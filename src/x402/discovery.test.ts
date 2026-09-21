import { describe, expect, it } from 'vitest';
import { buildPaidRoutes, examplePath, formatAtomic, routePattern } from './catalog.js';
import {
  buildAgentCard,
  buildAgentMetadata,
  buildMcpServerCard,
  buildMcpTools,
  currentDiscoveryContext,
  toDataUri,
  type DiscoveryContext,
} from './discovery.js';
import { createMcpHandler, type McpForwardRequest, type McpForwardResponse } from './mcp.js';

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
};

describe('paid route catalog', () => {
  it('prices every route in atomic units and charges one flat price for data', () => {
    const routes = buildPaidRoutes('12345');
    expect(routes.map((route) => route.path)).toEqual([
      '/api/v1/agent/ping',
      '/api/v1/agent/listings',
      '/api/v1/agent/posts',
      '/api/v1/agent/catalog',
      '/api/v1/agent/creator/:id',
    ]);
    expect(routes[0]!.priceAtomic).toBe('12345');
    const profile = routes.find((route) => route.id === 'creator-profile')!;
    const listings = routes.find((route) => route.id === 'creator-listings')!;
    // One flat price across the data routes. The liveness check stays on its
    // own env var so an operator can raise it without touching the data prices.
    expect(profile.priceAtomic).toBe(listings.priceAtomic);
    expect(routes.every((route) => /^\d+$/.test(route.priceAtomic))).toBe(true);
  });

  it('builds route patterns and example paths', () => {
    const profile = buildPaidRoutes().find((route) => route.id === 'creator-profile')!;
    expect(routePattern(profile)).toBe('GET /api/v1/agent/creator/:id');
    expect(examplePath(profile)).toBe(`/api/v1/agent/creator/${profile.pathParam?.example}`);
  });

  it('publishes search and pagination on every list route, and none on the profile', () => {
    const routes = buildPaidRoutes();
    for (const route of routes.filter((entry) => ['creator-listings', 'public-posts', 'music-catalog'].includes(entry.id))) {
      expect(route.queryParams?.map((param) => param.name)).toEqual(['q', 'limit', 'cursor']);
      expect(examplePath(route)).toContain('?q=');
    }
    expect(routes.find((route) => route.id === 'creator-profile')?.queryParams).toBeUndefined();
    expect(routes.find((route) => route.id === 'x402-ping')?.queryParams).toBeUndefined();
  });

  it('names the public data rule in the routes an agent reads first', () => {
    const routes = buildPaidRoutes();
    for (const route of routes.filter((entry) => entry.queryParams)) {
      expect(route.description.toLowerCase()).not.toContain('opted-in');
      expect(route.description.toLowerCase()).toContain('searchable');
    }
  });

  it('formats atomic amounts as decimal prices', () => {
    expect(formatAtomic('10000')).toBe('0.01');
    expect(formatAtomic('5000')).toBe('0.005');
    expect(formatAtomic('1000000')).toBe('1');
    expect(formatAtomic('1')).toBe('0.000001');
  });
});

describe('A2A agent card', () => {
  const card = buildAgentCard(context) as Record<string, any>;

  it('keeps the fields an A2A client reads first', () => {
    expect(card.protocolVersion).toBeTruthy();
    expect(card.name).toBe('Streamlivr');
    expect(card.url).toBe(context.baseUrl);
    expect(card.capabilities.streaming).toBe(false);
    expect(card.defaultOutputModes).toContain('application/json');
  });

  it('lists one skill per paid route with the price in the tags', () => {
    expect(card.skills).toHaveLength(context.routes?.length ?? 0);
    expect(card.skills.map((skill: any) => skill.id)).toEqual(context.routes?.map((route) => route.id));
    expect(card.skills[0].tags).toContain('0.01-usdc');
    expect(card.skills[0].examples[0]).toContain(`${context.baseUrl}/api/v1/agent/ping`);
  });

  it('advertises the x402 payment detail under a declared extension', () => {
    const x402 = card.capabilities.extensions.find((extension: any) => extension.uri.includes('x402'));
    expect(x402.required).toBe(true);
    expect(x402.params.network).toBe('eip155:42220');
    expect(x402.params.assetAddress).toBe(context.assetAddress);
    expect(x402.params.payTo).toBe(context.payTo);
    expect(x402.params.routes).toHaveLength(context.routes?.length ?? 0);
    expect(x402.params.routes[0].price.amount).toBe('0.01');
  });

  it('links the on-chain identity and reputation registries', () => {
    const erc8004 = card.capabilities.extensions.find((extension: any) => extension.uri.includes('8004'));
    expect(erc8004.params.agentId).toBe('9852');
    expect(erc8004.params.identityRegistry).toBe('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432');
    expect(erc8004.params.reputationRegistry).toBe('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63');
    expect(erc8004.params.registrationUrl).toBe('https://8004scan.io/agents/celo/9852');
  });
});

