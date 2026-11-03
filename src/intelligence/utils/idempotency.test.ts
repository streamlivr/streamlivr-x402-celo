import { describe, expect, it } from 'vitest';
import {
    generateAttributionKey,
    generateEnrichmentKey,
    generateQueryHash,
} from './idempotency.js';

describe('generateEnrichmentKey', () => {
    it('produces a deterministic key', () => {
        const a = generateEnrichmentKey('creator', 'abc123', 'x_api');
        const b = generateEnrichmentKey('creator', 'abc123', 'x_api');
        expect(a).toBe(b);
    });

    it('includes all three components', () => {
        const key = generateEnrichmentKey('content', 'vid456', 'firecrawl');
        expect(key).toBe('enrich:content:vid456:firecrawl');
    });

    it('produces different keys for different inputs', () => {
        const a = generateEnrichmentKey('creator', 'abc', 'x_api');
        const b = generateEnrichmentKey('creator', 'xyz', 'x_api');
        expect(a).not.toBe(b);
    });
});

describe('generateQueryHash', () => {
    it('produces a deterministic 64-char hex string', () => {
        const hash = generateQueryHash('music creators', { category: 'hip-hop' }, 'public');
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns the same hash for identical queries', () => {
        const a = generateQueryHash('test query', { limit: 10 }, 'public');
        const b = generateQueryHash('test query', { limit: 10 }, 'public');
        expect(a).toBe(b);
    });

    it('normalises filter key order', () => {
        const a = generateQueryHash('q', { z: 1, a: 2, m: 3 }, 'public');
        const b = generateQueryHash('q', { a: 2, m: 3, z: 1 }, 'public');
        expect(a).toBe(b);
    });

    it('normalises query case and whitespace', () => {
        const a = generateQueryHash('  Music Creators  ', {}, 'public');
        const b = generateQueryHash('music creators', {}, 'public');
        expect(a).toBe(b);
    });

    it('differentiates by access scope', () => {
        const a = generateQueryHash('q', {}, 'public');
        const b = generateQueryHash('q', {}, 'agent:xyz');
        expect(a).not.toBe(b);
    });

    it('differentiates by different filter values', () => {
        const a = generateQueryHash('q', { category: 'music' }, 'public');
        const b = generateQueryHash('q', { category: 'gaming' }, 'public');
        expect(a).not.toBe(b);
    });

    it('handles nested filter objects with consistent ordering', () => {
        const a = generateQueryHash('q', { nested: { z: 1, a: 2 } }, 'public');
        const b = generateQueryHash('q', { nested: { a: 2, z: 1 } }, 'public');
        expect(a).toBe(b);
    });
});

describe('generateAttributionKey', () => {
    it('produces a deterministic key with creatorId', () => {
        const a = generateAttributionKey('req-001', 'creator-abc');
        const b = generateAttributionKey('req-001', 'creator-abc');
        expect(a).toBe(b);
        expect(a).toBe('attr:req-001:creator-abc');
    });

    it('uses "platform" when creatorId is null', () => {
        const key = generateAttributionKey('req-002', null);
        expect(key).toBe('attr:req-002:platform');
    });

    it('produces different keys for different requests', () => {
        const a = generateAttributionKey('req-001', 'creator-abc');
        const b = generateAttributionKey('req-002', 'creator-abc');
        expect(a).not.toBe(b);
    });
});
