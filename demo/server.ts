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
 *   GET  /api/v1/agent/stats          free inventory: how much there is, and what to search
 *   GET  /api/v1/agent/reputation     on-chain ERC-8004 reputation, free to read
 *   GET  /api/v1/agent/*              the paid routes (402 -> sign -> settle -> 200)
 *   GET  /demo/settlements            local settlement ledger for reviewers
 *
 * The paid routes carry the same search and pagination contract as production:
 * `?q=` searches, `?limit=` sizes a page and `?cursor=` walks to the next one.
 * The data behind them is generated at boot to production scale (2,400 creators,
 * 6,000 posts, 5,000 tracks), so the demo exercises the same page sizes and the
 * same "showing 50 of 2,431" summaries a real deployment does.
 *
 * The two well-known documents answer even with X402_ENABLED=false, so a boot
 * check does not need a facilitator key. The MCP endpoint and the reputation
 * read register only when the paid routes exist.
 */
import 'dotenv/config';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { x402HTTPResourceServer, x402ResourceServer, type HTTPProcessResult, type RoutesConfig } from '@x402/core/server';
import { decodePaymentResponseHeader } from '@x402/core/http';
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
import { buildPaidRoutes, examplePath, routePattern, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../src/x402/catalog.js';
import { encodeCursor, readPageQuery, type PageInfo, type PageRequest } from '../src/x402/paging.js';
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

/**
 * The seller's data, in memory.
 *
 * Production holds a couple of thousand accounts and thousands of posts, so
 * this demo holds the same order of magnitude. Three creators and three tracks
 * cannot show what search, cursors and totals are for: every page would be the
 * whole dataset and every search would be a no-op.
 *
 * Everything is generated from a fixed seed, so the demo answers identically on
 * every boot and a reviewer can screenshot a page and reproduce it. The fields
 * mirror what the production routes serve: public profile fields for creators,
 * published public posts, and catalog entries with the creators behind them.
 * Nothing here is private data, because the production equivalent
 * (`src/x402/access.ts` in the API) never serves private accounts,
 * followers-only posts, emails, wallet addresses or KYC state through a paid
 * route.
 */
const CREATOR_COUNT = 2_400;
const POST_COUNT = 6_000;
const TRACK_COUNT = 5_000;

/** mulberry32: a tiny deterministic PRNG, so the dataset is identical every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITIES = [
  'lagos', 'accra', 'nairobi', 'abuja', 'kano', 'ibadan', 'cape', 'dakar', 'kumasi', 'tema',
  'mombasa', 'kampala', 'lusaka', 'maputo', 'kigali', 'daressalaam', 'johannesburg', 'port', 'benin', 'ilorin',
];
const FLAVOURS = [
  'neon', 'golden', 'ivory', 'midnight', 'sunset', 'velvet', 'electric', 'silent', 'crimson', 'azure',
  'iron', 'lunar', 'amber', 'coastal', 'highlife', 'savage', 'royal', 'sonic', 'urban', 'prince',
];
const HANDLES = [
  'prod', 'beats', 'vibes', 'sound', 'wave', 'studio', 'dj', 'vocalist', 'mix', 'tapes',
  'films', 'lens', 'shoots', 'kitchen', 'fashion', 'dance', 'comedy', 'fitness', 'gamer', 'teach',
];
const COUNTRIES = ['NG', 'NG', 'NG', 'NG', 'GH', 'GH', 'KE', 'ZA', 'TZ', 'UG', 'CM', 'CI', 'SN', 'US', 'GB', 'FR', 'CA', 'BR'];
const TAGS = [
  'afrobeats', 'amapiano', 'highlife', 'afropop', 'drill', 'hiphop', 'dancehall', 'gospel',
  'house', 'alte', 'lagos', 'nairobi', 'accra', 'streets', 'studio', 'behindthescenes',
];
const TITLE_WORDS = [
  'night', 'motion', 'sun', 'rain', 'city', 'money', 'love', 'run', 'fire', 'gold',
  'road', 'dream', 'weekend', 'market', 'church', 'street', 'smile', 'hustle', 'rhythm', 'shore',
];

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Recent-ish publish dates, newest first, so a cursor page walks time backwards. */
const NOW = Date.UTC(2026, 0, 31, 12, 0, 0);

function buildDataset(): { creators: CreatorRow[]; posts: PostRow[]; tracks: TrackRow[] } {
  const random = seeded(0x5ea51e);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

  const creators: CreatorRow[] = Array.from({ length: CREATOR_COUNT }, (_, index) => {
    const flavour = pick(FLAVOURS);
    const city = pick(CITIES);
    const handle = `${flavour}.${city}`;
    const suffix = index > 0 ? `.${pad(index, 4)}` : '';
    const country = pick(COUNTRIES);
    return {
      id: `cr_${pad(index, 5)}`,
      username: `${handle}${suffix}`.replace(/[^a-z0-9._]/g, ''),
      displayName: `${flavour[0]!.toUpperCase()}${flavour.slice(1)} ${city[0]!.toUpperCase()}${city.slice(1)}`,
      bio: `${pick(HANDLES)} in ${city[0]!.toUpperCase()}${city.slice(1)}. ${pick(TAGS)} all day.`,
      avatarUrl: null,
      countryCode: country,
      isVerified: random() < 0.08,
      followerCount: Math.floor(random() ** 2.2 * 480_000) + 3,
      followingCount: Math.floor(random() * 900) + 1,
      createdAt: new Date(NOW - Math.floor(random() * 900) * 86_400_000).toISOString(),
    };
  });

  const posts: PostRow[] = Array.from({ length: POST_COUNT }, (_, index) => {
    const creator = creators[Math.floor(random() * creators.length)]!;
    const title = random() < 0.75 ? `${pick(TITLE_WORDS)} ${pick(TITLE_WORDS)}` : null;
    const hashtags = [...new Set(Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(TAGS)))];
    const carousel = random() < 0.15;
    const views = Math.floor(random() ** 2.6 * 900_000);
    return {
      id: `po_${pad(index, 5)}`,
      creatorId: creator.id,
      title,
      description: `${pick(TITLE_WORDS)} in ${pick(CITIES)} #${hashtags[0] ?? 'streets'}`,
      hashtags,
      mediaType: carousel ? 'PHOTO_CAROUSEL' : 'VIDEO',
      mediaCount: carousel ? 2 + Math.floor(random() * 6) : 1,
      durationSeconds: carousel ? 0 : 6 + Math.floor(random() * 90),
      aspectRatio: '9:16',
      thumbnailUrl: null,
      videoUrl: null,
      viewCount: views,
      likeCount: Math.floor(views * (0.02 + random() * 0.08)),
      commentCount: Math.floor(views * 0.004),
      shareCount: Math.floor(views * 0.001),
      repostCount: Math.floor(views * 0.0007),
      isAiGenerated: random() < 0.05,
      isLivestreamVod: random() < 0.04,
      createdAt: new Date(NOW - Math.floor(random() ** 1.6 * 420) * 86_400_000 - Math.floor(random() * 86_400_000)).toISOString(),
    };
  });

  // The three curated tracks stay first so the README's walkthrough and the
  // checked-in demo screenshots still resolve, and so a reviewer who searches a
  // known title finds it in a catalog of five thousand.
  const curated: TrackRow[] = [
    { id: 'tr_00001', title: 'Lagos Nights', artist: 'Ada', isrc: 'NGAAA2600001', coverUrl: null, previewUrl: null, creatorIds: [creators[0]!.id] },
    { id: 'tr_00002', title: 'Accra Motion', artist: 'Kwame', isrc: 'GHAAA2600002', coverUrl: null, previewUrl: null, creatorIds: [creators[1]!.id] },
    { id: 'tr_00003', title: 'Cape Town Sun', artist: 'Zola', isrc: 'ZAAAA2600003', coverUrl: null, previewUrl: null, creatorIds: [creators[2]!.id, creators[0]!.id] },
  ];
  const tracks: TrackRow[] = [
    ...curated,
    ...Array.from({ length: TRACK_COUNT - curated.length }, (_, index) => {
      const creator = creators[Math.floor(random() * creators.length)]!;
      const title = `${pick(TITLE_WORDS)} ${pick(TITLE_WORDS)}`;
      return {
        id: `tr_${pad(index + curated.length + 1, 5)}`,
        title: `${title[0]!.toUpperCase()}${title.slice(1)}`,
        artist: creator.displayName,
        isrc: `${pick(COUNTRIES)}AAA26${pad(index, 5)}`,
        coverUrl: null,
        previewUrl: null,
        creatorIds: [creator.id],
      };
    }),
  ];

  return { creators, posts, tracks };
}

