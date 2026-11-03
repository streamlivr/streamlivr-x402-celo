/**
 * Intelligence route response builders.
 *
 * Defines the response shapes for each intelligence endpoint and provides
 * builder functions that assemble standardised responses from internal data.
 * These are pure functions with no Fastify or server dependency — the actual
 * Fastify plugin wires them to HTTP routes.
 */
import type { CreatorIntelligence, ContentIntelligence } from './types.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface PageInfo {
    total: number;
    limit: number;
    returned: number;
    hasMore: boolean;
    nextCursor: string | null;
    truncated: boolean;
}

export interface AttributionInfo {
    creatorId: string | null;
    basis: string;
    note: string;
}

// ---------------------------------------------------------------------------
// Creator search
// ---------------------------------------------------------------------------

export interface CreatorSearchResultIntelligence {
    categories: string[];
    topics: string[];
    confidenceScore: number;
    lastEnrichedAt: string | null;
}

export interface CreatorSearchResult {
    id: string;
    username: string;
    displayName: string;
    bio: string;
    avatarUrl: string | null;
    countryCode: string;
    isVerified: boolean;
    followerCount: number;
    intelligence: CreatorSearchResultIntelligence;
    attribution: AttributionInfo;
}

export interface CreatorSearchResponse {
    creators: CreatorSearchResult[];
    page: PageInfo;
    query: { q?: string; limit: number };
}

export function buildCreatorSearchResponse(
    results: CreatorSearchResult[],
    page: PageInfo,
    query: { q?: string; limit: number },
): CreatorSearchResponse {
    return { creators: results, page, query };
}

// ---------------------------------------------------------------------------
// Creator intelligence profile
// ---------------------------------------------------------------------------

export interface CreatorIntelligenceFields {
    categories: string[];
    topics: string[];
    languages: string[];
    biographySummary: string | null;
    crossPlatformPresence: Record<string, unknown>;
    engagementSignals: Record<string, unknown>;
    growthSignals: Record<string, unknown>;
    confidenceScore: number;
    lastEnrichedAt: string | null;
    freshness: string;
}

export interface CreatorIntelligenceResponse {
    id: string;
    username: string;
    displayName: string;
    bio: string;
    avatarUrl: string | null;
    countryCode: string;
    isVerified: boolean;
    followerCount: number;
    intelligence: CreatorIntelligenceFields;
    attribution: AttributionInfo;
}

/**
 * Merges enriched intelligence with a base creator profile. The intelligence
 * fields are projected from the `CreatorIntelligence` row; internal fields
 * like embeddings and provider metadata are omitted from the public response.
 */
export function buildCreatorIntelligenceResponse(
    intelligence: CreatorIntelligence,
    creatorProfile: Record<string, unknown>,
): CreatorIntelligenceResponse {
    const freshness = intelligence.lastEnrichedAt
        ? (Date.now() - new Date(intelligence.lastEnrichedAt).getTime() < 7 * 24 * 60 * 60 * 1000 ? 'fresh' : 'stale')
        : 'never_enriched';

    return {
        id: (creatorProfile.id as string) ?? intelligence.creatorId,
        username: (creatorProfile.username as string) ?? '',
        displayName: (creatorProfile.displayName as string) ?? '',
        bio: (creatorProfile.bio as string) ?? '',
        avatarUrl: (creatorProfile.avatarUrl as string | null) ?? null,
        countryCode: (creatorProfile.countryCode as string) ?? '',
        isVerified: (creatorProfile.isVerified as boolean) ?? false,
        followerCount: (creatorProfile.followerCount as number) ?? 0,
        intelligence: {
            categories: intelligence.categories,
            topics: intelligence.topics,
            languages: intelligence.languages,
            biographySummary: intelligence.biographySummary,
            crossPlatformPresence: intelligence.crossPlatformPresence,
            engagementSignals: intelligence.engagementSignals,
            growthSignals: intelligence.growthSignals,
            confidenceScore: intelligence.confidenceScore,
            lastEnrichedAt: intelligence.lastEnrichedAt?.toISOString() ?? null,
            freshness,
        },
        attribution: {
            creatorId: intelligence.creatorId,
            basis: 'platform_native',
            note: 'Creator registered on Streamlivr',
        },
    };
}

// ---------------------------------------------------------------------------
// Content search
// ---------------------------------------------------------------------------

export interface ContentSearchResultIntelligence {
    topics: string[];
    categories: string[];
    language: string | null;
    confidenceScore: number;
}

export interface ContentSearchResult {
    id: string;
    creatorId: string | null;
    title: string;
    description: string;
    mediaType: string;
    intelligence: ContentSearchResultIntelligence;
    attribution: AttributionInfo;
}

export interface ContentSearchResponse {
    content: ContentSearchResult[];
    page: PageInfo;
    query: { q?: string; limit: number };
}

export function buildContentSearchResponse(
    results: ContentSearchResult[],
    page: PageInfo,
    query: { q?: string; limit: number },
): ContentSearchResponse {
    return { content: results, page, query };
}

// ---------------------------------------------------------------------------
// Content intelligence profile
// ---------------------------------------------------------------------------

export interface ContentIntelligenceFields {
    summary: string | null;
    topics: string[];
    categories: string[];
    language: string | null;
    confidenceScore: number;
}

export interface ContentIntelligenceResponse {
    id: string;
    creatorId: string | null;
    intelligence: ContentIntelligenceFields;
    attribution: AttributionInfo;
}

export function buildContentIntelligenceResponse(
    intelligence: ContentIntelligence,
): ContentIntelligenceResponse {
    return {
        id: intelligence.contentId,
        creatorId: intelligence.creatorId,
        intelligence: {
            summary: intelligence.summary,
            topics: intelligence.topics,
            categories: intelligence.categories,
            language: intelligence.language,
            confidenceScore: intelligence.confidenceScore,
        },
        attribution: {
            creatorId: intelligence.creatorId,
            basis: intelligence.creatorId ? 'content_owner' : 'platform_owned',
            note: intelligence.creatorId
                ? 'Content created by registered creator'
                : 'Content with no identified creator — platform owned',
        },
    };
}

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

export interface EnrichmentResponse {
    status: string;
    jobId?: string;
    message: string;
}

export function buildEnrichmentResponse(
    status: string,
    jobId?: string,
): EnrichmentResponse {
    const messages: Record<string, string> = {
        queued: 'Enrichment job queued. Results will be available within minutes.',
        processing: 'Enrichment is currently in progress.',
        completed: 'Enrichment has been completed successfully.',
        failed: 'Enrichment job failed. It will be retried automatically.',
        already_fresh: 'Creator intelligence is already up to date.',
    };
    return {
        status,
        ...(jobId ? { jobId } : {}),
        message: messages[status] ?? `Enrichment status: ${status}`,
    };
}

// ---------------------------------------------------------------------------
// Unified search
// ---------------------------------------------------------------------------

export interface UnifiedSearchResponse {
    creators: CreatorSearchResult[];
    content: ContentSearchResult[];
    page: PageInfo;
    query: { q?: string; limit: number };
}

export function buildUnifiedSearchResponse(
    creators: CreatorSearchResult[],
    content: ContentSearchResult[],
    page: PageInfo,
    query: { q?: string; limit: number },
): UnifiedSearchResponse {
    return { creators, content, page, query };
}
