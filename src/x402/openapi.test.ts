import { describe, expect, it } from 'vitest';
import { buildPaidRoutes } from './catalog.js';
import type { DiscoveryContext } from './discovery.js';
import { FastifyAdapter } from './fastifyAdapter.js';
import { buildOpenApiDocument } from './openapi.js';
import { MAX_REQUEST_PRICE_ATOMIC } from './pricing.js';

const context: DiscoveryContext = {
  baseUrl: 'https://api.example.com',
  agentId: '9852',
  networkName: 'celo-mainnet',
  network: 'eip155:42220',
  chainId: 42220,
  assetSymbol: 'USDC',
  assetAddress: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
  payTo: '0x4503F32dFF9e54Ee4c0Fd9BE25bCC662abB4c4Bf',
  facilitatorUrl: 'https://api.x402.celo.org',
  routes: buildPaidRoutes(),
  iconUrl: 'https://cdn.example.com/icon.png',
};

const doc = buildOpenApiDocument(context) as Record<string, any>;

describe('OpenAPI document', () => {
  it('is OpenAPI 3.1 with the public server', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'https://api.example.com' }]);
    expect(doc.info['x-logo'].url).toBe('https://cdn.example.com/icon.png');
  });

  it('documents every paid route with an OpenAPI path template', () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/v1/agent/ping', '/api/v1/agent/listings', '/api/v1/agent/posts', '/api/v1/agent/catalog', '/api/v1/agent/creator/{id}']),
    );
    const profile = doc.paths['/api/v1/agent/creator/{id}'].get;
    expect(profile.parameters.find((param: any) => param.in === 'path')).toMatchObject({ name: 'id', required: true });
  });

  it('carries x402 pricing that matches the catalog', () => {
    const listings = doc.paths['/api/v1/agent/listings'].get;
    expect(listings.responses['402']).toBeDefined();
    expect(listings['x-x402']).toMatchObject({ scheme: 'exact', network: 'eip155:42220', billedPer: 'creator credited', minimumAtomic: '10000', maximumAtomic: MAX_REQUEST_PRICE_ATOMIC });
    const ping = doc.paths['/api/v1/agent/ping'].get;
    expect(ping['x-x402']).toMatchObject({ billedPer: 'request', minimumAtomic: ping['x-x402'].maximumAtomic });
  });

  it('types query parameters and keeps examples', () => {
    const params = doc.paths['/api/v1/agent/listings'].get.parameters;
    expect(params.find((param: any) => param.name === 'limit')).toMatchObject({ in: 'query', schema: { type: 'integer' }, example: 10 });
    expect(params.find((param: any) => param.name === 'sort').schema.enum).toEqual(['followers', 'newest']);
  });

  it('marks discovery and pricing routes as free', () => {
    expect(doc.paths['/api/v1/agent/pricing'].get.security).toEqual([]);
    expect(doc.paths['/.well-known/agent.json'].get.security).toEqual([]);
  });
});

describe('FastifyAdapter', () => {
  const request = { url: '/api/v1/agent/listings?q=lagos&limit=3', method: 'GET', headers: {} } as any;

  it('reports the requested URL on the public origin', () => {
    expect(new FastifyAdapter(request, 'https://api.example.com/').getUrl()).toBe('https://api.example.com/api/v1/agent/listings?q=lagos&limit=3');
    expect(new FastifyAdapter(request, 'https://api.example.com').getPath()).toBe('/api/v1/agent/listings');
  });
});
