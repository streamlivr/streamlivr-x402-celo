import { describe, expect, it } from 'vitest';
import {
    buildRankingExpression,
    defaultRankingConfig,
    rankResults,
} from './ranking.js';

// ---------------------------------------------------------------------------
// defaultRankingConfig
// ---------------------------------------------------------------------------

describe('defaultRankingConfig', () => {
    it('returns weights that sum to 1.0', () => {
        const config = defaultRankingConfig();
        const sum =
            config.semanticWeight +
            config.keywordWeight +
            config.freshnessWeight +
            config.engagementWeight +
            config.verificationWeight;
        expect(sum).toBeCloseTo(1.0);
    });

    it('has semantic as the heaviest weight', () => {
        const config = defaultRankingConfig();
        expect(config.semanticWeight).toBe(0.4);
        expect(config.semanticWeight).toBeGreaterThan(config.keywordWeight);
    });

    it('has verification as the lightest weight', () => {
        const config = defaultRankingConfig();
        expect(config.verificationWeight).toBe(0.05);
    });
});

// ---------------------------------------------------------------------------
// buildRankingExpression
// ---------------------------------------------------------------------------

describe('buildRankingExpression', () => {
    it('includes semantic_score when weight > 0', () => {
        const expr = buildRankingExpression(defaultRankingConfig());
        expect(expr).toContain('semantic_score');
    });

    it('includes keyword_score when weight > 0', () => {
        const expr = buildRankingExpression(defaultRankingConfig());
        expect(expr).toContain('keyword_score');
    });

    it('includes freshness decay function', () => {
        const expr = buildRankingExpression(defaultRankingConfig());
        expect(expr).toContain('EXTRACT(EPOCH FROM');
        expect(expr).toContain('86400');
    });

    it('includes engagement quality from JSONB', () => {
        const expr = buildRankingExpression(defaultRankingConfig());
        expect(expr).toContain('engagement_signals');
        expect(expr).toContain('quality_score');
    });

    it('includes verification bonus check', () => {
        const expr = buildRankingExpression(defaultRankingConfig());
        expect(expr).toContain('"isVerified"');
    });

    it('ends with AS composite_score', () => {
        const expr = buildRankingExpression(defaultRankingConfig());
        expect(expr).toContain('AS composite_score');
    });

    it('returns 0 when all weights are zero', () => {
        const expr = buildRankingExpression({
            semanticWeight: 0,
            keywordWeight: 0,
            freshnessWeight: 0,
            engagementWeight: 0,
            verificationWeight: 0,
        });
        expect(expr).toBe('0');
    });

    it('omits components with zero weight', () => {
        const expr = buildRankingExpression({
            semanticWeight: 0.5,
            keywordWeight: 0,
            freshnessWeight: 0,
            engagementWeight: 0,
            verificationWeight: 0.5,
        });
        expect(expr).toContain('semantic_score');
        expect(expr).toContain('"isVerified"');
        expect(expr).not.toContain('keyword_score');
        expect(expr).not.toContain('engagement_signals');
    });
});

// ---------------------------------------------------------------------------
// rankResults
// ---------------------------------------------------------------------------

describe('rankResults', () => {
    const config = defaultRankingConfig();

    it('sorts results by composite score descending', () => {
        const results = [
            { semanticScore: 0.3, keywordScore: 0.1 },
            { semanticScore: 0.9, keywordScore: 0.8 },
            { semanticScore: 0.5, keywordScore: 0.5 },
        ];

        const ranked = rankResults(results, config);
        // The one with 0.9 semantic + 0.8 keyword should be first
        expect(ranked[0]!.semanticScore).toBe(0.9);
        expect(ranked[ranked.length - 1]!.semanticScore).toBe(0.3);
    });

    it('applies verification bonus', () => {
        const results = [
            { semanticScore: 0.5, keywordScore: 0.5, isVerified: false },
            { semanticScore: 0.5, keywordScore: 0.5, isVerified: true },
        ];

        const ranked = rankResults(results, config);
        // Verified creator should rank higher with same scores
        expect(ranked[0]!.isVerified).toBe(true);
    });

    it('applies freshness boost', () => {
        const now = new Date();
        const old = new Date(now.getTime() - 365 * 86_400_000); // 1 year ago

        const results = [
            { semanticScore: 0.5, updatedAt: old },
            { semanticScore: 0.5, updatedAt: now },
        ];

        const ranked = rankResults(results, config);
        // Recent result should rank higher
        expect(ranked[0]!.updatedAt).toBe(now);
    });

    it('handles missing optional fields gracefully', () => {
        const results = [
            { semanticScore: 0.8 },
            { keywordScore: 0.9 },
            {},
        ];

        const ranked = rankResults(results, config);
        expect(ranked).toHaveLength(3);
    });

    it('returns empty array for empty input', () => {
        const ranked = rankResults([], config);
        expect(ranked).toEqual([]);
    });

    it('preserves all original properties', () => {
        const results = [
            { semanticScore: 0.5, keywordScore: 0.3, id: 'abc', extra: 42 },
        ];

        const ranked = rankResults(results, config);
        expect(ranked[0]!.id).toBe('abc');
        expect(ranked[0]!.extra).toBe(42);
    });
});