interface CreatorRow {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  countryCode: string;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  createdAt: string;
}

interface PostRow {
  id: string;
  creatorId: string;
  title: string | null;
  description: string;
  hashtags: string[];
  mediaType: 'VIDEO' | 'PHOTO_CAROUSEL';
  mediaCount: number;
  durationSeconds: number;
  aspectRatio: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  repostCount: number;
  isAiGenerated: boolean;
  isLivestreamVod: boolean;
  createdAt: string;
}

interface TrackRow {
  id: string;
  title: string;
  artist: string;
  isrc: string;
  coverUrl: string | null;
  previewUrl: string | null;
  creatorIds: string[];
}

const { creators: CREATORS, posts: POSTS, tracks: TRACKS } = buildDataset();
const CREATOR_BY_ID = new Map(CREATORS.map((creator) => [creator.id, creator]));

// ── Search and pagination, the same contract the production API serves ─────

const contains = (haystack: string | null | undefined, needle: string): boolean =>
  (haystack ?? '').toLowerCase().includes(needle);

const isCountryCode = (value: string): boolean => /^[A-Za-z]{2}$/.test(value.trim());

/**
 * The same token search the production API runs, in memory. A chat box sends a
 * sentence rather than a keyword, so every token has to match some field:
 * "music & me by nate dogg" is six tokens, and the track matches because its
 * title carries three of them and its credited creator the other two.
 */
