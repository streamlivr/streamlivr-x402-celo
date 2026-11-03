/**
 * Firecrawl web-scraping enrichment adapter.
 *
 * Implements the {@link EnrichmentProvider} interface for extracting
 * structured creator and content intelligence from web pages.
 */

import { computeContentHash } from '../utils/contentHash.js';
import type { EnrichmentProvider, EnrichmentResult, ProviderUsage } from './interface.js';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class FirecrawlError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'FirecrawlError';
        this.status = status;
    }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function createFirecrawlProvider(apiKey: string, baseUrl: string): EnrichmentProvider & {
    enrichContent: NonNullable<EnrichmentProvider['enrichContent']>;
    getUsageCost: NonNullable<EnrichmentProvider['getUsageCost']>;
} {
    let requestsToday = 0;

    async function firecrawlScrape(url: string): Promise<Record<string, unknown>> {
        const response = await fetch(`${baseUrl}/v1/scrape`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url,
                formats: ['markdown', 'extract'],
            }),
        });

        if (response.status === 401 || response.status === 403) {
            throw new FirecrawlError(
                `Firecrawl authentication error: ${response.status}`,
                response.status,
            );
        }

        if (response.status === 429) {
            throw new FirecrawlError('Firecrawl rate limit exceeded', 429);
        }

        if (!response.ok) {
            throw new FirecrawlError(
                `Firecrawl request failed with status ${response.status}`,
                response.status,
            );
        }

        requestsToday++;
        return (await response.json()) as Record<string, unknown>;
    }

    function normalizeCreatorData(responseBody: Record<string, unknown>): Record<string, unknown> {
        const data = (responseBody.data ?? responseBody) as Record<string, unknown>;
        const extract = (data.extract ?? {}) as Record<string, unknown>;
        const metadata = (data.metadata ?? {}) as Record<string, unknown>;
        const markdown = (data.markdown ?? '') as string;

        // Extract social links from markdown content
        const socialLinks: Record<string, string> = {};
        const twitterMatch = markdown.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i);
        if (twitterMatch) socialLinks.twitter = twitterMatch[1];
        const instaMatch = markdown.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
        if (instaMatch) socialLinks.instagram = instaMatch[1];
        const youtubeMatch = markdown.match(/youtube\.com\/(?:@|channel\/)([a-zA-Z0-9_-]+)/i);
        if (youtubeMatch) socialLinks.youtube = youtubeMatch[1];
        const tiktokMatch = markdown.match(/tiktok\.com\/@([a-zA-Z0-9_.]+)/i);
        if (tiktokMatch) socialLinks.tiktok = tiktokMatch[1];

        // Extract topics from metadata keywords or content
        const keywords = (metadata.keywords ?? '') as string;
        const topics = keywords
            ? keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
            : [];

        return {
            name: (extract.name ?? metadata.title ?? null) as string | null,
            bio: (extract.description ?? extract.bio ?? metadata.description ?? null) as string | null,
            socialLinks,
            topics,
            sourceUrl: (metadata.sourceURL ?? data.url ?? null) as string | null,
            markdownLength: markdown.length,
        };
    }

    function normalizeContentData(responseBody: Record<string, unknown>): Record<string, unknown> {
        const data = (responseBody.data ?? responseBody) as Record<string, unknown>;
        const extract = (data.extract ?? {}) as Record<string, unknown>;
        const metadata = (data.metadata ?? {}) as Record<string, unknown>;
        const markdown = (data.markdown ?? '') as string;

        const keywords = (metadata.keywords ?? '') as string;
        const topics = keywords
            ? keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
            : [];

        return {
            title: (extract.title ?? metadata.title ?? null) as string | null,
            description: (extract.description ?? metadata.description ?? null) as string | null,
            topics,
            language: (metadata.language ?? metadata.lang ?? 'en') as string,
            sourceUrl: (metadata.sourceURL ?? data.url ?? null) as string | null,
            markdownPreview: markdown.slice(0, 500),
        };
    }

    return {
        name: 'firecrawl' as const,

        async enrichCreator(input) {
            const { creatorId, externalIdentifiers } = input;

            const websiteUrl = externalIdentifiers?.website;
            if (!websiteUrl) {
                throw new FirecrawlError(
                    'Firecrawl enrichment requires a website URL (externalIdentifiers.website)',
                    400,
                );
            }

            const responseBody = await firecrawlScrape(websiteUrl);
            const normalizedData = normalizeCreatorData(responseBody);
            const rawDataHash = computeContentHash(normalizedData);

            return {
                success: true,
                provider: 'firecrawl',
                entityType: 'creator',
                entityId: creatorId,
                normalizedData,
                rawDataHash,
                retrievedAt: new Date(),
                retentionPolicy: 'standard',
                attributionEligible: false,
                confidenceScore: 0.5,
            } satisfies EnrichmentResult;
        },

        async enrichContent(input) {
            const contentUrl = input.url ?? input.contentId;
            if (!contentUrl) {
                throw new FirecrawlError(
                    'Firecrawl content enrichment requires a URL',
                    400,
                );
            }

            const responseBody = await firecrawlScrape(contentUrl);
            const normalizedData = normalizeContentData(responseBody);
            const rawDataHash = computeContentHash(normalizedData);

            return {
                success: true,
                provider: 'firecrawl',
                entityType: 'content',
                entityId: contentUrl,
                normalizedData,
                rawDataHash,
                retrievedAt: new Date(),
                retentionPolicy: 'standard',
                attributionEligible: false,
                confidenceScore: 0.5,
            } satisfies EnrichmentResult;
        },

        async getUsageCost() {
            return {
                provider: 'firecrawl',
                requestsToday,
                costEstimateUsd: requestsToday * 0.001,
                rateLimitRemaining: null,
            } satisfies ProviderUsage;
        },
    };
}
