import { describe, expect, it } from 'vitest';
import {
    buildContentSemanticQuery,
    buildCreatorSemanticQuery,
    formatEmbeddingParam,
} from './semantic.js';

// ---------------------------------------------------------------------------
// Helpers — a tiny embedding that matches the default 1536 dimensions
// ---------------------------------------------------------------------------

function make1536(): number[] {
    return Array.from({ length: 1536 }, (_, i) => i * 0.001);
}

// ---------------------------------------------------------------------------
// formatEmbeddingParam
// ---------------------------------------------------------------------------

describe('formatEmbeddingParam', () => {
    it('formats embedding as PostgreSQL vector literal', () => {
        const result = formatEmbeddingParam([0.1, 0.2, 0.3], 3);
        expect(result).toBe('[0.1,0.2,0.3]');
    });

    it('throws on dimension mismatch', () => {
        expect(() => formatEmbeddingParam([0.1, 0.2], 3)).toThrow(
            'Embedding dimension mismatch: got 2, expected 3',
        );
    });

    it('accepts correct 1536-dim embeddings with default dimension', () => {
        const emb = make1536();
        const result = formatEmbeddingParam(emb);
        expect(result.startsWith('[')).toBe(true);
        expect(result.endsWith(']')).toBe(true);
        // Verify the interior is comma-separated numbers
        const inner = result.slice(1, -1).split(',');
        expect(inner.length).toBe(1536);
    });

    it('rejects wrong length against default dimension', () => {
        expect(() => formatEmbeddingParam([0.1, 0.2, 0.3])).toThrow(
            'Embedding dimension mismatch',
        );
    });
});

// ---------------------------------------------------------------------------
// buildCreatorSemanticQuery
// ---------------------------------------------------------------------------

describe('buildCreatorSemanticQuery', () => {
    it('generates select expression with semantic_score', () => {
        const emb = make1536();
        const result = buildCreatorSemanticQuery(emb, 20);
        expect(result.selectExpression).toContain('semantic_score');
        expect(result.selectExpression).toContain('embedding <=>');
    });

    it('orders by cosine distance ascending', () => {
        const emb = make1536();
        const result = buildCreatorSemanticQuery(emb, 20);
        expect(result.orderBy).toContain('embedding <=>');
        expect(result.orderBy).toContain('ASC');
    });

    it('includes embedding IS NOT NULL in where clause', () => {
        const emb = make1536();
        const result = buildCreatorSemanticQuery(emb, 10);
        expect(result.whereClause).toContain('embedding IS NOT NULL');
    });

    it('adds threshold filter when provided', () => {
        const emb = make1536();
        const result = buildCreatorSemanticQuery(emb, 10, 0.7);
        expect(result.whereClause).toContain('> 0.7');
    });

    it('omits threshold when not provided', () => {
        const emb = make1536();
        const result = buildCreatorSemanticQuery(emb, 10);
        expect(result.whereClause).not.toContain('>');
    });

    it('returns embedding param as vector literal string', () => {
        const emb = make1536();
        const result = buildCreatorSemanticQuery(emb, 10);
        expect(result.params.embedding.startsWith('[')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// buildContentSemanticQuery
// ---------------------------------------------------------------------------

describe('buildContentSemanticQuery', () => {
    it('targets content_embedding column', () => {
        const emb = make1536();
        const result = buildContentSemanticQuery(emb, 20);
        expect(result.selectExpression).toContain('content_embedding');
        expect(result.orderBy).toContain('content_embedding');
    });

    it('includes content_embedding IS NOT NULL in where clause', () => {
        const emb = make1536();
        const result = buildContentSemanticQuery(emb, 10);
        expect(result.whereClause).toContain('content_embedding IS NOT NULL');
    });

    it('adds threshold filter when provided', () => {
        const emb = make1536();
        const result = buildContentSemanticQuery(emb, 10, 0.5);
        expect(result.whereClause).toContain('> 0.5');
    });
});
