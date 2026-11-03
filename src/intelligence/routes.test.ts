import { describe, expect, it } from 'vitest';
import {
    buildCreatorSearchResponse,
    buildCreatorIntelligenceResponse,
    buildContentSearchResponse,
    buildContentIntelligenceResponse,
    buildEnrichmentResponse,
    buildUnifiedSearchResponse,
    type CreatorSearchResult,
    type ContentSearchResult,
    type PageInfo,
} from './routes.js';
import type { CreatorIntelligence, ContentIntelligence } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const page: PageInfo = {
    total: 100,
    limit: 10,
    returned: 1,
    hasMore: true,
    nextCursor: 'abc123',
    truncated: false,
};

const creatorResult: CreatorSearchResult = {
    id: 'c1',
    username: 'grant',
    displayName: 'ekegrant59',
    bio: 'Afrobeats producer',
    avatarUrl: 'https://assets.example.com/avatar.jpg',
    countryCode: 'NG',
    isVerified: true,
    followerCount: 500,
    intelligence: {
        categories: ['music'],
        topics: ['afrobeats'],
        confidenceScore: 0.85,
        lastEnrichedAt: '2026-10-15T12:00:00.000Z',
    },
    attribution: {
        creatorId: 'c1',
        basis: 'platform_native',
        note: 'Creator registered on Streamlivr',
    },
};

const contentResult: ContentSearchResult = {
    id: 'v1',
    creatorId: 'c1',
    title: 'Lagos at night',
    description: 'Studio vibes',
    mediaType: 'VIDEO',
    intelligence: {
        topics: ['nightlife'],
        categories: ['lifestyle'],
        language: 'en',
        confidenceScore: 0.78,
    },
    attribution: {
        creatorId: 'c1',
        basis: 'content_owner',
        note: 'Content created by registered creator',
    },
};

