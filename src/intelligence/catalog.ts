/**
 * Intelligence paid route catalog.
 *
 * Extends the base x402 catalog with intelligence-specific endpoints for
 * enriched creator search, content search, creator discovery, enrichment
 * requests, and unified search. Each route follows the same `PaidRoute`
 * interface so the existing MCP tool builder, discovery documents, and
 * pricing infrastructure work without modification.
 *
 * This module is additive: it does not touch or replace the base catalog.
 * The server wires both arrays together at startup.
 */
import type { PaidRoute, PaidRouteQueryParam, PaidRoutePathParam } from '../x402/catalog.js';
import { CREATOR_UNIT_PRICE_ATOMIC, FLOOR_REQUEST_PRICE_ATOMIC, PRICE_RULE } from '../x402/pricing.js';

// ---------------------------------------------------------------------------
// Query parameter sets for intelligence routes
// ---------------------------------------------------------------------------

const INTELLIGENCE_PAGE_PARAMS: PaidRouteQueryParam[] = [
    {
        name: 'q',
        description:
            'Free-text or semantic search query. Matches names, bios, topics, categories and cross-platform presence. Supports keyword and semantic similarity when embeddings are available.',
        example: 'afrobeats producer',
    },
    {
        name: 'limit',
        type: 'integer',
        description:
            'Rows to return, 1-200, default 10. The invoice is one cent per creator the page credits, so a bigger page costs more.',
        example: '10',
    },
    {
        name: 'cursor',
        description: 'nextCursor from the previous page. Omit for the first page.',
        example: 'eyJpZCI6ImNtbWdnYnRpazAwMDBycWJ6b250dnN5MzgifQ',
    },
];

const CREATOR_SEARCH_PARAMS: PaidRouteQueryParam[] = [
    ...INTELLIGENCE_PAGE_PARAMS,
    {
        name: 'category',
        description: 'Filter by enriched category (e.g. music, gaming, lifestyle). Omit for all categories.',
        example: 'music',
    },
    {
        name: 'language',
        description: 'Filter by detected language (ISO 639-1 code). Omit for all languages.',
        example: 'en',
    },
    {
        name: 'verified',
        type: 'boolean',
        description: 'Filter by verified status. Omit for both verified and unverified.',
        example: 'true',
    },
];

const CONTENT_SEARCH_PARAMS: PaidRouteQueryParam[] = [
    ...INTELLIGENCE_PAGE_PARAMS,
    {
        name: 'category',
        description: 'Filter by content category. Omit for all categories.',
        example: 'music',
    },
    {
        name: 'language',
        description: 'Filter by content language (ISO 639-1 code). Omit for all languages.',
        example: 'en',
    },
];

const DISCOVER_PARAMS: PaidRouteQueryParam[] = [
    {
        name: 'q',
        description:
            'Describe the kind of creator you are looking for. Supports natural language queries and semantic matching.',
        example: 'nigerian afrobeats producers with growing audiences',
    },
    {
        name: 'limit',
        type: 'integer',
        description: 'Maximum recommendations to return, 1-50, default 10.',
        example: '10',
    },
    {
        name: 'category',
        description: 'Limit recommendations to a specific category.',
        example: 'music',
    },
    {
        name: 'language',
        description: 'Prefer creators who produce content in this language (ISO 639-1).',
        example: 'en',
    },
];

const UNIFIED_SEARCH_PARAMS: PaidRouteQueryParam[] = [
    ...INTELLIGENCE_PAGE_PARAMS,
    {
        name: 'entity_type',
        description: 'Restrict results to creators or content. Omit for both.',
        example: 'creator',
        values: ['creator', 'content'],
    },
    {
        name: 'category',
        description: 'Filter by enriched category.',
        example: 'music',
    },
    {
        name: 'language',
        description: 'Filter by language (ISO 639-1 code).',
        example: 'en',
    },
];

// ---------------------------------------------------------------------------
// Path parameter for ID-based routes
// ---------------------------------------------------------------------------

const CREATOR_ID_PATH_PARAM: PaidRoutePathParam = {
    name: 'id',
    description: 'Streamlivr creator id, taken from a search or listings response.',
    example: 'cmmggbkik0000rqbzontvsy38',
};

