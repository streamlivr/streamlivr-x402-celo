import { describe, expect, it } from 'vitest';
import { buildPageInfo, decodeCursor, encodeCursor, readPageQuery, takeFor } from './paging.js';

const options = { defaultLimit: 50, maxLimit: 200 };

describe('paid route pagination', () => {
  it('defaults to the route limit and treats blank values as absent', () => {
    const result = readPageQuery({ limit: '', q: '   ', cursor: '' }, options);
    expect(result).toEqual({ ok: true, page: { limit: 50, cursor: null, q: null } });
  });

  it('clamps limit to the route maximum instead of failing', () => {
    const result = readPageQuery({ limit: '100000' }, options);
    expect(result.ok && result.page.limit).toBe(200);
  });

  it('rejects a limit that is not a whole number', () => {
    const result = readPageQuery({ limit: '10; drop' }, options);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/whole number/);
  });

  it('rejects a cursor this API did not issue', () => {
    const result = readPageQuery({ cursor: 'not-a-cursor' }, options);
    expect(result.ok).toBe(false);
  });

  it('round-trips a cursor with values a title could contain', () => {
    const values = { title: 'Lagos | Nights', id: 'tr_01' };
    expect(decodeCursor(encodeCursor(values))).toEqual(values);
  });

  it('returns null for a cursor that decodes to something that is not a value map', () => {
    expect(decodeCursor(Buffer.from('[1,2,3]').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"id":42}').toString('base64url'))).toBeNull();
    expect(decodeCursor('x'.repeat(600))).toBeNull();
  });

  it('marks a short page as the end and a long one as having more', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const short = buildPageInfo(rows.slice(0, 2), 2, 2, (row) => ({ id: row.id }));
    expect(short.info.hasMore).toBe(false);
    expect(short.info.nextCursor).toBeNull();
    expect(short.info.truncated).toBe(false);

    const long = buildPageInfo(rows, 10, 2, (row) => ({ id: row.id }));
    expect(long.rows).toHaveLength(2);
    expect(long.info.hasMore).toBe(true);
    expect(long.info.nextCursor).toBe(encodeCursor({ id: 'b' }));
    expect(long.info.total).toBe(10);
    expect(long.info.truncated).toBe(true);
  });

  it('asks for one row more than the caller requested', () => {
    expect(takeFor({ limit: 50, cursor: null, q: null })).toBe(51);
  });
});
