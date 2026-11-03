/**
 * Hybrid search combining keyword (tsvector) and semantic (pgvector) results.
 *
 * Uses Reciprocal Rank Fusion (RRF) to merge result sets from the two
 * retrieval modes into a single relevance-ordered list. Generates a complete
 * SQL query string with CTEs — one per search mode — that the caller can
 * execute against the database in Phase 4.
 */

import type { EntityType } from '../types.js';
import { buildCreatorKeywordQuery, buildContentKeywordQuery, tokensToTsQuery } from './keyword.js';
import { formatEmbeddingParam } from './semantic.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard RRF constant — dampens the impact of very high ranks. */
const RRF_K = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchFilters {
    categories?: string[];
    language?: string;
    countryCode?: string;
    isVerified?: boolean;
    minFollowers?: number;
    minConfidence?: number;
    dateFrom?: Date;
    dateTo?: Date;
}

export interface HybridSearchOptions {
    entityType: EntityType;
    keywordTokens?: string[];
    keywordMatch?: 'all' | 'any';
    embedding?: number[];
    keywordWeight?: number;
    semanticWeight?: number;
    filters?: SearchFilters;
    limit: number;
    offset?: number;
}

export interface HybridQuery {
    sql: string;
    params: unknown[];
    mode: 'keyword' | 'semantic' | 'hybrid';
}

// ---------------------------------------------------------------------------
// Weight normalisation
// ---------------------------------------------------------------------------

/**
 * Clamp both weights to [0, 1] then normalise so they sum to 1.0.
 * If both are zero, default to equal weights.
 */
export function normalizeWeights(
    keywordWeight: number,
    semanticWeight: number,
): { keyword: number; semantic: number } {
    let kw = Math.max(0, Math.min(1, keywordWeight));
    let sw = Math.max(0, Math.min(1, semanticWeight));

    const total = kw + sw;
    if (total === 0) return { keyword: 0.5, semantic: 0.5 };

    kw = kw / total;
    sw = sw / total;

    return { keyword: kw, semantic: sw };
}

// ---------------------------------------------------------------------------
// Hybrid query builder
// ---------------------------------------------------------------------------

/**
 * Build a hybrid search query that combines keyword and semantic signals
 * using Reciprocal Rank Fusion.
 *
 * Supports three modes:
 *  - **keyword-only** — when only `keywordTokens` are provided
 *  - **semantic-only** — when only `embedding` is provided
 *  - **hybrid** — when both are provided
 */
