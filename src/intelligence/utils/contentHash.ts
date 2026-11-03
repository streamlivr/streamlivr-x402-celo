import { createHash } from 'node:crypto';

/**
 * Produce a deterministic SHA-256 hex digest of a data record.
 *
 * Keys are sorted recursively so that `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }`
 * always yield the same hash. This is used for deduplication: if the hash of
 * freshly-fetched provider data matches the stored `content_hash` on
 * `enrichment_metadata`, we skip the write.
 */
export function computeContentHash(data: Record<string, unknown>): string {
    const normalized = JSON.stringify(sortKeys(data));
    return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Returns `true` when the incoming data would produce a different hash than
 * the one already stored, or when no hash has been stored yet (`null`).
 */
export function hasContentChanged(
    existingHash: string | null,
    newData: Record<string, unknown>,
): boolean {
    if (existingHash === null) return true;
    return computeContentHash(newData) !== existingHash;
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
