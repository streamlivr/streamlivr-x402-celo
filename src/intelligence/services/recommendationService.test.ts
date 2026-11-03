import { describe, expect, it } from 'vitest';
import { createRecommendationService, overlapRatio } from './recommendationService.js';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const svc = createRecommendationService();

// ---------------------------------------------------------------------------
// buildSimilarCreatorsQuery
// ---------------------------------------------------------------------------

describe('buildSimilarCreatorsQuery', () => {
    it('builds a semantic search for similar creators', () => {
        const plan = svc.buildSimilarCreatorsQuery('creator-abc', 10);
        expect(plan.mode).toBe('semantic');
        expect(plan.entityType).toBe('creator');
        expect(plan.searchQuery.sql).toContain('creator_intelligence');
    });

    it('excludes the source creator from results', () => {
        const plan = svc.buildSimilarCreatorsQuery('creator-abc', 10);
        expect(plan.searchQuery.sql).toContain('creator_id != $1');
        expect(plan.searchQuery.params[0]).toBe('creator-abc');
    });

    it('uses cosine similarity operator', () => {
        const plan = svc.buildSimilarCreatorsQuery('creator-abc', 10);
        expect(plan.searchQuery.sql).toContain('<=>');
    });

    it('applies similarity threshold', () => {
        const plan = svc.buildSimilarCreatorsQuery('creator-abc', 10);
        expect(plan.searchQuery.sql).toContain('0.5'); // DEFAULT_SIMILARITY_THRESHOLD
    });

    it('passes limit parameter', () => {
        const plan = svc.buildSimilarCreatorsQuery('creator-abc', 5);
        expect(plan.searchQuery.params).toContain(5);
        expect(plan.pagination.limit).toBe(5);
    });
});

// ---------------------------------------------------------------------------
// buildRelatedContentQuery
// ---------------------------------------------------------------------------

