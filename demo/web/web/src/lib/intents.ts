'use client';

import { MAX_ATOMIC_PER_REQUEST, NETWORKS, NETWORK_ORDER, explorerTx, networkForCaip2, shortAddress, type NetworkKey } from './config';
import { formatUsd } from './format';
import {
  fetchAssetBalance,
  fetchNativeBalance,
  getSessionSpentAtomic,
  paidRequest,
  probeResource,
  resetSessionSpend,
  type PaymentChallenge,
  type PaymentTerms,
  type RequestTrace,
  type SettlementReceipt,
} from './x402pay';

/** How a paid payload should be drawn. Chosen per endpoint, not per response. */
export type PayloadShape = 'creators' | 'tracks' | 'profile' | 'ping' | 'generic';

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'invoice'; terms: PaymentTerms; challenge: PaymentChallenge | null }
  | { kind: 'receipt'; receipt: SettlementReceipt; amountAtomic: string; network: NetworkKey; durationMs: number; endpoint: string }
  | { kind: 'payload'; title: string; shape: PayloadShape; data: unknown; endpoint: string }
  | { kind: 'raw'; trace: RequestTrace; label: string }
  | { kind: 'error'; text: string; hint?: string };

export interface KnownCreator {
  id: string;
  username: string | null;
  displayName: string | null;
}

export interface RunContext {
  network: NetworkKey;
  burnerKey: string;
  knownCreators: KnownCreator[];
  lastTrace: RequestTrace | null;
  setNetwork(network: NetworkKey): void;
}

export interface MoveOutcome {
  next?: Move[];
  knownCreators?: KnownCreator[];
  lastTrace?: RequestTrace;
  /** Set when a move wants the composer to switch its chip set entirely. */
  focus?: string;
}

export interface Move {
  id: string;
  label: string;
  hint?: string;
  group: 'discover' | 'inspect' | 'wallet' | 'about';
  run(ctx: RunContext, emit: (block: Block) => void): Promise<MoveOutcome>;
}

// ── Voice ───────────────────────────────────────────────────────────────────
// Every scripted line has several phrasings. A demo that says the same sentence
// on every run reads like a recording; these keep repeat runs alive without
// pretending the agent is improvising.
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── Payload readers ─────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function extractCreators(trace: RequestTrace): KnownCreator[] {
  const body = asRecord(trace.body);
  if (!body) return [];

  // Listings: { creators: [{ id, username, displayName }] }
  if (Array.isArray(body.creators)) {
    return body.creators
      .map(asRecord)
      .filter((row): row is Record<string, unknown> => row !== null)
      .map((row) => ({
        id: String(row.id ?? ''),
        username: row.username ? String(row.username) : null,
        displayName: row.displayName ? String(row.displayName) : null,
      }))
      .filter((row) => row.id);
  }

  // Catalog: { tracks: [{ creatorIds: [...] }] } (no names travel with the
  // catalog, so the profile move is the only way to resolve one).
  if (Array.isArray(body.tracks)) {
    return [];
  }

  // Single profile: { id, username, displayName }
  if (body.id && body.username) {
    return [
      {
        id: String(body.id),
        username: body.username ? String(body.username) : null,
        displayName: body.displayName ? String(body.displayName) : null,
      },
    ];
  }
  return [];
}

function countRows(trace: RequestTrace): number {
  const body = asRecord(trace.body);
  if (!body) return 0;
  if (Array.isArray(body.creators)) return body.creators.length;
  if (Array.isArray(body.tracks)) return body.tracks.length;
  return 0;
}

// ── Endpoint catalogue ──────────────────────────────────────────────────────

interface EndpointSpec {
  id: string;
  path: string;
  title: string;
  shape: PayloadShape;
  /** One line describing what is actually being bought. */
  buys: string;
}