const STOP_TOKENS = new Set(['&', 'by', 'the', 'a', 'an', 'of', 'in', 'on', 'and', 'or']);

function searchTokens(q: string | null): string[] {
  if (!q) return [];
  const tokens = q
    .toLowerCase()
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !STOP_TOKENS.has(token));
  return [...new Set(tokens)].slice(0, 6);
}

/** True when every token matches at least one of the fields offered. */
function matchesAllTokens(tokens: string[], fields: (string | null | undefined)[]): boolean {
  return tokens.every((token) => fields.some((field) => contains(field, token)));
}

/** `after` is the keyset test: true when a row sorts behind the cursor row. */
function pageOf<T extends { id: string }>(
  rows: T[],
  page: PageRequest,
  after: (row: T, cursor: Record<string, string>) => boolean,
  cursorFor: (row: T) => Record<string, string>,
): { rows: T[]; info: PageInfo } {
  const ordered = page.cursor ? rows.filter((row) => after(row, page.cursor!)) : rows;
  const visible = ordered.slice(0, page.limit);
  const last = visible[visible.length - 1];
  const hasMore = ordered.length > page.limit;
  return {
    rows: visible,
    info: {
      total: rows.length,
      limit: page.limit,
      returned: visible.length,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(cursorFor(last)) : null,
      truncated: rows.length > visible.length,
    },
  };
}

function searchCreators(q: string | null): CreatorRow[] {
  const tokens = searchTokens(q);
  const code = q && isCountryCode(q) ? q.trim().toUpperCase() : null;
  const matched = tokens.length
    ? CREATORS.filter((creator) => {
        const fields = [creator.username, creator.displayName, creator.bio];
        if (tokens.length === 1 && code) return creator.countryCode === code || matchesAllTokens(tokens, fields);
        return matchesAllTokens(tokens, fields);
      })
    : [...CREATORS];
  return matched.sort((left, right) => right.followerCount - left.followerCount || left.id.localeCompare(right.id));
}

function searchPosts(q: string | null): PostRow[] {
  const tokens = searchTokens(q);
  const matched = tokens.length
    ? POSTS.filter((post) => matchesAllTokens(tokens, [post.title, post.description, post.hashtags.join(' ')]))
    : [...POSTS];
  return matched.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

function searchTracks(q: string | null): TrackRow[] {
  const tokens = searchTokens(q);
  const matched = tokens.length
    ? TRACKS.filter((track) => matchesAllTokens(tokens, [track.title, track.artist, track.isrc]))
    : [...TRACKS];
  return matched.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

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
      // The buyer's authorization stays valid for two minutes. Settlement is
      // the facilitator paying gas, and a busy Celo block has pushed that past
      // one minute; an authorization that expires mid-settlement comes back as
      // a 402 the buyer cannot act on.
      accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: X402_PAY_TO!, price: { amount: route.priceAtomic, asset: X402_ASSET_ADDRESS, extra: X402_ASSET_EXTRA }, maxTimeoutSeconds: 120 }],
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

