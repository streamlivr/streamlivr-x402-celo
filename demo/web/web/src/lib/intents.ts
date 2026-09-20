'use client';

import { MAX_ATOMIC_PER_REQUEST, NETWORKS, NETWORK_ORDER, explorerTx, networkForCaip2, shortAddress, type NetworkKey } from './config';
import { formatUsd } from './format';
import { fetchCreators } from './api';
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
export type PayloadShape = 'creators' | 'tracks' | 'profile' | 'ledger' | 'ping' | 'quotes' | 'generic';

export type Block =
  | { kind: 'text'; text: string }
  | {
      kind: 'invoice';
      terms: PaymentTerms;
      challenge: PaymentChallenge | null;
      /**
       * Whether this invoice is about to be paid or was only read. A quote
       * renders as information; a payable invoice renders as an offer. Showing
       * the same pill for both is what made a free read look like a charge.
       */
      mode: 'payable' | 'quoted';
    }
  | {
      kind: 'receipt';
      receipt: SettlementReceipt;
      amountAtomic: string;
      network: NetworkKey;
      durationMs: number;
      endpoint: string;
      /** Creators whose data was served and who now hold a share of this payment. */
      credited: number;
    }
  | { kind: 'progress'; label: string; startedAt: number }
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

/**
 * Shows what the agent is doing while a slow request is in flight, and moves
 * the line on as the wait continues. Settlement on Celo takes several seconds,
 * and a silent gap that long reads as a hung page. Returns a stop function the
 * caller runs once the await resolves.
 */
function stagedProgress(
  emit: (block: Block) => void,
  stages: { atMs: number; label: string }[],
): () => void {
  const startedAt = Date.now();
  emit({ kind: 'progress', label: stages[0].label, startedAt });
  const timers = stages.slice(1).map((stage) =>
    setTimeout(() => emit({ kind: 'progress', label: stage.label, startedAt }), stage.atMs),
  );
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
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
  /** Plain-language openings, picked at random so repeat runs don't read canned. */
  intro: string[];
}

