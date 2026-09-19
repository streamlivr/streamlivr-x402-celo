/**
 * Machine-readable discovery documents for the paid agent routes.
 *
 * Three surfaces are produced from the same catalog:
 *   - `/.well-known/agent.json` A2A agent card, with x402 and ERC-8004 detail
 *   - `/.well-known/mcp.json` MCP server card listing the paid tools
 *   - `POST /mcp` MCP tool list, served live from the same definitions
 *
 * The ERC-8004 registration metadata is built here too, so the services array
 * that is written on-chain cannot drift from the routes the API actually
 * serves.
 */
import { LISTINGS_PRICE_ATOMIC, buildPaidRoutes, examplePath, formatAtomic, type PaidRoute } from './catalog.js';
import {
  ERC8004_AGENT_ID,
  X402_ASSET_ADDRESS,
  X402_ASSET_SYMBOL,
  X402_CHAIN_ID,
  X402_FACILITATOR_URL,
  X402_NETWORK,
  X402_PAY_TO,
  X402_SITE_URL,
} from './config.js';
import { ERC8004_CONTRACTS, erc8004NetworkFor, type Erc8004Network } from './reputation.js';

export const AGENT_PROTOCOL_VERSION = '0.3.0';
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const AGENT_VERSION = '1.0.0';
export const AGENT_NAME = 'Streamlivr';
export const AGENT_DESCRIPTION =
  'Streamlivr pays creators over x402 on Celo. Agents can discover opted-in creator listings, music catalogs, and creator profiles, and every settled payment is attributed back to the creators who supplied the data.';
export const AGENT_PROVIDER = { organization: 'Streamlivr', url: 'https://streamlivr.com' };
export const AGENT_DOCUMENTATION_URL = 'https://github.com/streamlivr/streamlivr-x402-celo';

export interface DiscoveryContext {
  /** Public origin the API is reachable at, without a trailing slash. */
  baseUrl: string;
  /** ERC-8004 agent id, when the agent has been registered. */
  agentId: string | null;
  /** `celo-mainnet` or `celo-sepolia`, matching the hackathon registration field. */
  networkName: Erc8004Network;
  /** CAIP-2 network id, for example `eip155:42220`. */
  network: string;
  chainId: number;
  assetSymbol: string;
  assetAddress: string;
  payTo: string;
  facilitatorUrl: string;
  routes?: PaidRoute[];
  /** Public URL of the web app, when it differs from the API origin. */
  siteUrl?: string;
}

/**
 * Resolves the public origin once, so every generated document points at the
 * same host. Local development falls back to localhost because the discovery
 * routes are also useful when the API is only reachable on the LAN.
 */
export function resolveDiscoveryBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.X402_PUBLIC_BASE_URL ?? env.API_PUBLIC_URL;
  const fallback = `http://localhost:${env.PORT ?? '3000'}`;
  return (configured?.trim() || fallback).replace(/\/+$/, '');
}

/**
 * Discovery context for the running process. Everything comes from the x402
 * config, so the documents cannot advertise a network or asset the server does
 * not actually settle.
 */
export function currentDiscoveryContext(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  const chainId = overrides.chainId ?? X402_CHAIN_ID;
  return {
    baseUrl: overrides.baseUrl ?? resolveDiscoveryBaseUrl(),
    agentId: overrides.agentId ?? ERC8004_AGENT_ID ?? null,
    networkName: overrides.networkName ?? erc8004NetworkFor(chainId),
    network: overrides.network ?? X402_NETWORK,
    chainId,
    assetSymbol: overrides.assetSymbol ?? X402_ASSET_SYMBOL,
    assetAddress: overrides.assetAddress ?? X402_ASSET_ADDRESS,
    payTo: overrides.payTo ?? X402_PAY_TO ?? '',
    facilitatorUrl: overrides.facilitatorUrl ?? X402_FACILITATOR_URL,
    siteUrl: overrides.siteUrl ?? X402_SITE_URL ?? AGENT_PROVIDER.url,
    ...(overrides.routes ? { routes: overrides.routes } : {}),
  };
}