const mockCreatorIntelligence: CreatorIntelligence = {
    id: 'intel-1',
    creatorId: 'c1',
    categories: ['music', 'afrobeats'],
    topics: ['production', 'studio'],
    languages: ['en', 'yo'],
    biographySummary: 'Lagos-based Afrobeats producer.',
    crossPlatformPresence: { twitter: '@ekegrant59' },
    engagementSignals: { avgLikesPerPost: 42 },
    growthSignals: { followerGrowth30d: 0.12 },
    recommendationFeatures: {},
    confidenceScore: 0.85,
    embedding: null,
    embeddingModel: null,
    intelligenceVersion: '1.0.0',
    lastEnrichedAt: new Date('2026-10-15T12:00:00.000Z'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-10-15'),
};

const mockContentIntelligence: ContentIntelligence = {
    id: 'cintel-1',
    contentId: 'v1',
    creatorId: 'c1',
    summary: 'A video about Lagos nightlife.',
    topics: ['nightlife', 'lagos'],
    categories: ['lifestyle'],
    language: 'en',
    contentEmbedding: null,
    embeddingModel: null,
    confidenceScore: 0.78,
    intelligenceVersion: '1.0.0',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-10-15'),
};

// ---------------------------------------------------------------------------
// Creator search response
// ---------------------------------------------------------------------------

describe('buildCreatorSearchResponse', () => {
    it('returns the correct shape', () => {
        const response = buildCreatorSearchResponse([creatorResult], page, { q: 'afrobeats', limit: 10 });
        expect(response.creators).toHaveLength(1);
        expect(response.page).toBe(page);
        expect(response.query).toEqual({ q: 'afrobeats', limit: 10 });
    });

    it('includes intelligence fields in each creator', () => {
        const response = buildCreatorSearchResponse([creatorResult], page, { limit: 10 });
        const c = response.creators[0];
        expect(c.intelligence).toBeDefined();
        expect(c.intelligence.categories).toContain('music');
        expect(c.intelligence.confidenceScore).toBe(0.85);
    });

    it('includes attribution info in each creator', () => {
        const response = buildCreatorSearchResponse([creatorResult], page, { limit: 10 });
        const c = response.creators[0];
        expect(c.attribution).toBeDefined();
        expect(c.attribution.creatorId).toBe('c1');
        expect(c.attribution.basis).toBe('platform_native');
    });
});

// ---------------------------------------------------------------------------
// Creator intelligence response
// ---------------------------------------------------------------------------

describe('buildCreatorIntelligenceResponse', () => {
    const profile = {
        id: 'c1',
        username: 'grant',
        displayName: 'ekegrant59',
        bio: 'Afrobeats producer',
        avatarUrl: 'https://assets.example.com/avatar.jpg',
        countryCode: 'NG',
        isVerified: true,
        followerCount: 500,
    };

    it('merges intelligence with base profile', () => {
        const response = buildCreatorIntelligenceResponse(mockCreatorIntelligence, profile);
        expect(response.id).toBe('c1');
        expect(response.username).toBe('grant');
        expect(response.intelligence.categories).toEqual(['music', 'afrobeats']);
        expect(response.intelligence.topics).toContain('production');
    });

    it('includes freshness information', () => {
        const response = buildCreatorIntelligenceResponse(mockCreatorIntelligence, profile);
        expect(response.intelligence.freshness).toBeDefined();
        expect(typeof response.intelligence.freshness).toBe('string');
    });

    it('includes confidence score', () => {
        const response = buildCreatorIntelligenceResponse(mockCreatorIntelligence, profile);
        expect(response.intelligence.confidenceScore).toBe(0.85);
    });

    it('includes provenance summary in attribution', () => {
        const response = buildCreatorIntelligenceResponse(mockCreatorIntelligence, profile);
        expect(response.attribution).toBeDefined();
        expect(response.attribution.creatorId).toBe('c1');
        expect(response.attribution.basis).toBe('platform_native');
    });

    it('omits internal fields like embeddings', () => {
        const response = buildCreatorIntelligenceResponse(mockCreatorIntelligence, profile);
        const responseJson = JSON.stringify(response);
        expect(responseJson).not.toContain('embedding');
        expect(responseJson).not.toContain('embeddingModel');
        expect(responseJson).not.toContain('recommendationFeatures');
    });

    it('handles never-enriched creators', () => {
        const neverEnriched: CreatorIntelligence = {
            ...mockCreatorIntelligence,
            lastEnrichedAt: null,
        };
        const response = buildCreatorIntelligenceResponse(neverEnriched, profile);
        expect(response.intelligence.freshness).toBe('never_enriched');
        expect(response.intelligence.lastEnrichedAt).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Content search response
// ---------------------------------------------------------------------------

describe('buildContentSearchResponse', () => {
    it('returns the correct shape', () => {
        const response = buildContentSearchResponse([contentResult], page, { q: 'lagos', limit: 10 });
        expect(response.content).toHaveLength(1);
        expect(response.page).toBe(page);
        expect(response.query).toEqual({ q: 'lagos', limit: 10 });
    });

    it('includes intelligence fields in each content result', () => {
        const response = buildContentSearchResponse([contentResult], page, { limit: 10 });
        const c = response.content[0];
        expect(c.intelligence).toBeDefined();
        expect(c.intelligence.topics).toContain('nightlife');
        expect(c.intelligence.language).toBe('en');
    });

    it('includes attribution info', () => {
        const response = buildContentSearchResponse([contentResult], page, { limit: 10 });
        const c = response.content[0];
        expect(c.attribution.creatorId).toBe('c1');
    });
});

// ---------------------------------------------------------------------------
// Content intelligence response
// ---------------------------------------------------------------------------

describe('buildContentIntelligenceResponse', () => {
    it('builds from content intelligence', () => {
        const response = buildContentIntelligenceResponse(mockContentIntelligence);
        expect(response.id).toBe('v1');
        expect(response.creatorId).toBe('c1');
    });

    it('includes all intelligence fields', () => {
        const response = buildContentIntelligenceResponse(mockContentIntelligence);
        expect(response.intelligence.summary).toBe('A video about Lagos nightlife.');
        expect(response.intelligence.topics).toContain('nightlife');
        expect(response.intelligence.categories).toContain('lifestyle');
        expect(response.intelligence.language).toBe('en');
        expect(response.intelligence.confidenceScore).toBe(0.78);
    });

    it('marks content_owner when creator exists', () => {
        const response = buildContentIntelligenceResponse(mockContentIntelligence);
        expect(response.attribution.basis).toBe('content_owner');
    });

    it('marks platform_owned when no creator', () => {
        const noCreator: ContentIntelligence = { ...mockContentIntelligence, creatorId: null };
        const response = buildContentIntelligenceResponse(noCreator);
        expect(response.attribution.basis).toBe('platform_owned');
        expect(response.attribution.creatorId).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Enrichment response
// ---------------------------------------------------------------------------

describe('buildEnrichmentResponse', () => {
    it('builds a queued response', () => {
        const response = buildEnrichmentResponse('queued', 'job-123');
        expect(response.status).toBe('queued');
        expect(response.jobId).toBe('job-123');
        expect(response.message).toContain('queued');
    });

    it('builds a completed response', () => {
        const response = buildEnrichmentResponse('completed');
        expect(response.status).toBe('completed');
        expect(response.jobId).toBeUndefined();
        expect(response.message).toContain('completed');
    });

    it('handles unknown status', () => {
        const response = buildEnrichmentResponse('custom_status');
        expect(response.message).toContain('custom_status');
    });
});

// ---------------------------------------------------------------------------
// Unified search response
// ---------------------------------------------------------------------------

describe('buildUnifiedSearchResponse', () => {
    it('returns the correct shape with both creators and content', () => {
        const response = buildUnifiedSearchResponse(
            [creatorResult],
            [contentResult],
            page,
            { q: 'afrobeats', limit: 10 },
        );
        expect(response.creators).toHaveLength(1);
        expect(response.content).toHaveLength(1);
        expect(response.page).toBe(page);
        expect(response.query).toEqual({ q: 'afrobeats', limit: 10 });
    });

    it('handles empty creator list', () => {
        const response = buildUnifiedSearchResponse([], [contentResult], page, { limit: 10 });
        expect(response.creators).toHaveLength(0);
        expect(response.content).toHaveLength(1);
    });

    it('handles empty content list', () => {
        const response = buildUnifiedSearchResponse([creatorResult], [], page, { limit: 10 });
        expect(response.creators).toHaveLength(1);
        expect(response.content).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// PageInfo structure
// ---------------------------------------------------------------------------

describe('PageInfo structure', () => {
    it('has all required fields', () => {
        expect(page).toHaveProperty('total');
        expect(page).toHaveProperty('limit');
        expect(page).toHaveProperty('returned');
        expect(page).toHaveProperty('hasMore');
        expect(page).toHaveProperty('nextCursor');
        expect(page).toHaveProperty('truncated');
    });

    it('field types are correct', () => {
        expect(typeof page.total).toBe('number');
        expect(typeof page.limit).toBe('number');
        expect(typeof page.returned).toBe('number');
        expect(typeof page.hasMore).toBe('boolean');
        expect(typeof page.truncated).toBe('boolean');
    });
});
