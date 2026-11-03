import { describe, expect, it } from 'vitest';
import { createSearchService } from './searchService.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe('createSearchService', () => {
    it('creates a service with all expected methods', () => {
        const svc = createSearchService();
        expect(typeof svc.search).toBe('function');
        expect(typeof svc.searchCreators).toBe('function');
        expect(typeof svc.searchContent).toBe('function');
        expect(typeof svc.getCreatorIntelligence).toBe('function');
        expect(typeof svc.getContentIntelligence).toBe('function');
    });
});

// ---------------------------------------------------------------------------
// search() — creator-only plan
// ---------------------------------------------------------------------------

describe('search — creator-only plan', () => {
    const svc = createSearchService();

    it('generates a creator search plan', () => {
        const result = svc.search({
            query: 'afrobeats',
            entityTypes: ['creator'],
        });
        expect(result.plan.entityType).toBe('creator');
        expect(result.plan.searchQuery.sql).toContain('creator_intelligence');
        expect(result.responseBuilder).toBe('buildCreatorSearchResponse');
        expect(result.metadata.mode).toBe('keyword');
    });
});

// ---------------------------------------------------------------------------
// search() — content-only plan
// ---------------------------------------------------------------------------

describe('search — content-only plan', () => {
    const svc = createSearchService();

    it('generates a content search plan', () => {
        const result = svc.search({
            query: 'lagos nightlife',
            entityTypes: ['content'],
        });
        expect(result.plan.entityType).toBe('content');
        expect(result.plan.searchQuery.sql).toContain('content_intelligence');
        expect(result.responseBuilder).toBe('buildContentSearchResponse');
    });
});

// ---------------------------------------------------------------------------
// search() — unified plan
// ---------------------------------------------------------------------------

describe('search — unified plan', () => {
    const svc = createSearchService();

    it('selects unified response builder for multiple entity types', () => {
        const result = svc.search({
            query: 'music',
            entityTypes: ['creator', 'content'],
        });
        expect(result.responseBuilder).toBe('buildUnifiedSearchResponse');
    });

    it('selects unified builder when no entity types specified', () => {
        const result = svc.search({ query: 'music' });
        expect(result.responseBuilder).toBe('buildUnifiedSearchResponse');
    });
});

// ---------------------------------------------------------------------------
// search() — config defaults
// ---------------------------------------------------------------------------

describe('search — config defaults', () => {
    it('applies default limit from config', () => {
        const svc = createSearchService({ defaultLimit: 15 });
        const result = svc.search({ query: 'test', entityTypes: ['creator'] });
        expect(result.plan.pagination.limit).toBe(15);
    });

    it('applies default limit when no limit specified', () => {
        const svc = createSearchService();
        const result = svc.search({ query: 'test', entityTypes: ['creator'] });
        expect(result.plan.pagination.limit).toBe(20); // default
    });
});

// ---------------------------------------------------------------------------
// search() — limit clamping
// ---------------------------------------------------------------------------

describe('search — limit clamping', () => {
    it('clamps limit to maxLimit', () => {
        const svc = createSearchService({ maxLimit: 50 });
        const result = svc.search({
            query: 'test',
            entityTypes: ['creator'],
            limit: 200,
        });
        expect(result.plan.pagination.limit).toBe(50);
    });

    it('allows limit below maxLimit', () => {
        const svc = createSearchService({ maxLimit: 100 });
        const result = svc.search({
            query: 'test',
            entityTypes: ['creator'],
            limit: 30,
        });
        expect(result.plan.pagination.limit).toBe(30);
    });
});

// ---------------------------------------------------------------------------
// search() — metadata
// ---------------------------------------------------------------------------

describe('search — metadata', () => {
    const svc = createSearchService();

    it('includes query hash in metadata', () => {
        const result = svc.search({ query: 'test', entityTypes: ['creator'] });
        expect(result.metadata.queryHash).toBeDefined();
        expect(typeof result.metadata.queryHash).toBe('string');
        expect(result.metadata.queryHash.length).toBe(64); // SHA-256 hex
    });

    it('produces consistent query hash for same input', () => {
        const r1 = svc.search({ query: 'test', entityTypes: ['creator'] });
        const r2 = svc.search({ query: 'test', entityTypes: ['creator'] });
        expect(r1.metadata.queryHash).toBe(r2.metadata.queryHash);
    });

    it('reports cached flag based on cache query presence', () => {
        const result = svc.search({ query: 'test', entityTypes: ['creator'] });
        expect(typeof result.metadata.cached).toBe('boolean');
    });
});

// ---------------------------------------------------------------------------
// searchCreators()
// ---------------------------------------------------------------------------

describe('searchCreators', () => {
    const svc = createSearchService();

    it('builds a creator-only search plan', () => {
        const plan = svc.searchCreators('afrobeats');
        expect(plan.entityType).toBe('creator');
        expect(plan.searchQuery.sql).toContain('creator_intelligence');
    });

    it('applies filters', () => {
        const plan = svc.searchCreators('music', { categories: ['music'] });
        expect(plan.searchQuery.sql).toBeDefined();
    });

    it('respects limit', () => {
        const plan = svc.searchCreators('test', undefined, 5);
        expect(plan.pagination.limit).toBe(5);
    });

    it('clamps limit to maxLimit', () => {
        const svc2 = createSearchService({ maxLimit: 10 });
        const plan = svc2.searchCreators('test', undefined, 50);
        expect(plan.pagination.limit).toBe(10);
    });
});

// ---------------------------------------------------------------------------
// searchContent()
// ---------------------------------------------------------------------------

describe('searchContent', () => {
    const svc = createSearchService();

    it('builds a content-only search plan', () => {
        const plan = svc.searchContent('lagos');
        expect(plan.entityType).toBe('content');
        expect(plan.searchQuery.sql).toContain('content_intelligence');
    });

    it('respects limit', () => {
        const plan = svc.searchContent('test', undefined, 3);
        expect(plan.pagination.limit).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// getCreatorIntelligence()
// ---------------------------------------------------------------------------

describe('getCreatorIntelligence', () => {
    const svc = createSearchService();

    it('returns SQL with creator_id param', () => {
        const q = svc.getCreatorIntelligence('creator-123');
        expect(q.sql).toContain('creator_intelligence');
        expect(q.sql).toContain('external_identity_link');
        expect(q.sql).toContain('data_provenance');
        expect(q.params).toEqual(['creator-123']);
    });

    it('joins external links and provenance', () => {
        const q = svc.getCreatorIntelligence('xyz');
        expect(q.sql).toContain('LEFT JOIN');
        expect(q.sql).toContain('verification_status');
    });
});

// ---------------------------------------------------------------------------
// getContentIntelligence()
// ---------------------------------------------------------------------------

describe('getContentIntelligence', () => {
    const svc = createSearchService();

    it('returns SQL with content_id param', () => {
        const q = svc.getContentIntelligence('content-456');
        expect(q.sql).toContain('content_intelligence');
        expect(q.sql).toContain('data_provenance');
        expect(q.params).toEqual(['content-456']);
    });

    it('joins provenance data', () => {
        const q = svc.getContentIntelligence('xyz');
        expect(q.sql).toContain('LEFT JOIN');
        expect(q.sql).toContain('retention_policy');
    });
});