const ENDPOINTS: Record<'ping' | 'listings' | 'catalog', EndpointSpec> = {
  ping: {
    id: 'ping',
    path: '/api/v1/agent/ping',
    title: 'Payment gate',
    shape: 'ping',
    buys: 'a liveness check that only answers once money has moved',
  },
  listings: {
    id: 'listings',
    path: '/api/v1/agent/listings',
    title: 'Creator listings',
    shape: 'creators',
    buys: 'public profiles of artists who opted in to agent discovery',
  },
  catalog: {
    id: 'catalog',
    path: '/api/v1/agent/catalog',
    title: 'Music catalog',
    shape: 'tracks',
    buys: 'track metadata: titles, artists, ISRCs, and which creators own them',
  },
};

const PROFILE_PRICE = '5000';

// ── Moves ───────────────────────────────────────────────────────────────────

/**
 * Quote, then pay. The invoice is emitted before the signature exists so the
 * user watches the terms arrive first, which is the part of x402 worth
 * understanding.
 */
async function buy(ctx: RunContext, emit: (block: Block) => void, spec: EndpointSpec): Promise<MoveOutcome> {
  emit({
    kind: 'text',
    text: pick([
      `Requesting ${spec.title.toLowerCase()} with no payment header. This is ${spec.buys}.`,
      `First request goes out unpaid. Testing what the seller asks for: ${spec.title}.`,
      `Asking for ${spec.title.toLowerCase()} cold, the way any agent would discover it.`,
      `No wallet signature yet. Just a plain GET, and whatever the server decides to say back.`,
    ]),
  });

  const probe = await probeResource(spec.path);

  if (probe.status !== 402) {
    emit({
      kind: 'text',
      text: pick([
        `That came back ${probe.status} instead of 402. No invoice returned, so nothing to pay.`,
        `No payment required here (HTTP ${probe.status}). Either the gate is off or this route is free.`,
      ]),
    });
    emit({ kind: 'payload', title: spec.title, shape: spec.shape, data: probe.body, endpoint: spec.path });
    return { lastTrace: probe, next: nextMoves(ctx, probe) };
  }

  if (probe.terms) {
    emit({ kind: 'invoice', terms: probe.terms, challenge: probe.challenge });
    emit({
      kind: 'text',
      text: pick([
        `HTTP 402. The price is quoted inside the response itself without needing external docs. It requests ${formatUsd(probe.terms.amount)} in ${String(
          (probe.terms.extra as Record<string, unknown> | undefined)?.name ?? 'the settlement asset',
        )} on ${NETWORKS[ctx.network].label}.`,
        `There it is: ${formatUsd(probe.terms.amount)} to ${shortAddress(probe.terms.payTo)}, settled on ${
          NETWORKS[ctx.network].label
        }. The signature is EIP-3009, so it costs the buyer no gas.`,
        `The invoice came back with the request. ${formatUsd(probe.terms.amount)} payable to ${shortAddress(
          probe.terms.payTo,
        )}. I sign an authorization, and the facilitator moves the money.`,
      ]),
    });
  } else {
    emit({
      kind: 'error',
      text: 'The 402 came back without a readable invoice, so there is nothing to sign.',
      hint: 'That usually means the seller is misconfigured, not that the payment failed.',
    });
    return { lastTrace: probe };
  }

  emit({
    kind: 'text',
    text: pick([
      'Signing the authorization now. No approval transaction, no gas from me.',
      'Signing off-chain and retrying the request with the payment header.',
      'Authorizing the transfer locally. The facilitator pays the gas on Celo.',
    ]),
  });

  const trace = await paidRequest({
    path: spec.path,
    network: ctx.network,
    burnerKey: ctx.burnerKey,
    maxAtomicPerRequest: MAX_ATOMIC_PER_REQUEST,
    terms: probe.terms,
    challenge: probe.challenge,
    challengeHeader: probe.raw.challengeHeader,
  });

  return finish(ctx, emit, spec, trace);
}

