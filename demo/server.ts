/**
 * Streamlivr x402 on Celo - runnable seller reference.
 *
 * This is the same flow the production Streamlivr API runs, with the database
 * replaced by an in-memory store so a reviewer can start it with two values
 * (a Celo facilitator API key and a payTo wallet) and see a real 402 -> sign ->
 * settle -> 200 round trip against Celo.
 *
 *   cp .env.example .env   # set X402_API_KEY and X402_PAY_TO
 *   npm install
 *   npm run demo
 *
 * What it exposes:
 *   GET  /.well-known/agent.json      A2A agent card with x402 and ERC-8004 detail
 *   GET  /.well-known/mcp.json        MCP server card listing the paid tools
 *   POST /mcp                         MCP JSON-RPC endpoint for the paid tools
 *   GET  /api/v1/agent/reputation     on-chain ERC-8004 reputation, free to read
 *   GET  /api/v1/agent/*              the paid routes (402 -> sign -> settle -> 200)
 *   GET  /demo/settlements            local settlement ledger for reviewers
 *
 * The two well-known documents answer even with X402_ENABLED=false, so a boot
 * check does not need a facilitator key. The MCP endpoint and the reputation
 * read register only when the paid routes exist.
 */
import 'dotenv/config';
import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { x402HTTPResourceServer, x402ResourceServer, type HTTPProcessResult, type RoutesConfig } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions';
import { FastifyAdapter } from '../src/x402/fastifyAdapter.js';
import { createX402Facilitator } from '../src/x402/facilitator.js';
import {
  assertX402Configuration,
  ERC8004_AGENT_ID,
  X402_ASSET_ADDRESS,
  X402_ASSET_DECIMALS,
  X402_ASSET_EXTRA,
  X402_ASSET_SYMBOL,
  X402_CHAIN_ID,
  X402_DISCOVERY,
  X402_ENABLED,
  X402_NETWORK,
  X402_PAY_TO,
  X402_PUBLIC_BASE_URL,
} from '../src/x402/config.js';
import { buildPaidRoutes, examplePath, routePattern } from '../src/x402/catalog.js';
import { buildAgentCard, buildMcpServerCard, currentDiscoveryContext } from '../src/x402/discovery.js';
import { createMcpHandler } from '../src/x402/mcp.js';
import { readReputation } from '../src/x402/reputation.js';
import { calculateAttributionShares, CREATOR_SHARE_BPS, PLATFORM_SHARE_BPS } from '../src/x402/split.js';

type PaymentState = Extract<HTTPProcessResult, { type: 'payment-verified' }> & { adapter: FastifyAdapter };
type StoredSettlement = Parameters<x402HTTPResourceServer['createSettlementHeaders']>[0];

declare module 'fastify' {
  interface FastifyRequest {
    x402Payment?: PaymentState;
    x402Replay?: StoredSettlement | null;
    x402Replayed?: boolean;
    x402CreatorIds?: string[];
  }
}

/** Sample discovery data. In production these queries filter on creator consent. */
const CREATORS = [
  { id: 'cr_01', username: 'ada', displayName: 'Ada', countryCode: 'NG', followerCount: 18240, isVerified: true },
  { id: 'cr_02', username: 'kwame', displayName: 'Kwame', countryCode: 'GH', followerCount: 9310, isVerified: true },
  { id: 'cr_03', username: 'zola', displayName: 'Zola', countryCode: 'ZA', followerCount: 5120, isVerified: false },
];

const TRACKS = [
  { id: 'tr_01', title: 'Lagos Nights', artist: 'Ada', isrc: 'NGAAA2600001', creatorIds: ['cr_01'] },
  { id: 'tr_02', title: 'Accra Motion', artist: 'Kwame', isrc: 'GHAAA2600002', creatorIds: ['cr_02'] },
  { id: 'tr_03', title: 'Cape Town Sun', artist: 'Zola', isrc: 'ZAAAA2600003', creatorIds: ['cr_03', 'cr_01'] },
];

const paidRoutes = buildPaidRoutes();
const discoveryContext = currentDiscoveryContext({ routes: paidRoutes, ...(X402_PUBLIC_BASE_URL ? { baseUrl: X402_PUBLIC_BASE_URL } : {}) });

