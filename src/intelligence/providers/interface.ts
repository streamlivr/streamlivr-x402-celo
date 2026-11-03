/**
 * Enrichment provider interface — the contract every external data adapter
 * must implement.
 *
 * Phase 1 defines the interface only. Concrete adapters (X API, Firecrawl,
 * native) are implemented in Phase 2.
 */

import type { EntityType, ProviderName, RetentionPolicy } from '../types.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface EnrichmentResult {
    /** Whether the enrichment call succeeded end-to-end. */
    success: boolean;
    /** Canonical provider name. */
    provider: ProviderName;
    /** Entity class — `creator` or `content`. */
    entityType: EntityType;
    /** Primary key of the entity being enriched. */
    entityId: string;
    /**
     * Provider response normalised to a flat record suitable for merging
     * into the intelligence tables.
     */
    normalizedData: Record<string, unknown>;
    /** SHA-256 hex digest of the raw response payload for deduplication. */
    rawDataHash: string;
    /** Timestamp the data was retrieved from the provider. */
    retrievedAt: Date;
    /** Data retention policy that governs how long the data may be kept. */
    retentionPolicy: RetentionPolicy;
    /** Whether this data can carry revenue attribution to its creator. */
    attributionEligible: boolean;
    /** AI-assigned confidence in the quality of the normalised data (0–1). */
    confidenceScore: number;
}

export interface ProviderUsage {
    /** Canonical provider name. */
    provider: ProviderName;
    /** Number of API requests made during the current UTC day. */
    requestsToday: number;
    /** Estimated USD cost accrued today. */
    costEstimateUsd: number;
    /** Remaining rate-limit credits, or `null` if the provider doesn't report it. */
    rateLimitRemaining: number | null;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface EnrichmentProvider {
    /** Unique, stable name matching the `ProviderName` union. */
    readonly name: ProviderName;

    /**
     * Fetch and normalise intelligence data for a creator.
     *
     * Implementations are responsible for:
     *  - API authentication and rate limiting
     *  - Response normalisation into the intelligence schema
     *  - Computing `rawDataHash` for dedup
     */
    enrichCreator(input: {
        creatorId: string;
        externalIdentifiers?: Record<string, string>;
        existingData?: Record<string, unknown>;
    }): Promise<EnrichmentResult>;

    /**
     * Fetch and normalise intelligence data for a piece of content.
     * Optional — not every provider supports content-level enrichment.
     */
    enrichContent?(input: {
        contentId?: string;
        url?: string;
    }): Promise<EnrichmentResult>;

    /**
     * Return current usage/cost metrics for the provider.
     * Optional — used for dashboard reporting and cost tracking.
     */
    getUsageCost?(): Promise<ProviderUsage>;
}