/** Shared tail for every paid call: receipt, payload, commentary. */
function finish(ctx: RunContext, emit: (block: Block) => void, spec: EndpointSpec, trace: RequestTrace): MoveOutcome {
  if (!trace.ok || !trace.receipt?.success) {
    emit({
      kind: 'error',
      text: trace.error ?? trace.receipt?.errorReason ?? 'The payment did not settle.',
      hint: 'Nothing was charged if there is no transaction hash below.',
    });
    if (trace.raw.responseHeader) emit({ kind: 'raw', trace, label: spec.title });
    return { lastTrace: trace, next: nextMoves(ctx, trace) };
  }

  emit({
    kind: 'receipt',
    receipt: trace.receipt,
    amountAtomic: trace.terms?.amount ?? '0',
    // Trust the receipt's own chain so the explorer link is right even when the
    // invoice came from the other network than the one selected in the UI.
    network: networkForCaip2(trace.receipt.network, ctx.network),
    durationMs: trace.durationMs,
    endpoint: spec.path,
  });

  emit({ kind: 'payload', title: spec.title, shape: spec.shape, data: trace.body, endpoint: spec.path });

  const rows = countRows(trace);
  if (spec.shape === 'creators') {
    emit({
      kind: 'text',
      text: rows
        ? pick([
            `${plural(rows, 'creator', 'creators')} came back, and every one of them is now credited with a share of that cent.`,
            `That is ${plural(rows, 'artist', 'artists')} on the payout ledger. Pick one and I will buy their profile too.`,
            `${plural(rows, 'listing', 'listings')}. The sellers only appear here because they opted in. Consent is off by default.`,
          ])
        : pick([
            'The call settled, but no creator has opted in to listings yet, so the list is empty. Consent is per-artist and off by default.',
            'Empty list. That is the consent gate working: nobody has switched listings on yet.',
          ]),
    });
  } else if (spec.shape === 'tracks') {
    emit({
      kind: 'text',
      text: rows
        ? pick([
            `${plural(rows, 'track', 'tracks')}. The 60/40 split is applied per creator behind each row, not per request.`,
            `${plural(rows, 'track', 'tracks')} returned. Save the ids: buying one back as a profile is a separate payment.`,
            `Catalog metadata only, no media URLs. ${plural(rows, 'track', 'tracks')}, each mapped to the creators who own it.`,
          ])
        : pick([
            'Nothing in the catalog yet. No track belongs to a creator with catalog consent switched on.',
            'Empty catalog. Either no music is published, or nobody has granted catalog consent.',
          ]),
    });
  } else {
    emit({
      kind: 'text',
      text: pick([
        'Settled. That is the cheapest possible proof that the whole loop works.',
        'The gate answers 200 only after settlement. A 200 here confirms real on-chain settlement, not just a ping.',
      ]),
    });
  }

  const known = extractCreators(trace);
  return {
    lastTrace: trace,
    knownCreators: known.length ? known : undefined,
    next: nextMoves({ ...ctx, knownCreators: known.length ? known : ctx.knownCreators }, trace),
  };
}

async function buyProfile(ctx: RunContext, emit: (block: Block) => void, creator: KnownCreator): Promise<MoveOutcome> {
  const path = `/api/v1/agent/creator/${creator.id}`;
  const label = creator.displayName ?? creator.username ?? shortAddress(creator.id, 6);

  emit({
    kind: 'text',
    text: pick([
      `Buying ${label}'s profile. Route price: $0.005 instead of $0.01.`,
      `Second purchase, this time a single profile: ${label}.`,
      `Fetching ${label}. This one is priced per creator, not per catalog page.`,
    ]),
  });

  const probe = await probeResource(path);
  if (probe.status !== 402) {
    emit({
      kind: 'error',
      text: `${label}'s profile answered ${probe.status}.`,
      hint:
        probe.status === 404
          ? 'That creator has not switched profile consent on, so the route pretends they do not exist.'
          : 'Nothing to pay, nothing returned.',
    });
    return { lastTrace: probe };
  }

  if (probe.terms) emit({ kind: 'invoice', terms: probe.terms, challenge: probe.challenge });

  const trace = await paidRequest({
    path,
    network: ctx.network,
    burnerKey: ctx.burnerKey,
    maxAtomicPerRequest: MAX_ATOMIC_PER_REQUEST,
    terms: probe.terms,
    challenge: probe.challenge,
    challengeHeader: probe.raw.challengeHeader,
  });

  const outcome = finish(
    ctx,
    emit,
    { id: 'profile', path, title: `${label}'s profile`, shape: 'profile', buys: 'one public creator profile' },
    trace,
  );
  if (trace.ok) {
    emit({
      kind: 'text',
      text: pick([
        'Attribution for that route goes entirely to the creator without a split pool.',
        'Single-creator purchase, so the whole creator share lands on one ledger row.',
      ]),
    });
  }
  return outcome;
}