function priceTag(route: PaidRoute): string {
  return `${formatAtomic(route.priceAtomic)}-usdc`;
}

export interface PaymentRouteSummary {
  id: string;
  name: string;
  method: 'GET';
  url: string;
  path: string;
  description: string;
  tags: string[];
  price: { amountAtomic: string; amount: string; decimals: number; asset: string; assetAddress: string; network: string; payTo: string };
}

/** The x402 payment detail for one route, in the shape an agent needs to pay it. */
export function paymentRouteSummary(route: PaidRoute, context: DiscoveryContext): PaymentRouteSummary {
  return {
    id: route.id,
    name: route.serviceName,
    method: 'GET',
    url: `${context.baseUrl}${examplePath(route)}`,
    path: route.path,
    description: route.description,
    tags: [...route.tags, priceTag(route)],
    price: {
      amountAtomic: route.priceAtomic,
      amount: formatAtomic(route.priceAtomic),
      decimals: 6,
      asset: context.assetSymbol,
      assetAddress: context.assetAddress,
      network: context.network,
      payTo: context.payTo,
    },
  };
}

/** A2A agent card published at `/.well-known/agent.json`. */
export function buildAgentCard(context: DiscoveryContext): Record<string, unknown> {
  const routes = context.routes ?? buildPaidRoutes();
  const summaries = routes.map((route) => paymentRouteSummary(route, context));
  const reputation = ERC8004_CONTRACTS[context.networkName];

  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    url: context.baseUrl,
    preferredTransport: 'HTTP+JSON',
    additionalInterfaces: [{ url: context.baseUrl, transport: 'HTTP+JSON' }],
    version: AGENT_VERSION,
    provider: AGENT_PROVIDER,
    documentationUrl: AGENT_DOCUMENTATION_URL,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
      extensions: [
        {
          uri: 'https://github.com/coinbase/x402',
          description: 'Every skill on this agent is paid with an x402 exact-scheme transfer on Celo.',
          required: true,
          params: {
            x402Version: 2,
            scheme: 'exact',
            network: context.network,
            chainId: context.chainId,
            asset: context.assetSymbol,
            assetAddress: context.assetAddress,
            payTo: context.payTo,
            facilitator: context.facilitatorUrl,
            routes: summaries,
          },
        },
        {
          uri: 'https://eips.ethereum.org/EIPS/eip-8004',
          description: 'Agent identity and buyer reputation on the Celo ERC-8004 registries.',
          required: false,
          params: {
            agentId: context.agentId,
            chainId: context.chainId,
            network: context.networkName,
            identityRegistry: reputation.identityRegistry,
            reputationRegistry: reputation.reputationRegistry,
            registrationUrl: context.agentId
              ? `https://8004scan.io/agents/${context.networkName === 'celo-mainnet' ? 'celo' : 'celo-sepolia'}/${context.agentId}`
              : null,
            reputationUrl: `${context.baseUrl}/api/v1/agent/reputation`,
          },
        },
      ],
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: routes.map((route) => ({
      id: route.id,
      name: route.title,
      description: route.description,
      tags: [...route.tags, priceTag(route)],
      examples: [`GET ${context.baseUrl}${examplePath(route)}`],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    })),
    supportsAuthenticatedExtendedCard: false,
  };
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: true; idempotentHint: false; openWorldHint: false; destructiveHint: false };
  /** Non-standard but harmless: x402 priced clients read this to build the payment. */
  x402: {
    url: string;
    method: 'GET';
    price: { amount: string; amountAtomic: string; asset: string; assetAddress: string; network: string; payTo: string };
    inputSchema: Record<string, unknown>;
  };
}

