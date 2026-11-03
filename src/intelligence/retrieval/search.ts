/**
 * Unified search orchestrator for the intelligence engine.
 *
 * Receives a raw search request, validates it with zod, determines the
 * optimal search mode, generates a cache lookup query, builds the main
 * search query via the keyword / semantic / hybrid modules, applies filters,
 * ranking, and pagination, and returns a complete {@link SearchPlan} that
 * the caller can execute in Phase 4.
 */

import { z } from 'zod';
import type { EntityType } from '../types.js';
import { generateQueryHash } from '../utils/idempotency.js';
import { buildHybridQuery, type SearchFilters, type HybridQuery } from './hybrid.js';
import { buildCacheLookupQuery, shouldUseCache } from './cache.js';
import { defaultRankingConfig, type RankingConfig } from './ranking.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntelligenceSearchRequest {
    query?: string;
    entityTypes: EntityType[];
    embedding?: number[];
    filters?: SearchFilters;
    limit: number;
    offset?: number;
    rankingConfig?: Partial<RankingConfig>;
    accessScope?: string;
}

export interface SearchPlan {
    cacheQuery?: { sql: string; params: unknown[] };
    searchQuery: { sql: string; params: unknown[] };
    mode: 'keyword' | 'semantic' | 'hybrid';
    entityType: EntityType;
    pagination: { limit: number; offset: number };
}

export interface FilterClause {
    sql: string;
    params: unknown[];
}

// ---------------------------------------------------------------------------
// Zod schema for raw request parsing
// ---------------------------------------------------------------------------

const searchFiltersSchema = z.object({
    categories: z.array(z.string()).optional(),
    language: z.string().optional(),
    countryCode: z.string().optional(),
    isVerified: z.boolean().optional(),
    minFollowers: z.number().int().nonnegative().optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
}).optional();

const rankingConfigSchema = z.object({
    semanticWeight: z.number().min(0).max(1).optional(),
    keywordWeight: z.number().min(0).max(1).optional(),
    freshnessWeight: z.number().min(0).max(1).optional(),
    engagementWeight: z.number().min(0).max(1).optional(),
    verificationWeight: z.number().min(0).max(1).optional(),
}).optional();

const searchRequestSchema = z.object({
    query: z.string().trim().optional(),
    entityTypes: z
        .array(z.enum(['creator', 'content']))
        .nonempty('At least one entity type is required'),
    embedding: z.array(z.number()).optional(),
    filters: searchFiltersSchema,
    limit: z.number().int().positive().max(100).default(20),
    offset: z.number().int().nonnegative().default(0),
    rankingConfig: rankingConfigSchema,
    accessScope: z.string().default('public'),
});

// ---------------------------------------------------------------------------
// Request parser
// ---------------------------------------------------------------------------

/**
 * Validate and normalise an incoming search request.
 *
 * Query text is lowercased and trimmed. Defaults are applied for limit,
 * offset, and access scope when missing.
 */
export function parseSearchRequest(
    raw: Record<string, unknown>,
): IntelligenceSearchRequest {
    const parsed = searchRequestSchema.parse(raw);

    return {
        query: parsed.query?.toLowerCase().trim() || undefined,
        entityTypes: parsed.entityTypes as EntityType[],
        embedding: parsed.embedding,
        filters: parsed.filters as SearchFilters | undefined,
        limit: parsed.limit,
        offset: parsed.offset,
        rankingConfig: parsed.rankingConfig as Partial<RankingConfig> | undefined,
        accessScope: parsed.accessScope,
    };
}

// ---------------------------------------------------------------------------
// Filter clause builder
// ---------------------------------------------------------------------------

/**
 * Generate parameterised SQL WHERE clause fragments for each active filter.
 * These are independent of the search mode and can be appended to any query.
 */