// ── Move catalogue ──────────────────────────────────────────────────────────

const movePing: Move = {
  id: 'ping',
  label: 'Payment gate',
  hint: 'One cent. Proves settlement end to end.',
  group: 'discover',
  run: (ctx, emit) => buy(ctx, emit, ENDPOINTS.ping),
};

const moveListings: Move = {
  id: 'listings',
  label: 'Creator listings',
  hint: 'One cent. Artists who opted in.',
  group: 'discover',
  run: (ctx, emit) => buy(ctx, emit, ENDPOINTS.listings),
};

const moveCatalog: Move = {
  id: 'catalog',
  label: 'Music catalog',
  hint: 'One cent. Track metadata plus ownership.',
  group: 'discover',
  run: (ctx, emit) => buy(ctx, emit, ENDPOINTS.catalog),
};

const moveQuote: Move = {
  id: 'quote',
  label: 'Quote only',
  hint: 'Read the 402 and stop.',
  group: 'inspect',
  async run(_ctx, emit) {
    emit({
      kind: 'text',
      text: pick([
        'Reading the invoice and stopping there. A 402 is free to look at.',
        'No signature this time: only the terms published by the seller.',
      ]),
    });
    const trace = await probeResource(ENDPOINTS.catalog.path);
    if (trace.terms) {
      emit({ kind: 'invoice', terms: trace.terms, challenge: trace.challenge });
      const extra = (trace.terms.extra ?? {}) as Record<string, unknown>;
      emit({
        kind: 'text',
        text: pick([
          `That is the entire negotiation. ${
            extra.name ? String(extra.name) : 'The asset'
          }, version ${extra.version ? String(extra.version) : 'N/A'}, transfer method ${String(
            extra.assetTransferMethod ?? 'eip3009',
          )}. The EIP-712 domain is here because getting it wrong is the most common integration failure.`,
          `Note what travels in the response: network, asset, amount, payee, and the EIP-712 domain under extra. Nothing about this seller's code has to be known in advance.`,
        ]),
      });
    } else {
      emit({ kind: 'error', text: `Expected a 402, got ${trace.status}.`, hint: trace.error });
    }
    return { lastTrace: trace };
  },
};

const moveWallet: Move = {
  id: 'wallet',
  label: 'Burner wallet',
  hint: 'Address, balances, session spend.',
  group: 'wallet',
  async run(ctx, emit) {
    emit({
      kind: 'text',
      text: pick([
        'Fetching the burner balances straight from Celo RPC.',
        'Reading the wallet this demo signs with.',
      ]),
    });
    const profile = NETWORKS[ctx.network];
    if (!/^0x[0-9a-fA-F]{64}$/.test(ctx.burnerKey)) {
      emit({
        kind: 'error',
        text: 'No burner key is configured for this build.',
        hint: 'Set NEXT_PUBLIC_BURNER_PRIVATE_KEY and rebuild. The chat can still read quotes without it.',
      });
      return {};
    }
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(ctx.burnerKey as `0x${string}`);
    const [assetBalance, nativeBalance] = await Promise.all([
      fetchAssetBalance(ctx.network, account.address, profile.usdc).catch(() => null),
      fetchNativeBalance(ctx.network, account.address).catch(() => null),
    ]);
    emit({
      kind: 'payload',
      title: 'Burner wallet',
      shape: 'generic',
      endpoint: 'wallet',
      data: {
        address: account.address,
        network: profile.label,
        assetSymbol: 'USDC',
        assetBalanceAtomic: assetBalance,
        nativeBalanceWei: nativeBalance,
        sessionSpentAtomic: String(getSessionSpentAtomic()),
        explorer: `${profile.explorer}/address/${account.address}`,
      },
    });
    emit({
      kind: 'text',
      text: pick([
        'The buyer never needs CELO: the facilitator covers gas on Celo. A zero native balance is expected here.',
        'Native CELO stays empty on purpose. Stablecoin in, signature out, facilitator pays the fee.',
      ]),
    });
    return {};
  },
};