const CONTENT_ID_PATH_PARAM: PaidRoutePathParam = {
    name: 'id',
    description: 'Streamlivr content id, taken from a search or posts response.',
    example: 'cmvideo0000rqbzontvsy38',
};

const ENRICH_ID_PATH_PARAM: PaidRoutePathParam = {
    name: 'id',
    description: 'Streamlivr creator id to request enrichment for.',
    example: 'cmmggbkik0000rqbzontvsy38',
};

// ---------------------------------------------------------------------------
// Intelligence route builder
// ---------------------------------------------------------------------------

/**
 * Builds the intelligence paid routes. These extend (not replace) the base
 * catalog from `src/x402/catalog.ts`. The server concatenates both arrays
 * so discovery documents and MCP tools cover the full surface.
 */
export function buildIntelligencePaidRoutes(): PaidRoute[] {
    return [
        {
            path: '/api/intelligence/creators/search',
            serviceName: 'streamlivr-intelligence-creator-search',
            id: 'search-creators-intelligence',
            title: 'Intelligent creator search',
            description:
                `Keyword and semantic creator discovery with enriched intelligence. Search by name, bio, topic, category or natural language query. Results include AI-enriched categories, topics, confidence scores, cross-platform presence and engagement signals. ${PRICE_RULE.summary}`,
            tags: ['x402', 'celo', 'intelligence', 'creators', 'search', 'semantic'],
            priceAtomic: CREATOR_UNIT_PRICE_ATOMIC,
            queryParams: CREATOR_SEARCH_PARAMS,
            example: {
                creators: [
                    {
                        id: 'cmmggbkik0000rqbzontvsy38',
                        username: 'grant',
                        displayName: 'ekegrant59',
                        bio: 'Afrobeats producer, Lagos',
                        avatarUrl: 'https://assets.example.com/avatars/creator.jpg',
                        countryCode: 'NG',
                        isVerified: false,
                        followerCount: 2,
                        intelligence: {
                            categories: ['music', 'afrobeats'],
                            topics: ['production', 'lagos nightlife'],
                            confidenceScore: 0.82,
                            lastEnrichedAt: '2026-10-15T12:00:00.000Z',
                        },
                        attribution: {
                            creatorId: 'cmmggbkik0000rqbzontvsy38',
                            basis: 'platform_native',
                            note: 'Creator registered on Streamlivr',
                        },
                    },
                ],
                page: {
                    total: 340,
                    limit: 10,
                    returned: 1,
                    hasMore: true,
                    nextCursor: 'eyJpZCI6ImNtbWdnYnRpazAwMDBycWJ6b250dnN5MzgifQ',
                    truncated: true,
                },
                query: { q: 'afrobeats producer', limit: 10 },
            },
        },
        {
            path: '/api/intelligence/creators/:id',
            serviceName: 'streamlivr-intelligence-creator-profile',
            id: 'get-creator-intelligence',
            title: 'Enriched creator intelligence',
            description:
                'Enriched creator profile with AI-derived categories, topics, engagement signals, growth indicators, cross-platform presence, and recommendation features. Includes confidence scores and data freshness information.',
            tags: ['x402', 'celo', 'intelligence', 'creators', 'profile', 'enriched'],
            priceAtomic: FLOOR_REQUEST_PRICE_ATOMIC,
            pathParam: CREATOR_ID_PATH_PARAM,
            example: {
                id: 'cmmggbkik0000rqbzontvsy38',
                username: 'grant',
                displayName: 'ekegrant59',
                bio: 'Afrobeats producer, Lagos',
                avatarUrl: 'https://assets.example.com/avatars/creator.jpg',
                countryCode: 'NG',
                isVerified: false,
                followerCount: 2,
                intelligence: {
                    categories: ['music', 'afrobeats'],
                    topics: ['production', 'lagos nightlife', 'studio sessions'],
                    languages: ['en', 'yo'],
                    biographySummary: 'Lagos-based Afrobeats producer creating original beats and studio content.',
                    crossPlatformPresence: { twitter: '@ekegrant59', instagram: 'ekegrant59' },
                    engagementSignals: { avgLikesPerPost: 42, avgCommentsPerPost: 5 },
                    growthSignals: { followerGrowth30d: 0.12 },
                    confidenceScore: 0.82,
                    lastEnrichedAt: '2026-10-15T12:00:00.000Z',
                    freshness: 'fresh',
                },
                attribution: {
                    creatorId: 'cmmggbkik0000rqbzontvsy38',
                    basis: 'platform_native',
                    note: 'Creator registered on Streamlivr',
                },
            },
        },
        {
            path: '/api/intelligence/content/search',
            serviceName: 'streamlivr-intelligence-content-search',
            id: 'search-content-intelligence',
            title: 'Intelligent content search',
            description:
                `Search content with AI-enriched metadata: topics, categories, language detection, and semantic similarity. Results include content intelligence fields and creator attribution. ${PRICE_RULE.summary}`,
            tags: ['x402', 'celo', 'intelligence', 'content', 'search', 'semantic'],
            priceAtomic: CREATOR_UNIT_PRICE_ATOMIC,
            queryParams: CONTENT_SEARCH_PARAMS,
            example: {
                content: [
                    {
                        id: 'cmvideo0000rqbzontvsy38',
                        creatorId: 'cmmggbkik0000rqbzontvsy38',
                        title: 'Lagos at night',
                        description: 'Shot on the way home from the studio',
                        mediaType: 'VIDEO',
                        intelligence: {
                            topics: ['nightlife', 'lagos', 'urban'],
                            categories: ['lifestyle', 'music'],
                            language: 'en',
                            confidenceScore: 0.78,
                        },
                        attribution: {
                            creatorId: 'cmmggbkik0000rqbzontvsy38',
                            basis: 'content_owner',
                            note: 'Content created by registered creator',
                        },
                    },
                ],
                page: {
                    total: 1240,
                    limit: 10,
                    returned: 1,
                    hasMore: true,
                    nextCursor: 'eyJpZCI6ImNtdmlkZW8wMDAwcnFiem9udHZzeTM4In0',
                    truncated: true,
                },
                query: { q: 'lagos', limit: 10 },
            },
        },
        {
            path: '/api/intelligence/content/:id',
            serviceName: 'streamlivr-intelligence-content-profile',
            id: 'get-content-intelligence',
            title: 'Content intelligence',
            description:
                'Detailed content intelligence for a single piece of content, including AI-derived topics, categories, language, summary, and confidence scores.',
            tags: ['x402', 'celo', 'intelligence', 'content', 'profile', 'enriched'],
            priceAtomic: FLOOR_REQUEST_PRICE_ATOMIC,
            pathParam: CONTENT_ID_PATH_PARAM,
            example: {
                id: 'cmvideo0000rqbzontvsy38',
                creatorId: 'cmmggbkik0000rqbzontvsy38',
                title: 'Lagos at night',
                description: 'Shot on the way home from the studio',
                mediaType: 'VIDEO',
                intelligence: {
                    summary: 'A short video documenting the Lagos nightlife scene, filmed during a commute from a music studio.',
                    topics: ['nightlife', 'lagos', 'urban', 'commute'],
                    categories: ['lifestyle', 'music'],
                    language: 'en',
                    confidenceScore: 0.78,
                },
                attribution: {
                    creatorId: 'cmmggbkik0000rqbzontvsy38',
                    basis: 'content_owner',
                    note: 'Content created by registered creator',
                },
            },
        },
        {
            path: '/api/intelligence/discover',
            serviceName: 'streamlivr-intelligence-discover',
            id: 'discover-creators',
            title: 'Creator discovery recommendations',
            description:
                `AI-powered creator recommendations based on semantic similarity, engagement signals, growth trajectory, and category alignment. Describe the kind of creator you are looking for in natural language. ${PRICE_RULE.summary}`,
            tags: ['x402', 'celo', 'intelligence', 'creators', 'discovery', 'recommendations', 'semantic'],
            priceAtomic: CREATOR_UNIT_PRICE_ATOMIC,
            queryParams: DISCOVER_PARAMS,
            example: {
                creators: [
                    {
                        id: 'cmmggbkik0000rqbzontvsy38',
                        username: 'grant',
                        displayName: 'ekegrant59',
                        bio: 'Afrobeats producer, Lagos',
                        avatarUrl: 'https://assets.example.com/avatars/creator.jpg',
                        countryCode: 'NG',
                        isVerified: false,
                        followerCount: 2,
                        intelligence: {
                            categories: ['music', 'afrobeats'],
                            topics: ['production', 'lagos nightlife'],
                            confidenceScore: 0.82,
                            lastEnrichedAt: '2026-10-15T12:00:00.000Z',
                        },
                        relevanceScore: 0.91,
                        matchReason: 'High category alignment with afrobeats and growing engagement signals.',
                    },
                ],
                page: {
                    total: 25,
                    limit: 10,
                    returned: 1,
                    hasMore: true,
                    nextCursor: null,
                    truncated: false,
                },
                query: { q: 'nigerian afrobeats producers with growing audiences', limit: 10 },
            },
        },
        {
            path: '/api/intelligence/enrich/:id',
            serviceName: 'streamlivr-intelligence-enrich',
            id: 'enrich-creator',
            title: 'Request creator enrichment',
            description:
                'Request on-demand enrichment for a creator profile. Triggers cross-platform identity resolution, content analysis, and AI classification. Returns the enrichment job status.',
            tags: ['x402', 'celo', 'intelligence', 'creators', 'enrichment'],
            priceAtomic: FLOOR_REQUEST_PRICE_ATOMIC,
            pathParam: ENRICH_ID_PATH_PARAM,
            example: {
                status: 'queued',
                jobId: 'enrich:creator:cmmggbkik0000rqbzontvsy38:native',
                creatorId: 'cmmggbkik0000rqbzontvsy38',
                message: 'Enrichment job queued. Results will be available within minutes.',
                estimatedCompletionSeconds: 120,
            },
        },
        {
            path: '/api/intelligence/search',
            serviceName: 'streamlivr-intelligence-unified-search',
            id: 'search-streamlivr-unified',
            title: 'Unified intelligence search',
            description:
                `Search across both creators and content with enriched intelligence. Returns ranked results from both entity types with AI-derived metadata, semantic matching, and attribution. Filter by entity_type to restrict to creators or content only. ${PRICE_RULE.summary}`,
            tags: ['x402', 'celo', 'intelligence', 'search', 'unified', 'semantic'],
            priceAtomic: CREATOR_UNIT_PRICE_ATOMIC,
            queryParams: UNIFIED_SEARCH_PARAMS,
            example: {
                creators: [
                    {
                        id: 'cmmggbkik0000rqbzontvsy38',
                        username: 'grant',
                        displayName: 'ekegrant59',
                        bio: 'Afrobeats producer, Lagos',
                        avatarUrl: 'https://assets.example.com/avatars/creator.jpg',
                        countryCode: 'NG',
                        isVerified: false,
                        followerCount: 2,
                        intelligence: {
                            categories: ['music', 'afrobeats'],
                            topics: ['production'],
                            confidenceScore: 0.82,
                            lastEnrichedAt: '2026-10-15T12:00:00.000Z',
                        },
                        attribution: {
                            creatorId: 'cmmggbkik0000rqbzontvsy38',
                            basis: 'platform_native',
                            note: 'Creator registered on Streamlivr',
                        },
                    },
                ],
                content: [
                    {
                        id: 'cmvideo0000rqbzontvsy38',
                        creatorId: 'cmmggbkik0000rqbzontvsy38',
                        title: 'Lagos at night',
                        mediaType: 'VIDEO',
                        intelligence: {
                            topics: ['nightlife', 'lagos'],
                            categories: ['lifestyle'],
                            language: 'en',
                            confidenceScore: 0.78,
                        },
                        attribution: {
                            creatorId: 'cmmggbkik0000rqbzontvsy38',
                            basis: 'content_owner',
                            note: 'Content created by registered creator',
                        },
                    },
                ],
                page: {
                    total: 1580,
                    limit: 10,
                    returned: 2,
                    hasMore: true,
                    nextCursor: 'eyJpZCI6ImNtdmlkZW8wMDAwcnFiem9udHZzeTM4In0',
                    truncated: true,
                },
                query: { q: 'afrobeats', limit: 10 },
            },
        },
    ];
}