/** MCP tool definitions, one per paid route. */
export function buildMcpTools(context: DiscoveryContext): McpToolDefinition[] {
  const routes = context.routes ?? buildPaidRoutes();
  return routes.map((route) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    if (route.pathParam) {
      properties[route.pathParam.name] = { type: 'string', description: route.pathParam.description };
      required.push(route.pathParam.name);
    }
    const inputSchema = { type: 'object', properties, required, additionalProperties: false } as Record<string, unknown>;
    return {
      name: route.id.replace(/-/g, '_'),
      title: route.title,
      description: `${route.description} Paid route: ${context.assetSymbol} ${formatAtomic(route.priceAtomic)} on Celo, settled over x402. Without a payment the call returns the x402 payment requirements instead of data.`,
      inputSchema,
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false, destructiveHint: false },
      x402: {
        url: `${context.baseUrl}${examplePath(route)}`,
        method: 'GET',
        price: {
          amount: formatAtomic(route.priceAtomic),
          amountAtomic: route.priceAtomic,
          asset: context.assetSymbol,
          assetAddress: context.assetAddress,
          network: context.network,
          payTo: context.payTo,
        },
        inputSchema,
      },
    };
  });
}

/** MCP server card published at `/.well-known/mcp.json`. */
export function buildMcpServerCard(context: DiscoveryContext): Record<string, unknown> {
  return {
    serverInfo: { name: 'streamlivr-x402', version: AGENT_VERSION, title: `${AGENT_NAME} x402 agent tools` },
    protocolVersion: MCP_PROTOCOL_VERSION,
    description: AGENT_DESCRIPTION,
    transport: { type: 'streamable-http', url: `${context.baseUrl}/mcp` },
    capabilities: { tools: { listChanged: false } },
    authentication: {
      type: 'x402',
      description: 'Each tool call settles an x402 exact-scheme payment on Celo before the data is returned.',
      network: context.network,
      asset: context.assetSymbol,
      assetAddress: context.assetAddress,
      payTo: context.payTo,
      facilitator: context.facilitatorUrl,
      paymentMetaKey: 'x402/payment',
    },
    provider: AGENT_PROVIDER,
    documentationUrl: AGENT_DOCUMENTATION_URL,
    tools: buildMcpTools(context),
  };
}

export interface AgentMetadataOptions extends DiscoveryContext {
  /** Optional hero image, already content addressed. */
  image?: string;
}

/**
 * ERC-8004 registration metadata. The `services` array is the spec field name,
 * and every entry uses `endpoint`, which is what the current validator expects.
 * The paid routes are listed individually so a directory can link straight to a
 * priced endpoint.
 *
 * Only spec fields are written on-chain. Prices and the reputation registry
 * live in the A2A card and the MCP card instead, because every one of those
 * fields is checkable against a running endpoint, while an unknown top-level
 * key in the metadata is just a validator warning waiting to happen.
 */
export function buildAgentMetadata(options: AgentMetadataOptions): Record<string, unknown> {
  const routes = options.routes ?? buildPaidRoutes();
  const services = [
    { name: 'web', endpoint: options.siteUrl ?? AGENT_PROVIDER.url },
    { name: 'A2A', endpoint: `${options.baseUrl}/.well-known/agent.json` },
    { name: 'MCP', endpoint: `${options.baseUrl}/mcp` },
    // Path parameters stay as `{id}` templates on-chain: a concrete id would
    // turn into a dead link the moment that record is removed.
    ...routes.map((route) => ({
      name: route.serviceName,
      endpoint: `${options.baseUrl}${route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`,
    })),
  ];
  const reputation = ERC8004_CONTRACTS[options.networkName];

  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    ...(options.image ? { image: options.image } : {}),
    services,
    supportedTrust: ['reputation'],
    active: true,
    x402Support: true,
    registrations: [{ agentId: options.agentId, agentRegistry: `eip155:${options.chainId}:${reputation.identityRegistry}` }],
  };
}

/** Base64 `data:` URI for an ERC-8004 metadata document, so it cannot be changed after registration. */
export function toDataUri(document: unknown): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(document)).toString('base64')}`;
}

/** Example price used in docs and tests, kept next to the builder for one source of truth. */
export const EXAMPLE_LISTINGS_PRICE_ATOMIC = LISTINGS_PRICE_ATOMIC;
