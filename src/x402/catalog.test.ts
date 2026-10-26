import { declareDiscoveryExtension, validateDiscoveryExtension } from '@x402/extensions';
import { describe, expect, it } from 'vitest';
import { buildPaidRoutes, discoveryDeclaration, emptyPageKey, noChargePage, PAGE_BODY_KEYS } from './catalog.js';

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

/**
 * A crawler reads the Bazaar declaration to learn how to call a route. Before
 * query parameters were declared, every data route advertised an empty,
 * closed `queryParams` object, so no agent could find `q`, `limit` or `cursor`.
 */
describe('bazaar discovery declaration', () => {
  const routes = buildPaidRoutes('1000');
  const route = (path: string) => routes.find((r) => r.path === path)!;
  // The server extension sets `method` at request time; validate as a 402 would carry it.
  const asServed = (path: string) => {
    const bazaar = declareDiscoveryExtension(discoveryDeclaration(route(path))).bazaar!;
    const info = bazaar.info as { input: Record<string, unknown> };
    return { ...bazaar, info: { ...info, input: { ...info.input, method: 'GET' } } };
  };

  it('declares every query parameter with its type and description', () => {
    const bazaar = declareDiscoveryExtension(discoveryDeclaration(route('/api/v1/agent/listings'))).bazaar!;
    const queryParams = ((bazaar.schema as any).properties.input.properties.queryParams);
    expect(Object.keys(queryParams.properties)).toEqual(['q', 'limit', 'cursor', 'verified', 'minFollowers', 'sort']);
    expect(queryParams.properties.limit).toMatchObject({ type: 'integer', minimum: 0 });
    expect(queryParams.properties.verified).toMatchObject({ type: 'boolean' });
    expect(queryParams.properties.sort).toMatchObject({ type: 'string', enum: ['followers', 'newest'] });
    expect(queryParams.properties.q.description).toContain('Free-text search');
  });

  it('publishes a callable example query, without filters or a cursor', () => {
    const bazaar = declareDiscoveryExtension(discoveryDeclaration(route('/api/v1/agent/posts'))).bazaar!;
    expect((bazaar.info as any).input.queryParams).toEqual({ q: 'lagos', limit: 10 });
  });

  it('leaves the ping route with no query parameters and keeps the profile path param', () => {
    expect(discoveryDeclaration(route('/api/v1/agent/ping'))).not.toHaveProperty('inputSchema');
    const profile = discoveryDeclaration(route('/api/v1/agent/creator/:id'));
    expect(profile.pathParams).toEqual({ id: 'cmmggbkik0000rqbzontvsy38' });
    expect(profile).not.toHaveProperty('input');
  });

  it('passes the x402 validator for every paid route', () => {
    for (const { path } of routes) {
      expect(validateDiscoveryExtension(asServed(path) as any), path).toEqual({ valid: true });
    }
  });
});