export function buildFilterClauses(
    filters: SearchFilters,
    entityType: EntityType,
): FilterClause[] {
    const clauses: FilterClause[] = [];

    if (filters.categories && filters.categories.length > 0) {
        clauses.push({
            sql: `categories && $1::text[]`,
            params: [filters.categories],
        });
    }

    if (filters.language) {
        if (entityType === 'creator') {
            clauses.push({ sql: `$1 = ANY(languages)`, params: [filters.language] });
        } else {
            clauses.push({ sql: `language = $1`, params: [filters.language] });
        }
    }

    if (filters.countryCode) {
        clauses.push({
            sql: `EXISTS (SELECT 1 FROM "User" WHERE id = creator_id AND "countryCode" = $1)`,
            params: [filters.countryCode],
        });
    }

    if (filters.isVerified !== undefined) {
        clauses.push({
            sql: `EXISTS (SELECT 1 FROM "User" WHERE id = creator_id AND "isVerified" = $1)`,
            params: [filters.isVerified],
        });
    }

    if (filters.minFollowers !== undefined) {
        clauses.push({
            sql: `EXISTS (SELECT 1 FROM "User" WHERE id = creator_id AND "followerCount" >= $1)`,
            params: [filters.minFollowers],
        });
    }

    if (filters.minConfidence !== undefined) {
        clauses.push({
            sql: `confidence_score >= $1`,
            params: [filters.minConfidence],
        });
    }

    if (filters.dateFrom) {
        clauses.push({
            sql: `updated_at >= $1`,
            params: [filters.dateFrom],
        });
    }

    if (filters.dateTo) {
        clauses.push({
            sql: `updated_at <= $1`,
            params: [filters.dateTo],
        });
    }

    return clauses;
}

// ---------------------------------------------------------------------------
// Main search plan builder
// ---------------------------------------------------------------------------

/**
 * Build a complete {@link SearchPlan} from a validated search request.
 *
 * The plan includes:
 *  1. An optional cache lookup query (skipped when filters are too dynamic)
 *  2. The main search query (keyword, semantic, or hybrid)
 *  3. Pagination metadata
 */
export function buildSearchQuery(request: IntelligenceSearchRequest): SearchPlan {
    const {
        query,
        entityTypes,
        embedding,
        filters,
        limit,
        offset = 0,
        accessScope = 'public',
    } = request;

    // Use the first entity type for this plan. Multi-entity search would
    // generate one plan per type in Phase 4.
    const entityType = entityTypes[0]!;

    // -----------------------------------------------------------------------
    // Determine search mode
    // -----------------------------------------------------------------------
    const hasQuery = query !== undefined && query.length > 0;
    const hasEmbedding = embedding !== undefined && embedding.length > 0;

    let mode: 'keyword' | 'semantic' | 'hybrid';
    if (hasQuery && hasEmbedding) {
        mode = 'hybrid';
    } else if (hasEmbedding) {
        mode = 'semantic';
    } else {
        mode = 'keyword';
    }

    // -----------------------------------------------------------------------
    // Tokenise query text
    // -----------------------------------------------------------------------
    const keywordTokens = hasQuery
        ? query.split(/\s+/).filter((t) => t.length > 0)
        : undefined;

    // -----------------------------------------------------------------------
    // Cache lookup
    // -----------------------------------------------------------------------
    let cacheQuery: { sql: string; params: unknown[] } | undefined;
    if (shouldUseCache(filters)) {
        const queryHash = generateQueryHash(
            query ?? '',
            (filters as Record<string, unknown>) ?? {},
            accessScope,
        );
        cacheQuery = buildCacheLookupQuery(queryHash, accessScope);
    }

    // -----------------------------------------------------------------------
    // Main search query
    // -----------------------------------------------------------------------
    const hybridResult: HybridQuery = buildHybridQuery({
        entityType,
        keywordTokens,
        keywordMatch: 'all',
        embedding,
        keywordWeight: request.rankingConfig?.keywordWeight,
        semanticWeight: request.rankingConfig?.semanticWeight,
        filters,
        limit,
        offset,
    });

    return {
        cacheQuery,
        searchQuery: { sql: hybridResult.sql, params: hybridResult.params },
        mode: hybridResult.mode,
        entityType,
        pagination: { limit, offset },
    };
}
