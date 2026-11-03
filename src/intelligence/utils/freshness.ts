/**
 * Freshness utilities for the enrichment pipeline.
 *
 * These pure functions decide whether a record needs re-enrichment based on
 * time intervals stored in the intelligence config.
 */

/**
 * Returns `true` if the record is stale — i.e. it was last enriched longer
 * ago than `refreshIntervalSeconds`, or has never been enriched at all.
 */
export function isStale(
    lastEnrichedAt: Date | null,
    refreshIntervalSeconds: number,
): boolean {
    if (lastEnrichedAt === null) return true;
    const ageMs = Date.now() - lastEnrichedAt.getTime();
    return ageMs >= refreshIntervalSeconds * 1000;
}

/**
 * Computes the next expected refresh timestamp.
 */
export function nextRefreshAt(
    lastSuccessfulAt: Date,
    refreshIntervalSeconds: number,
): Date {
    return new Date(lastSuccessfulAt.getTime() + refreshIntervalSeconds * 1000);
}

/**
 * Decides whether the enrichment worker should attempt (or re-attempt)
 * enrichment for a given entity.
 *
 * Returns `true` if:
 *  - The entity has never been enriched (no `lastSuccessfulAt`)
 *  - The entity is past its refresh window (`nextRefreshAt` is in the past)
 *  - The previous attempt failed AND retries remain
 */
export function shouldEnrich(
    metadata: {
        status: string;
        lastSuccessfulAt: Date | null;
        nextRefreshAt: Date | null;
        attempts: number;
    },
    maxRetries: number,
): boolean {
    // Never enriched — always enrich.
    if (metadata.lastSuccessfulAt === null) {
        // Unless already exhausted retries.
        if (metadata.status === 'failed' && metadata.attempts >= maxRetries) {
            return false;
        }
        return true;
    }

    // Past the refresh window.
    if (metadata.nextRefreshAt !== null && metadata.nextRefreshAt.getTime() <= Date.now()) {
        return true;
    }

    // Previous attempt failed with retries remaining.
    if (metadata.status === 'failed' && metadata.attempts < maxRetries) {
        return true;
    }

    return false;
}
