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
 */
import 'dotenv/config';
import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { x402HTTPResourceServer, x402ResourceServer, type HTTPProcessResult, type RoutesConfig } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { FastifyAdapter } from '../src/x402/fastifyAdapter.js';
import { createX402Facilitator } from '../src/x402/facilitator.js';
import {
  assertX402Configuration,
  X402_ASSET_ADDRESS,
  X402_ASSET_EXTRA,
  X402_ASSET_SYMBOL,
  X402_ENABLED,
  X402_NETWORK,
  X402_PAY_TO,
  X402_PING_PRICE_ATOMIC,
} from '../src/x402/config.js';
import { calculateAttributionShares } from '../src/x402/split.js';

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

const routeConfig: RoutesConfig = {
  'GET /api/v1/agent/ping': {
    accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: X402_PAY_TO!, price: { amount: X402_PING_PRICE_ATOMIC, asset: X402_ASSET_ADDRESS, extra: X402_ASSET_EXTRA }, maxTimeoutSeconds: 60 }],
    description: 'Payment connectivity check',
    mimeType: 'application/json',
  },
  'GET /api/v1/agent/listings': {
    accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: X402_PAY_TO!, price: { amount: '10000', asset: X402_ASSET_ADDRESS, extra: X402_ASSET_EXTRA }, maxTimeoutSeconds: 60 }],
    description: 'Opted-in creator listings',
    mimeType: 'application/json',
  },
  'GET /api/v1/agent/catalog': {
    accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: X402_PAY_TO!, price: { amount: '10000', asset: X402_ASSET_ADDRESS, extra: X402_ASSET_EXTRA }, maxTimeoutSeconds: 60 }],
    description: 'Opted-in music catalog',
    mimeType: 'application/json',
  },
  'GET /api/v1/agent/creator/:id': {
    accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: X402_PAY_TO!, price: { amount: '5000', asset: X402_ASSET_ADDRESS, extra: X402_ASSET_EXTRA }, maxTimeoutSeconds: 60 }],
    description: 'Opted-in creator profile',
    mimeType: 'application/json',
  },
};

const PAID_PATHS = new Set(['/api/v1/agent/ping', '/api/v1/agent/listings', '/api/v1/agent/catalog']);

interface SettlementRecord {
  endpoint: string;
  amountAtomic: string;
  asset: string;
  network: string;
  txHash: string;
  payTo: string;
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

  app.get('/healthz', async () => ({ ok: true, x402: X402_ENABLED ? 'enabled' : 'disabled', network: X402_NETWORK, asset: X402_ASSET_SYMBOL }));

  if (!X402_ENABLED) {
    app.get('/api/v1/agent/ping', async () => ({ ok: true, paid: false, hint: 'Set X402_ENABLED=true and provide X402_API_KEY + X402_PAY_TO' }));
    await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });
    return;
  }

  assertX402Configuration();
  const resource = new x402ResourceServer(createX402Facilitator());
  resource.register(X402_NETWORK, new ExactEvmScheme());
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
    settlements.push({
      endpoint: state.adapter.getPath(),
      amountAtomic,
      asset: String(state.paymentRequirements.asset),
      network: state.paymentRequirements.network,
      txHash,
      payTo: String(state.paymentRequirements.payTo),
      settledAt: new Date().toISOString(),
      creatorIds: request.x402CreatorIds ?? [],
      attribution: calculateAttributionShares(amountAtomic, request.x402CreatorIds ?? []),
    });
    const key = createHash('sha256').update(JSON.stringify(state.paymentPayload)).digest('hex');
    replayStore.set(key, settled as unknown as StoredSettlement);
    request.log.info({ txHash, endpoint: state.adapter.getPath(), amountAtomic }, 'x402 settlement recorded');
    return payload;
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

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
  app.log.info({ port, network: X402_NETWORK, asset: X402_ASSET_SYMBOL, payTo: X402_PAY_TO }, 'Streamlivr x402 demo seller ready');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
