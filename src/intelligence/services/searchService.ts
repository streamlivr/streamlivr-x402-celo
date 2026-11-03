/**
 * Shared search API service for the intelligence engine.
 *
 * Orchestrates the search pipeline for both MCP/agent and in-app consumers.
 * Operates at the query-plan level — it assembles the SQL plan + response
 * builder metadata without executing against a database.
 */

import type { EntityType } from '../types.js';
import type { SearchFilters } from '../retrieval/hybrid.js';
import type { RankingConfig } from '../retrieval/ranking.js';
import { defaultRankingConfig } from '../retrieval/ranking.js';
import {
    parseSearchRequest,
    buildSearchQuery,
    type SearchPlan,
    type IntelligenceSearchRequest,
} from '../retrieval/search.js';
import { buildCacheLookupQuery } from '../retrieval/cache.js';
import { generateQueryHash } from '../utils/idempotency.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchServiceConfig {
    defaultLimit: number;
    maxLimit: number;
    cacheTtlSeconds: number;
    rankingConfig: RankingConfig;
    embeddingDimensions: number;
}

export interface SearchServiceRequest {
    query?: string;
    entityTypes?: EntityType[];
    filters?: SearchFilters;
    limit?: number;
    offset?: number;
    accessScope?: string;
}

export interface SearchServiceResponse {
    plan: SearchPlan;
    responseBuilder: string;
    metadata: {
        mode: string;
        cached: boolean;
        queryHash: string;
    };
}

export interface CreatorIntelligenceQuery {
    sql: string;
    params: unknown[];
}

export interface ContentIntelligenceQuery {
    sql: string;
    params: unknown[];
}

export interface SearchService {
    search(request: SearchServiceRequest): SearchServiceResponse;
    searchCreators(query: string, filters?: SearchFilters, limit?: number): SearchPlan;
    searchContent(query: string, filters?: SearchFilters, limit?: number): SearchPlan;
    getCreatorIntelligence(creatorId: string): CreatorIntelligenceQuery;
    getContentIntelligence(contentId: string): ContentIntelligenceQuery;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultSearchServiceConfig(): SearchServiceConfig {
    return {
        defaultLimit: 20,
        maxLimit: 100,
        cacheTtlSeconds: 3600,
        rankingConfig: defaultRankingConfig(),
        embeddingDimensions: 1536,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the response builder name based on entity types in the request.
 */
function resolveResponseBuilder(entityTypes: EntityType[]): string {
    if (entityTypes.length === 1 && entityTypes[0] === 'creator') {
        return 'buildCreatorSearchResponse';
    }
    if (entityTypes.length === 1 && entityTypes[0] === 'content') {
        return 'buildContentSearchResponse';
    }
    return 'buildUnifiedSearchResponse';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a search service that orchestrates the intelligence search pipeline.
 *
 * The service coordinates parsing, caching, query building, and response
 * builder selection without executing any SQL. The caller wires in the
 * actual database layer when integrating with Fastify.
 */
export function createSearchService(
    config?: Partial<SearchServiceConfig>,
): SearchService {
    const cfg: SearchServiceConfig = {
        ...defaultSearchServiceConfig(),
        ...config,
    };

    function search(request: SearchServiceRequest): SearchServiceResponse {
        const entityTypes: EntityType[] = request.entityTypes ?? ['creator', 'content'];
        const limit = Math.min(request.limit ?? cfg.defaultLimit, cfg.maxLimit);

        // Parse and validate through zod
        const parsed: IntelligenceSearchRequest = parseSearchRequest({
            query: request.query,
            entityTypes,
            filters: request.filters,
            limit,
            offset: request.offset ?? 0,
            accessScope: request.accessScope ?? 'public',
        });

        // Build the search plan
        const plan = buildSearchQuery(parsed);

        // Compute query hash for cache coordination
        const queryHash = generateQueryHash(
            request.query ?? '',
            (request.filters as Record<string, unknown>) ?? {},
            request.accessScope ?? 'public',
        );

        // Determine the response builder
        const responseBuilder = resolveResponseBuilder(entityTypes);

        return {
            plan,
            responseBuilder,
            metadata: {
                mode: plan.mode,
                cached: plan.cacheQuery !== undefined,
                queryHash,
            },
        };
    }

    function searchCreators(
        query: string,
        filters?: SearchFilters,
        limit?: number,
    ): SearchPlan {
        const parsed = parseSearchRequest({
            query,
            entityTypes: ['creator'],
            filters,
            limit: Math.min(limit ?? cfg.defaultLimit, cfg.maxLimit),
        });
        return buildSearchQuery(parsed);
    }

    function searchContent(
        query: string,
        filters?: SearchFilters,
        limit?: number,
    ): SearchPlan {
        const parsed = parseSearchRequest({
            query,
            entityTypes: ['content'],
            filters,
            limit: Math.min(limit ?? cfg.defaultLimit, cfg.maxLimit),
        });
        return buildSearchQuery(parsed);
    }

    function getCreatorIntelligence(creatorId: string): CreatorIntelligenceQuery {
        const sql = [
            `SELECT ci.*, eil.provider, eil.external_username, eil.verification_status,`,
            `  dp.source_type, dp.retrieved_at, dp.retention_policy`,
            `FROM creator_intelligence ci`,
            `LEFT JOIN external_identity_link eil ON eil.creator_id = ci.creator_id`,
            `LEFT JOIN data_provenance dp ON dp.entity_type = 'creator' AND dp.entity_id = ci.creator_id`,
            `WHERE ci.creator_id = $1`,
        ].join('\n');

        return { sql, params: [creatorId] };
    }

    function getContentIntelligence(contentId: string): ContentIntelligenceQuery {
        const sql = [
            `SELECT ci.*,`,
            `  dp.source_type, dp.retrieved_at, dp.retention_policy`,
            `FROM content_intelligence ci`,
            `LEFT JOIN data_provenance dp ON dp.entity_type = 'content' AND dp.entity_id = ci.content_id`,
            `WHERE ci.content_id = $1`,
        ].join('\n');

        return { sql, params: [contentId] };
    }

    return {
        search,
        searchCreators,
        searchContent,
        getCreatorIntelligence,
        getContentIntelligence,
    };
}
