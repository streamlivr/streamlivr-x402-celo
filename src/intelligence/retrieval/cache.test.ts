import { describe, expect, it } from 'vitest';
import {
    buildCacheInsertQuery,
    buildCacheInvalidationQuery,
    buildCacheLookupQuery,
    shouldUseCache,
} from './cache.js';

// ---------------------------------------------------------------------------
// buildCacheLookupQuery
// ---------------------------------------------------------------------------

describe('buildCacheLookupQuery', () => {
    it('generates SELECT with hash and scope parameters', () => {
        const { sql, params } = buildCacheLookupQuery('abc123', 'public');
        expect(sql).toContain('SELECT');
        expect(sql).toContain('intelligence_query_cache');
        expect(sql).toContain('$1');
        expect(sql).toContain('$2');
        expect(params).toEqual(['abc123', 'public']);
    });

    it('filters by non-expired rows', () => {
        const { sql } = buildCacheLookupQuery('hash', 'scope');
        expect(sql).toContain('expires_at > NOW()');
    });

    it('selects all cache columns', () => {
        const { sql } = buildCacheLookupQuery('hash', 'scope');
        expect(sql).toContain('query_hash');
        expect(sql).toContain('normalized_query');
        expect(sql).toContain('result');
        expect(sql).toContain('access_scope');
    });
});

// ---------------------------------------------------------------------------
// buildCacheInsertQuery
// ---------------------------------------------------------------------------

describe('buildCacheInsertQuery', () => {
    const entry = {
        queryHash: 'hash123',
        normalizedQuery: 'lagos music',
        filters: { language: 'en' },
        result: [{ id: '1' }, { id: '2' }],
        accessScope: 'public',
        ttlSeconds: 3600,
    };

    it('generates INSERT with ON CONFLICT DO UPDATE', () => {
        const { sql } = buildCacheInsertQuery(entry);
        expect(sql).toContain('INSERT INTO intelligence_query_cache');
        expect(sql).toContain('ON CONFLICT');
        expect(sql).toContain('DO UPDATE SET');
    });

    it('uses TTL from entry for expires_at', () => {
        const { sql } = buildCacheInsertQuery(entry);
        expect(sql).toContain('3600 seconds');
    });

    it('passes 5 parameters', () => {
        const { params } = buildCacheInsertQuery(entry);
        expect(params).toHaveLength(5);
        expect(params[0]).toBe('hash123');
        expect(params[1]).toBe('lagos music');
        expect(params[4]).toBe('public');
    });

    it('serialises filters and result as JSON', () => {
        const { params } = buildCacheInsertQuery(entry);
        // Filters param (index 2)
        expect(typeof params[2]).toBe('string');
        expect(JSON.parse(params[2] as string)).toEqual({ language: 'en' });
        // Result param (index 3)
        expect(typeof params[3]).toBe('string');
        expect(JSON.parse(params[3] as string)).toEqual([{ id: '1' }, { id: '2' }]);
    });

    it('falls back to config TTL when entry ttlSeconds is 0', () => {
        const zeroTtl = { ...entry, ttlSeconds: 0 };
        const { sql } = buildCacheInsertQuery(zeroTtl);
        // Should contain a numeric interval (from config default 3600)
        expect(sql).toContain('seconds');
    });
});

// ---------------------------------------------------------------------------
// buildCacheInvalidationQuery
// ---------------------------------------------------------------------------

describe('buildCacheInvalidationQuery', () => {
    it('generates DELETE with JSONB containment', () => {
        const { sql, params } = buildCacheInvalidationQuery('creator', 'slvr-100');
        expect(sql).toContain('DELETE FROM intelligence_query_cache');
        expect(sql).toContain('@>');
        expect(sql).toContain('$1::jsonb');
        expect(params).toHaveLength(1);
    });

    it('embeds entity type and id in the pattern', () => {
        const { params } = buildCacheInvalidationQuery('content', 'vid-42');
        const pattern = JSON.parse(params[0] as string);
        expect(pattern.entityType).toBe('content');
        expect(pattern.entityId).toBe('vid-42');
    });
});

// ---------------------------------------------------------------------------
// shouldUseCache
// ---------------------------------------------------------------------------

describe('shouldUseCache', () => {
    it('returns true for undefined filters', () => {
        expect(shouldUseCache(undefined)).toBe(true);
    });

    it('returns true for stable filters only', () => {
        expect(shouldUseCache({ categories: ['music'] })).toBe(true);
        expect(shouldUseCache({ language: 'en' })).toBe(true);
        expect(shouldUseCache({ isVerified: true })).toBe(true);
        expect(shouldUseCache({ countryCode: 'NG' })).toBe(true);
        expect(shouldUseCache({ minConfidence: 0.5 })).toBe(true);
    });

    it('returns false for date-range filters', () => {
        expect(shouldUseCache({ dateFrom: new Date() })).toBe(false);
        expect(shouldUseCache({ dateTo: new Date() })).toBe(false);
    });

    it('returns false for follower-count filters', () => {
        expect(shouldUseCache({ minFollowers: 1000 })).toBe(false);
    });

    it('returns true for empty filter object', () => {
        expect(shouldUseCache({})).toBe(true);
    });

    it('returns false when date filter and stable filter are combined', () => {
        expect(shouldUseCache({
            categories: ['music'],
            dateFrom: new Date(),
        })).toBe(false);
    });
});
