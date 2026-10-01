import { afterEach, describe, expect, it, vi } from 'vitest';
import { interpretWithModel } from './interpret';

afterEach(() => vi.unstubAllGlobals());

describe('model search validation in the browser', () => {
  it('keeps a structured count and creator filters', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plan: {
      reply: null,
      action: { kind: 'search', dataset: 'listings', q: 'NG', limit: 3, verified: true, minFollowers: 1000, sort: 'followers' },
    } }), { status: 200 })));
    const plan = await interpretWithModel({ message: 'top 3 verified creators in NG with 1000 followers', moves: [] });
    expect(plan?.action).toEqual({ kind: 'search', dataset: 'listings', q: 'NG', limit: 3, verified: true, minFollowers: 1000, sort: 'followers' });
  });

  it('drops a ranking the API cannot serve', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plan: {
      action: { kind: 'search', dataset: 'catalog', q: null, limit: 3, sort: 'views' },
    } }), { status: 200 })));
    expect(await interpretWithModel({ message: 'top 3 tracks', moves: [] })).toBeNull();
  });
});
