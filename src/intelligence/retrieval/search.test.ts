import { describe, expect, it } from 'vitest';
import {
    buildFilterClauses,
    buildSearchQuery,
    parseSearchRequest,
} from './search.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function make1536(): number[] {
    return Array.from({ length: 1536 }, (_, i) => i * 0.001);
}

// ---------------------------------------------------------------------------
// parseSearchRequest — zod validation
// ---------------------------------------------------------------------------

describe('parseSearchRequest', () => {
    it('parses a minimal valid request', () => {
        const req = parseSearchRequest({
            entityTypes: ['creator'],
        });
        expect(req.entityTypes).toEqual(['creator']);
        expect(req.limit).toBe(20); // default
        expect(req.offset).toBe(0); // default
        expect(req.accessScope).toBe('public'); // default
    });

    it('normalises query text to lowercase', () => {
        const req = parseSearchRequest({
            query: '  Lagos Music  ',
            entityTypes: ['creator'],
        });
        expect(req.query).toBe('lagos music');
    });

    it('rejects empty entityTypes', () => {
        expect(() =>
            parseSearchRequest({ entityTypes: [] }),
        ).toThrow();
    });

    it('rejects invalid entityType value', () => {
        expect(() =>
            parseSearchRequest({ entityTypes: ['unknown'] }),
        ).toThrow();
    });

    it('clamps limit to max 100', () => {
        expect(() =>
            parseSearchRequest({ entityTypes: ['creator'], limit: 200 }),
        ).toThrow();
    });

    it('accepts valid filters', () => {
        const req = parseSearchRequest({
            entityTypes: ['content'],
            filters: {
                categories: ['music'],
                language: 'en',
                minConfidence: 0.5,
            },
        });
        expect(req.filters?.categories).toEqual(['music']);
        expect(req.filters?.language).toBe('en');
        expect(req.filters?.minConfidence).toBe(0.5);
    });

    it('accepts embedding array', () => {
        const emb = make1536();
        const req = parseSearchRequest({
            entityTypes: ['creator'],
            embedding: emb,
        });
        expect(req.embedding).toHaveLength(1536);
    });

    it('applies default access scope', () => {
        const req = parseSearchRequest({
            entityTypes: ['creator'],
        });
        expect(req.accessScope).toBe('public');
    });

    it('accepts partial ranking config', () => {
        const req = parseSearchRequest({
            entityTypes: ['creator'],
            rankingConfig: { semanticWeight: 0.8 },
        });
        expect(req.rankingConfig?.semanticWeight).toBe(0.8);
    });
});

// ---------------------------------------------------------------------------
// buildFilterClauses
// ---------------------------------------------------------------------------

describe('buildFilterClauses', () => {
    it('returns empty array when no filters match', () => {
        const clauses = buildFilterClauses({}, 'creator');
        expect(clauses).toHaveLength(0);
    });

    it('generates category overlap clause', () => {
        const clauses = buildFilterClauses({ categories: ['music'] }, 'creator');
        expect(clauses.length).toBeGreaterThan(0);
        expect(clauses[0]!.sql).toContain('categories &&');
        expect(clauses[0]!.params).toEqual([['music']]);
    });

    it('generates language clause for creator using ANY', () => {
        const clauses = buildFilterClauses({ language: 'en' }, 'creator');
        const langClause = clauses.find((c) => c.sql.includes('languages'));
        expect(langClause).toBeDefined();
        expect(langClause!.sql).toContain('ANY(languages)');
    });

    it('generates language clause for content using equality', () => {
        const clauses = buildFilterClauses({ language: 'en' }, 'content');
        const langClause = clauses.find((c) => c.sql.includes('language'));
        expect(langClause).toBeDefined();
        expect(langClause!.sql).toContain('language =');
    });

    it('generates verified clause', () => {
        const clauses = buildFilterClauses({ isVerified: true }, 'creator');
        const verified = clauses.find((c) => c.sql.includes('"isVerified"'));
        expect(verified).toBeDefined();
        expect(verified!.params).toEqual([true]);
    });

    it('generates date range clauses', () => {
        const from = new Date('2024-01-01');
        const to = new Date('2024-12-31');
        const clauses = buildFilterClauses({ dateFrom: from, dateTo: to }, 'creator');
        expect(clauses).toHaveLength(2);
        const fromClause = clauses.find((c) => c.sql.includes('>='));
        const toClause = clauses.find((c) => c.sql.includes('<='));
        expect(fromClause).toBeDefined();
        expect(toClause).toBeDefined();
    });

    it('generates confidence clause', () => {
        const clauses = buildFilterClauses({ minConfidence: 0.8 }, 'creator');
        const conf = clauses.find((c) => c.sql.includes('confidence_score'));
        expect(conf).toBeDefined();
        expect(conf!.params).toEqual([0.8]);
    });

    it('generates country code clause', () => {
        const clauses = buildFilterClauses({ countryCode: 'NG' }, 'creator');
        const country = clauses.find((c) => c.sql.includes('"countryCode"'));
        expect(country).toBeDefined();
        expect(country!.params).toEqual(['NG']);
    });

    it('generates follower clause', () => {
        const clauses = buildFilterClauses({ minFollowers: 1000 }, 'creator');
        const followers = clauses.find((c) => c.sql.includes('"followerCount"'));
        expect(followers).toBeDefined();
        expect(followers!.params).toEqual([1000]);
    });
});

