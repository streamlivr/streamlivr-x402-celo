import { describe, expect, it } from 'vitest';
import { emptyPageKey, noChargePage, PAGE_BODY_KEYS } from './catalog.js';

/**
 * The empty-page rule is the difference between a paid API and a trap. These
 * cover the three paid data routes, the route that always sells an answer, and
 * the bodies that must not be mistaken for an empty page.
 */
describe('empty page detection', () => {
  it('names the body key of every paid data route', () => {
    expect(PAGE_BODY_KEYS).toEqual({
      '/api/v1/agent/listings': 'creators',
      '/api/v1/agent/posts': 'posts',
      '/api/v1/agent/catalog': 'tracks',
    });
  });

  it('reads an empty page off the body', () => {
    expect(emptyPageKey('/api/v1/agent/listings', JSON.stringify({ creators: [], page: { total: 0 } }))).toBe('creators');
    expect(emptyPageKey('/api/v1/agent/posts', JSON.stringify({ posts: [] }))).toBe('posts');
    expect(emptyPageKey('/api/v1/agent/catalog', JSON.stringify({ tracks: [] }))).toBe('tracks');
  });

  it('leaves a page with rows to settle normally', () => {
    expect(emptyPageKey('/api/v1/agent/listings', JSON.stringify({ creators: [{ id: 'c1' }] }))).toBeNull();
    expect(emptyPageKey('/api/v1/agent/listings', JSON.stringify({ creators: undefined }))).toBeNull();
    expect(emptyPageKey('/api/v1/agent/listings', JSON.stringify({ page: { total: 0 } }))).toBeNull();
  });

  it('never treats a route that is not a page as empty', () => {
    // The liveness route sells its answer, and a body that will not parse is not
    // evidence of an empty page.
    expect(emptyPageKey('/api/v1/agent/ping', JSON.stringify({ ok: true }))).toBeNull();
    expect(emptyPageKey('/api/v1/agent/listings', 'not json')).toBeNull();
  });

  it('does not settle a page with rows but no creator credit', () => {
    const body = JSON.stringify({ tracks: [{ id: 'unowned' }] });
    expect(noChargePage('/api/v1/agent/catalog', body, [])).toEqual({
      code: 'no-creator-credit',
      reason: 'no creator credit on this page',
    });
    expect(noChargePage('/api/v1/agent/catalog', body, ['creator-a'])).toBeNull();
    expect(noChargePage('/api/v1/agent/catalog', body, undefined)?.code).toBe('no-creator-credit');
    expect(noChargePage('/api/v1/agent/ping', JSON.stringify({ ok: true }), [])).toBeNull();
  });
});
