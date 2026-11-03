import { describe, expect, it } from 'vitest';
import { buildHybridQuery, normalizeWeights } from './hybrid.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function make1536(): number[] {
    return Array.from({ length: 1536 }, (_, i) => i * 0.001);
}

// ---------------------------------------------------------------------------
// normalizeWeights
// ---------------------------------------------------------------------------

describe('normalizeWeights', () => {
    it('returns equal weights when both are zero', () => {
        const result = normalizeWeights(0, 0);
        expect(result.keyword).toBe(0.5);
        expect(result.semantic).toBe(0.5);
    });

    it('normalises so weights sum to 1.0', () => {
        const result = normalizeWeights(0.6, 0.4);
        expect(result.keyword + result.semantic).toBeCloseTo(1.0);
    });

    it('normalises unbalanced weights', () => {
        const result = normalizeWeights(0.6, 0.2);
        expect(result.keyword).toBeCloseTo(0.75);
        expect(result.semantic).toBeCloseTo(0.25);
    });

    it('clamps negative weights to 0', () => {
        const result = normalizeWeights(-1, 1);
        expect(result.keyword).toBe(0);
        expect(result.semantic).toBe(1);
    });

    it('clamps weights above 1 to 1', () => {
        const result = normalizeWeights(5, 5);
        expect(result.keyword).toBeCloseTo(0.5);
        expect(result.semantic).toBeCloseTo(0.5);
    });
});

// ---------------------------------------------------------------------------
// buildHybridQuery — keyword-only
// ---------------------------------------------------------------------------

describe('buildHybridQuery keyword-only mode', () => {
    it('returns mode=keyword when only tokens are provided', () => {
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['lagos', 'music'],
            limit: 20,
        });
        expect(result.mode).toBe('keyword');
        expect(result.sql).toContain('ts_rank_cd');
        expect(result.sql).toContain("to_tsquery('english'");
    });

    it('uses creator_intelligence table for creator entity', () => {
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['test'],
            limit: 10,
        });
        expect(result.sql).toContain('creator_intelligence');
    });

    it('uses content_intelligence table for content entity', () => {
        const result = buildHybridQuery({
            entityType: 'content',
            keywordTokens: ['test'],
            limit: 10,
        });
        expect(result.sql).toContain('content_intelligence');
    });

    it('includes LIMIT and OFFSET', () => {
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['test'],
            limit: 15,
            offset: 5,
        });
        expect(result.sql).toContain('LIMIT 15');
        expect(result.sql).toContain('OFFSET 5');
    });
});

// ---------------------------------------------------------------------------
// buildHybridQuery — semantic-only
// ---------------------------------------------------------------------------

describe('buildHybridQuery semantic-only mode', () => {
    it('returns mode=semantic when only embedding is provided', () => {
        const emb = make1536();
        const result = buildHybridQuery({
            entityType: 'creator',
            embedding: emb,
            limit: 20,
        });
        expect(result.mode).toBe('semantic');
        expect(result.sql).toContain('semantic_score');
        expect(result.sql).toContain('embedding <=>');
    });

    it('uses content_embedding column for content entity', () => {
        const emb = make1536();
        const result = buildHybridQuery({
            entityType: 'content',
            embedding: emb,
            limit: 10,
        });
        expect(result.sql).toContain('content_embedding');
    });

    it('includes embedding in params', () => {
        const emb = make1536();
        const result = buildHybridQuery({
            entityType: 'creator',
            embedding: emb,
            limit: 10,
        });
        expect(result.params.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// buildHybridQuery — hybrid mode (RRF)
// ---------------------------------------------------------------------------

describe('buildHybridQuery hybrid mode', () => {
    it('returns mode=hybrid when both tokens and embedding are provided', () => {
        const emb = make1536();
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['lagos'],
            embedding: emb,
            limit: 20,
        });
        expect(result.mode).toBe('hybrid');
    });

    it('uses CTEs for keyword and semantic sub-queries', () => {
        const emb = make1536();
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['music'],
            embedding: emb,
            limit: 20,
        });
        expect(result.sql).toContain('keyword_cte');
        expect(result.sql).toContain('semantic_cte');
    });

    it('computes hybrid_score with RRF formula', () => {
        const emb = make1536();
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['test'],
            embedding: emb,
            limit: 10,
        });
        expect(result.sql).toContain('hybrid_score');
        // RRF constant 60 should appear
        expect(result.sql).toContain('60');
    });

    it('orders by hybrid_score DESC', () => {
        const emb = make1536();
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['test'],
            embedding: emb,
            limit: 10,
        });
        expect(result.sql).toContain('ORDER BY hybrid_score DESC');
    });
});

// ---------------------------------------------------------------------------
// buildHybridQuery — filter application
// ---------------------------------------------------------------------------

describe('buildHybridQuery with filters', () => {
    it('applies category filter', () => {
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['test'],
            filters: { categories: ['music', 'gaming'] },
            limit: 10,
        });
        expect(result.sql).toContain('categories &&');
    });

    it('applies language filter for creator', () => {
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['test'],
            filters: { language: 'en' },
            limit: 10,
        });
        expect(result.sql).toContain('ANY(languages)');
    });

    it('applies language filter for content', () => {
        const result = buildHybridQuery({
            entityType: 'content',
            keywordTokens: ['test'],
            filters: { language: 'en' },
            limit: 10,
        });
        expect(result.sql).toContain('language =');
    });

    it('applies verified filter', () => {
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['test'],
            filters: { isVerified: true },
            limit: 10,
        });
        expect(result.sql).toContain('"isVerified"');
    });

    it('applies confidence filter', () => {
        const result = buildHybridQuery({
            entityType: 'creator',
            keywordTokens: ['test'],
            filters: { minConfidence: 0.8 },
            limit: 10,
        });
        expect(result.sql).toContain('confidence_score >=');
    });
});

// ---------------------------------------------------------------------------
// buildHybridQuery — fallback
// ---------------------------------------------------------------------------

describe('buildHybridQuery fallback', () => {
    it('returns keyword mode fallback when no search signals', () => {
        const result = buildHybridQuery({
            entityType: 'creator',
            limit: 20,
        });
        expect(result.mode).toBe('keyword');
        expect(result.sql).toContain('ORDER BY updated_at DESC');
    });
});