// ---------------------------------------------------------------------------
// buildSearchQuery — mode selection
// ---------------------------------------------------------------------------

describe('buildSearchQuery mode selection', () => {
    it('selects keyword mode when only query is provided', () => {
        const req = parseSearchRequest({
            query: 'lagos music',
            entityTypes: ['creator'],
        });
        const plan = buildSearchQuery(req);
        expect(plan.mode).toBe('keyword');
    });

    it('selects semantic mode when only embedding is provided', () => {
        const emb = make1536();
        const req = parseSearchRequest({
            entityTypes: ['creator'],
            embedding: emb,
        });
        const plan = buildSearchQuery(req);
        expect(plan.mode).toBe('semantic');
    });

    it('selects hybrid mode when both query and embedding are provided', () => {
        const emb = make1536();
        const req = parseSearchRequest({
            query: 'lagos music',
            entityTypes: ['creator'],
            embedding: emb,
        });
        const plan = buildSearchQuery(req);
        expect(plan.mode).toBe('hybrid');
    });

    it('falls back to keyword mode when neither query nor embedding', () => {
        const req = parseSearchRequest({
            entityTypes: ['creator'],
        });
        const plan = buildSearchQuery(req);
        expect(plan.mode).toBe('keyword');
    });
});

// ---------------------------------------------------------------------------
// buildSearchQuery — pagination
// ---------------------------------------------------------------------------

describe('buildSearchQuery pagination', () => {
    it('uses default limit and offset', () => {
        const req = parseSearchRequest({
            entityTypes: ['creator'],
        });
        const plan = buildSearchQuery(req);
        expect(plan.pagination.limit).toBe(20);
        expect(plan.pagination.offset).toBe(0);
    });

    it('respects custom limit and offset', () => {
        const req = parseSearchRequest({
            entityTypes: ['creator'],
            limit: 50,
            offset: 10,
        });
        const plan = buildSearchQuery(req);
        expect(plan.pagination.limit).toBe(50);
        expect(plan.pagination.offset).toBe(10);
    });
});

// ---------------------------------------------------------------------------
// buildSearchQuery — cache integration
// ---------------------------------------------------------------------------

describe('buildSearchQuery cache integration', () => {
    it('includes cacheQuery for stable filters', () => {
        const req = parseSearchRequest({
            query: 'music',
            entityTypes: ['creator'],
            filters: { categories: ['music'] },
        });
        const plan = buildSearchQuery(req);
        expect(plan.cacheQuery).toBeDefined();
        expect(plan.cacheQuery!.sql).toContain('intelligence_query_cache');
    });

    it('omits cacheQuery for date-range filters', () => {
        const req = parseSearchRequest({
            query: 'music',
            entityTypes: ['creator'],
            filters: { dateFrom: new Date().toISOString() as unknown as Date },
        });
        const plan = buildSearchQuery(req);
        expect(plan.cacheQuery).toBeUndefined();
    });

    it('includes cacheQuery when no filters', () => {
        const req = parseSearchRequest({
            query: 'test',
            entityTypes: ['creator'],
        });
        const plan = buildSearchQuery(req);
        expect(plan.cacheQuery).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// buildSearchQuery — entity type
// ---------------------------------------------------------------------------

describe('buildSearchQuery entity type', () => {
    it('uses first entity type for the plan', () => {
        const req = parseSearchRequest({
            query: 'test',
            entityTypes: ['content', 'creator'],
        });
        const plan = buildSearchQuery(req);
        expect(plan.entityType).toBe('content');
    });

    it('targets creator_intelligence for creator type', () => {
        const req = parseSearchRequest({
            query: 'test',
            entityTypes: ['creator'],
        });
        const plan = buildSearchQuery(req);
        expect(plan.searchQuery.sql).toContain('creator_intelligence');
    });

    it('targets content_intelligence for content type', () => {
        const req = parseSearchRequest({
            query: 'test',
            entityTypes: ['content'],
        });
        const plan = buildSearchQuery(req);
        expect(plan.searchQuery.sql).toContain('content_intelligence');
    });
});
