/**
 * TypeScript type definitions for the intelligence database tables.
 *
 * These mirror the SQL tables defined in the migration files and give
 * type-safe access without requiring an ORM in this repository.
 */

// ---------------------------------------------------------------------------
// Union / enum types
// ---------------------------------------------------------------------------

export type EnrichmentStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type VerificationStatus = 'unlinked' | 'linked' | 'verified';

export type AttributionStatus =
    | 'verified_linked'
    | 'linked_unverified'
    | 'unlinked'
    | 'unknown'
    | 'platform_owned'
    | 'ineligible';

export type RetentionPolicy = 'standard' | 'x_api_30d' | 'indefinite';

export type EntityType = 'creator' | 'content';

export type ProviderName = 'x_api' | 'firecrawl' | 'native' | 'ai_refinement';

// ---------------------------------------------------------------------------
// Table row interfaces
// ---------------------------------------------------------------------------

export interface CreatorIntelligence {
    id: string; // UUID
    creatorId: string;
    categories: string[];
    topics: string[];
    languages: string[];
    biographySummary: string | null;
    crossPlatformPresence: Record<string, unknown>;
    engagementSignals: Record<string, unknown>;
    growthSignals: Record<string, unknown>;
    recommendationFeatures: Record<string, unknown>;
    confidenceScore: number;
    embedding: number[] | null; // vector(1536)
    embeddingModel: string | null;
    intelligenceVersion: string;
    lastEnrichedAt: Date | null;
    searchVector?: string; // tsvector — opaque in TS
    createdAt: Date;
    updatedAt: Date;
}

export interface ContentIntelligence {
    id: string; // UUID
    contentId: string;
    creatorId: string | null;
    summary: string | null;
    topics: string[];
    categories: string[];
    language: string | null;
    contentEmbedding: number[] | null; // vector(1536)
    embeddingModel: string | null;
    confidenceScore: number;
    intelligenceVersion: string;
    searchVector?: string; // tsvector — opaque in TS
    createdAt: Date;
    updatedAt: Date;
}

export interface ExternalIdentityLink {
    id: string; // UUID
    creatorId: string;
    provider: string;
    externalAccountId: string;
    externalUsername: string | null;
    linked: boolean;
    verificationStatus: VerificationStatus;
    linkedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface EnrichmentMetadata {
    id: string; // UUID
    entityType: EntityType;
    entityId: string;
    provider: ProviderName;
    status: EnrichmentStatus;
    lastAttemptedAt: Date | null;
    lastSuccessfulAt: Date | null;
    nextRefreshAt: Date | null;
    contentHash: string | null;
    errorMessage: string | null;
    attempts: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface DataProvenance {
    id: string; // UUID
    entityType: EntityType;
    entityId: string;
    sourceType: ProviderName;
    sourceReference: string | null;
    retrievedAt: Date;
    retentionPolicy: RetentionPolicy | null;
    attributionEligible: boolean;
    metadata: Record<string, unknown>;
}

export interface IntelligenceQueryCache {
    id: string; // UUID
    queryHash: string;
    normalizedQuery: string | null;
    filters: Record<string, unknown>;
    result: Record<string, unknown> | null;
    resultCount: number;
    createdAt: Date;
    expiresAt: Date;
    accessScope: string;
}

export interface IntelligenceAttribution {
    id: string; // UUID
    requestId: string;
    creatorId: string | null;
    dataEntityId: string | null;
    dataEntityType: EntityType | null;
    attributableValueAtomic: string; // BigInt string — never float
    attributionStatus: AttributionStatus;
    verificationSnapshot: Record<string, unknown> | null;
    createdAt: Date;
}