const ENDPOINTS: Record<'ping' | 'listings' | 'catalog', EndpointSpec> = {
  ping: {
    id: 'ping',
    path: '/api/v1/agent/ping',
    title: 'Payment gate',
    shape: 'ping',
    intro: [
      'Checking the payment gate. It only answers once a payment settles.',
      'Calling the liveness route. This one is a pure settlement check.',
    ],
  },
  listings: {
    id: 'listings',
    path: '/api/v1/agent/listings',
    title: 'Creator listings',
    shape: 'creators',
    intro: [
      'Looking up artists who opted in to agent access.',
      'Fetching creator listings. Every artist in the response agreed to appear.',
    ],
  },
  catalog: {
    id: 'catalog',
    path: '/api/v1/agent/catalog',
    title: 'Music catalog',
    shape: 'tracks',
    intro: [
      'Pulling the music catalog: cover art, ISRCs, and the artists who own each recording.',
      'Fetching the catalog. Tracks come back with their artwork and the creators behind them.',
    ],
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
  emit({ kind: 'text', text: pick(spec.intro) });

  const stopProbeProgress = stagedProgress(emit, [
    { atMs: 0, label: `Requesting a price for ${spec.title.toLowerCase()}` },
    { atMs: 2500, label: 'Still waiting on the seller' },
  ]);
  const probe = await probeResource(spec.path);
  stopProbeProgress();

  if (probe.status === 0) {
    emit({
      kind: 'error',
      text: 'The API never answered, so nothing was sent and nothing was paid.',
      hint: probe.error ?? 'Check that the API base URL is reachable from this browser.',
    });
    return { lastTrace: probe, next: nextMoves(ctx, probe) };
  }

  if (probe.status !== 402) {
    emit({
      kind: 'text',
      text: pick([
        `That came back ${probe.status} instead of 402. No invoice returned, so nothing to pay.`,
        `No payment required here (HTTP ${probe.status}). Either the gate is off or this route is free.`,
      ]),
    });
    emit({ kind: 'payload', title: spec.title, shape: spec.shape, data: probe.body, endpoint: spec.path });
    // An unpaid 200 still names creators, and the follow-up chips should offer
    // their profiles the same way a settled response does.
    const known = extractCreators(probe);
    const nextKnown = known.length ? known : ctx.knownCreators;
    return {
      lastTrace: probe,
      ...(known.length ? { knownCreators: known } : {}),
      next: nextMoves({ ...ctx, knownCreators: nextKnown }, probe),
    };
  }

  const assetName = String((probe.terms?.extra as Record<string, unknown> | undefined)?.name ?? 'USDC');

  if (probe.terms) {
    emit({ kind: 'invoice', terms: probe.terms, challenge: probe.challenge, mode: 'payable' });
    emit({
      kind: 'text',
      text: pick([
        `The seller wants ${formatUsd(probe.terms.amount)} in ${assetName} on ${
          NETWORKS[ctx.network].label
        }, paid to ${shortAddress(probe.terms.payTo)}. Nothing has been signed yet.`,
        `Price: ${formatUsd(probe.terms.amount)} in ${assetName}. That is the whole negotiation, and it arrived with the 402.`,
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
      `Paying it. I sign a ${assetName} authorization with the demo wallet, and the facilitator moves the money.`,
      `Sending the payment. The signature is off-chain, so the buyer never needs gas.`,
    ]),
  });

  const stopPayProgress = stagedProgress(emit, [
    { atMs: 0, label: 'Signing the authorization' },
    { atMs: 1200, label: `Settling ${formatUsd(probe.terms.amount)} on ${NETWORKS[ctx.network].label}` },
    { atMs: 7000, label: 'Waiting for the facilitator to confirm' },
  ]);
  let trace: RequestTrace;
  try {
    trace = await paidRequest({
      path: spec.path,
      network: ctx.network,
      burnerKey: ctx.burnerKey,
      maxAtomicPerRequest: MAX_ATOMIC_PER_REQUEST,
      terms: probe.terms,
      challenge: probe.challenge,
      challengeHeader: probe.raw.challengeHeader,
    });
  } finally {
    stopPayProgress();
  }

  return finish(ctx, emit, spec, trace);
}

/**
 * How many creators this payment credited. The seller records attribution from
 * the rows it actually served, so this is the number the ledger will show.
 */
function creditedCount(trace: RequestTrace, shape: PayloadShape): number {
  const body = asRecord(trace.body);
  if (!body) return 0;
  if (shape === 'profile') return body.id ? 1 : 0;
  if (Array.isArray(body.creators)) return body.creators.length;
  if (Array.isArray(body.tracks)) {
    const ids = new Set<string>();
    for (const entry of body.tracks) {
      const row = asRecord(entry);
      if (row && Array.isArray(row.creatorIds)) {
        for (const id of row.creatorIds) ids.add(String(id));
      }
    }
    return ids.size;
  }
  return 0;
}

/** Shared tail for every paid call: receipt, payload, commentary. */
function finish(ctx: RunContext, emit: (block: Block) => void, spec: EndpointSpec, trace: RequestTrace): MoveOutcome {
  if (!trace.ok || !trace.receipt?.success) {
    const reason = trace.error ?? trace.receipt?.errorReason ?? 'The payment did not settle.';
    const outOfCredits = /insufficient_credits|settlement funds/i.test(reason);
    emit({
      kind: 'error',
      text: outOfCredits
        ? "The seller's facilitator is out of settlement credits, so the transfer was refused before it reached the chain."
        : reason,
      hint: outOfCredits
        ? 'Nothing was charged. Top up the seller account at x402.celo.org, then run this again.'
        : 'Nothing was charged if there is no transaction hash below.',
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
    credited: creditedCount(trace, spec.shape),
  });

  emit({ kind: 'payload', title: spec.title, shape: spec.shape, data: trace.body, endpoint: spec.path });

  const rows = countRows(trace);
  const credits = creditedCount(trace, spec.shape);

  if (spec.shape === 'creators') {
    emit({
      kind: 'text',
      text: rows
        ? pick([
            `${plural(rows, 'artist', 'artists')} returned. Each of them now holds a share of that cent, split 60/40 with the platform.`,
            `${plural(rows, 'creator', 'creators')} returned, and the ledger credited all of them. Only artists who switched listings on can appear here.`,
          ])
        : pick([
            'The payment settled, but no artist has listings consent switched on yet, so the response is empty.',
            'Empty list. Consent is per artist and off by default, so nobody is in it yet.',
          ]),
    });
    if (rows) {
      emit({
        kind: 'text',
        text: 'Pick an artist and I will buy their profile. That route costs half a cent and credits the whole creator share to one person.',
      });
    }
  } else if (spec.shape === 'tracks') {
    emit({
      kind: 'text',
      text: rows
        ? pick([
            `${plural(rows, 'track', 'tracks')}, credited across ${plural(credits, 'creator', 'creators')}.`,
            `${plural(rows, 'track', 'tracks')} returned with cover art and the creators who own each one. The 60/40 split runs per creator, not per request.`,
          ])
        : pick([
            'The catalog is empty. No track belongs to an artist with catalog consent switched on.',
            'Empty catalog. Either nothing is published, or nobody granted catalog consent.',
          ]),
    });
  } else {
    emit({
      kind: 'text',
      text: pick([
        'Settled. The route answers 200 only after the transfer lands, so a 200 here is proof the money moved.',
        'Done. That 200 came back after settlement, not before it.',
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
      `Buying ${label}'s profile. This route costs half a cent and credits one artist instead of a pool.`,
      `Fetching ${label}. Single profile, same payment flow, smaller price.`,
    ]),
  });

  const stopProbe = stagedProgress(emit, [{ atMs: 0, label: `Requesting ${label}'s profile` }]);
  const probe = await probeResource(path);
  stopProbe();

  if (probe.status === 0) {
    emit({
      kind: 'error',
      text: 'The API never answered, so nothing was sent and nothing was paid.',
      hint: probe.error ?? 'Check that the API base URL is reachable from this browser.',
    });
    return { lastTrace: probe };
  }

  if (probe.status !== 402) {
    if (probe.status === 404) {
      emit({
        kind: 'error',
        text: `${label}'s profile is not available to agents.`,
        hint: 'That artist has not switched profile consent on, so the route pretends they do not exist.',
      });
      return { lastTrace: probe, next: nextMoves(ctx, probe) };
    }
    if (probe.status >= 400) {
      emit({
        kind: 'error',
        text: `${label}'s profile answered ${probe.status}, so there is nothing to show.`,
      });
      return { lastTrace: probe, next: nextMoves(ctx, probe) };
    }
    // The seller answered without asking for money, which is what a route looks
    // like when the payment gate is switched off. The profile still renders.
    emit({ kind: 'payload', title: `${label}'s profile`, shape: 'profile', data: probe.body, endpoint: path });
    emit({
      kind: 'text',
      text: 'That route answered without asking for payment, so nothing was charged for this profile.',
    });
    return afterProfile(ctx, emit, creator, label, { lastTrace: probe, next: nextMoves(ctx, probe) });
  }

  if (probe.terms) {
    emit({ kind: 'invoice', terms: probe.terms, challenge: probe.challenge, mode: 'payable' });
    emit({
      kind: 'text',
      text: `${formatUsd(probe.terms.amount)} for one profile, paid to ${shortAddress(probe.terms.payTo)}.`,
    });
  }

  const stopPay = stagedProgress(emit, [
    { atMs: 0, label: 'Signing the authorization' },
    { atMs: 1200, label: 'Settling on Celo' },
    { atMs: 7000, label: 'Waiting for the facilitator to confirm' },
  ]);
  let trace: RequestTrace;
  try {
    trace = await paidRequest({
      path,
      network: ctx.network,
      burnerKey: ctx.burnerKey,
      maxAtomicPerRequest: MAX_ATOMIC_PER_REQUEST,
      terms: probe.terms,
      challenge: probe.challenge,
      challengeHeader: probe.raw.challengeHeader,
    });
  } finally {
    stopPay();
  }

  const outcome = finish(
    ctx,
    emit,
    { id: 'profile', path, title: `${label}'s profile`, shape: 'profile', intro: [] },
    trace,
  );

  if (!trace.ok) return outcome;
  return afterProfile(ctx, emit, creator, label, outcome);
}

/**
 * The free ledger read that follows a profile purchase. It answers the question
 * a buyer asks next: what has this artist actually been paid, and how much is
 * still sitting in the payout queue. It never fails the profile it follows.
 */
async function afterProfile(
  ctx: RunContext,
  emit: (block: Block) => void,
  creator: KnownCreator,
  label: string,
  outcome: MoveOutcome,
): Promise<MoveOutcome> {
  try {
    const ledger = await fetchCreators();
    emit({
      kind: 'payload',
      title: 'Artist payout ledger',
      shape: 'ledger',
      // The whole ledger travels, with the artist just bought pinned to the
      // top, so the numbers on the card are the live totals rather than a
      // single row pretending to be one.
      data: { ...ledger, focusCreatorId: creator.id },
      endpoint: '/api/v1/agent/demo/creators',
    });
  } catch {
    // The profile stands on its own if the free ledger is unavailable.
  }

  emit({
    kind: 'text',
    text: pick([
      `Attribution for this route landed on ${label} alone, so the whole creator share sits under their name.`,
      'The ledger card is a free read of the same database the payouts run from.',
    ]),
  });

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

/** Routes the price list reads. The profile route joins it once an artist is known. */
const QUOTE_ROUTES: { path: string; returns: string }[] = [
  { path: '/api/v1/agent/ping', returns: 'Settlement liveness check' },
  { path: '/api/v1/agent/listings', returns: 'Artist profiles' },
  { path: '/api/v1/agent/catalog', returns: 'Track metadata and owners' },
];

/**
 * Every price at once, read straight off each route's 402. Nothing is signed,
 * so this costs nothing and it answers the question a buyer actually arrives
 * with: what does this seller charge, per route.
 */
const moveQuote: Move = {
  id: 'quote',
  label: 'All prices',
  hint: 'Read every invoice. Nothing is signed.',
  group: 'inspect',
  async run(ctx, emit) {
    emit({
      kind: 'text',
      text: pick([
        'Reading every price. Looking at a 402 is free, so nothing is signed and nothing is charged.',
        'Price list, read live. These are the invoices each route returns to an unpaid request.',
      ]),
    });

    const targets = [...QUOTE_ROUTES];
    const firstCreator = ctx.knownCreators[0];
    if (firstCreator) {
      const name = firstCreator.displayName ?? firstCreator.username ?? shortAddress(firstCreator.id);
      targets.push({ path: `/api/v1/agent/creator/${firstCreator.id}`, returns: `${name}'s profile` });
    }

    const stopProgress = stagedProgress(emit, [{ atMs: 0, label: 'Asking each route for its price' }]);
    let probes: RequestTrace[];
    try {
      probes = await Promise.all(targets.map((target) => probeResource(target.path)));
    } finally {
      stopProgress();
    }

    const rows = targets.map((target, index) => {
      const terms = probes[index].terms;
      return {
        path: target.path,
        returns: target.returns,
        price: terms ? formatUsd(terms.amount) : null,
      };
    });

    const answered = probes.filter((probe) => probe.terms);
    if (answered.length === 0) {
      emit({
        kind: 'error',
        text: 'No route returned a price, so there is nothing to quote.',
        hint: probes[0]?.error ?? 'The seller may be unreachable.',
      });
      return { lastTrace: probes[0] };
    }

    const sample = answered[0].terms!;
    const extra = (sample.extra ?? {}) as Record<string, unknown>;
    const domain = [String(extra.name ?? 'USDC'), extra.version ? `v${String(extra.version)}` : null]
      .filter(Boolean)
      .join(' ');

    emit({
      kind: 'payload',
      title: 'Every price, read live',
      shape: 'quotes',
      endpoint: 'quotes',
      data: {
        rows,
        // Labels carry their own spaces because the card renders them in
        // uppercase and does not split camelCase.
        settlement: {
          Asset: String(extra.name ?? 'USDC'),
          Network: NETWORKS[ctx.network].label,
          'Paid to': shortAddress(sample.payTo),
          Transfer: String(extra.assetTransferMethod ?? 'eip3009'),
          'EIP-712 domain': domain,
        },
      },
    });

    // Point the raw inspector at the catalog probe, which is the one a buyer
    // most often wants to read in full.
    const catalogProbe = probes[targets.findIndex((target) => target.path === '/api/v1/agent/catalog')];
    return { lastTrace: catalogProbe ?? answered[0] };
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
  hint: 'Cycles the networks this build is allowed to pay on.',
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
        'Six steps from an unpaid request to settled money.',
      ]),
    });
    emit({
      kind: 'payload',
      title: 'How an x402 payment settles',
      shape: 'generic',
      endpoint: 'explain',
      data: {
        steps: [
          'The agent asks for the resource without paying.',
          'The seller answers 402 with the price, the asset, the payee, and the EIP-712 domain.',
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
  // so it leads the list when the response named any creators. The one just
  // bought is skipped: offering an artist's profile back to the buyer who paid
  // for it reads like the agent was not paying attention.
  for (const creator of ctx.knownCreators.slice(0, 2)) {
    if (trace.path === `/api/v1/agent/creator/${creator.id}`) continue;
    const label = creator.displayName ?? creator.username ?? shortAddress(creator.id, 6);
    moves.push({
      id: `profile:${creator.id}`,
      label: `${label} · profile`,
      hint: `${formatUsd(PROFILE_PRICE)}. Single-creator attribution.`,
      group: 'discover',
      run: (innerCtx, emit) => buyProfile(innerCtx, emit, creator),
    });
  }

  // Then the other paid routes, so the three chips on screen are all things a
  // buyer would actually want next. The route just used is left out.
  for (const move of [movePing, moveListings, moveCatalog, moveQuote]) {
    if (ENDPOINTS[move.id as 'ping' | 'listings' | 'catalog']?.path === trace.path) continue;
    if (!moves.some((offered) => offered.id === move.id)) moves.push(move);
  }

  moves.push(moveRaw, moveReplay);
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