describe('MCP server card', () => {
  const card = buildMcpServerCard(context) as Record<string, any>;

  it('publishes a streamable HTTP transport and one tool per paid route', () => {
    expect(card.transport).toEqual({ type: 'streamable-http', url: `${context.baseUrl}/mcp` });
    expect(card.tools).toHaveLength(context.routes?.length ?? 0);
    expect(card.tools[0].x402.price.amount).toBe('0.01');
    expect(card.authentication.paymentMetaKey).toBe('x402/payment');
  });

  it('gives the creator profile tool a required path argument', () => {
    const profile = buildMcpTools(context).find((tool) => tool.name === 'creator_profile');
    expect(profile?.inputSchema).toMatchObject({ type: 'object', required: ['id'], additionalProperties: false });
  });

  it('publishes search and pagination arguments on the list tools', () => {
    const listings = buildMcpTools(context).find((tool) => tool.name === 'creator_listings');
    const schema = listings?.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties).sort()).toEqual(['cursor', 'limit', 'q']);
    expect(schema.required).toEqual([]);
  });
});

describe('ERC-8004 registration metadata', () => {
  const metadata = buildAgentMetadata(context) as Record<string, any>;

  it('uses the current spec fields: versioned type, services, and endpoint', () => {
    expect(metadata.type).toBe('https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
    expect(Array.isArray(metadata.services)).toBe(true);
    expect(metadata.endpoints).toBeUndefined();
    for (const service of metadata.services) {
      expect(Object.keys(service).sort()).toEqual(['endpoint', 'name']);
    }
  });

  it('points the services array at the discovery documents and the paid routes', () => {
    const byName = Object.fromEntries(metadata.services.map((service: any) => [service.name, service.endpoint]));
    expect(byName.web).toBe('https://streamlivr.com');
    expect(byName.A2A).toBe('https://api.example.com/.well-known/agent.json');
    expect(byName.MCP).toBe('https://api.example.com/mcp');
    expect(byName['streamlivr-ping']).toBe('https://api.example.com/api/v1/agent/ping');
    expect(byName['streamlivr-listings']).toBe('https://api.example.com/api/v1/agent/listings');
    expect(byName['streamlivr-posts']).toBe('https://api.example.com/api/v1/agent/posts');
    expect(byName['streamlivr-catalog']).toBe('https://api.example.com/api/v1/agent/catalog');
    expect(byName['streamlivr-creator-profile']).toContain('/api/v1/agent/creator/');
  });

  it('uses the configured site url for the web service when one is set', () => {
    const withSite = buildAgentMetadata({ ...context, siteUrl: 'https://app.example.com' }) as Record<string, any>;
    expect(withSite.services.find((service: any) => service.name === 'web').endpoint).toBe('https://app.example.com');
  });

  it('writes only spec fields, with the identity registration', () => {
    expect(Object.keys(metadata).sort()).toEqual(['active', 'description', 'name', 'registrations', 'services', 'supportedTrust', 'type', 'x402Support']);
    expect(metadata.registrations[0].agentRegistry).toBe('eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432');
    expect(metadata.supportedTrust).toContain('reputation');
  });

  it('encodes metadata as a base64 data URI', () => {
    const uri = toDataUri(metadata);
    expect(uri.startsWith('data:application/json;base64,')).toBe(true);
    expect(JSON.parse(Buffer.from(uri.split(',')[1]!, 'base64').toString('utf8'))).toEqual(metadata);
  });
});

describe('currentDiscoveryContext', () => {
  it('falls back to the configured public URL and marks the network', () => {
    const built = currentDiscoveryContext({ baseUrl: 'https://api.example.com' });
    expect(built.baseUrl).toBe('https://api.example.com');
    expect(built.networkName === 'celo-mainnet' || built.networkName === 'celo-sepolia').toBe(true);
    expect(built.routes).toBeUndefined();
  });
});

const paymentRequired = {
  x402Version: 2,
  error: 'Payment required',
  resource: { url: 'https://api.example.com/api/v1/agent/ping', description: 'ping', mimeType: 'application/json' },
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:42220',
      payTo: context.payTo,
      maxAmountRequired: '10000',
      asset: context.assetAddress,
      maxTimeoutSeconds: 60,
      resource: 'https://api.example.com/api/v1/agent/ping',
    },
  ],
};

