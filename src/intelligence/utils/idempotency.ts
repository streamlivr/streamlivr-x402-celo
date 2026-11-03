import { createHash } from 'node:crypto';

/**
 * Deterministic key for deduplicating enrichment jobs.
 *
 * Two workers that pick up the same (entity, provider) pair will generate the
 * same key, so the second one can detect the duplicate.
 */
export function generateEnrichmentKey(
    entityType: string,
    entityId: string,
    provider: string,
): string {
    return `enrich:${entityType}:${entityId}:${provider}`;
}

/**
 * SHA-256 digest that uniquely identifies a search query + its filters and
 * access scope. Used as the `query_hash` column in `intelligence_query_cache`.
 *
 * Filter key ordering is normalised so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }`
 * produce the same hash.
 */
export function generateQueryHash(
    query: string,
    filters: Record<string, unknown>,
    accessScope: string,
): string {
    const payload = JSON.stringify({
        accessScope,
        filters: sortKeys(filters),
        query: query.trim().toLowerCase(),
    });
    return createHash('sha256').update(payload).digest('hex');
}

/**
 * Deterministic key for preventing duplicate `intelligence_attribution` rows
 * for the same (request, creator) pair.
 */
export function generateAttributionKey(
    requestId: string,
    creatorId: string | null,
): string {
    return `attr:${requestId}:${creatorId ?? 'platform'}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sortKeys(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(sortKeys);
    if (typeof value === 'object') {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
        }
        return sorted;
    }
    return value;
}
