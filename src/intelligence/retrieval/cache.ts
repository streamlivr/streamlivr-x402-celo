/**
 * Query-level caching logic for the intelligence search engine.
 *
 * Generates SQL for cache lookup, insert (upsert), and invalidation against
 * the `intelligence_query_cache` table defined in migration 002. None of
 * these functions execute queries — they return `{ sql, params }` tuples.
 */

import { ENRICHMENT_QUERY_CACHE_TTL } from '../config.js';
import type { EntityType } from '../types.js';
import type { SearchFilters } from './hybrid.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheEntry {
    queryHash: string;
    normalizedQuery: string;
    filters: Record<string, unknown>;
    result: unknown;
    accessScope: string;
    ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Cache lookup
// ---------------------------------------------------------------------------

/**
 * Build a SELECT that fetches a non-expired cache row matching the given
 * query hash and access scope.
 */
export function buildCacheLookupQuery(
    queryHash: string,
    accessScope: string,
): { sql: string; params: unknown[] } {
    const sql = [
        `SELECT id, query_hash, normalized_query, filters, result, result_count, created_at, expires_at, access_scope`,
        `FROM intelligence_query_cache`,
        `WHERE query_hash = $1 AND access_scope = $2 AND expires_at > NOW()`,
    ].join('\n');

    return { sql, params: [queryHash, accessScope] };
}

// ---------------------------------------------------------------------------
// Cache insert (upsert)
// ---------------------------------------------------------------------------

/**
 * Build an INSERT … ON CONFLICT DO UPDATE that writes a cache row, replacing
 * an existing row with the same (query_hash, access_scope) pair.
 *
 * `expires_at` is computed as `NOW() + ttlSeconds` (falls back to the
 * env-configured {@link ENRICHMENT_QUERY_CACHE_TTL} when the entry omits it).
 */
export function buildCacheInsertQuery(
    entry: CacheEntry,
): { sql: string; params: unknown[] } {
    const ttl = entry.ttlSeconds > 0 ? entry.ttlSeconds : ENRICHMENT_QUERY_CACHE_TTL;

    const sql = [
        `INSERT INTO intelligence_query_cache`,
        `  (query_hash, normalized_query, filters, result, result_count, access_scope, expires_at)`,
        `VALUES`,
        `  ($1, $2, $3::jsonb, $4::jsonb, COALESCE(jsonb_array_length($4::jsonb), 0), $5, NOW() + INTERVAL '${Number(ttl)} seconds')`,
        `ON CONFLICT (query_hash, access_scope) DO UPDATE SET`,
        `  normalized_query = EXCLUDED.normalized_query,`,
        `  filters = EXCLUDED.filters,`,
        `  result = EXCLUDED.result,`,
        `  result_count = EXCLUDED.result_count,`,
        `  expires_at = EXCLUDED.expires_at`,
    ].join('\n');

    return {
        sql,
        params: [
            entry.queryHash,
            entry.normalizedQuery,
            JSON.stringify(entry.filters),
            JSON.stringify(entry.result),
            entry.accessScope,
        ],
    };
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

/**
 * Build a DELETE that removes cache rows whose JSON `result` contains a
 * reference to the given entity. Uses JSONB containment (`@>`) to match
 * any result that embeds the entity ID.
 */
export function buildCacheInvalidationQuery(
    entityType: EntityType,
    entityId: string,
): { sql: string; params: unknown[] } {
    const pattern = JSON.stringify({ entityType, entityId });

    const sql = [
        `DELETE FROM intelligence_query_cache`,
        `WHERE result @> $1::jsonb`,
    ].join('\n');

    return { sql, params: [pattern] };
}

// ---------------------------------------------------------------------------
// Cache eligibility
// ---------------------------------------------------------------------------

/**
 * Decide whether a search with the given filters should consult the cache.
 *
 * User-specific or rapidly-changing criteria make cached results unreliable,
 * so the cache is bypassed for those queries.
 */
export function shouldUseCache(filters: SearchFilters | undefined): boolean {
    if (!filters) return true;

    // Date-range filters are time-sensitive — results change by the second.
    if (filters.dateFrom || filters.dateTo) return false;

    // Follower-count filters reflect live state.
    if (filters.minFollowers !== undefined) return false;

    // Everything else (categories, language, country, verified, confidence)
    // changes slowly enough that a TTL-bounded cache is acceptable.
    return true;
}