export function buildHybridQuery(options: HybridSearchOptions): HybridQuery {
    const {
        entityType,
        keywordTokens,
        keywordMatch = 'all',
        embedding,
        keywordWeight = 0.5,
        semanticWeight = 0.5,
        filters,
        limit,
        offset = 0,
    } = options;

    const hasKeyword = keywordTokens !== undefined && keywordTokens.length > 0;
    const hasSemantic = embedding !== undefined && embedding.length > 0;

    const table = entityType === 'creator'
        ? 'creator_intelligence'
        : 'content_intelligence';

    const embeddingColumn = entityType === 'creator' ? 'embedding' : 'content_embedding';

    // Collect parameterised values — $1, $2, etc.
    const params: unknown[] = [];
    let paramIndex = 1;

    // -----------------------------------------------------------------------
    // Filter clauses
    // -----------------------------------------------------------------------
    const filterClauses = buildFilterFragments(filters, entityType, params, paramIndex);
    paramIndex += filterClauses.paramCount;
    const filterWhere = filterClauses.clauses.length > 0
        ? ` AND ${filterClauses.clauses.join(' AND ')}`
        : '';

    // -----------------------------------------------------------------------
    // Keyword-only mode
    // -----------------------------------------------------------------------
    if (hasKeyword && !hasSemantic) {
        const operator = keywordMatch === 'all' ? '&' : '|';
        const tsQuery = tokensToTsQuery(keywordTokens, operator);
        params.push(tsQuery);
        const tsParam = `$${paramIndex}`;
        paramIndex += 1;

        const sql = [
            `SELECT *, ts_rank_cd(search_vector, to_tsquery('english', ${tsParam})) AS keyword_score`,
            `FROM ${table}`,
            `WHERE search_vector @@ to_tsquery('english', ${tsParam})${filterWhere}`,
            `ORDER BY keyword_score DESC`,
            `LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
        ].join('\n');

        return { sql, params, mode: 'keyword' };
    }

    // -----------------------------------------------------------------------
    // Semantic-only mode
    // -----------------------------------------------------------------------
    if (!hasKeyword && hasSemantic) {
        const embeddingLiteral = formatEmbeddingParam(embedding);
        params.push(embeddingLiteral);
        const embParam = `$${paramIndex}`;
        paramIndex += 1;

        const sql = [
            `SELECT *, 1 - (${embeddingColumn} <=> ${embParam}::vector) AS semantic_score`,
            `FROM ${table}`,
            `WHERE ${embeddingColumn} IS NOT NULL${filterWhere}`,
            `ORDER BY ${embeddingColumn} <=> ${embParam}::vector ASC`,
            `LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
        ].join('\n');

        return { sql, params, mode: 'semantic' };
    }

    // -----------------------------------------------------------------------
    // Hybrid mode (RRF)
    // -----------------------------------------------------------------------
    if (hasKeyword && hasSemantic) {
        const weights = normalizeWeights(keywordWeight, semanticWeight);

        const operator = keywordMatch === 'all' ? '&' : '|';
        const tsQuery = tokensToTsQuery(keywordTokens, operator);
        params.push(tsQuery);
        const tsParam = `$${paramIndex}`;
        paramIndex += 1;

        const embeddingLiteral = formatEmbeddingParam(embedding);
        params.push(embeddingLiteral);
        const embParam = `$${paramIndex}`;
        paramIndex += 1;

        const sql = [
            `WITH keyword_cte AS (`,
            `  SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, to_tsquery('english', ${tsParam})) DESC) AS keyword_rank`,
            `  FROM ${table}`,
            `  WHERE search_vector @@ to_tsquery('english', ${tsParam})${filterWhere}`,
            `),`,
            `semantic_cte AS (`,
            `  SELECT id, ROW_NUMBER() OVER (ORDER BY ${embeddingColumn} <=> ${embParam}::vector ASC) AS semantic_rank`,
            `  FROM ${table}`,
            `  WHERE ${embeddingColumn} IS NOT NULL${filterWhere}`,
            `)`,
            `SELECT t.*,`,
            `  COALESCE(${weights.keyword} / (${RRF_K} + k.keyword_rank), 0) + COALESCE(${weights.semantic} / (${RRF_K} + s.semantic_rank), 0) AS hybrid_score`,
            `FROM ${table} t`,
            `LEFT JOIN keyword_cte k ON k.id = t.id`,
            `LEFT JOIN semantic_cte s ON s.id = t.id`,
            `WHERE (k.id IS NOT NULL OR s.id IS NOT NULL)`,
            `ORDER BY hybrid_score DESC`,
            `LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
        ].join('\n');

        return { sql, params, mode: 'hybrid' };
    }

    // -----------------------------------------------------------------------
    // Fallback — no search signals at all
    // -----------------------------------------------------------------------
    const sql = [
        `SELECT *`,
        `FROM ${table}`,
        `WHERE 1 = 1${filterWhere}`,
        `ORDER BY updated_at DESC`,
        `LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    ].join('\n');

    return { sql, params, mode: 'keyword' };
}

// ---------------------------------------------------------------------------
// Internal filter helpers
// ---------------------------------------------------------------------------

function buildFilterFragments(
    filters: SearchFilters | undefined,
    entityType: EntityType,
    params: unknown[],
    startIndex: number,
): { clauses: string[]; paramCount: number } {
    if (!filters) return { clauses: [], paramCount: 0 };

    const clauses: string[] = [];
    let idx = startIndex;

    if (filters.categories && filters.categories.length > 0) {
        params.push(filters.categories);
        clauses.push(`categories && $${idx}::text[]`);
        idx += 1;
    }

    if (filters.language) {
        params.push(filters.language);
        if (entityType === 'creator') {
            clauses.push(`$${idx} = ANY(languages)`);
        } else {
            clauses.push(`language = $${idx}`);
        }
        idx += 1;
    }

    if (filters.countryCode) {
        params.push(filters.countryCode);
        clauses.push(`EXISTS (SELECT 1 FROM "User" WHERE id = creator_id AND "countryCode" = $${idx})`);
        idx += 1;
    }

    if (filters.isVerified !== undefined) {
        params.push(filters.isVerified);
        clauses.push(`EXISTS (SELECT 1 FROM "User" WHERE id = creator_id AND "isVerified" = $${idx})`);
        idx += 1;
    }

    if (filters.minFollowers !== undefined) {
        params.push(filters.minFollowers);
        clauses.push(`EXISTS (SELECT 1 FROM "User" WHERE id = creator_id AND "followerCount" >= $${idx})`);
        idx += 1;
    }

    if (filters.minConfidence !== undefined) {
        params.push(filters.minConfidence);
        clauses.push(`confidence_score >= $${idx}`);
        idx += 1;
    }

    if (filters.dateFrom) {
        params.push(filters.dateFrom.toISOString());
        clauses.push(`updated_at >= $${idx}`);
        idx += 1;
    }

    if (filters.dateTo) {
        params.push(filters.dateTo.toISOString());
        clauses.push(`updated_at <= $${idx}`);
        idx += 1;
    }

    return { clauses, paramCount: idx - startIndex };
}
