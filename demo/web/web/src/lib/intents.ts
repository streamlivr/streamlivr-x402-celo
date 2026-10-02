'use client';

import { MAX_ATOMIC_PER_REQUEST, NETWORKS, NETWORK_ORDER, explorerTx, shortAddress, type NetworkKey } from './config';
import { formatCount, formatUsd } from './format';
import { fetchCreators, fetchPricing, type PricingResponse } from './api';
import { interpretWithModel, type ChatPlan } from './interpret';
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
export type PayloadShape =
  | 'creators'
  | 'posts'
  | 'tracks'
  | 'profile'
  | 'ledger'
  | 'ping'
  | 'quotes'
  | 'stats'
  | 'generic';

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
  return items[Math.floor(Math.random() * items.length)] as T;
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
  emit({ kind: 'progress', label: stages[0]!.label, startedAt });
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
  // catalog, so the profile move is the only way to resolve one). Posts carry a
  // creator id too, and for the same reason it is not a name.
  if (Array.isArray(body.tracks) || Array.isArray(body.posts)) {
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
  if (Array.isArray(body.posts)) return body.posts.length;
  if (Array.isArray(body.tracks)) return body.tracks.length;
  return 0;
}

/** The page envelope every list route returns. */
export interface PageMeta {
  total?: number;
  limit?: number;
  returned?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
  truncated?: boolean;
}

interface PageQuery {
  q?: string | null;
  limit?: number;
  cursor?: string | null;
  verified?: boolean;
  minFollowers?: number;
  sort?: 'followers' | 'newest' | 'views' | 'title';
}

/** Rows a page holds when the caller does not ask for a size. */
const DEFAULT_PAGE_ROWS = 10;

/**
 * Put search and pagination in the query string.
 *
 * This is the whole client half of the paging contract: the datasets hold
 * thousands of rows, so a page is what a cent buys. `cursor` is opaque. The
 * seller mints it and the seller validates it. The selected rows determine
 * the price, so each page gets a fresh quote.
 */
export function withQuery(path: string, params: PageQuery = {}): string {
  const search = new URLSearchParams();
  const q = params.q?.trim();
  if (q) search.set('q', q);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.verified !== undefined) search.set('verified', String(params.verified));
  if (params.minFollowers !== undefined) search.set('minFollowers', String(params.minFollowers));
  if (params.sort !== undefined) search.set('sort', params.sort);
  if (params.cursor) search.set('cursor', params.cursor);
  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function pageOf(trace: RequestTrace): PageMeta | undefined {
  return asRecord(asRecord(trace.body)?.page) as PageMeta | undefined;
}

function queryOf(trace: RequestTrace): string | null {
  const q = asRecord(asRecord(trace.body)?.query)?.q;
  return typeof q === 'string' && q ? q : null;
}

function searchOptionsOf(trace: RequestTrace): Pick<PageQuery, 'verified' | 'minFollowers' | 'sort'> {
  const query = asRecord(asRecord(trace.body)?.query);
  return {
    ...(typeof query?.verified === 'boolean' ? { verified: query.verified } : {}),
    ...(typeof query?.minFollowers === 'number' ? { minFollowers: query.minFollowers } : {}),
    ...(typeof query?.sort === 'string' && ['followers', 'newest', 'views', 'title'].includes(query.sort) ? { sort: query.sort as PageQuery['sort'] } : {}),
  };
}

/** `path` carries the query string; routing compares the path alone. */
function pathnameOf(path: string): string {
  const cut = path.indexOf('?');
  return cut === -1 ? path : path.slice(0, cut);
}

// ── Endpoint catalogue ──────────────────────────────────────────────────────

/** The datasets a search can be routed to. Each is one paid route. */
export type DatasetId = 'listings' | 'posts' | 'catalog';

interface EndpointSpec {
  id: 'ping' | DatasetId;
  path: string;
  title: string;
  /** Plural noun for page summaries: "showing 50 of 2,431 creators". */
  noun: string;
  shape: PayloadShape;
  /** Plain-language openings, picked at random so repeat runs don't read canned. */
  intro: string[];
}

const ENDPOINTS: Record<'ping' | DatasetId, EndpointSpec> = {
  ping: {
    id: 'ping',
    path: '/api/v1/agent/ping',
    title: 'Payment gate',
    noun: 'checks',
    shape: 'ping',
    intro: ['Checking the payment gate. It answers only after a payment settles.'],
  },
  listings: {
    id: 'listings',
    path: '/api/v1/agent/listings',
    title: 'Creator listings',
    noun: 'creators',
    shape: 'creators',
    intro: ['Fetching public creator listings, one page at a time.'],
  },
  posts: {
    id: 'posts',
    path: '/api/v1/agent/posts',
    title: 'Public posts',
    noun: 'posts',
    shape: 'posts',
    intro: ['Fetching public posts, newest first.'],
  },
  catalog: {
    id: 'catalog',
    path: '/api/v1/agent/catalog',
    title: 'Music catalog',
    noun: 'tracks',
    shape: 'tracks',
    intro: ['Fetching tracks and recording details.'],
  },
};

/** Iteration order for the cross-dataset chips: cheapest to reason about first. */
const DATASET_ORDER: DatasetId[] = ['listings', 'posts', 'catalog'];