/**
 * Lifts a failed settlement reason out of the payment-response header.
 *
 * x402 reports a rejected settlement there and leaves the body empty, so a
 * client that reads only the status sees an opaque 402. Passing the reason
 * through the body is the difference between "it failed" and knowing the
 * facilitator account needs credits.
 */
function failureReasonFromHeaders(headers: Record<string, unknown> | undefined): string | null {
  const key = Object.keys(headers ?? {}).find((name) => name.toLowerCase() === 'payment-response');
  const value = key ? headers?.[key] : undefined;
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' || !text) return null;
  try {
    const decoded = decodePaymentResponseHeader(text) as { success?: boolean; errorReason?: string };
    return decoded?.success === false ? decoded.errorReason ?? 'The payment was rejected' : null;
  } catch {
    return null;
  }
}

function pathOf(request: { url: string }): string {
  return new URL(request.url, 'http://demo.local').pathname;
}

/**
 * The data routes: free inventory plus the paid pages.
 *
 * Registered even when payments are switched off, where they answer unpaid.
 * That is deliberate. It lets a reviewer without a facilitator key read the
 * search and pagination contract: the totals, the cursors, the page sizes the
 * production API uses. The bundled web demo detects the missing invoice
 * and says so instead of pretending a payment happened. With X402_ENABLED=true
 * the payment hook below gates every one of these routes.
 */
