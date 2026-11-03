/**
 * PostgreSQL full-text search abstraction.
 *
 * Generates SQL query fragments for `tsvector` / `tsquery` operations on the
 * `creator_intelligence` and `content_intelligence` tables. These fragments
 * are composed by the higher-level search modules — they never touch a
 * database connection themselves.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeywordQuery {
    tsQuery: string;
    whereClause: string;
    rankExpression: string;
    params: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Token sanitisation
// ---------------------------------------------------------------------------

/**
 * Escape characters that carry special meaning inside a PostgreSQL `tsquery`
 * literal, then lowercase and trim. The caller can safely interpolate the
 * result into a `to_tsquery('english', ...)` call.
 */
export function sanitizeTsQueryInput(token: string): string {
    return token
        .toLowerCase()
        .trim()
        .replace(/[&|!():\\*]/g, '');
}

// ---------------------------------------------------------------------------
// Token → tsquery string
// ---------------------------------------------------------------------------

/**
 * Join an array of sanitised tokens into a tsquery string with the given
 * operator (`&` for AND, `|` for OR). Each token is suffixed with `:*` for
 * prefix matching.
 *
 * Single-token arrays omit the operator. Empty arrays return an empty string.
 */
export function tokensToTsQuery(tokens: string[], operator: '&' | '|'): string {
    const sanitised = tokens
        .map(sanitizeTsQueryInput)
        .filter((t) => t.length > 0);

    if (sanitised.length === 0) return '';
    if (sanitised.length === 1) return `${sanitised[0]}:*`;

    return sanitised.map((t) => `${t}:*`).join(` ${operator} `);
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

/**
 * Build a keyword query targeting the `creator_intelligence` table's
 * `search_vector` column.
 */
export function buildCreatorKeywordQuery(
    tokens: string[],
    match: 'all' | 'any',
): KeywordQuery {
    const operator = match === 'all' ? '&' : '|';
    const tsQuery = tokensToTsQuery(tokens, operator);

    return {
        tsQuery,
        whereClause: tsQuery
            ? `search_vector @@ to_tsquery('english', $tsQuery)`
            : '1 = 1',
        rankExpression: tsQuery
            ? `ts_rank_cd(search_vector, to_tsquery('english', $tsQuery))`
            : '0',
        params: { tsQuery },
    };
}

/**
 * Build a keyword query targeting the `content_intelligence` table's
 * `search_vector` column.
 */
export function buildContentKeywordQuery(
    tokens: string[],
    match: 'all' | 'any',
): KeywordQuery {
    const operator = match === 'all' ? '&' : '|';
    const tsQuery = tokensToTsQuery(tokens, operator);

    return {
        tsQuery,
        whereClause: tsQuery
            ? `search_vector @@ to_tsquery('english', $tsQuery)`
            : '1 = 1',
        rankExpression: tsQuery
            ? `ts_rank_cd(search_vector, to_tsquery('english', $tsQuery))`
            : '0',
        params: { tsQuery },
    };
}