const DATASETS: Record<DatasetId, EndpointSpec> = {
  listings: ENDPOINTS.listings,
  posts: ENDPOINTS.posts,
  catalog: ENDPOINTS.catalog,
};

function specForPath(path: string): EndpointSpec | undefined {
  const base = pathnameOf(path);
  return Object.values(ENDPOINTS).find((spec) => spec.path === base);
}

// ── Reading a typed query ───────────────────────────────────────────────────
// A chat box sends a sentence, not a keyword. The planner below turns that
// sentence into either a scripted answer ("what does each route cost?") or a
// search on one dataset with the filler words removed, which is what the chips
// and the composer both use. Keeping it in one place is what stops the chips
// and the text box from disagreeing about what "amapiano posts" means.

/** Words that carry no search value on their own. */
const FILLER = new Set([
  '&', 'a', 'about', 'all', 'an', 'and', 'any', 'are', 'browse', 'by', 'find', 'for', 'from', 'get', 'give',
  'called', 'in', 'is', 'list', 'me', 'named', 'of', 'on', 'or', 'please', 'public', 'search', 'show', 'some', 'the', 'there',
  'to', 'what', 'with',
]);

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const COUNT = '(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
const RANK_COUNT = new RegExp(`\\b(?:top|first|latest|newest|best)\\s*${COUNT}\\b`, 'i');
const ENTITY_COUNT = new RegExp(`\\b${COUNT}\\s+(?:(?:newest|latest|top|best|popular|most popular|most viewed|most followed|verified|unverified|public)\\s+)*(?:creators?|artists?|brands?|profiles?|users?|influencers?|posts?|videos?|clips?|tracks?|songs?|recordings?)\\b`, 'i');
const FOLLOWER_THRESHOLD = /\b(at least|minimum|more than|over|above|with)\s+([\d,.]+)\s*([km])?\s+followers?\b/i;

interface CreatorFilters {
  verified?: boolean;
  minFollowers?: number;
}

interface SearchOptions extends CreatorFilters {
  sort?: PageQuery['sort'];
}

function requestedSort(text: string, dataset: DatasetId): PageQuery['sort'] | undefined {
  if (dataset === 'listings') {
    if (/\b(?:newest|latest|most recent|recently joined)\b/i.test(text)) return 'newest';
    if (/\b(?:top|most followed|most popular|popular|biggest|highest follower)\b/i.test(text)) return 'followers';
  }
  if (dataset === 'posts') {
    if (/\b(?:top|most viewed|most popular|popular|highest views)\b/i.test(text)) return 'views';
    if (/\b(?:newest|latest|most recent)\b/i.test(text)) return 'newest';
  }
  if (dataset === 'catalog' && /\b(?:alphabetical|by title)\b/i.test(text)) return 'title';
  return undefined;
}

function creatorFiltersFrom(text: string): CreatorFilters {
  const verified = /\bunverified\b/i.test(text) ? false : /\bverified\b/i.test(text) ? true : undefined;
  const match = FOLLOWER_THRESHOLD.exec(text);
  const base = match ? Number(match[2]!.replaceAll(',', '')) : NaN;
  const multiplier = match?.[3]?.toLowerCase() === 'm' ? 1_000_000 : match?.[3]?.toLowerCase() === 'k' ? 1_000 : 1;
  const strict = match && ['more than', 'over', 'above'].includes(match[1]!.toLowerCase()) ? 1 : 0;
  const minFollowers = base * multiplier + strict;
  return {
    ...(verified === undefined ? {} : { verified }),
    ...(Number.isSafeInteger(minFollowers) && minFollowers >= 0 && minFollowers <= 2_147_483_647 ? { minFollowers } : {}),
  };
}

/** Only numbers describing a result count become page sizes. Title numbers remain search terms. */
export function requestedLimit(text: string): number | undefined {
  const word = RANK_COUNT.exec(text)?.[1] ?? ENTITY_COUNT.exec(text)?.[1];
  if (!word) return undefined;
  const count = COUNT_WORDS[word.toLowerCase()] ?? Number(word);
  return Number.isInteger(count) && count >= 1 ? count : undefined;
}

function searchInput(text: string, limit?: number, filters: CreatorFilters = {}, sort?: PageQuery['sort']): string {
  let cleaned = limit === undefined ? text : text
    .replace(RANK_COUNT, ' ')
    .replace(ENTITY_COUNT, ' ')
    .replace(/\b(?:top|first|latest|newest|best|most popular|most followed)\b/gi, ' ');
  if (sort !== undefined) cleaned = cleaned.replace(/\b(?:top|first|latest|newest|best|most viewed|most popular|popular|most followed|highest views|most recent|recently joined|sorted by views|by title|alphabetical)\b/gi, ' ');
  if (filters.minFollowers !== undefined) cleaned = cleaned.replace(FOLLOWER_THRESHOLD, ' ');
  if (filters.verified !== undefined) cleaned = cleaned.replace(/\b(?:unverified|verified)\b/gi, ' ');
  return cleaned;
}