function registerDataRoutes(app: FastifyInstance): void {
  /**
   * Free inventory: how much there is to buy and what is worth searching for.
   * A buyer deciding whether a page is worth a cent needs this before paying,
   * so it is not behind the paywall. Aggregate counts only, nothing identifying.
   */
  app.get('/api/v1/agent/stats', async (_request, reply) => {
    const countries = new Map<string, number>();
    for (const creator of CREATORS) countries.set(creator.countryCode, (countries.get(creator.countryCode) ?? 0) + 1);
    const tags = new Map<string, number>();
    for (const post of POSTS) for (const tag of post.hashtags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    // Field names match the production route exactly, so the web demo does not
    // need to know which server it is talking to.
    const top = (entries: Iterable<[string, number]>, key: string, countKey: string) =>
      [...entries]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 12)
        .map(([value, count]) => ({ [key]: value, [countKey]: count }));
    reply.header('cache-control', 'public, max-age=60');
    return {
      totals: { creators: CREATORS.length, posts: POSTS.length, tracks: TRACKS.length, countries: countries.size },
      top: { countries: top(countries, 'code', 'creators'), hashtags: top(tags, 'tag', 'posts') },
      sample: { hashtagsFromPosts: POSTS.length },
      generatedAt: new Date().toISOString(),
    };
  });

  /**
   * Creator listings. `?q=` searches username, display name, bio and country
   * code; `?limit=` and `?cursor=` page through the result. The response always
   * names the total that matched, so a buyer can see the size of the dataset
   * without paying for every page.
   */
  app.get('/api/v1/agent/listings', async (request, reply) => {
    const parsed = readPageQuery(request.query, { defaultLimit: DEFAULT_PAGE_LIMIT, maxLimit: MAX_PAGE_LIMIT });
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error, code: 'invalid_query' });
    const page = parsed.page;

    const { rows: creators, info } = pageOf(
      searchCreators(page.q),
      page,
      (row, cursor) =>
        row.followerCount < Number(cursor.followerCount) ||
        (row.followerCount === Number(cursor.followerCount) && row.id > cursor.id),
      (row) => ({ followerCount: String(row.followerCount), id: row.id }),
    );
    if (info.total > 0 && info.returned === 0) {
      return reply.status(400).send({ error: 'cursor is not a cursor this API issued', code: 'invalid_query' });
    }
    // Attribution follows what was served: the creators on this page.
    request.x402CreatorIds = creators.map((creator) => creator.id);
    return { creators, page: info, query: { q: page.q, limit: page.limit } };
  });

  /** Public posts, newest first, searchable by caption, description or tag. */
  app.get('/api/v1/agent/posts', async (request, reply) => {
    const parsed = readPageQuery(request.query, { defaultLimit: DEFAULT_PAGE_LIMIT, maxLimit: MAX_PAGE_LIMIT });
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error, code: 'invalid_query' });
    const page = parsed.page;

    const { rows: posts, info } = pageOf(
      searchPosts(page.q),
      page,
      (row, cursor) => row.createdAt < cursor.createdAt! || (row.createdAt === cursor.createdAt && row.id > cursor.id),
      (row) => ({ createdAt: row.createdAt, id: row.id }),
    );
    request.x402CreatorIds = [...new Set(posts.map((post) => post.creatorId))];
    return { posts, page: info, query: { q: page.q, limit: page.limit } };
  });

  /** Music catalog, title A-Z, searchable by title, creator or ISRC. */
  app.get('/api/v1/agent/catalog', async (request, reply) => {
    const parsed = readPageQuery(request.query, { defaultLimit: DEFAULT_PAGE_LIMIT, maxLimit: MAX_PAGE_LIMIT });
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error, code: 'invalid_query' });
    const page = parsed.page;

    const { rows: tracks, info } = pageOf(
      searchTracks(page.q),
      page,
      (row, cursor) => row.title > cursor.title! || (row.title === cursor.title && row.id > cursor.id),
      (row) => ({ title: row.title, id: row.id }),
    );
    request.x402CreatorIds = [...new Set(tracks.flatMap((track) => track.creatorIds))];
    return { tracks, page: info, query: { q: page.q, limit: page.limit } };
  });

  /**
   * One public creator profile by id, with the size of their public body of
   * work, so an agent that already knows the id pays for one profile instead of a
   * full listings page.
   */
  app.get('/api/v1/agent/creator/:id', async (request, reply) => {
    const creator = CREATOR_BY_ID.get((request.params as { id: string }).id);
    if (!creator) return reply.status(404).send({ error: 'Creator not found' });
    const posts = POSTS.filter((post) => post.creatorId === creator.id);
    request.x402CreatorIds = [creator.id];
    return {
      ...creator,
      stats: {
        publishedVideos: posts.length,
        catalogTracks: TRACKS.filter((track) => track.creatorIds.includes(creator.id)).length,
        agentAccess: 'public',
      },
    };
  });
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
          const creator = CREATOR_BY_ID.get(share.creatorId);
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
    // The dataset holds thousands of creators, so this card shows the ones the
    // ledger actually mentions. Before the first sale it shows the three
    // biggest accounts instead of an empty table.
    const listed = earned.size
      ? [...earned.keys()].map((id) => CREATOR_BY_ID.get(id)).filter((creator): creator is CreatorRow => Boolean(creator))
      : [...CREATORS].sort((left, right) => right.followerCount - left.followerCount).slice(0, 3);
    const creators = listed.map((creator) => {
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
        agentAccess: 'public' as const,
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


  registerDataRoutes(app);

  app.get('/api/v1/agent/ping', async () => ({ ok: true, paid: X402_ENABLED, network: X402_NETWORK, asset: X402_ASSET_ADDRESS, assetSymbol: X402_ASSET_SYMBOL }));

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

  if (!X402_ENABLED) {
    app.log.warn('X402_ENABLED=false: the data routes answer unpaid. Set X402_ENABLED=true with X402_API_KEY and X402_PAY_TO to charge for them.');
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
      const body = result.response.body;
      const empty = !body || (typeof body === 'object' && Object.keys(body as Record<string, unknown>).length === 0);
      const reason = empty ? failureReasonFromHeaders(result.response.headers as Record<string, unknown> | undefined) : null;
      reply.code(result.response.status).send(reason ? { error: 'payment_failed', reason } : body ?? {});
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
      const reason = failureReasonFromHeaders(settled.headers as Record<string, unknown> | undefined);
      if (reason) {
        reply.header('content-type', 'application/json');
        return JSON.stringify({ error: 'payment_failed', reason });
      }
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

  await app.listen({ port, host });
  app.log.info({ port, network: X402_NETWORK, asset: X402_ASSET_SYMBOL, payTo: X402_PAY_TO }, 'Streamlivr x402 demo seller ready');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
