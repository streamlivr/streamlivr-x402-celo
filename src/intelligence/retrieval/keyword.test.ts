import { describe, expect, it } from 'vitest';
import {
    buildContentKeywordQuery,
    buildCreatorKeywordQuery,
    sanitizeTsQueryInput,
    tokensToTsQuery,
} from './keyword.js';

// ---------------------------------------------------------------------------
// sanitizeTsQueryInput
// ---------------------------------------------------------------------------

describe('sanitizeTsQueryInput', () => {
    it('lowercases and trims', () => {
        expect(sanitizeTsQueryInput('  Lagos  ')).toBe('lagos');
    });

    it('strips tsquery special characters', () => {
        expect(sanitizeTsQueryInput('music&me')).toBe('musicme');
        expect(sanitizeTsQueryInput('live|stream')).toBe('livestream');
        expect(sanitizeTsQueryInput('test!')).toBe('test');
        expect(sanitizeTsQueryInput('(group)')).toBe('group');
        expect(sanitizeTsQueryInput('prefix:*')).toBe('prefix');
        expect(sanitizeTsQueryInput('back\\slash')).toBe('backslash');
    });

    it('returns empty string for all-special input', () => {
        expect(sanitizeTsQueryInput('&|!()')).toBe('');
    });

    it('preserves alphanumeric characters', () => {
        expect(sanitizeTsQueryInput('afro123beats')).toBe('afro123beats');
    });
});

// ---------------------------------------------------------------------------
// tokensToTsQuery
// ---------------------------------------------------------------------------

describe('tokensToTsQuery', () => {
    it('joins multiple tokens with AND operator', () => {
        const result = tokensToTsQuery(['lagos', 'music'], '&');
        expect(result).toBe('lagos:* & music:*');
    });

    it('joins multiple tokens with OR operator', () => {
        const result = tokensToTsQuery(['lagos', 'music'], '|');
        expect(result).toBe('lagos:* | music:*');
    });

    it('returns single token without operator', () => {
        const result = tokensToTsQuery(['afrobeats'], '&');
        expect(result).toBe('afrobeats:*');
    });

    it('appends :* for prefix matching', () => {
        const result = tokensToTsQuery(['test'], '&');
        expect(result).toContain(':*');
    });

    it('returns empty string for empty token array', () => {
        expect(tokensToTsQuery([], '&')).toBe('');
    });

    it('filters out tokens that sanitize to empty', () => {
        const result = tokensToTsQuery(['&', 'valid', '|'], '&');
        expect(result).toBe('valid:*');
    });

    it('sanitizes tokens before joining', () => {
        const result = tokensToTsQuery(['Lagos!', 'MUSIC'], '&');
        expect(result).toBe('lagos:* & music:*');
    });
});

// ---------------------------------------------------------------------------
// buildCreatorKeywordQuery
// ---------------------------------------------------------------------------

describe('buildCreatorKeywordQuery', () => {
    it('builds AND query for match=all', () => {
        const result = buildCreatorKeywordQuery(['lagos', 'producer'], 'all');
        expect(result.tsQuery).toBe('lagos:* & producer:*');
        expect(result.whereClause).toContain("to_tsquery('english'");
        expect(result.whereClause).toContain('search_vector @@');
        expect(result.rankExpression).toContain('ts_rank_cd');
    });

    it('builds OR query for match=any', () => {
        const result = buildCreatorKeywordQuery(['lagos', 'producer'], 'any');
        expect(result.tsQuery).toBe('lagos:* | producer:*');
    });

    it('returns pass-through for empty tokens', () => {
        const result = buildCreatorKeywordQuery([], 'all');
        expect(result.tsQuery).toBe('');
        expect(result.whereClause).toBe('1 = 1');
        expect(result.rankExpression).toBe('0');
    });

    it('includes params with tsQuery key', () => {
        const result = buildCreatorKeywordQuery(['test'], 'all');
        expect(result.params).toHaveProperty('tsQuery');
        expect(result.params.tsQuery).toBe('test:*');
    });
});

// ---------------------------------------------------------------------------
// buildContentKeywordQuery
// ---------------------------------------------------------------------------

describe('buildContentKeywordQuery', () => {
    it('generates same SQL structure as creator query', () => {
        const result = buildContentKeywordQuery(['afrobeats'], 'all');
        expect(result.whereClause).toContain('search_vector @@');
        expect(result.rankExpression).toContain('ts_rank_cd');
    });

    it('handles single token correctly', () => {
        const result = buildContentKeywordQuery(['stream'], 'any');
        expect(result.tsQuery).toBe('stream:*');
    });
});