function header(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

describe('MCP handler', () => {
  const routes = buildPaidRoutes();
  const handler = (forward: (request: McpForwardRequest) => Promise<McpForwardResponse>) =>
    createMcpHandler({ context: { ...context, routes }, forward });

  it('answers initialize with the protocol version and capabilities', async () => {
    const outcome = await handler(async () => ({ status: 200, body: {}, headers: {} }))({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(outcome.kind).toBe('response');
    const body = outcome.kind === 'response' ? (outcome.body as any) : {};
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.instructions).toContain('x402');
  });

  it('treats notifications as notifications', async () => {
    const outcome = await handler(async () => ({ status: 200, body: {}, headers: {} }))({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(outcome.kind).toBe('notification');
  });

  it('lists the paid tools', async () => {
    const outcome = await handler(async () => ({ status: 200, body: {}, headers: {} }))({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const body = outcome.kind === 'response' ? (outcome.body as any) : {};
    expect(body.result.tools.map((tool: any) => tool.name)).toEqual(['x402_ping', 'creator_listings', 'public_posts', 'music_catalog', 'creator_profile']);
  });

  it('returns the decoded payment requirements when the route answers 402', async () => {
    const outcome = await handler(async () => ({ status: 402, body: { x402Version: 2 }, headers: { 'payment-required': header(paymentRequired) } }))({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'creator_listings', arguments: {} },
    });
    const structured = outcome.kind === 'response' ? (outcome.body as any).result.structuredContent : {};
    expect(structured.paymentRequired).toBe(true);
    expect(structured.paymentRequirements.accepts[0].payTo).toBe(context.payTo);
    expect(structured.x402.price.amount).toBe('0.01');
  });

  it('forwards a supplied payment header and returns the settlement', async () => {
    let seen: McpForwardRequest | undefined;
    const settlement = { success: true, transaction: `0x${'ab'.repeat(32)}`, network: 'eip155:42220', payer: '0xbuyer' };
    const outcome = await handler(async (request) => {
      seen = request;
      return { status: 200, body: { creators: [] }, headers: { 'payment-response': header(settlement) } };
    })({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'creator_listings', arguments: {}, _meta: { 'x402/payment': 'cGF5bWVudA==' } },
    });
    const result = outcome.kind === 'response' ? (outcome.body as any).result : {};
    expect(seen?.paymentHeader).toBe('cGF5bWVudA==');
    expect(seen?.path).toBe('/api/v1/agent/listings');
    expect(result.structuredContent.data).toEqual({ creators: [] });
    expect(result.structuredContent.settlement.transaction).toBe(settlement.transaction);
    expect(result.isError).toBe(false);
  });

  it('forwards declared query parameters and drops undeclared arguments', async () => {
    let seen: McpForwardRequest | undefined;
    const forward = async (request: McpForwardRequest) => {
      seen = request;
      return { status: 200, body: { creators: [] }, headers: {} };
    };
    await handler(forward)({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'creator_listings', arguments: { q: 'lag os', limit: '25', notDeclared: 'x' } },
    });
    expect(seen?.path).toBe('/api/v1/agent/listings?q=lag+os&limit=25');

    await handler(forward)({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'creator_listings', arguments: {} } });
    expect(seen?.path).toBe('/api/v1/agent/listings');
  });

  it('fills the path parameter and rejects a missing one', async () => {
    let seen: McpForwardRequest | undefined;
    const forward = async (request: McpForwardRequest) => {
      seen = request;
      return { status: 200, body: { id: 'cr_01' }, headers: {} };
    };
    await handler(forward)({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'creator_profile', arguments: { id: 'cr_01' } } });
    expect(seen?.path).toBe('/api/v1/agent/creator/cr_01');

    const missing = await handler(forward)({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'creator_profile', arguments: {} } });
    expect(missing.kind === 'response' ? (missing.body as any).error.code : null).toBe(-32602);
  });

  it('reports unknown tools and methods as JSON-RPC errors', async () => {
    const forward = async () => ({ status: 200, body: {}, headers: {} });
    const unknownTool = await handler(forward)({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope' } });
    expect(unknownTool.kind === 'response' ? (unknownTool.body as any).error.code : null).toBe(-32602);
    const unknownMethod = await handler(forward)({ jsonrpc: '2.0', id: 8, method: 'resources/list' });
    expect(unknownMethod.kind === 'response' ? (unknownMethod.body as any).error.code : null).toBe(-32601);
  });

  it('explains the failure when the internal API cannot be reached', async () => {
    const outcome = await handler(async () => {
      throw new Error('connect ECONNREFUSED');
    })({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'x402_ping', arguments: {} } });
    const result = outcome.kind === 'response' ? (outcome.body as any).result : {};
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('https://api.example.com/api/v1/agent/ping');
  });
});
