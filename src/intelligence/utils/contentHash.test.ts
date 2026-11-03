import { describe, expect, it } from 'vitest';
import { computeContentHash, hasContentChanged } from './contentHash.js';

describe('computeContentHash', () => {
    it('produces a deterministic 64-char hex string', () => {
        const hash = computeContentHash({ foo: 'bar', baz: 1 });
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns the same hash for identical data', () => {
        const a = computeContentHash({ name: 'alice', score: 42 });
        const b = computeContentHash({ name: 'alice', score: 42 });
        expect(a).toBe(b);
    });

    it('returns the same hash regardless of key order', () => {
        const a = computeContentHash({ z: 1, a: 2, m: 3 });
        const b = computeContentHash({ a: 2, m: 3, z: 1 });
        expect(a).toBe(b);
    });

    it('sorts nested objects recursively', () => {
        const a = computeContentHash({ outer: { z: 1, a: 2 } });
        const b = computeContentHash({ outer: { a: 2, z: 1 } });
        expect(a).toBe(b);
    });

    it('produces different hashes for different data', () => {
        const a = computeContentHash({ name: 'alice' });
        const b = computeContentHash({ name: 'bob' });
        expect(a).not.toBe(b);
    });

    it('handles null and undefined values', () => {
        const a = computeContentHash({ a: null, b: undefined });
        const b = computeContentHash({ b: undefined, a: null });
        expect(a).toBe(b);
    });

    it('handles arrays (order matters)', () => {
        const a = computeContentHash({ items: [1, 2, 3] });
        const b = computeContentHash({ items: [3, 2, 1] });
        expect(a).not.toBe(b);
    });

    it('handles empty objects', () => {
        const hash = computeContentHash({});
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('hasContentChanged', () => {
    it('returns true when existing hash is null', () => {
        expect(hasContentChanged(null, { a: 1 })).toBe(true);
    });

    it('returns false when data matches the stored hash', () => {
        const data = { name: 'test', value: 123 };
        const hash = computeContentHash(data);
        expect(hasContentChanged(hash, data)).toBe(false);
    });

    it('returns false when data matches regardless of key order', () => {
        const hash = computeContentHash({ x: 1, y: 2 });
        expect(hasContentChanged(hash, { y: 2, x: 1 })).toBe(false);
    });

    it('returns true when data differs', () => {
        const hash = computeContentHash({ name: 'old' });
        expect(hasContentChanged(hash, { name: 'new' })).toBe(true);
    });
});