describe('buildRelatedContentQuery', () => {
    it('builds a semantic search for related content', () => {
        const plan = svc.buildRelatedContentQuery('content-xyz', 10);
        expect(plan.mode).toBe('semantic');
        expect(plan.entityType).toBe('content');
        expect(plan.searchQuery.sql).toContain('content_intelligence');
    });

    it('excludes the source content from results', () => {
        const plan = svc.buildRelatedContentQuery('content-xyz', 10);
        expect(plan.searchQuery.sql).toContain('content_id != $1');
        expect(plan.searchQuery.params[0]).toBe('content-xyz');
    });

    it('uses content_embedding column', () => {
        const plan = svc.buildRelatedContentQuery('content-xyz', 10);
        expect(plan.searchQuery.sql).toContain('content_embedding');
    });

    it('passes limit parameter', () => {
        const plan = svc.buildRelatedContentQuery('content-xyz', 3);
        expect(plan.searchQuery.params).toContain(3);
        expect(plan.pagination.limit).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// buildCreatorDiscoveryQuery
// ---------------------------------------------------------------------------

describe('buildCreatorDiscoveryQuery', () => {
    it('builds a discovery plan from interests', () => {
        const plan = svc.buildCreatorDiscoveryQuery({
            interests: ['afrobeats', 'production'],
            categories: ['music'],
        });
        expect(plan.entityType).toBe('creator');
        expect(plan.searchQuery.sql).toContain('creator_intelligence');
    });

    it('wraps SQL to exclude specific creators', () => {
        const plan = svc.buildCreatorDiscoveryQuery({
            interests: ['gaming'],
            categories: ['gaming'],
            excludeCreatorIds: ['id-1', 'id-2'],
        });
        expect(plan.searchQuery.sql).toContain('NOT IN');
        expect(plan.searchQuery.params).toContain('id-1');
        expect(plan.searchQuery.params).toContain('id-2');
    });

    it('does not add exclusion when no excludeCreatorIds', () => {
        const plan = svc.buildCreatorDiscoveryQuery({
            interests: ['music'],
            categories: [],
        });
        expect(plan.searchQuery.sql).not.toContain('NOT IN');
    });
});

// ---------------------------------------------------------------------------
// buildTrendingQuery
// ---------------------------------------------------------------------------

describe('buildTrendingQuery', () => {
    it('returns SQL targeting enrichment_metadata for freshness', () => {
        const q = svc.buildTrendingQuery('creator', 10);
        expect(q.sql).toContain('enrichment_metadata');
        expect(q.sql).toContain('last_successful_at');
    });

    it('uses default 72-hour window', () => {
        const q = svc.buildTrendingQuery('creator', 10);
        expect(q.sql).toContain('72 hours');
    });

    it('accepts custom window', () => {
        const q = svc.buildTrendingQuery('content', 5, 24);
        expect(q.sql).toContain('24 hours');
    });

    it('targets correct table for creator', () => {
        const q = svc.buildTrendingQuery('creator', 10);
        expect(q.sql).toContain('creator_intelligence');
    });

    it('targets correct table for content', () => {
        const q = svc.buildTrendingQuery('content', 10);
        expect(q.sql).toContain('content_intelligence');
    });

    it('includes engagement quality score', () => {
        const q = svc.buildTrendingQuery('creator', 10);
        expect(q.sql).toContain('quality_score');
    });

    it('passes entity type and limit as params', () => {
        const q = svc.buildTrendingQuery('creator', 15);
        expect(q.params).toEqual(['creator', 15]);
    });
});

// ---------------------------------------------------------------------------
// overlapRatio
// ---------------------------------------------------------------------------

describe('overlapRatio (category overlap)', () => {
    it('returns 1 for identical arrays', () => {
        expect(overlapRatio(['music', 'gaming'], ['music', 'gaming'])).toBe(1);
    });

    it('returns 0 for disjoint arrays', () => {
        expect(overlapRatio(['music'], ['gaming'])).toBe(0);
    });

    it('returns 0 for two empty arrays', () => {
        expect(overlapRatio([], [])).toBe(0);
    });

    it('returns 0 when one is empty', () => {
        expect(overlapRatio(['music'], [])).toBe(0);
    });

    it('computes correct partial overlap', () => {
        // intersection = 1 (music), union = 3 (music, gaming, lifestyle)
        const ratio = overlapRatio(['music', 'gaming'], ['music', 'lifestyle']);
        expect(ratio).toBeCloseTo(1 / 3, 5);
    });

    it('is case-insensitive', () => {
        expect(overlapRatio(['Music'], ['music'])).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// overlapRatio (topic overlap)
// ---------------------------------------------------------------------------

describe('overlapRatio (topic overlap)', () => {
    it('handles longer topic lists', () => {
        const a = ['production', 'beats', 'studio'];
        const b = ['production', 'mixing', 'studio', 'mastering'];
        // intersection = 2 (production, studio), union = 5
        expect(overlapRatio(a, b)).toBeCloseTo(2 / 5, 5);
    });
});

// ---------------------------------------------------------------------------
// scoreRecommendation
// ---------------------------------------------------------------------------

describe('scoreRecommendation', () => {
    const context = {
        userCategories: ['music', 'afrobeats'],
        userTopics: ['production', 'beats'],
        userInteractions: [],
    };

    it('returns 0 for empty candidate with no signals', () => {
        const score = svc.scoreRecommendation(
            {
                id: '1',
                entityType: 'creator',
                categories: [],
                topics: [],
            },
            context,
        );
        expect(score).toBe(0);
    });

    it('increases score with higher semantic similarity', () => {
        const low = svc.scoreRecommendation(
            { id: '1', entityType: 'creator', categories: [], topics: [], semanticScore: 0.2 },
            context,
        );
        const high = svc.scoreRecommendation(
            { id: '2', entityType: 'creator', categories: [], topics: [], semanticScore: 0.9 },
            context,
        );
        expect(high).toBeGreaterThan(low);
    });

    it('increases score with category overlap', () => {
        const noOverlap = svc.scoreRecommendation(
            { id: '1', entityType: 'creator', categories: ['gaming'], topics: [] },
            context,
        );
        const withOverlap = svc.scoreRecommendation(
            { id: '2', entityType: 'creator', categories: ['music', 'afrobeats'], topics: [] },
            context,
        );
        expect(withOverlap).toBeGreaterThan(noOverlap);
    });

    it('increases score with topic overlap', () => {
        const noOverlap = svc.scoreRecommendation(
            { id: '1', entityType: 'creator', categories: [], topics: ['cooking'] },
            context,
        );
        const withOverlap = svc.scoreRecommendation(
            { id: '2', entityType: 'creator', categories: [], topics: ['production', 'beats'] },
            context,
        );
        expect(withOverlap).toBeGreaterThan(noOverlap);
    });

    it('adds freshness bonus for recently updated candidates', () => {
        const stale = svc.scoreRecommendation(
            {
                id: '1', entityType: 'creator', categories: [], topics: [],
                updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
            },
            context,
        );
        const fresh = svc.scoreRecommendation(
            {
                id: '2', entityType: 'creator', categories: [], topics: [],
                updatedAt: new Date(), // just now
            },
            context,
        );
        expect(fresh).toBeGreaterThan(stale);
    });

    it('adds verification bonus', () => {
        const unverified = svc.scoreRecommendation(
            { id: '1', entityType: 'creator', categories: [], topics: [], isVerified: false },
            context,
        );
        const verified = svc.scoreRecommendation(
            { id: '2', entityType: 'creator', categories: [], topics: [], isVerified: true },
            context,
        );
        expect(verified).toBeGreaterThan(unverified);
    });

    it('clamps score to [0, 1]', () => {
        const score = svc.scoreRecommendation(
            {
                id: '1', entityType: 'creator',
                categories: ['music', 'afrobeats'],
                topics: ['production', 'beats'],
                semanticScore: 1.0,
                isVerified: true,
                updatedAt: new Date(),
            },
            context,
        );
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
    });

    it('produces combined score from all signals', () => {
        const score = svc.scoreRecommendation(
            {
                id: '1', entityType: 'creator',
                categories: ['music'],
                topics: ['production'],
                semanticScore: 0.7,
                isVerified: true,
                updatedAt: new Date(),
            },
            context,
        );
        // Should be non-trivial with multiple signals
        expect(score).toBeGreaterThan(0.2);
    });
});