const DATASET_WORDS: Record<DatasetId, string[]> = {
  listings: ['account', 'accounts', 'artist', 'artists', 'brand', 'brands', 'creator', 'creators', 'handle', 'handles', 'influencer', 'influencers', 'listing', 'listings', 'profile', 'profiles', 'user', 'users'],
  posts: ['caption', 'captions', 'clip', 'clips', 'post', 'posts', 'video', 'videos'],
  catalog: ['album', 'albums', 'catalog', 'catalogue', 'isrc', 'music', 'song', 'songs', 'track', 'tracks'],
};

/** Which dataset a sentence names, or null when it does not name one. */
export function datasetFor(text: string): DatasetId | null {
  const lower = text.toLowerCase();
  // Catalog first: "creator" appears in a great many sentences that are really
  // about a song, and "track" almost never appears in one that is not.
  const order: DatasetId[] = ['catalog', 'posts', 'listings'];
  for (const dataset of order) {
    if (DATASET_WORDS[dataset].some((word) => new RegExp(`\\b${word}\\b`).test(lower))) return dataset;
  }
  // "Music & Me by Nate Dogg" names no dataset word, but "X by Y" is how people
  // describe a recording, so it is read as a catalog search.
  if (/\bby\b/.test(lower)) return 'catalog';
  return null;
}

/**
 * The words worth sending as `q`.
 *
 * Filler and the dataset word itself are dropped, so "creators in NG" searches
 * for `NG` and not for the word "creators", and "#amapiano posts" searches for
 * `amapiano`. Returns null when nothing is left, which means "list this
 * dataset" rather than "search for nothing".
 */
