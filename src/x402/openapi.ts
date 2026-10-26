/**
 * OpenAPI 3.1 document for the agent routes, served at `/openapi.json`.
 *
 * Built from the same catalog as the 402 route config, the agent cards and the
 * ERC-8004 metadata, so a directory that imports this file sees the paths,
 * parameters, examples and prices the server actually charges. Payment detail
 * that OpenAPI has no field for travels in an `x-x402` extension on each paid
 * operation.
 */
import { buildPaidRoutes, formatAtomic, type PaidRoute } from './catalog.js';
import { MAX_REQUEST_PRICE_ATOMIC, PRICE_RULE } from './pricing.js';
import { AGENT_DESCRIPTION, AGENT_DOCUMENTATION_URL, AGENT_NAME, AGENT_PROVIDER, AGENT_VERSION, type DiscoveryContext } from './discovery.js';

type Schema = Record<string, unknown>;

const SUPPORT_EMAIL = 'support@streamlivr.com';
const TERMS_URL = 'https://docs.streamlivr.com/legal/terms-of-service';

function paramSchema(type: 'string' | 'integer' | 'boolean' | undefined, values?: string[]): Schema {
  if (type === 'integer') return { type: 'integer', minimum: 0 };
  if (type === 'boolean') return { type: 'boolean' };
  return values ? { type: 'string', enum: values } : { type: 'string' };
}

function exampleValue(type: 'string' | 'integer' | 'boolean' | undefined, example: string): unknown {
  if (type === 'integer') return Number(example);
  if (type === 'boolean') return example === 'true';
  return example;
}

const PAYMENT_REQUIRED_RESPONSE = {
  description:
    'Payment required. The x402 v2 requirements are base64 JSON in the `PAYMENT-REQUIRED` header and are repeated as JSON in the body. Sign them with any x402 client and repeat the request with the `PAYMENT-SIGNATURE` header.',
  headers: {
    'PAYMENT-REQUIRED': { description: 'Base64-encoded x402 PaymentRequired object.', schema: { type: 'string' } },
  },
  content: { 'application/json': { schema: { $ref: '#/components/schemas/PaymentRequired' } } },
};