/**
 * One x402 route config per catalog entry. The Bazaar discovery declaration is
 * attached here, so the 402 response tells a client how to call the route
 * instead of only naming a price.
 */
const routeConfig: RoutesConfig = Object.fromEntries(
  paidRoutes.map((route) => [
    routePattern(route),
    {
      accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: X402_PAY_TO!, price: { amount: route.priceAtomic, asset: X402_ASSET_ADDRESS, extra: X402_ASSET_EXTRA }, maxTimeoutSeconds: 60 }],
      resource: `${discoveryContext.baseUrl}${examplePath(route)}`,
      description: route.description,
      mimeType: 'application/json',
      serviceName: route.serviceName,
      tags: route.tags,
      ...(X402_DISCOVERY
        ? {
            extensions: declareDiscoveryExtension({
              ...(route.pathParam
                ? { pathParams: { [route.pathParam.name]: route.pathParam.example }, pathParamsSchema: { type: 'object', properties: { [route.pathParam.name]: { type: 'string', description: route.pathParam.description } }, required: [route.pathParam.name] } }
                : {}),
              output: { example: route.example },
            }),
          }
        : {}),
    },
  ]),
);

const PAID_PATHS = new Set(paidRoutes.filter((route) => !route.pathParam).map((route) => route.path));

interface SettlementRecord {
  id: string;
  endpoint: string;
  amountAtomic: string;
  asset: string;
  network: string;
  txHash: string;
  payTo: string;
  /** Truncated payer address, the way the public demo ledger shows it. */
  payer: string;
  settledAt: string;
  creatorIds: string[];
  attribution: Array<{ creatorId: string; shareAtomic: string; shareBps: number }>;
}

const settlements: SettlementRecord[] = [];
const replayStore = new Map<string, StoredSettlement>();

function copyHeaders(reply: { header: (name: string, value: string) => unknown }, headers: Record<string, string> | undefined): void {
  for (const [name, value] of Object.entries(headers ?? {})) reply.header(name, value);
}

function pathOf(request: { url: string }): string {
  return new URL(request.url, 'http://demo.local').pathname;
}

