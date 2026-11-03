/**
 * X (Twitter) API v2 enrichment adapter.
 *
 * Implements the {@link EnrichmentProvider} interface for fetching creator
 * and content intelligence from X's public API.
 *
 * Rate-limit headers are tracked per-process; the adapter throws a typed
 * {@link XApiError} when the API returns 429 or auth failures.
 */

import { computeContentHash } from '../utils/contentHash.js';
import type { EnrichmentProvider, EnrichmentResult, ProviderUsage } from './interface.js';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class XApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly rateLimitReset: number | null;

    constructor(message: string, status: number, code: string, rateLimitReset: number | null = null) {
        super(message);
        this.name = 'XApiError';
        this.status = status;
        this.code = code;
        this.rateLimitReset = rateLimitReset;
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const X_API_BASE = 'https://api.x.com';

const USER_FIELDS = 'id,name,username,description,location,public_metrics,profile_image_url,verified,created_at';
const TWEET_FIELDS = 'text,public_metrics,created_at,entities,lang';

function parseRateLimitHeaders(headers: Headers): { remaining: number | null; reset: number | null } {
    const remaining = headers.get('x-rate-limit-remaining');
    const reset = headers.get('x-rate-limit-reset');
    return {
        remaining: remaining !== null ? parseInt(remaining, 10) : null,
        reset: reset !== null ? parseInt(reset, 10) : null,
    };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function createXApiProvider(bearerToken: string): EnrichmentProvider & {
    enrichContent: NonNullable<EnrichmentProvider['enrichContent']>;
    getUsageCost: NonNullable<EnrichmentProvider['getUsageCost']>;
} {
    let requestsToday = 0;
    let rateLimitRemaining: number | null = null;

    async function xFetch(url: string): Promise<{ data: Record<string, unknown>; headers: Headers }> {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${bearerToken}`,
                'Content-Type': 'application/json',
            },
        });

        const rl = parseRateLimitHeaders(response.headers);
        rateLimitRemaining = rl.remaining;

        if (response.status === 429) {
            throw new XApiError(
                'X API rate limit exceeded',
                429,
                'RATE_LIMITED',
                rl.reset,
            );
        }

        if (response.status === 401 || response.status === 403) {
            throw new XApiError(
                `X API authentication error: ${response.status}`,
                response.status,
                'AUTH_ERROR',
            );
        }

        if (!response.ok) {
            throw new XApiError(
                `X API request failed with status ${response.status}`,
                response.status,
                'API_ERROR',
            );
        }

        requestsToday++;

        const body = (await response.json()) as Record<string, unknown>;
        return { data: body, headers: response.headers };
    }

    function normalizeUserData(data: Record<string, unknown>): Record<string, unknown> {
        const publicMetrics = (data.public_metrics ?? {}) as Record<string, unknown>;
        return {
            xId: data.id as string,
            username: data.username as string,
            displayName: data.name as string,
            biography: (data.description as string) ?? null,
            location: (data.location as string) ?? null,
            followerCount: (publicMetrics.followers_count as number) ?? 0,
            followingCount: (publicMetrics.following_count as number) ?? 0,
            tweetCount: (publicMetrics.tweet_count as number) ?? 0,
            listedCount: (publicMetrics.listed_count as number) ?? 0,
            profileImageUrl: (data.profile_image_url as string) ?? null,
            verified: (data.verified as boolean) ?? false,
            accountCreatedAt: (data.created_at as string) ?? null,
        };
    }

    function normalizeTweetData(data: Record<string, unknown>): Record<string, unknown> {
        const publicMetrics = (data.public_metrics ?? {}) as Record<string, unknown>;
        const entities = (data.entities ?? {}) as Record<string, unknown>;
        const hashtags = (entities.hashtags ?? []) as Array<Record<string, unknown>>;
        const topics = hashtags.map((h) => (h.tag as string) ?? '').filter(Boolean);

        return {
            tweetId: data.id as string,
            text: (data.text as string) ?? '',
            language: (data.lang as string) ?? 'en',
            topics,
            createdAt: (data.created_at as string) ?? null,
            likeCount: (publicMetrics.like_count as number) ?? 0,
            retweetCount: (publicMetrics.retweet_count as number) ?? 0,
            replyCount: (publicMetrics.reply_count as number) ?? 0,
            quoteCount: (publicMetrics.quote_count as number) ?? 0,
            impressionCount: (publicMetrics.impression_count as number) ?? 0,
        };
    }

    return {
        name: 'x_api' as const,

        async enrichCreator(input) {
            const { creatorId, externalIdentifiers } = input;

            let url: string;
            if (externalIdentifiers?.xAccountId) {
                url = `${X_API_BASE}/2/users/${encodeURIComponent(externalIdentifiers.xAccountId)}?user.fields=${USER_FIELDS}`;
            } else if (externalIdentifiers?.x) {
                const username = externalIdentifiers.x.replace(/^@/, '');
                url = `${X_API_BASE}/2/users/by/username/${encodeURIComponent(username)}?user.fields=${USER_FIELDS}`;
            } else {
                throw new XApiError(
                    'X API enrichment requires an X username (externalIdentifiers.x) or account ID (externalIdentifiers.xAccountId)',
                    400,
                    'MISSING_IDENTIFIER',
                );
            }

            const { data: responseBody } = await xFetch(url);
            const userData = (responseBody.data ?? responseBody) as Record<string, unknown>;
            const normalizedData = normalizeUserData(userData);
            const rawDataHash = computeContentHash(normalizedData);

            return {
                success: true,
                provider: 'x_api',
                entityType: 'creator',
                entityId: creatorId,
                normalizedData,
                rawDataHash,
                retrievedAt: new Date(),
                retentionPolicy: 'x_api_30d',
                attributionEligible: false,
                confidenceScore: 0.7,
            } satisfies EnrichmentResult;
        },

        async enrichContent(input) {
            const contentId = input.contentId ?? input.url;
            if (!contentId) {
                throw new XApiError(
                    'X API content enrichment requires a tweet ID (contentId) or URL',
                    400,
                    'MISSING_IDENTIFIER',
                );
            }

            // Extract tweet ID from URL if needed
            let tweetId = contentId;
            const urlMatch = contentId.match(/\/status\/(\d+)/);
            if (urlMatch) {
                tweetId = urlMatch[1];
            }

            const url = `${X_API_BASE}/2/tweets/${encodeURIComponent(tweetId)}?tweet.fields=${TWEET_FIELDS}`;
            const { data: responseBody } = await xFetch(url);
            const tweetData = (responseBody.data ?? responseBody) as Record<string, unknown>;
            const normalizedData = normalizeTweetData(tweetData);
            const rawDataHash = computeContentHash(normalizedData);

            return {
                success: true,
                provider: 'x_api',
                entityType: 'content',
                entityId: tweetId,
                normalizedData,
                rawDataHash,
                retrievedAt: new Date(),
                retentionPolicy: 'x_api_30d',
                attributionEligible: false,
                confidenceScore: 0.8,
            } satisfies EnrichmentResult;
        },

        async getUsageCost() {
            return {
                provider: 'x_api',
                requestsToday,
                costEstimateUsd: requestsToday * 0.01, // Basic tier estimate
                rateLimitRemaining,
            } satisfies ProviderUsage;
        },
    };
}
