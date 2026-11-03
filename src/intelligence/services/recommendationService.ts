/**
 * Recommendation service for the intelligence engine.
 *
 * Provides configurable relevance-based recommendations: similar creators,
 * related content, creator discovery, and trending queries. All methods
 * return query plans (SQL + params) — no database execution.
 */

import type { EntityType } from '../types.js';
import { buildSearchQuery, parseSearchRequest, type SearchPlan } from '../retrieval/search.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveryContext {
    interests: string[];
    categories: string[];
    recentInteractions?: string[];
    excludeCreatorIds?: string[];
}

export interface RecommendationCandidate {
    id: string;
    entityType: EntityType;
    categories: string[];
    topics: string[];
    semanticScore?: number;
    isVerified?: boolean;
    updatedAt?: Date;
}

export interface RecommendationContext {
    userCategories: string[];
    userTopics: string[];
    userInteractions: string[];
}

export interface TrendingQuery {
    sql: string;
    params: unknown[];
}

export interface RecommendationService {
    buildSimilarCreatorsQuery(creatorId: string, limit: number): SearchPlan;
    buildRelatedContentQuery(contentId: string, limit: number): SearchPlan;
    buildCreatorDiscoveryQuery(context: DiscoveryContext): SearchPlan;
    buildTrendingQuery(entityType: EntityType, limit: number, windowHours?: number): TrendingQuery;
    scoreRecommendation(candidate: RecommendationCandidate, context: RecommendationContext): number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default minimum cosine similarity threshold for vector recommendations. */
const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

/** Default trending window in hours. */
const DEFAULT_TRENDING_WINDOW_HOURS = 72;

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------

const SCORE_WEIGHTS = {
    semantic: 0.40,
    categoryOverlap: 0.25,
    topicOverlap: 0.20,
    freshness: 0.10,
    verification: 0.05,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the Jaccard-like overlap ratio between two string arrays.
 * Returns 0 when both arrays are empty, and a value in [0, 1] otherwise.
 */
export function overlapRatio(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) return 0;
    const setA = new Set(a.map((s) => s.toLowerCase()));
    const setB = new Set(b.map((s) => s.toLowerCase()));
    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }
    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? intersection / union : 0;
}

/**
 * Freshness score: exponential decay over days since last update.
 * Returns a value in [0, 1] where 1 = just updated, ~0.5 = 7 days ago.
 */
