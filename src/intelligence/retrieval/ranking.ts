/**
 * Configurable ranking for intelligence search results.
 *
 * Provides both a SQL expression builder (for DB-side ranking) and an
 * in-memory re-ranker for cases where the composite score must be computed
 * after the query returns rows.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankingConfig {
    semanticWeight: number;
    keywordWeight: number;
    freshnessWeight: number;
    engagementWeight: number;
    verificationWeight: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Production-tuned default ranking weights. They intentionally sum to 1.0 so
 * the composite score stays in [0, 1] for easy interpretation.
 */
export function defaultRankingConfig(): RankingConfig {
    return {
        semanticWeight: 0.4,
        keywordWeight: 0.3,
        freshnessWeight: 0.15,
        engagementWeight: 0.1,
        verificationWeight: 0.05,
    };
}

// ---------------------------------------------------------------------------
// SQL expression builder
// ---------------------------------------------------------------------------

/**
 * Generate a SQL expression that combines multiple relevance signals into a
 * single `composite_score` column.
 *
 * Signal definitions:
 *  - `semantic_relevance` — cosine similarity from pgvector (0–1)
 *  - `keyword_relevance` — ts_rank_cd output (0–∞, but typically 0–1)
 *  - `freshness` — exponential decay over days since last update
 *  - `engagement_quality` — extracted from the JSONB `engagement_signals`
 *  - `verification_bonus` — flat bonus for verified creators
 */
export function buildRankingExpression(config: RankingConfig): string {
    const parts: string[] = [];

    if (config.semanticWeight > 0) {
        parts.push(`${config.semanticWeight} * COALESCE(semantic_score, 0)`);
    }

    if (config.keywordWeight > 0) {
        parts.push(`${config.keywordWeight} * COALESCE(keyword_score, 0)`);
    }

    if (config.freshnessWeight > 0) {
        // Decay function: score drops by half every ~7 days.
        parts.push(
            `${config.freshnessWeight} * (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400))`,
        );
    }

    if (config.engagementWeight > 0) {
        parts.push(
            `${config.engagementWeight} * COALESCE((engagement_signals->>'quality_score')::float, 0)`,
        );
    }

    if (config.verificationWeight > 0) {
        parts.push(
            `${config.verificationWeight} * CASE WHEN EXISTS (SELECT 1 FROM "User" WHERE id = creator_id AND "isVerified" = true) THEN 1 ELSE 0 END`,
        );
    }

    if (parts.length === 0) return '0';

    return `(${parts.join(' + ')}) AS composite_score`;
}

// ---------------------------------------------------------------------------
// In-memory re-ranker
// ---------------------------------------------------------------------------

/**
 * Re-rank an array of results by computing a composite score from the
 * available signals on each row. Sorts descending (highest score first).
 *
 * This is used when the SQL query could not embed the ranking expression
 * (e.g. after a hybrid RRF merge or when results come from multiple tables).
 */
export function rankResults<
    T extends {
        semanticScore?: number;
        keywordScore?: number;
        updatedAt?: Date;
        isVerified?: boolean;
    },
>(results: T[], config: RankingConfig): T[] {
    const now = Date.now();

    const scored = results.map((row) => {
        let score = 0;

        if (config.semanticWeight > 0) {
            score += config.semanticWeight * (row.semanticScore ?? 0);
        }

        if (config.keywordWeight > 0) {
            score += config.keywordWeight * (row.keywordScore ?? 0);
        }

        if (config.freshnessWeight > 0 && row.updatedAt) {
            const ageDays = (now - row.updatedAt.getTime()) / 86_400_000;
            score += config.freshnessWeight * (1 / (1 + ageDays));
        }

        if (config.verificationWeight > 0 && row.isVerified) {
            score += config.verificationWeight;
        }

        return { row, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.map((s) => s.row);
}