const moveSwitch: Move = {
  id: 'switch',
  label: 'Switch network',
  hint: 'Sepolia and mainnet price differently.',
  group: 'wallet',
  async run(ctx, emit) {
    // Only the networks this build can actually pay on, so a Sepolia-only build
    // never offers a mainnet switch it would refuse at signing time.
    const order: NetworkKey[] = NETWORK_ORDER;
    const next = order[(order.indexOf(ctx.network) + 1) % order.length];
    ctx.setNetwork(next);
    emit({
      kind: 'text',
      text: pick([
        `Switched to ${NETWORKS[next].label}. The invoice decides the chain, so nothing else needs reconfiguring.`,
        `Now quoting against ${NETWORKS[next].label}. The burner key is the same; the settlement asset is not.`,
      ]),
    });
    return {};
  },
};

const moveSpend: Move = {
  id: 'spend',
  label: 'Session spend',
  hint: 'Running total for this browser tab.',
  group: 'wallet',
  async run(ctx, emit) {
    const spent = getSessionSpentAtomic();
    emit({
      kind: 'text',
      text: spent
        ? pick([
            `This tab has settled ${formatUsd(String(spent))} so far. The burner holds the rest.`,
            `${formatUsd(String(spent))} spent in this session, across every endpoint you have tried.`,
          ])
        : pick([
            'Nothing yet. Every quote you have looked at so far was free.',
            'This session has not settled anything. Quotes do not cost anything.',
          ]),
    });
    emit({
      kind: 'raw',
      trace: {
        ok: true,
        paid: false,
        url: 'session',
        path: 'session',
        durationMs: 0,
        status: 200,
        challenge: null,
        terms: null,
        receipt: null,
        body: { sessionSpentAtomic: String(spent), network: NETWORKS[ctx.network].label },
        raw: { challengeHeader: null, signatureHeader: null, responseHeader: null, requestHeaders: {}, responseHeaders: {} },
      },
      label: 'Session counter',
    });
    return {};
  },
};

const moveReset: Move = {
  id: 'reset',
  label: 'Reset counter',
  hint: 'Only clears the local total.',
  group: 'wallet',
  async run(_ctx, emit) {
    resetSessionSpend();
    emit({
      kind: 'text',
      text: 'Local counter cleared. Nothing on chain was touched, and no refund happened.',
    });
    return {};
  },
};

const moveExplain: Move = {
  id: 'explain',
  label: 'How it works',
  hint: 'The six steps, no jargon.',
  group: 'about',
  async run(_ctx, emit) {
    emit({
      kind: 'text',
      text: pick([
        'Here is the whole loop, in the order it happens.',
        'Six steps from a plain GET to settled money.',
      ]),
    });
    emit({
      kind: 'payload',
      title: 'How an x402 payment settles',
      shape: 'generic',
      endpoint: 'explain',
      data: {
        steps: [
          'The agent asks for the resource with no payment header.',
          'The seller answers 402 with the price, the asset, the payee and the EIP-712 domain.',
          'The agent signs a TransferWithAuthorization off-chain. No approval transaction, no gas.',
          'The agent repeats the request with a payment-signature header.',
          'The Celo facilitator verifies, then settles through the token contract. The seller never custodies funds.',
          'The seller returns 200 with the data and a payment-response header carrying the transaction hash.',
        ],
        split: 'Each settled payment is split 60% to the creators whose data was served and 40% to the platform.',
        note: 'Payment is per request, not per subscription. A failed request costs nothing.',
      },
    });
    return {};
  },
};