function freshnessScore(updatedAt?: Date): number {
    if (!updatedAt) return 0;
    const ageDays = (Date.now() - updatedAt.getTime()) / 86_400_000;
    return 1 / (1 + ageDays / 7);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a recommendation service that builds query plans for
 * relevance-based recommendations.
 */
export function createRecommendationService(): RecommendationService {
    function buildSimilarCreatorsQuery(creatorId: string, limit: number): SearchPlan {
        // Use pgvector cosine similarity with the creator's existing embedding
        const sql = [
            `WITH source AS (`,
            `  SELECT embedding FROM creator_intelligence WHERE creator_id = $1`,
            `)`,
            `SELECT ci.*, 1 - (ci.embedding <=> source.embedding) AS semantic_score`,
            `FROM creator_intelligence ci, source`,
            `WHERE ci.creator_id != $1`,
            `  AND ci.embedding IS NOT NULL`,
            `  AND source.embedding IS NOT NULL`,
            `  AND 1 - (ci.embedding <=> source.embedding) >= ${DEFAULT_SIMILARITY_THRESHOLD}`,
            `ORDER BY ci.embedding <=> source.embedding ASC`,
            `LIMIT $2`,
        ].join('\n');

        return {
            searchQuery: { sql, params: [creatorId, limit] },
            mode: 'semantic',
            entityType: 'creator',
            pagination: { limit, offset: 0 },
        };
    }

    function buildRelatedContentQuery(contentId: string, limit: number): SearchPlan {
        const sql = [
            `WITH source AS (`,
            `  SELECT content_embedding FROM content_intelligence WHERE content_id = $1`,
            `)`,
            `SELECT ci.*, 1 - (ci.content_embedding <=> source.content_embedding) AS semantic_score`,
            `FROM content_intelligence ci, source`,
            `WHERE ci.content_id != $1`,
            `  AND ci.content_embedding IS NOT NULL`,
            `  AND source.content_embedding IS NOT NULL`,
            `  AND 1 - (ci.content_embedding <=> source.content_embedding) >= ${DEFAULT_SIMILARITY_THRESHOLD}`,
            `ORDER BY ci.content_embedding <=> source.content_embedding ASC`,
            `LIMIT $2`,
        ].join('\n');

        return {
            searchQuery: { sql, params: [contentId, limit] },
            mode: 'semantic',
            entityType: 'content',
            pagination: { limit, offset: 0 },
        };
    }

    function buildCreatorDiscoveryQuery(context: DiscoveryContext): SearchPlan {
        // Build a hybrid search combining keyword interests and category filters
        const query = [...context.interests, ...context.categories].join(' ');

        const parsed = parseSearchRequest({
            query: query || undefined,
            entityTypes: ['creator'],
            filters: {
                categories: context.categories.length > 0 ? context.categories : undefined,
            },
            limit: 20,
        });

        const plan = buildSearchQuery(parsed);

        // If there are creators to exclude, wrap the plan's SQL
        if (context.excludeCreatorIds && context.excludeCreatorIds.length > 0) {
            const excludeList = context.excludeCreatorIds
                .map((_, i) => `$${plan.searchQuery.params.length + i + 1}`)
                .join(', ');

            plan.searchQuery.sql = [
                `SELECT * FROM (`,
                plan.searchQuery.sql,
                `) sub`,
                `WHERE sub.creator_id NOT IN (${excludeList})`,
            ].join('\n');

            plan.searchQuery.params.push(...context.excludeCreatorIds);
        }

        return plan;
    }

    function buildTrendingQuery(
        entityType: EntityType,
        limit: number,
        windowHours?: number,
    ): TrendingQuery {
        const hours = windowHours ?? DEFAULT_TRENDING_WINDOW_HOURS;
        const table = entityType === 'creator' ? 'creator_intelligence' : 'content_intelligence';
        const idColumn = entityType === 'creator' ? 'creator_id' : 'content_id';

        const sql = [
            `SELECT t.*, em.last_successful_at,`,
            `  COALESCE((t.engagement_signals->>'quality_score')::float, 0) AS quality_score,`,
            `  1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - em.last_successful_at)) / 86400) AS freshness_score`,
            `FROM ${table} t`,
            `INNER JOIN enrichment_metadata em`,
            `  ON em.entity_type = $1 AND em.entity_id = t.${idColumn}`,
            `WHERE em.last_successful_at >= NOW() - INTERVAL '${Number(hours)} hours'`,
            `  AND em.status = 'completed'`,
            `ORDER BY`,
            `  COALESCE((t.engagement_signals->>'quality_score')::float, 0) * 0.6`,
            `  + (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - em.last_successful_at)) / 86400)) * 0.4`,
            `  DESC`,
            `LIMIT $2`,
        ].join('\n');

        return { sql, params: [entityType, limit] };
    }

    function scoreRecommendation(
        candidate: RecommendationCandidate,
        context: RecommendationContext,
    ): number {
        let score = 0;

        // Semantic similarity (40%)
        score += SCORE_WEIGHTS.semantic * (candidate.semanticScore ?? 0);

        // Category overlap (25%)
        score += SCORE_WEIGHTS.categoryOverlap * overlapRatio(
            candidate.categories,
            context.userCategories,
        );

        // Topic overlap (20%)
        score += SCORE_WEIGHTS.topicOverlap * overlapRatio(
            candidate.topics,
            context.userTopics,
        );

        // Freshness bonus (10%)
        score += SCORE_WEIGHTS.freshness * freshnessScore(candidate.updatedAt);

        // Verification bonus (5%)
        if (candidate.isVerified) {
            score += SCORE_WEIGHTS.verification;
        }

        // Clamp to [0, 1]
        return Math.max(0, Math.min(1, score));
    }

    return {
        buildSimilarCreatorsQuery,
        buildRelatedContentQuery,
        buildCreatorDiscoveryQuery,
        buildTrendingQuery,
        scoreRecommendation,
    };
}