export function searchTermFrom(text: string, ignore: readonly string[] = []): string | null {
  const drop = new Set([...FILLER, ...ignore.map((word) => word.toLowerCase())]);
  const words = text
    .toLowerCase()
    .replace(/[“”"']/g, ' ')
    .split(/[\s,]+/)
    .map((word) => word.replace(/^#/, '').replace(/[^a-z0-9&._-]/g, ''))
    .filter(Boolean)
    .filter((word) => !drop.has(word));
  return words.length ? [...new Set(words)].join(' ') : null;
}

export type QueryPlan =
  | { kind: 'search'; dataset: DatasetId; q: string | null; limit?: number; verified?: boolean; minFollowers?: number; sort?: PageQuery['sort']; reason: string }
  | { kind: 'move'; moveId: string };

/**
 * What a sentence should do. Scripted answers are tested first, because "what
 * does each route cost?" must not turn into a search for the words "each
 * route", and a named dataset with a term left over becomes a page of that
 * dataset.
 */
export function planQuery(text: string, options: Move[]): QueryPlan | undefined {
  const query = text.trim();
  if (!query) return undefined;
  const lower = query.toLowerCase();

  if (/(price|cost|how much|terms|licen[cs]e|royalt)/.test(lower)) return { kind: 'move', moveId: 'quote' };
  if (/(wallet|balance|burner|funds)/.test(lower)) return { kind: 'move', moveId: 'wallet' };
  if (/(settle|settlement|liveness|ping|proof)/.test(lower)) return { kind: 'move', moveId: 'ping' };
  if (/(how many|inventory|what.{0,16}(for sale|available|in the catalog)|size of|how big)/.test(lower)) {
    return { kind: 'move', moveId: 'inventory' };
  }
  if (/(how|why|what).*(work|works|x402|protocol)/.test(lower) || /explain/.test(lower)) {
    return { kind: 'move', moveId: 'explain' };
  }

  const dataset = datasetFor(query);
  if (dataset) {
    const limit = requestedLimit(query);
    const filters = dataset === 'listings' ? creatorFiltersFrom(query) : {};
    const sort = requestedSort(query, dataset);
    const term = searchTermFrom(searchInput(query, limit, filters, sort), DATASET_WORDS[dataset]);
    const spec = DATASETS[dataset];
    return term
      ? { kind: 'search', dataset, q: term, ...(limit === undefined ? {} : { limit }), ...filters, ...(sort === undefined ? {} : { sort }), reason: `search ${spec.noun} for “${term}”` }
      : { kind: 'search', dataset, q: null, ...(limit === undefined ? {} : { limit }), ...filters, ...(sort === undefined ? {} : { sort }), reason: `list ${spec.noun}` };
  }

  const byLabel = options.find((move) => lower.includes(move.label.toLowerCase()));
  if (byLabel) return { kind: 'move', moveId: byLabel.id };

  // Anything else with a real word in it is a search over every public account,
  // which is the dataset a visitor usually means by a bare city or name.
  const limit = requestedLimit(query);
  const filters = creatorFiltersFrom(query);
  const term = searchTermFrom(searchInput(query, limit, filters));
  if (term || Object.keys(filters).length) return { kind: 'search', dataset: 'listings', q: term, ...(limit === undefined ? {} : { limit }), ...filters, reason: `search creators for “${term ?? ''}”` };

  const first = options[0];
  return first ? { kind: 'move', moveId: first.id } : undefined;
}

/** A search on one dataset, ready to run and to pay for. */
function searchMove(dataset: DatasetId, q: string | null, label?: string, hint?: string, lead?: string, limit?: number, filters: SearchOptions = {}): Move {
  const spec = DATASETS[dataset];
  const reason = q ? `search ${spec.noun} for “${q}”` : `list ${spec.noun}`;
  return {
    id: `search:${dataset}`,
    label: label ?? (q ? `Search ${spec.noun} for “${q}”` : `List ${spec.noun}`),
    hint: hint ?? `${reason}. One cent per creator credited, and the cursor buys the next page the same way.`,
    group: 'discover',
    run: (ctx, emit) => buy(ctx, emit, { spec, path: withQuery(spec.path, { q, limit, ...filters }), q, ...(lead ? { lead } : {}) }),
  };
}

function unsupportedRanking(text: string): Move | null {
  const requested = requestedLimit(text);
  if (requested !== undefined && requested > 200) {
    return {
      id: 'unsupported-page-size', label: text, group: 'discover',
      async run(_ctx, emit) { emit({ kind: 'error', text: 'A page can return at most 200 rows. Ask for 200 or fewer.' }); return {}; },
    };
  }
  const dataset = datasetFor(text);
  let explanation: string | null = null;
  if (dataset === 'catalog' && /\b(?:top\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)|most popular|most played|trending)\b/i.test(text)) {
    explanation = 'The catalog has no public popularity ranking. You can search tracks by title, artist or ISRC.';
  }
  if (dataset === 'posts' && /\b(?:most liked|most shared|most commented|sort(?:ed)? by likes)\b/i.test(text)) {
    explanation = 'Posts can be ordered by views or newest first. Likes and shares are shown on each row but are not sortable here.';
  }
  if (!explanation) return null;
  return {
    id: 'unsupported-ranking', label: text, group: 'discover',
    async run(_ctx, emit) { emit({ kind: 'error', text: explanation }); return {}; },
  };
}

/**
 * The same planner, but the seller's model reads the sentence first.
 *
 * The browser cannot hold a model key, so the sentence goes to the API's
 * interpreter route and comes back as one call. Everything that route cannot
 * answer falls through to `interpretQuery`, which is the reader this page
 * shipped with. A model that is unavailable, slow or wrong therefore costs the
 * visitor nothing: the chat behaves exactly as it did before.
 */
export async function resolveMove(
  text: string,
  options: Move[],
  history: readonly { role: 'user' | 'agent'; text: string }[] = [],
): Promise<Move | undefined> {
  const unsupported = unsupportedRanking(text);
  if (unsupported) return unsupported;
  const fallback = () => interpretQuery(text, options);
  const local = planQuery(text, options);
  // Plain requests for one named dataset are complete locally. Questions and
  // requests involving several datasets still need the model to choose a call.
  const named = (Object.keys(DATASET_WORDS) as DatasetId[]).filter((dataset) =>
    DATASET_WORDS[dataset].some((word) => new RegExp(`\\b${word}\\b`, 'i').test(text)),
  );
  const needsInterpretation = /\b(?:which|who|why|how|what|can|could|would|should|tell|compare|recommend|similar|like)\b/i.test(text);
  if (!needsInterpretation && local?.kind === 'search' && named.length === 1 && named[0] === local.dataset) return fallback();
  let plan: ChatPlan | null = null;
  try {
    plan = await interpretWithModel({
      message: text,
      moves: options.map((move) => ({ id: move.id, label: move.label, ...(move.hint ? { hint: move.hint } : {}) })),
      history,
    });
  } catch {
    return fallback();
  }
  if (!plan) return fallback();

  const action = plan.action;
  // A model that picks a browse chip or omits the count must not turn a clear
  // "top 3 creators" request into the route's default ten-row page.
  if (action.kind === 'move' && local?.kind === 'search' && (local.limit !== undefined || local.verified !== undefined || local.minFollowers !== undefined || local.sort !== undefined)) {
    return searchMove(local.dataset, local.q, undefined, undefined, undefined, local.limit, local);
  }
  if (action.kind === 'search') {
    const dataset = action.dataset as DatasetId;
    const sameLocal = local?.kind === 'search' && local.dataset === dataset ? local : null;
    const limit = sameLocal?.limit ?? action.limit;
    const filters: SearchOptions = dataset === 'listings'
      ? { ...(action.verified === undefined ? {} : { verified: action.verified }), ...(action.minFollowers === undefined ? {} : { minFollowers: action.minFollowers }),
          ...(sameLocal?.verified === undefined ? {} : { verified: sameLocal.verified }), ...(sameLocal?.minFollowers === undefined ? {} : { minFollowers: sameLocal.minFollowers }) }
      : {};
    filters.sort = sameLocal?.sort ?? action.sort;
    const q = sameLocal && (sameLocal.limit !== undefined || sameLocal.verified !== undefined || sameLocal.minFollowers !== undefined || sameLocal.sort !== undefined)
      ? sameLocal.q
      : action.q;
    return searchMove(dataset, q, undefined, undefined, undefined, limit, filters);
  }
  // The model named one of the moves already on screen. Its own narration is
  // dropped here: every move has a line of its own, and saying both would be
  // the same sentence twice.
  return options.find((move) => move.id === action.moveId) ?? CORE_MOVES.find((move) => move.id === action.moveId) ?? fallback();
}

/**
 * The same planner, resolved against the chips on screen. The composer and the
 * empty-state chips both go through here, so a typed sentence and a clicked
 * chip can never mean two different things.
 */
export function interpretQuery(text: string, options: Move[]): Move | undefined {
  const unsupported = unsupportedRanking(text);
  if (unsupported) return unsupported;
  const plan = planQuery(text, options);
  if (!plan) return undefined;
  if (plan.kind === 'search') return searchMove(plan.dataset, plan.q, undefined, undefined, undefined, plan.limit, plan);
  return options.find((move) => move.id === plan.moveId) ?? CORE_MOVES.find((move) => move.id === plan.moveId);
}

// ── Moves ───────────────────────────────────────────────────────────────────

/** One paid request: which route, and the query string it is bought with. */
interface PaidCall {
  spec: EndpointSpec;
  path: string;
  q?: string | null;
  /** A line the seller's model wrote for this request, when it wrote one. */
  lead?: string;
}

/**
 * Quote, then pay. The invoice is emitted before the signature exists so the
 * user watches the terms arrive first, which is the part of x402 worth
 * understanding.
 */
async function buy(ctx: RunContext, emit: (block: Block) => void, call: PaidCall): Promise<MoveOutcome> {
  const { spec, path } = call;
  const q = call.q ?? null;

  emit({
    kind: 'text',
    text:
      call.lead ??
      (q
        ? `Searching ${spec.noun} for “${q}”.`
        : pick(spec.intro)),
  });

  const stopProbeProgress = stagedProgress(emit, [
    { atMs: 0, label: `Requesting a price for ${spec.title.toLowerCase()}` },
    { atMs: 2500, label: 'Still waiting on the seller' },
  ]);
  const probe = await probeResource(path);
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
      text: `Nothing to pay: this route answered ${probe.status} instead of asking for a payment.`,
    });
    emit({ kind: 'payload', title: spec.title, shape: spec.shape, data: probe.body, endpoint: path });
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
  } else {
    emit({
      kind: 'error',
      text: 'The 402 came back without a readable invoice, so there is nothing to sign.',
      hint: 'That usually means the seller is misconfigured, not that the payment failed.',
    });
    return { lastTrace: probe };
  }

  if (Number(probe.terms.amount) > MAX_ATOMIC_PER_REQUEST) {
    emit({
      kind: 'error',
      text: `This page costs ${formatUsd(probe.terms.amount)}, but this demo build is limited to ${formatUsd(String(MAX_ATOMIC_PER_REQUEST))} per request. Nothing was signed.`,
      hint: 'The demo operator needs to raise the build-time payment limit and redeploy.',
    });
    return { lastTrace: probe, next: nextMoves(ctx, probe) };
  }

  emit({
    kind: 'text',
    text: `Signing a ${assetName} authorization with the demo wallet. The facilitator pays the gas and moves the money.`,
  });

  const stopPayProgress = stagedProgress(emit, [
    { atMs: 0, label: 'Signing the authorization' },
    { atMs: 1200, label: `Settling ${formatUsd(probe.terms.amount)} on ${NETWORKS[ctx.network].label}` },
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
    stopPayProgress();
  }

  return finish(ctx, emit, call, trace);
}

/**
 * How many creators this payment credited. The seller records attribution from
 * the rows it actually served, so this is the number the ledger will show.
 *
 * Posts and catalog rows carry an `attribution.creatorId`, which is the account
 * the cent goes to. For a borrowed sound that is the owner of the audio rather
 * than the account that published the post, and for audio nobody here owns it is
 * null. Reading the id off the label is what keeps the receipt's count equal to
 * the seller's invoice.
 */
function creditedCount(trace: RequestTrace, shape: PayloadShape): number {
  const body = asRecord(trace.body);
  if (!body) return 0;
  if (shape === 'profile') return body.id ? 1 : 0;
  const listings = Array.isArray(body.creators);
  const rows = listings
    ? (body.creators as unknown[])
    : Array.isArray(body.posts)
      ? (body.posts as unknown[])
      : Array.isArray(body.tracks)
        ? (body.tracks as unknown[])
        : [];
  const ids = new Set<string>();
  for (const entry of rows) {
    const row = asRecord(entry);
    if (!row) continue;
    const attribution = asRecord(row.attribution);
    // A listing row is the creator. Every other row says who the credit goes to.
    const credited = typeof attribution?.creatorId === 'string' ? attribution.creatorId : null;
    const ownId = listings && typeof row.id === 'string' ? row.id : null;
    const id = credited ?? ownId;
    if (id) ids.add(id);
  }
  return ids.size;
}

/** Shared tail for every paid call: receipt, payload, commentary. */
function finish(ctx: RunContext, emit: (block: Block) => void, call: PaidCall, trace: RequestTrace): MoveOutcome {
  const { spec } = call;

  /**
   * The seller does not settle an empty page, so there is no receipt and no
   * charge. That is a result, not a failure, and it has to read that way.
   */
  if (trace.status < 400 && !trace.receipt && trace.noChargeReason) {
    emit({
      kind: 'text',
      text: 'This page was served without a charge.',
    });
    emit({ kind: 'payload', title: spec.title, shape: spec.shape, data: trace.body, endpoint: call.path });
    return { lastTrace: trace, next: nextMoves(ctx, trace) };
  }

  if (!trace.ok || !trace.receipt?.success) {
    emit({
      kind: 'error',
      text: trace.error
        ? `The payment did not complete: ${trace.error}`
        : `The seller answered ${trace.status} after the payment, so the data was not served.`,
      hint: trace.error?.includes('per-request limit')
        ? 'The demo operator needs to raise the build-time payment limit and redeploy.'
        : 'The payment status may be unknown. Check the ledger before trying again.',
    });
    return { lastTrace: trace, next: nextMoves(ctx, trace) };
  }

  if (trace.receipt) {
    emit({
      kind: 'receipt',
      receipt: trace.receipt,
      amountAtomic: trace.terms?.amount ?? '0',
      network: ctx.network,
      durationMs: trace.durationMs,
      endpoint: spec.path,
      credited: creditedCount(trace, spec.shape),
    });
  }

  emit({ kind: 'payload', title: spec.title, shape: spec.shape, data: trace.body, endpoint: call.path });

  /**
   * Nothing is said about the rows here. The card carries the count, the cursor
   * and the credit on every row, and the receipt carries the money. A sentence
   * that repeats either of them is the line that makes a chat read as a
   * template, and a page that found nothing was already explained above.
   *
   * The liveness route has no card, so it is the one that still needs a line.
   */
  if (spec.shape === 'ping') {
    emit({
      kind: 'text',
      text: 'The route answers 200 only after the transfer lands, so this is settlement working end to end.',
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
    text: `Buying ${label}'s profile. One cent, and it credits that one creator.`,
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
        text: `${label}'s profile is not available.`,
        hint: 'Either the id does not exist, or the creator revoked agent access and every route drops them.',
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
    { spec: { id: 'ping', path, title: `${label}'s profile`, noun: 'profiles', shape: 'profile', intro: [] }, path },
    trace,
  );

  if (!trace.ok) return outcome;
  return afterProfile(ctx, emit, creator, label, outcome);
}

/**
 * The free ledger read that follows a profile purchase. It answers the question
 * a buyer asks next: what has this creator actually been paid, and how much is
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
      title: 'Creator payout ledger',
      shape: 'ledger',
      // The whole ledger travels, with the creator just bought pinned to the
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
    text: `This route credited ${label} alone, so the whole creator share sits under their name.`,
  });

  return outcome;
}

// ── Move catalogue ──────────────────────────────────────────────────────────

/** What one profile costs. One cent, the same floor as every other request. */
const PROFILE_PRICE = '10000';

const movePing: Move = {
  id: 'ping',
  label: 'Payment gate',
  hint: 'One cent. Proves settlement end to end.',
  group: 'discover',
  run: (ctx, emit) => buy(ctx, emit, { spec: ENDPOINTS.ping, path: ENDPOINTS.ping.path }),
};

const moveListings: Move = {
  id: 'listings',
  label: 'Creator listings',
  hint: 'One cent per creator, ten a page by default.',
  group: 'discover',
  run: (ctx, emit) => buy(ctx, emit, { spec: ENDPOINTS.listings, path: ENDPOINTS.listings.path }),
};

const movePosts: Move = {
  id: 'posts',
  label: 'Public posts',
  hint: 'One cent per creator credited, ten posts a page.',
  group: 'discover',
  run: (ctx, emit) => buy(ctx, emit, { spec: ENDPOINTS.posts, path: ENDPOINTS.posts.path }),
};

const moveCatalog: Move = {
  id: 'catalog',
  label: 'Music catalog',
  hint: 'One cent per creator credited, ten tracks a page.',
  group: 'discover',
  run: (ctx, emit) => buy(ctx, emit, { spec: ENDPOINTS.catalog, path: ENDPOINTS.catalog.path }),
};

/**
 * The free inventory. Reading it is what makes the suggestion chips honest: a
 * chip that names a tag the dataset does not have wastes a payment to find out.
 */
const moveInventory: Move = {
  id: 'inventory',
  label: 'What is for sale',
  hint: 'Free. Counts and the busiest tags, before you pay.',
  group: 'about',
  async run(ctx, emit) {
    emit({
      kind: 'text',
      text: 'Reading the free inventory: how much is there, and what is worth searching for.',
    });
    const stopProgress = stagedProgress(emit, [{ atMs: 0, label: 'Counting public creators, posts and tracks' }]);
    const probe = await probeResource('/api/v1/agent/stats');
    stopProgress();

    if (probe.status !== 200) {
      emit({
        kind: 'error',
        text: probe.status === 0 ? 'The API never answered, so the inventory could not be read.' : `The inventory route answered ${probe.status}.`,
        hint: probe.error ?? 'This route is free, so an error here is an old or misconfigured deployment.',
      });
      return { lastTrace: probe, next: nextMoves(ctx, probe) };
    }

    emit({
      kind: 'payload',
      title: 'Public inventory',
      shape: 'stats',
      data: probe.body,
      endpoint: '/api/v1/agent/stats',
    });
    emit({
      kind: 'text',
      text: 'Those are the totals behind the three paid data routes. A page costs one cent per creator it credits, and a page that matches nothing costs nothing.',
    });
    return { lastTrace: probe, next: nextMoves(ctx, probe) };
  },
};

/** Routes the price list reads. The profile route joins it once a creator is known. */
const QUOTE_ROUTES: { path: string; returns: string }[] = [
  { path: '/api/v1/agent/ping', returns: 'Settlement liveness check' },
  { path: '/api/v1/agent/listings', returns: 'Public creator listings' },
  { path: '/api/v1/agent/posts', returns: 'Public posts, newest first' },
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
      text: 'Reading every price. Looking at a 402 is free, so nothing is signed and nothing is charged.',
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
      const terms = probes[index]?.terms;
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

    const sample = answered[0]!.terms!;
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
  label: 'Demo wallet',
  hint: 'Address, balances, session spend.',
  group: 'wallet',
  async run(ctx, emit) {
    emit({
      kind: 'text',
      text: 'Reading the demo wallet balances from Celo RPC.',
    });
    const profile = NETWORKS[ctx.network];
    if (!/^0x[0-9a-fA-F]{64}$/.test(ctx.burnerKey)) {
      emit({
        kind: 'error',
        text: 'No buyer key is configured for this build.',
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
      title: 'Demo wallet',
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
      text: 'The buyer never needs CELO: the facilitator covers gas on Celo, so a zero native balance is expected here.',
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
    const next = order[(order.indexOf(ctx.network) + 1) % order.length]!;
    ctx.setNetwork(next);
    emit({
      kind: 'text',
      text: `Switched to ${NETWORKS[next].label}. The invoice decides the chain, so nothing else needs reconfiguring.`,
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
        ? `This tab has settled ${formatUsd(String(spent))} so far, across every page you have paid for.`
        : 'Nothing yet. Quotes are free, so only a settled payment moves this number.',
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
        noChargeReason: null,
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
      text: 'Six steps from an unpaid request to settled money.',
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
          'The Celo facilitator verifies the authorization and transfers USDC to the platform wallet, paying the gas.',
          'The seller returns 200 with the data and a payment-response header carrying the transaction hash.',
        ],
        split: 'For paid data, 60% is credited to creators in the ledger and 40% to the platform. Creator payouts are sent later in batches.',
        note: 'A page costs one cent per creator credited. Ten creators cost ten cents. Empty pages are free.',
      },
    });
    return {};
  },
};

/**
 * The seller's published price list, read at most once per session.
 *
 * Cached as a promise rather than a value so two clicks in quick succession
 * share one request. A deployment that does not answer the route resolves to
 * null and the move falls back to the rule written beside it.
 */
let pricingRead: Promise<PricingResponse | null> | null = null;

function readPricing(): Promise<PricingResponse | null> {
  pricingRead ??= fetchPricing();
  return pricingRead;
}

const moveEndpoints: Move = {
  id: 'endpoints',
  label: "What's for sale",
  hint: 'The paid routes and what a page costs.',
  group: 'about',
  async run(_ctx, emit) {
    // Read live where the deployment answers it, so the table cannot drift from
    // what the seller actually charges.
    const pricing = await readPricing();
    emit({
      kind: 'payload',
      title: 'Agent-facing routes',
      shape: 'generic',
      endpoint: 'endpoints',
      data: {
        routes: pricing?.routes ?? [
          { path: '/api/v1/agent/ping', price: '0.01', returns: 'Settlement liveness check' },
          { path: '/api/v1/agent/listings', price: '0.01 each', returns: 'Creator and brand profiles, searchable and paged' },
          { path: '/api/v1/agent/posts', price: '0.01 each', returns: 'Public content: titles, captions, tags, media, engagement' },
          { path: '/api/v1/agent/catalog', price: '0.01 each', returns: 'Music and audio metadata, ISRC, artwork' },
          { path: '/api/v1/agent/creator/:id', price: '0.01', returns: 'One creator or brand profile' },
          { path: '/api/v1/agent/stats', price: 'free', returns: 'How much is behind the paywall' },
          { path: '/api/v1/agent/pricing', price: 'free', returns: 'The price rule, read live' },
          { path: '/api/v1/agent/demo/settlements', price: 'free', returns: 'The public ledger page' },
        ],
        note:
          pricing?.rule.summary ??
          'One cent in USDC per creator credited, one cent minimum per request, so a page that credits 50 creators costs $0.50. Each data route takes ?q=, ?limit= and ?cursor=, and the 402 states the exact amount for the page before anything is signed.',
        asset: pricing ? `${pricing.asset.symbol} on ${pricing.asset.network}` : undefined,
        maximum: pricing ? `${formatUsd(pricing.maximumAtomic)} per request` : undefined,
        free: pricing?.rule.notCharged,
        examples: pricing?.examples,
      },
    });
    emit({
      kind: 'text',
      text: 'The dataset includes public creator profiles, posts and catalogued recordings. A post using another creator’s sound credits the sound owner; each paid row that credits a creator names them.',
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
  hint: 'Repeat the last request, cursor and all.',
  group: 'inspect',
  async run(ctx, emit) {
    const path = ctx.lastTrace?.path;
    if (!path) {
      emit({ kind: 'error', text: 'No previous request to repeat.' });
      return {};
    }
    if (pathnameOf(path).startsWith('/api/v1/agent/creator/')) {
      const id = pathnameOf(path).split('/').pop() ?? '';
      return buyProfile(ctx, emit, { id, username: null, displayName: null });
    }
    const spec = specForPath(path);
    if (!spec) {
      emit({ kind: 'error', text: `No replay handler for ${path}.` });
      return {};
    }
    return buy(ctx, emit, { spec, path, q: queryOf(ctx.lastTrace!) });
  },
};

// ── Availability ────────────────────────────────────────────────────────────

/** The routes a follow-up chip can offer, keyed by the path that identifies them. */
const ROUTE_MOVES: [string, Move][] = [
  [ENDPOINTS.ping.path, movePing],
  [ENDPOINTS.listings.path, moveListings],
  [ENDPOINTS.posts.path, movePosts],
  [ENDPOINTS.catalog.path, moveCatalog],
  ['/api/v1/agent/stats', moveInventory],
];

const CORE_MOVES: Move[] = [
  movePing,
  moveListings,
  movePosts,
  moveCatalog,
  moveInventory,
  moveQuote,
  moveWallet,
  moveSwitch,
  moveSpend,
  moveExplain,
  moveEndpoints,
];

export function initialMoves(): Move[] {
  return [moveListings, movePosts, moveCatalog, moveInventory, moveQuote, moveWallet, moveExplain, moveEndpoints];
}

/** Full catalogue, used when the composer needs to reset to a known set. */
export function allMoves(): Move[] {
  return CORE_MOVES;
}

/**
 * The chips that follow a response.
 *
 * A dataset this size is never one page, so the first chip walks the cursor
 * whenever the seller said there was more. The next chips re-run the same
 * search against the other two datasets, because "amapiano" is a tag on posts
 * and a sound in the catalog, and a buyer who searched one usually wants the
 * other. Profiles come after that, and the remaining routes last.
 */
function nextMoves(ctx: RunContext, trace: RequestTrace): Move[] {
  const moves: Move[] = [];
  const spec = specForPath(trace.path);
  const q = queryOf(trace);
  const page = pageOf(trace);

  /**
   * A query that matched nothing did not cost anything, and offering the same
   * words against the next dataset invites a second search with the same
   * likelihood of an empty page. The chips after an empty result are the ones
   * that know the data: the datasets themselves, the prices, the ledger.
   */
  if (spec && countRows(trace) === 0 && !trace.receipt) {
    for (const [path, move] of ROUTE_MOVES) {
      if (pathnameOf(trace.path) === path) continue;
      moves.push(move);
    }
    moves.push(moveQuote, moveRaw);
    return moves;
  }

  const cursor = page?.hasMore ? page.nextCursor : null;
  if (spec && spec.id !== 'ping' && cursor) {
    const rows = page?.returned ?? DEFAULT_PAGE_ROWS;
    moves.push({
      id: `page:${spec.id}`,
      label: `Next ${rows} ${spec.noun}`,
      hint: `Continue through ${formatCount(page?.total ?? 0)} matching rows. One cent per creator credited on the next page.`,
      group: 'discover',
      run: (innerCtx, emit) =>
        buy(innerCtx, emit, {
          spec,
          path: withQuery(spec.path, { q, cursor, limit: page?.limit, ...searchOptionsOf(trace) }),
          q,
        }),
    });
  }

  if (q && spec && spec.id !== 'ping') {
    for (const dataset of DATASET_ORDER) {
      if (dataset === spec.id) continue;
      const other = DATASETS[dataset];
      moves.push(
        searchMove(
          dataset,
          q,
          `Search ${other.noun} for “${q}”`,
          `The same query against ${other.noun}. One cent per creator credited.`,
        ),
      );
    }
  }

  // A profile purchase is the natural next step, and it is priced differently,
  // so it leads the list when the response named any creators. The one just
  // bought is skipped: offering a creator's profile back to the buyer who paid
  // for it reads like the agent was not paying attention.
  for (const creator of ctx.knownCreators.slice(0, 2)) {
    if (pathnameOf(trace.path) === `/api/v1/agent/creator/${creator.id}`) continue;
    const label = creator.displayName ?? creator.username ?? shortAddress(creator.id, 6);
    moves.push({
      id: `profile:${creator.id}`,
      label: `${label} · profile`,
      hint: `${formatUsd(PROFILE_PRICE)}. Single-creator attribution.`,
      group: 'discover',
      run: (innerCtx, emit) => buyProfile(innerCtx, emit, creator),
    });
  }

  // Then the other routes, so the chips on screen are all things a buyer would
  // actually want next. The route just used, and anything already offered, is
  // left out; the free inventory stays on the list because it is what makes the
  // rest of the prices make sense.
  const justUsed = pathnameOf(trace.path);
  for (const [path, move] of ROUTE_MOVES) {
    if (path === justUsed) continue;
    if (!moves.some((offered) => offered.id === move.id)) moves.push(move);
  }

  moves.push(moveQuote, moveRaw, moveReplay);
  return moves;
}

export function explorerLink(network: NetworkKey, hash: string): string {
  return explorerTx(network, hash);
}

export type { PaymentTerms, SettlementReceipt, RequestTrace };