const moveEndpoints: Move = {
  id: 'endpoints',
  label: "What's for sale",
  hint: 'Three paid routes and their prices.',
  group: 'about',
  async run(_ctx, emit) {
    emit({
      kind: 'payload',
      title: 'Agent-facing routes',
      shape: 'generic',
      endpoint: 'endpoints',
      data: {
        routes: [
          { path: '/api/v1/agent/ping', price: '0.01', returns: 'Settlement liveness check' },
          { path: '/api/v1/agent/listings', price: '0.01', returns: 'Opted-in creator listings' },
          { path: '/api/v1/agent/catalog', price: '0.01', returns: 'Music catalog metadata' },
          { path: '/api/v1/agent/creator/:id', price: '0.005', returns: 'One creator profile' },
          { path: '/api/v1/agent/demo/settlements', price: 'free', returns: 'The public ledger page' },
        ],
        note: 'Prices are strings in token base units. 10000 is one cent, 5000 is half a cent.',
      },
    });
    emit({
      kind: 'text',
      text: pick([
        'Creator data is off by default. An artist has to switch consent on before any of these routes will return them.',
        'Consent is per-artist and per-surface: listings, catalog and profile are three separate switches.',
      ]),
    });
    return {};
  },
};

const moveRaw: Move = {
  id: 'raw',
  label: 'Raw response',
  hint: 'Headers, signature and body.',
  group: 'inspect',
  async run(ctx, emit) {
    if (!ctx.lastTrace) {
      emit({ kind: 'error', text: 'Nothing to inspect yet. Buy or quote an endpoint first.' });
      return {};
    }
    emit({ kind: 'raw', trace: ctx.lastTrace, label: ctx.lastTrace.path });
    return {};
  },
};

const moveReplay: Move = {
  id: 'replay',
  label: 'Run again',
  hint: 'Repeat the last request.',
  group: 'inspect',
  async run(ctx, emit) {
    const path = ctx.lastTrace?.path;
    if (!path) {
      emit({ kind: 'error', text: 'No previous request to repeat.' });
      return {};
    }
    if (path.startsWith('/api/v1/agent/creator/')) {
      const id = path.split('/').pop() ?? '';
      return buyProfile(ctx, emit, { id, username: null, displayName: null });
    }
    const spec = Object.values(ENDPOINTS).find((candidate) => candidate.path === path);
    if (!spec) {
      emit({ kind: 'error', text: `No replay handler for ${path}.` });
      return {};
    }
    return buy(ctx, emit, spec);
  },
};

// ── Availability ────────────────────────────────────────────────────────────

const CORE_MOVES: Move[] = [movePing, moveListings, moveCatalog, moveQuote, moveWallet, moveSwitch, moveSpend, moveExplain, moveEndpoints];

export function initialMoves(): Move[] {
  return [movePing, moveListings, moveCatalog, moveQuote, moveWallet, moveExplain, moveEndpoints];
}

/** Moves that only make sense once something has been requested. */
function nextMoves(ctx: RunContext, trace: RequestTrace): Move[] {
  const moves: Move[] = [];

  // A profile purchase is the natural next step, and it is priced differently,
  // so it leads the list when the response named any creators.
  for (const creator of ctx.knownCreators.slice(0, 3)) {
    const label = creator.displayName ?? creator.username ?? shortAddress(creator.id, 6);
    moves.push({
      id: `profile:${creator.id}`,
      label: `${label} · profile`,
      hint: `${formatUsd(PROFILE_PRICE)}. Single-creator attribution.`,
      group: 'discover',
      run: (innerCtx, emit) => buyProfile(innerCtx, emit, creator),
    });
  }

  moves.push(moveRaw, moveReplay);

  // Then the standing catalogue, without duplicating anything already offered.
  const offered = new Set(moves.map((move) => move.id));
  for (const move of CORE_MOVES) {
    if (!offered.has(move.id)) moves.push(move);
  }
  void trace;
  return moves;
}

/** Full catalogue, used when the composer needs to reset to a known set. */
export function allMoves(): Move[] {
  return CORE_MOVES;
}

export function explorerLink(network: NetworkKey, hash: string): string {
  return explorerTx(network, hash);
}

export type { PaymentTerms, SettlementReceipt, RequestTrace };
