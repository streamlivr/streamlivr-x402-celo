/**
 * Cursor pagination for the paid data routes.
 *
 * Production holds thousands of creators, posts and tracks, so a paid response
 * is always one page: the rows, the total that matched, and a cursor for the
 * next page. Shipping "everything" in one body would be a multi-megabyte JSON
 * document no agent asked for and no browser can render.
 *
 * The cursor is a keyset cursor, not an offset: it carries the sort values of
 * the last row served, and the next page is `WHERE (sort) > (cursor)` — the
 * same convention `src/utils/feedCursor.ts` uses for the app feed. A page stays
 * correct while rows are being inserted underneath it, and a stale cursor skips
 * forward instead of repeating rows.
 *
 * The value is base64url JSON, so a title containing the separator character
 * cannot corrupt it. It is not signed and not secret: the worst a tampered
 * cursor can do is return a different page of the same public data. It can
 * never change the price, the payer, or the attribution, because those are
 * decided before the query runs.
 */

export interface PageRequest {
  /** Rows to return, already clamped to the route's maximum. */
  limit: number;
  /** Sort values of the row the page starts after, or null for the first page. */
  cursor: Record<string, string> | null;
  /** Normalised search text, or null when the caller did not search. */
  q: string | null;
}

export interface PageInfo {
  /** Rows that match the current filter, not just the rows on this page. */
  total: number;
  limit: number;
  returned: number;
  hasMore: boolean;
  nextCursor: string | null;
  /** True when the filter matches more rows than this page returned. */
  truncated: boolean;
}

export interface PageOptions {
  defaultLimit: number;
  maxLimit: number;
}

export type PageQueryResult =
  | { ok: true; page: PageRequest }
  | { ok: false; error: string };

/** Longest cursor this API will read back, so a hostile one cannot be huge. */
const MAX_CURSOR_CHARS = 512;
const MAX_CURSOR_KEYS = 8;

function firstValue(value: unknown): string | null {
  if (Array.isArray(value)) return value.length ? firstValue(value[0]) : null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

/** Reads `q`, `limit` and `cursor` off a query object, failing closed on nonsense. */
export function readPageQuery(query: unknown, options: PageOptions): PageQueryResult {
  const raw = (query ?? {}) as Record<string, unknown>;

  const limitText = firstValue(raw.limit);
  let limit = options.defaultLimit;
  if (limitText !== null && limitText.trim() !== '') {
    if (!/^\d+$/.test(limitText.trim())) return { ok: false, error: 'limit must be a whole number' };
    limit = Number(limitText.trim());
    if (!Number.isFinite(limit) || limit < 1) return { ok: false, error: 'limit must be at least 1' };
    limit = Math.min(limit, options.maxLimit);
  }

  const qText = (firstValue(raw.q) ?? '').trim();
  if (qText.length > 120) return { ok: false, error: 'q must be 120 characters or fewer' };

  const cursorText = (firstValue(raw.cursor) ?? '').trim();
  const cursor = cursorText ? decodeCursor(cursorText) : null;
  if (cursorText && !cursor) return { ok: false, error: 'cursor is not a cursor this API issued' };

  return { ok: true, page: { limit, cursor, q: qText || null } };
}

export function encodeCursor(values: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Record<string, string> | null {
  if (cursor.length > MAX_CURSOR_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0 || entries.length > MAX_CURSOR_KEYS) return null;
    if (entries.some(([, value]) => typeof value !== 'string')) return null;
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Page metadata for one response. One row more than the caller asked for is
 * fetched by the query, so `hasMore` is a fact rather than a guess and a full
 * last page never advertises a next page that would come back empty.
 *
 * `cursorFor` returns the sort values of the last visible row. The page that
 * just ended is the only place those values are known, so it is the caller's
 * job to hand them over.
 */
export function buildPageInfo<T>(
  rows: T[],
  total: number,
  limit: number,
  cursorFor: (row: T) => Record<string, string | number> | null,
): { rows: T[]; info: PageInfo } {
  const overflow = rows.length > limit;
  const visible = overflow ? rows.slice(0, limit) : rows;
  const last = visible[visible.length - 1];
  const cursorValues = overflow && last !== undefined ? cursorFor(last) : null;
  return {
    rows: visible,
    info: {
      total,
      limit,
      returned: visible.length,
      hasMore: overflow,
      nextCursor: cursorValues ? encodeCursor(cursorValues) : null,
      truncated: total > visible.length,
    },
  };
}

/** One extra row is always requested; see `buildPageInfo`. */
export function takeFor(page: PageRequest): number {
  return page.limit + 1;
}
