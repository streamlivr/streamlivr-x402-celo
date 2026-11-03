/**
 * Native Streamlivr data enrichment adapter.
 *
 * A lightweight {@link EnrichmentProvider} that wraps first-party creator
 * and content data already stored in the main Streamlivr database.
 *
 * This adapter does NOT query the database itself — it receives data passed
 * to it via the `existingData` parameter and normalises it into the
 * intelligence schema.
 */

import { computeContentHash } from '../utils/contentHash.js';
import type { EnrichmentProvider, EnrichmentResult, ProviderUsage } from './interface.js';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function createNativeProvider(): EnrichmentProvider & {
    enrichContent: NonNullable<EnrichmentProvider['enrichContent']>;
    getUsageCost: NonNullable<EnrichmentProvider['getUsageCost']>;
} {
    let requestsToday = 0;

    function normalizeCreatorData(existingData: Record<string, unknown>): Record<string, unknown> {
        return {
            username: (existingData.username as string) ?? null,
            displayName: (existingData.displayName as string) ?? (existingData.display_name as string) ?? null,
            biography: (existingData.bio as string) ?? (existingData.biography as string) ?? null,
            countryCode: (existingData.countryCode as string) ?? (existingData.country_code as string) ?? null,
            isVerified: (existingData.isVerified as boolean) ?? (existingData.is_verified as boolean) ?? false,
            followerCount: (existingData.followerCount as number) ?? (existingData.follower_count as number) ?? 0,
            followingCount: (existingData.followingCount as number) ?? (existingData.following_count as number) ?? 0,
            contentCount: (existingData.contentCount as number) ?? (existingData.content_count as number) ?? 0,
            profileImageUrl: (existingData.profileImageUrl as string) ?? (existingData.profile_image_url as string) ?? null,
            accountCreatedAt: (existingData.createdAt as string) ?? (existingData.created_at as string) ?? null,
            categories: (existingData.categories as string[]) ?? [],
            languages: (existingData.languages as string[]) ?? [],
        };
    }

    function normalizeContentData(existingData: Record<string, unknown>): Record<string, unknown> {
        return {
            title: (existingData.title as string) ?? null,
            description: (existingData.description as string) ?? null,
            contentType: (existingData.contentType as string) ?? (existingData.content_type as string) ?? null,
            language: (existingData.language as string) ?? (existingData.lang as string) ?? 'en',
            topics: (existingData.topics as string[]) ?? [],
            categories: (existingData.categories as string[]) ?? [],
            duration: (existingData.duration as number) ?? null,
            viewCount: (existingData.viewCount as number) ?? (existingData.view_count as number) ?? 0,
            likeCount: (existingData.likeCount as number) ?? (existingData.like_count as number) ?? 0,
            createdAt: (existingData.createdAt as string) ?? (existingData.created_at as string) ?? null,
        };
    }

    return {
        name: 'native' as const,

        async enrichCreator(input) {
            const { creatorId, existingData } = input;
            requestsToday++;

            const data = existingData ?? {};
            const normalizedData = normalizeCreatorData(data);
            const rawDataHash = computeContentHash(normalizedData);

            return {
                success: true,
                provider: 'native',
                entityType: 'creator',
                entityId: creatorId,
                normalizedData,
                rawDataHash,
                retrievedAt: new Date(),
                retentionPolicy: 'indefinite',
                attributionEligible: true,
                confidenceScore: 1.0,
            } satisfies EnrichmentResult;
        },

        async enrichContent(input) {
            const contentId = input.contentId ?? 'unknown';
            requestsToday++;

            // For native provider, existingData is passed via a custom mechanism.
            // The enrichContent interface only has contentId/url, so the caller
            // is expected to have set up the data beforehand. For v1 we return
            // an empty normalisation when no data is available.
            const normalizedData = normalizeContentData({});
            const rawDataHash = computeContentHash(normalizedData);

            return {
                success: true,
                provider: 'native',
                entityType: 'content',
                entityId: contentId,
                normalizedData,
                rawDataHash,
                retrievedAt: new Date(),
                retentionPolicy: 'indefinite',
                attributionEligible: true,
                confidenceScore: 1.0,
            } satisfies EnrichmentResult;
        },

        async getUsageCost() {
            return {
                provider: 'native',
                requestsToday,
                costEstimateUsd: 0, // First-party data, zero cost
                rateLimitRemaining: null,
            } satisfies ProviderUsage;
        },
    };
}