async function main() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';

  /**
   * The bundled demo page runs on its own port, so every call it makes is
   * cross-origin. A browser can read the response body without help, but the
   * x402 invoice and receipt travel in response headers and stay invisible to
   * fetch() unless the response names them. Without this hook the page sees a
   * 402 with no terms and a paid route looks broken from the web while working
   * fine from curl.
   */
  const EXPOSED_PAYMENT_HEADERS = 'payment-required, payment-response, x-payment-required, x-payment-response';
  const ALLOWED_HEADERS =
    'content-type, authorization, accept, payment-signature, payment-required, payment-response, x-payment, x-payment-required, x-payment-response, ngrok-skip-browser-warning';

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'Origin');
      reply.header('access-control-allow-credentials', 'true');
      reply.header('access-control-expose-headers', EXPOSED_PAYMENT_HEADERS);
    }
    if (request.method === 'OPTIONS') {
      reply.header('access-control-allow-methods', 'GET,HEAD,POST,OPTIONS');
      reply.header(
        'access-control-allow-headers',
        (request.headers['access-control-request-headers'] as string | undefined) ?? ALLOWED_HEADERS,
      );
      reply.code(204).send();
    }
  });

  app.get('/healthz', async () => ({ ok: true, x402: X402_ENABLED ? 'enabled' : 'disabled', network: X402_NETWORK, asset: X402_ASSET_SYMBOL }));

  /**
   * Discovery documents are free on purpose: an agent has to read what a route
   * costs before it can decide to pay for it. They register before the payment
   * wiring, so a boot with X402_ENABLED=false still answers them, with an empty
   * route list instead of prices nothing here can settle.
   */
  const publicContext = X402_ENABLED
    ? discoveryContext
    : currentDiscoveryContext({ routes: [], ...(X402_PUBLIC_BASE_URL ? { baseUrl: X402_PUBLIC_BASE_URL } : {}) });

  app.get('/.well-known/agent.json', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return { ...buildAgentCard(publicContext), paymentEnabled: X402_ENABLED };
  });

  app.get('/.well-known/mcp.json', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return { ...buildMcpServerCard(publicContext), paymentEnabled: X402_ENABLED };
  });

  if (!X402_ENABLED) {
    app.get('/api/v1/agent/ping', async () => ({ ok: true, paid: false, hint: 'Set X402_ENABLED=true and provide X402_API_KEY + X402_PAY_TO' }));
    await app.listen({ port, host });
    return;
  }

  assertX402Configuration();
  const resource = new x402ResourceServer(createX402Facilitator());
  resource.register(X402_NETWORK, new ExactEvmScheme());
  // Enriches each Bazaar declaration with the HTTP method the facilitator reads.
  if (X402_DISCOVERY) resource.registerExtension(bazaarResourceServerExtension);
  const httpServer = new x402HTTPResourceServer(resource, routeConfig);
  await httpServer.initialize();

  app.addHook('onRequest', async (request, reply) => {
    const path = pathOf(request);
    if (request.method !== 'GET' || (!PAID_PATHS.has(path) && !path.startsWith('/api/v1/agent/creator/'))) return;
    const adapter = new FastifyAdapter(request);
    const paymentHeader = adapter.getHeader('payment-signature') ?? adapter.getHeader('x-payment');
    const result = await httpServer.processHTTPRequest({ adapter, path: adapter.getPath(), method: adapter.getMethod(), ...(paymentHeader ? { paymentHeader } : {}) });
    if (result.type === 'payment-error') {
      copyHeaders(reply, result.response.headers);
      reply.code(result.response.status).send(result.response.body ?? {});
      return;
    }
    if (result.type === 'payment-verified') {
      request.x402Payment = { ...result, adapter };
      const key = createHash('sha256').update(JSON.stringify(result.paymentPayload)).digest('hex');
      request.x402Replayed = replayStore.has(key);
      request.x402Replay = request.x402Replayed ? replayStore.get(key)! : null;
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const state = request.x402Payment;
    if (!state || reply.statusCode >= 400) return payload;
    if (request.x402Replayed) {
      // A client that retries after a timed-out response must not be charged twice.
      if (request.x402Replay) copyHeaders(reply, httpServer.createSettlementHeaders(request.x402Replay));
      return payload;
    }
    const settled = await httpServer.processSettlement(
      state.paymentPayload,
      state.paymentRequirements,
      state.declaredExtensions,
      {
        request: { adapter: state.adapter, path: state.adapter.getPath(), method: state.adapter.getMethod() },
        responseBody: Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? '')),
        responseHeaders: {},
      },
      undefined,
      state.beforeHandlerSettlement,
    );
    copyHeaders(reply, settled.headers);
    if (!settled.success) {
      reply.code(settled.response.status);
      return JSON.stringify(settled.response.body ?? {});
    }
    const txHash = String((settled as { transaction?: string }).transaction ?? 'unknown');
    const amountAtomic = String(state.paymentRequirements.amount ?? '0');
    const paymentPayload = state.paymentPayload.payload as Record<string, unknown>;
    const authorization = paymentPayload.authorization as Record<string, unknown> | undefined;
    const payer = String(
      (settled as { payer?: string }).payer ?? paymentPayload.from ?? paymentPayload.payer ?? authorization?.from ?? 'unknown',
    );
    settlements.push({
      id: `demo_${settlements.length + 1}`,
      endpoint: state.adapter.getPath(),
      amountAtomic,
      asset: String(state.paymentRequirements.asset),
      network: state.paymentRequirements.network,
      txHash,
      payTo: String(state.paymentRequirements.payTo),
      payer,
      settledAt: new Date().toISOString(),
      creatorIds: request.x402CreatorIds ?? [],
      attribution: calculateAttributionShares(amountAtomic, request.x402CreatorIds ?? []),
    });
    const key = createHash('sha256').update(JSON.stringify(state.paymentPayload)).digest('hex');
    replayStore.set(key, settled as unknown as StoredSettlement);
    request.log.info({ txHash, endpoint: state.adapter.getPath(), amountAtomic }, 'x402 settlement recorded');
    return payload;
  });

  /**
   * MCP tool calls forward to this process over loopback, carrying the caller's
   * x402 payment header. Payment verification stays in one place, so the MCP
   * transport cannot bypass the paywall.
   */
  const handleMcp = createMcpHandler({
    context: publicContext,
    forward: async (request) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch(`http://127.0.0.1:${port}${request.path}`, {
          method: 'GET',
          headers: { accept: 'application/json', ...(request.paymentHeader ? { 'payment-signature': request.paymentHeader, 'x-payment': request.paymentHeader } : {}) },
          signal: controller.signal,
        });
        const text = await response.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // A non JSON body is passed through as text; the MCP layer only reads status and shape.
        }
        return { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) };
      } finally {
        clearTimeout(timer);
      }
    },
  });

  app.post('/mcp', async (request, reply) => {
    const outcome = await handleMcp((request.body ?? {}) as Record<string, unknown>);
    if (outcome.kind === 'notification') return reply.status(202).send();
    return reply.status(200).send(outcome.body);
  });
  app.get('/mcp', async (_request, reply) => reply.status(405).header('allow', 'POST').send({ error: 'Use POST for MCP JSON-RPC requests' }));

  /** On-chain ERC-8004 reputation for the registered agent. Free to read. */
  app.get('/api/v1/agent/reputation', async (_request, reply) => {
    const gross = settlements.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n);
    const demo = { count: settlements.length, settledAtomic: gross.toString(), uniquePayers: new Set(settlements.map((row) => row.txHash)).size, network: X402_NETWORK };
    if (!ERC8004_AGENT_ID || !/^\d+$/.test(ERC8004_AGENT_ID)) {
      return { agentId: null, settlements: demo, summary: null, feedback: [], note: 'Set ERC8004_AGENT_ID to read the registered agent' };
    }
    try {
      const snapshot = await readReputation(BigInt(ERC8004_AGENT_ID), X402_CHAIN_ID, process.env.X402_TREASURY_RPC_URL);
      reply.header('cache-control', 'public, max-age=60');
      return { agentId: ERC8004_AGENT_ID, network: X402_NETWORK, settlements: demo, ...snapshot };
    } catch (error) {
      return { agentId: ERC8004_AGENT_ID, network: X402_NETWORK, settlements: demo, summary: null, feedback: [], error: error instanceof Error ? error.message : 'Reputation read failed' };
    }
  });

  app.get('/api/v1/agent/ping', async () => ({ ok: true, paid: true, network: X402_NETWORK, asset: X402_ASSET_ADDRESS, assetSymbol: X402_ASSET_SYMBOL }));

  app.get('/api/v1/agent/listings', async (request) => {
    request.x402CreatorIds = CREATORS.map((creator) => creator.id);
    return { creators: CREATORS };
  });

  app.get('/api/v1/agent/catalog', async (request) => {
    request.x402CreatorIds = [...new Set(TRACKS.flatMap((track) => track.creatorIds))];
    return { tracks: TRACKS };
  });

  app.get('/api/v1/agent/creator/:id', async (request, reply) => {
    const creator = CREATORS.find((row) => row.id === (request.params as { id: string }).id);
    if (!creator) return reply.status(404).send({ error: 'Creator not found' });
    request.x402CreatorIds = [creator.id];
    return creator;
  });

  /**
   * Free, read-only view of what this process settled. This stands in for the
   * production admin revenue surface; it is intentionally not behind x402 so a
   * reviewer can inspect the results without paying again.
   */
  app.get('/demo/settlements', async (request, reply) => {
    const token = process.env.DEMO_ADMIN_TOKEN;
    if (token && request.headers['x-demo-token'] !== token) return reply.status(401).send({ error: 'Unauthorized' });
    const gross = settlements.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n);
    const creatorShare = settlements.reduce((sum, row) => sum + row.attribution.reduce((inner, share) => inner + BigInt(share.shareAtomic), 0n), 0n);
    return {
      count: settlements.length,
      grossAtomic: gross.toString(),
      creatorShareAtomic: creatorShare.toString(),
      platformShareAtomic: (gross - creatorShare).toString(),
      settlements,
    };
  });

  /**
   * The same ledger in the shape the bundled browser demo renders. Production
   * serves these under `/api/v1/agent/demo`, so pointing `demo/web` at this
   * server shows the real page instead of a 404.
   */
  app.get('/api/v1/agent/demo/settlements', async (_request, reply) => {
    const rows = settlements.map((row) => {
      const creatorShare = row.attribution.reduce((sum, share) => sum + BigInt(share.shareAtomic), 0n);
      const gross = BigInt(row.amountAtomic);
      return {
        id: row.id,
        endpoint: row.endpoint,
        network: row.network,
        assetSymbol: X402_ASSET_SYMBOL,
        assetDecimals: X402_ASSET_DECIMALS,
        amountAtomic: row.amountAtomic,
        payer: row.payer.length > 12 ? `${row.payer.slice(0, 8)}…${row.payer.slice(-4)}` : row.payer,
        payTo: row.payTo,
        settlementTxHash: row.txHash,
        createdAt: row.settledAt,
        creatorShareAtomic: creatorShare.toString(),
        platformShareAtomic: (gross - creatorShare).toString(),
        attributions: row.attribution.map((share) => {
          const creator = CREATORS.find((entry) => entry.id === share.creatorId);
          return {
            creatorId: share.creatorId,
            username: creator?.username ?? null,
            displayName: creator?.displayName ?? null,
            avatarUrl: null,
            isVerified: creator?.isVerified ?? false,
            shareAtomic: share.shareAtomic,
            shareBps: share.shareBps,
          };
        }),
      };
    });

    const grossAtomic = settlements.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n);
    const creatorShareAtomic = rows.reduce((sum, row) => sum + BigInt(row.creatorShareAtomic), 0n);

    reply.header('cache-control', 'no-store');
    return {
      network: X402_NETWORK,
      payTo: X402_PAY_TO ?? '',
      asset: { symbol: X402_ASSET_SYMBOL, address: X402_ASSET_ADDRESS, decimals: X402_ASSET_DECIMALS },
      split: { creatorBps: Number(CREATOR_SHARE_BPS), platformBps: Number(PLATFORM_SHARE_BPS) },
      totals: {
        count: rows.length,
        grossAtomic: grossAtomic.toString(),
        creatorShareAtomic: creatorShareAtomic.toString(),
        platformShareAtomic: (grossAtomic - creatorShareAtomic).toString(),
      },
      settlements: rows.reverse(),
    };
  });

  /**
   * Per-creator balances for the demo page. The in-memory store holds no
   * payouts, so everything attributed is still outstanding, which is the honest
   * state for a server that has never signed a transfer.
   */
  app.get('/api/v1/agent/demo/creators', async (_request, reply) => {
    const earned = new Map<string, bigint>();
    const sales = new Map<string, number>();
    const lastSale = new Map<string, string>();
    for (const row of settlements) {
      for (const share of row.attribution) {
        earned.set(share.creatorId, (earned.get(share.creatorId) ?? 0n) + BigInt(share.shareAtomic));
        sales.set(share.creatorId, (sales.get(share.creatorId) ?? 0) + 1);
        const previous = lastSale.get(share.creatorId);
        if (!previous || row.settledAt > previous) lastSale.set(share.creatorId, row.settledAt);
      }
    }

    const creatorTotal = [...earned.values()].reduce((sum, value) => sum + value, 0n);
    const creators = CREATORS.map((creator) => {
      const attributed = earned.get(creator.id) ?? 0n;
      return {
        creatorId: creator.id,
        username: creator.username,
        displayName: creator.displayName,
        avatarUrl: null,
        isVerified: creator.isVerified,
        countryCode: creator.countryCode,
        followerCount: creator.followerCount,
        earnedAtomic: attributed.toString(),
        paidOutAtomic: '0',
        outstandingAtomic: attributed.toString(),
        salesCount: sales.get(creator.id) ?? 0,
        lastSaleAt: lastSale.get(creator.id) ?? null,
        consent: { listings: true, catalog: true, profile: true },
      };
    }).sort((left, right) => Number(BigInt(right.earnedAtomic) - BigInt(left.earnedAtomic)));

    reply.header('cache-control', 'no-store');
    return {
      network: X402_NETWORK,
      asset: { symbol: X402_ASSET_SYMBOL, address: X402_ASSET_ADDRESS, decimals: X402_ASSET_DECIMALS },
      split: { creatorBps: Number(CREATOR_SHARE_BPS), platformBps: Number(PLATFORM_SHARE_BPS) },
      totals: {
        creators: creators.length,
        creatorShareAtomic: creatorTotal.toString(),
        paidOutAtomic: '0',
        outstandingAtomic: creatorTotal.toString(),
      },
      creators,
    };
  });

  await app.listen({ port, host });
  app.log.info({ port, network: X402_NETWORK, asset: X402_ASSET_SYMBOL, payTo: X402_PAY_TO }, 'Streamlivr x402 demo seller ready');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
