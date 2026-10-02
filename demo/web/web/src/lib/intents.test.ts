import { afterEach, describe, expect, it, vi } from 'vitest';
import { planQuery, requestedLimit, resolveMove, withQuery } from './intents';

afterEach(() => vi.unstubAllGlobals());

describe('open-ended data requests', () => {
  it('turns top 3 creators into a three-row follower-ranked page', () => {
    expect(planQuery('top 3 creators', [])).toMatchObject({ kind: 'search', dataset: 'listings', q: null, limit: 3 });
    expect(withQuery('/api/v1/agent/listings', { q: null, limit: 3 })).toBe('/api/v1/agent/listings?limit=3');
  });

  it('combines a count with a country and topic without searching for the number', () => {
    expect(planQuery('show me the top three fashion creators in Nigeria', [])).toMatchObject({
      kind: 'search', dataset: 'listings', q: 'fashion nigeria', limit: 3,
    });
    expect(planQuery('five posts about amapiano', [])).toMatchObject({
      kind: 'search', dataset: 'posts', q: 'amapiano', limit: 5,
    });
    expect(planQuery('top 3 brands in NG', [])).toMatchObject({
      kind: 'search', dataset: 'listings', q: 'ng', limit: 3, sort: 'followers',
    });
  });

  it('understands counts in different positions', () => {
    expect(requestedLimit('first 7 tracks')).toBe(7);
    expect(requestedLimit('12 public creators')).toBe(12);
    expect(requestedLimit('top3 influencers')).toBe(3);
    expect(requestedLimit('Song 24k Magic')).toBeUndefined();
  });

  it('retains the requested size on the next page', () => {
    expect(withQuery('/api/v1/agent/listings', { q: 'NG', cursor: 'abc', limit: 3 })).toBe('/api/v1/agent/listings?q=NG&limit=3&cursor=abc');
  });

  it('combines real public profile filters with search and count', () => {
    expect(planQuery('top 3 verified fashion creators in Nigeria with at least 1,000 followers', [])).toMatchObject({
      kind: 'search', dataset: 'listings', q: 'fashion nigeria', limit: 3, verified: true, minFollowers: 1000,
    });
    expect(withQuery('/api/v1/agent/listings', { q: 'fashion nigeria', limit: 3, verified: true, minFollowers: 1000, cursor: 'next' })).toBe(
      '/api/v1/agent/listings?q=fashion+nigeria&limit=3&verified=true&minFollowers=1000&cursor=next',
    );
    expect(planQuery('unverified creators with over 2k followers', [])).toMatchObject({
      kind: 'search', dataset: 'listings', q: null, verified: false, minFollowers: 2001,
    });
  });

  it('routes ranking words to the supported sort instead of searching for those words', () => {
    expect(planQuery('top 3 posts in Nigeria', [])).toMatchObject({ kind: 'search', dataset: 'posts', q: 'nigeria', limit: 3, sort: 'views' });
    expect(planQuery('3 newest creators', [])).toMatchObject({ kind: 'search', dataset: 'listings', q: null, limit: 3, sort: 'newest' });
    expect(planQuery('3 most viewed posts', [])).toMatchObject({ kind: 'search', dataset: 'posts', q: null, limit: 3, sort: 'views' });
    expect(planQuery('3 most popular creators', [])).toMatchObject({ kind: 'search', dataset: 'listings', q: null, limit: 3, sort: 'followers' });
  });

  it('starts a clear paid search without waiting for the remote interpreter', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const move = await resolveMove('top 3 creators in Nigeria', []);
    expect(move?.id).toBe('search:listings');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still interprets a question before choosing a dataset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      plan: { reply: null, action: { kind: 'search', dataset: 'catalog', q: 'lagos nights' } },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const move = await resolveMove('Which creators made Lagos Nights?', []);
    expect(move?.id).toBe('search:catalog');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
