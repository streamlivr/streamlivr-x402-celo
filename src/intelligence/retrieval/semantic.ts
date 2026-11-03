/**
 * pgvector similarity search abstraction.
 *
 * Generates SQL query fragments for cosine-distance searches on the
 * `creator_intelligence.embedding` and `content_intelligence.content_embedding`
 * columns. Like every retrieval module, this never executes SQL itself.
 */

import { INTELLIGENCE_EMBEDDING_DIMENSIONS } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SemanticQuery {
    selectExpression: string;
    whereClause: string;
    orderBy: string;
    params: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Embedding formatting
// ---------------------------------------------------------------------------

/**
 * Format a JS number array as a PostgreSQL vector literal: `[0.1,0.2,0.3]`.
 *
 * @throws {Error} if the embedding dimension does not match the configured
 *   dimension from {@link INTELLIGENCE_EMBEDDING_DIMENSIONS}.
 */
export function formatEmbeddingParam(
    embedding: number[],
    expectedDimensions: number = INTELLIGENCE_EMBEDDING_DIMENSIONS,
): string {
    if (embedding.length !== expectedDimensions) {
        throw new Error(
            `Embedding dimension mismatch: got ${embedding.length}, expected ${expectedDimensions}`,
        );
    }
    return `[${embedding.join(',')}]`;
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

/**
 * Build a semantic search query targeting `creator_intelligence.embedding`.
 *
 * Uses cosine distance (`<=>`) and returns `1 - distance` as the similarity
 * score (`semantic_score`). An optional `threshold` filters out results below
 * a minimum similarity.
 */
export function buildCreatorSemanticQuery(
    embedding: number[],
    limit: number,
    threshold?: number,
): SemanticQuery {
    const embeddingLiteral = formatEmbeddingParam(embedding);

    const selectExpression = `1 - (embedding <=> $1::vector) AS semantic_score`;

    const whereParts: string[] = ['embedding IS NOT NULL'];
    if (threshold !== undefined) {
        whereParts.push(`1 - (embedding <=> $1::vector) > ${Number(threshold)}`);
    }

    return {
        selectExpression,
        whereClause: whereParts.join(' AND '),
        orderBy: `embedding <=> $1::vector ASC`,
        params: { embedding: embeddingLiteral },
    };
}

/**
 * Build a semantic search query targeting `content_intelligence.content_embedding`.
 *
 * Same pattern as {@link buildCreatorSemanticQuery} but on the content column.
 */
export function buildContentSemanticQuery(
    embedding: number[],
    limit: number,
    threshold?: number,
): SemanticQuery {
    const embeddingLiteral = formatEmbeddingParam(embedding);

    const selectExpression = `1 - (content_embedding <=> $1::vector) AS semantic_score`;

    const whereParts: string[] = ['content_embedding IS NOT NULL'];
    if (threshold !== undefined) {
        whereParts.push(`1 - (content_embedding <=> $1::vector) > ${Number(threshold)}`);
    }

    return {
        selectExpression,
        whereClause: whereParts.join(' AND '),
        orderBy: `content_embedding <=> $1::vector ASC`,
        params: { embedding: embeddingLiteral },
    };
}