function paidOperation(route: PaidRoute, context: DiscoveryContext): Schema {
  const perCreator = Boolean(route.queryParams);
  const parameters = [
    ...(route.pathParam
      ? [{ name: route.pathParam.name, in: 'path', required: true, description: route.pathParam.description, schema: { type: 'string' }, example: route.pathParam.example }]
      : []),
    ...(route.queryParams ?? []).map((param) => ({
      name: param.name,
      in: 'query',
      required: false,
      description: param.description,
      schema: paramSchema(param.type, param.values),
      example: exampleValue(param.type, param.example),
    })),
  ];
  return {
    operationId: route.id.replace(/-/g, '_'),
    summary: route.title,
    description: route.description,
    tags: ['Paid (x402)'],
    parameters,
    security: [{ x402: [] }],
    responses: {
      '200': {
        description: perCreator
          ? 'The page that was invoiced. A page with no rows is served without settling and carries `x-no-charge` headers.'
          : 'The requested data, with the settlement in the `PAYMENT-RESPONSE` header.',
        headers: {
          'PAYMENT-RESPONSE': { description: 'Base64 x402 settlement response, including the transaction hash.', schema: { type: 'string' } },
          'x-no-charge': { description: 'Set when nothing was settled, for example `empty-page`.', schema: { type: 'string' } },
        },
        content: { 'application/json': { schema: { type: 'object' }, example: route.example } },
      },
      '400': { description: 'Invalid query. Never settled.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      '402': PAYMENT_REQUIRED_RESPONSE,
      ...(route.pathParam ? { '404': { description: 'No public creator with that id. Never settled.' } } : {}),
    },
    'x-x402': {
      scheme: 'exact',
      network: context.network,
      asset: context.assetSymbol,
      assetAddress: context.assetAddress,
      decimals: 6,
      payTo: context.payTo,
      facilitator: context.facilitatorUrl,
      billedPer: perCreator ? 'creator credited' : 'request',
      minimumAtomic: route.priceAtomic,
      minimum: formatAtomic(route.priceAtomic),
      maximumAtomic: perCreator ? MAX_REQUEST_PRICE_ATOMIC : route.priceAtomic,
      maximum: formatAtomic(perCreator ? MAX_REQUEST_PRICE_ATOMIC : route.priceAtomic),
      rule: perCreator ? PRICE_RULE.summary : `${formatAtomic(route.priceAtomic)} ${context.assetSymbol} per request.`,
    },
  };
}

function freeOperation(operationId: string, summary: string, description: string): Schema {
  return {
    operationId,
    summary,
    description,
    tags: ['Free'],
    security: [],
    responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
  };
}

/** Builds the OpenAPI document for the running configuration. */
export function buildOpenApiDocument(context: DiscoveryContext): Record<string, unknown> {
  const routes = context.routes && context.routes.length > 0 ? context.routes : buildPaidRoutes();
  const paths: Record<string, Schema> = {};
  for (const route of routes) {
    paths[route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')] = { get: paidOperation(route, context) };
  }
  paths['/api/v1/agent/pricing'] = { get: freeOperation('get_pricing', 'Price list', 'The price rule, asset, network and worked examples. Free.') };
  paths['/api/v1/agent/stats'] = { get: freeOperation('get_stats', 'Inventory stats', 'Counts of public creators, posts and tracks, with the busiest countries and hashtags. Free.') };
  paths['/api/v1/agent/reputation'] = { get: freeOperation('get_reputation', 'Reputation', 'ERC-8004 reputation for the agent plus settled volume counters. Free.') };
  paths['/.well-known/agent.json'] = { get: freeOperation('get_agent_card', 'A2A agent card', 'A2A agent card with x402 and ERC-8004 detail. Free.') };
  paths['/.well-known/mcp.json'] = { get: freeOperation('get_mcp_card', 'MCP server card', 'MCP server card listing the paid tools. Free.') };

  return {
    openapi: '3.1.0',
    info: {
      title: `${AGENT_NAME} x402 agent API`,
      version: AGENT_VERSION,
      summary: 'Public creator, content and music metadata, paid per request over x402 on Celo.',
      description: AGENT_DESCRIPTION,
      contact: { name: `${AGENT_PROVIDER.organization} support`, url: context.siteUrl ?? AGENT_PROVIDER.url, email: SUPPORT_EMAIL },
      termsOfService: TERMS_URL,
      license: { name: 'Streamlivr Terms of Service', url: TERMS_URL },
      ...(context.iconUrl ? { 'x-logo': { url: context.iconUrl } } : {}),
    },
    externalDocs: { description: 'Quick start, pricing and on-chain proof', url: AGENT_DOCUMENTATION_URL },
    servers: [{ url: context.baseUrl }],
    tags: [
      { name: 'Paid (x402)', description: 'Every call settles an x402 exact-scheme USDC transfer on Celo before data is returned.' },
      { name: 'Free', description: 'Discovery and pricing. No payment.' },
    ],
    paths,
    components: {
      securitySchemes: {
        x402: {
          type: 'apiKey',
          in: 'header',
          name: 'PAYMENT-SIGNATURE',
          description: 'x402 v2 payment payload, base64. Omit it to receive the 402 invoice for the exact request. There is no API key: the signed payment is the only credential.',
        },
      },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' }, code: { type: 'string' }, reason: { type: 'string' } } },
        PaymentRequired: {
          type: 'object',
          required: ['x402Version', 'accepts'],
          properties: {
            x402Version: { type: 'integer', const: 2 },
            error: { type: 'string' },
            resource: { type: 'object', properties: { url: { type: 'string' }, description: { type: 'string' }, mimeType: { type: 'string' } } },
            accepts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  scheme: { type: 'string', const: 'exact' },
                  network: { type: 'string', example: context.network },
                  amount: { type: 'string', description: 'Atomic units of the asset (6 decimals).' },
                  asset: { type: 'string', example: context.assetAddress },
                  payTo: { type: 'string', example: context.payTo },
                  maxTimeoutSeconds: { type: 'integer' },
                  extra: { type: 'object' },
                },
              },
            },
            extensions: { type: 'object' },
          },
        },
      },
    },
  };
}
