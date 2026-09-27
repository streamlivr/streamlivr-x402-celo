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
 *   GET  /api/v1/agent/pricing        free price list: the rule, the asset, worked examples
 *   POST /api/v1/agent/chat/interpret free: turns a visitor sentence into one API call
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
import {
  x402HTTPResourceServer,
  x402ResourceServer,
  type HTTPProcessResult,
  type HTTPRequestContext,
  type RoutesConfig,
} from '@x402/core/server';
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
import {
  buildPaidRoutes,
  noChargePage,
  examplePath,
  routePattern,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from '../src/x402/catalog.js';
import { encodeCursor, readPageQuery, type PageInfo, type PageRequest } from '../src/x402/paging.js';
import { MAX_REQUEST_PRICE_ATOMIC, PRICE_EXAMPLES, PRICE_RULE, creatorsPaidFor, priceForCreatorCount } from '../src/x402/pricing.js';
import {
  creditedCreatorIds,
  normalizeArtistName,
  resolvePostOwnership,
  resolveTrackOwnership,
  type OwnershipLookup,
  type PostAudioFacts,
  type RowOwnership,
} from '../src/x402/ownership.js';
import {
  createChatBudget,
  MAX_CHAT_MESSAGE_CHARS,
  planChatMessage,
  type ChatMoveOption,
} from '../src/x402/chatIntent.js';
import { buildAgentCard, buildMcpServerCard, currentDiscoveryContext } from '../src/x402/discovery.js';
import { createMcpHandler } from '../src/x402/mcp.js';
import { readReputation } from '../src/x402/reputation.js';
import { calculateAttributionShares, CREATOR_SHARE_BPS, PLATFORM_SHARE_BPS } from '../src/x402/split.js';
import {
  asCountryCode,
  searchReadings,
  CREATOR_QUERY_WORDS,
  POST_QUERY_WORDS,
  TRACK_QUERY_WORDS,
} from '../src/x402/access.js';

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
    // Most posts carry the publisher's own audio, some borrow another
    // creator's sound, and a few sit on a commercial recording that nobody
    // here owns. The split is deliberate: it keeps all three attribution
    // outcomes visible on any page a visitor happens to open.
    const audioRoll = random();
    const audioKind: PostRow['audioKind'] = audioRoll < 0.72 ? 'original' : audioRoll < 0.93 ? 'borrowed' : 'commercial';
    const soundOwner = audioKind === 'borrowed' ? creators[Math.floor(random() * creators.length)]! : creator;
    // A post with no creator sound can still fingerprint a commercial
    // recording. Half of those name an artist who has a Streamlivr account and
    // half name one who does not, so the page shows both outcomes: an artist
    // credited through their account, and an amount the platform retains.
    const detectedTrack =
      audioKind !== 'commercial'
        ? null
        : random() < 0.5
          ? { isrc: `ZZDET26${pad(index, 5)}`, artist: creators[Math.floor(random() * creators.length)]!.displayName }
          : { isrc: `ZZDET26${pad(index, 5)}`, artist: `${pick(TITLE_WORDS)} ${pick(['Collective', 'Records', 'Sound'])}` };
    return {
      id: `po_${pad(index, 5)}`,
      creatorId: creator.id,
      audioKind,
      audioOwnerId: audioKind === 'commercial' ? null : soundOwner.id,
      soundTitle: audioKind === 'commercial' ? null : `${pick(TITLE_WORDS)} (sound)`,
      detectedTrack,
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
    // Two of these are owned by a creator on the platform and one is a
    // commercial recording with no owner here, so the catalog shows both
    // outcomes without a reviewer having to hunt for them.
    { id: 'tr_00001', title: 'Lagos Nights', artist: creators[0]!.displayName, isrc: 'NGAAA2600001', coverUrl: null, previewUrl: null, ownerId: creators[0]!.id, usedInPublicPosts: 12 },
    { id: 'tr_00002', title: 'Accra Motion', artist: creators[1]!.displayName, isrc: 'GHAAA2600002', coverUrl: null, previewUrl: null, ownerId: creators[1]!.id, usedInPublicPosts: 7 },
    { id: 'tr_00003', title: 'Cape Town Sun', artist: 'Sunset Collective', isrc: 'ZAAAA2600003', coverUrl: null, previewUrl: null, ownerId: null, usedInPublicPosts: 4 },
  ];
  const tracks: TrackRow[] = [
    ...curated,
    ...Array.from({ length: TRACK_COUNT - curated.length }, (_, index) => {
      const creator = creators[Math.floor(random() * creators.length)]!;
      const title = `${pick(TITLE_WORDS)} ${pick(TITLE_WORDS)}`;
      const owned = random() < 0.68;
      return {
        id: `tr_${pad(index + curated.length + 1, 5)}`,
        title: `${title[0]!.toUpperCase()}${title.slice(1)}`,
        artist: owned ? creator.displayName : `${pick(TITLE_WORDS)} ${pick(['Collective', 'Records', 'Sound'])}`,
        isrc: `${pick(COUNTRIES)}AAA26${pad(index, 5)}`,
        coverUrl: null,
        previewUrl: null,
        ownerId: owned ? creator.id : null,
        usedInPublicPosts: Math.floor(random() ** 2 * 40),
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
  /**
   * Whose audio this post carries.
   *
   * `original` is the publisher's own recording, `borrowed` is another
   * creator's sound (the sound's owner is paid, not the poster), and
   * `commercial` is audio nobody on Streamlivr owns, which the platform keeps.
   */
  audioKind: 'original' | 'borrowed' | 'commercial';
  /** The Streamlivr account that owns the audio, or null for commercial audio. */
  audioOwnerId: string | null;
  soundTitle: string | null;
  /**
   * A commercial recording the fingerprint detector heard in the post, when the
   * post has no creator sound of its own. The artist is credited only if that
   * artist has a Streamlivr account.
   */
  detectedTrack: { isrc: string; artist: string } | null;
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
  /**
   * The Streamlivr account that owns the recording, or null when nobody here
   * does. Owning is not the same as using: a track is credited to whoever made
   * it, never to the creators whose posts picked it up.
   */
  ownerId: string | null;
  /** Public posts that draw on the track. Usage data, shown as a label. */
  usedInPublicPosts: number;
}

const { creators: CREATORS, posts: POSTS, tracks: TRACKS } = buildDataset();
const CREATOR_BY_ID = new Map(CREATORS.map((creator) => [creator.id, creator]));

/**
 * Who owns what, resolved once at boot.
 *
 * Production resolves the same two maps from the database: a recording code to
 * the account whose original audio carries it, and a normalised artist name to
 * an account. The rule they feed is in `src/x402/ownership.ts` and is shared
 * with the production API, so this file cannot drift from it.
 */
const OWNERSHIP_LOOKUP: OwnershipLookup = {
  soundAuthorByIsrc: new Map(
    TRACKS.filter((track) => track.ownerId && track.isrc).map((track) => [track.isrc, track.ownerId as string]),
  ),
  // The first account named wins, so a duplicate display name cannot silently
  // move a payment to whichever record was loaded last.
  userByArtist: new Map(CREATORS.map((creator) => [normalizeArtistName(creator.displayName), creator.id])),
};

/** The audio facts on a post, in the shape the ownership rule reads. */
function postAudioFacts(post: PostRow): PostAudioFacts {
  return {
    authorId: post.creatorId,
    soundAuthorId:
      post.audioKind === 'borrowed' ? post.audioOwnerId : post.audioKind === 'original' ? post.creatorId : null,
    soundIsCommercial: false,
    soundIsrc: null,
    pickedTrack: null,
    detectedTrack: post.detectedTrack,
  };
}

/** What a post's audio pays, and the label the row carries. */
function postAttribution(post: PostRow): RowOwnership {
  return resolvePostOwnership(postAudioFacts(post), OWNERSHIP_LOOKUP);
}

/** What a track pays, and the label the row carries. */
function trackAttribution(track: TrackRow): RowOwnership {
  return resolveTrackOwnership({ isrc: track.isrc, artist: track.artist }, OWNERSHIP_LOOKUP);
}

/**
 * The label a post carries in the response.
 *
 * Fields match the production route exactly (`audio.ownership`,
 * `audio.ownerDisplayName`, `attribution.basis`, `attribution.note`), so the
 * demo page and the production page render the same row from the same keys.
 */
function labelPost(post: PostRow): PublicPostRow {
  const attribution = postAttribution(post);
  const owner = attribution.creatorId ? CREATOR_BY_ID.get(attribution.creatorId) : undefined;
  const borrowed = Boolean(attribution.creatorId) && attribution.creatorId !== post.creatorId;
  const ownership =
    attribution.basis === 'commercial-audio' || attribution.basis === 'unattributable'
      ? 'commercial'
      : borrowed
        ? 'borrowed'
        : 'original';
  const { audioKind: _audioKind, detectedTrack: _detectedTrack, ...rest } = post;
  return {
    ...rest,
    attribution,
    audio: {
      ownership,
      soundTitle: post.soundTitle,
      ownerUsername: owner?.username ?? null,
      ownerDisplayName: owner?.displayName ?? null,
      creditedToAnotherCreator: borrowed,
    },
  };
}

/** The label a catalog row carries in the response. */
function labelTrack(track: TrackRow): PublicTrackRow {
  const attribution = trackAttribution(track);
  const owner = attribution.creatorId ? CREATOR_BY_ID.get(attribution.creatorId) : undefined;
  return {
    ...track,
    attribution,
    label: {
      ownership: attribution.creatorId ? 'creator' : 'commercial',
      usedInPublicPosts: track.usedInPublicPosts,
      ownerUsername: owner?.username ?? null,
      ownerDisplayName: owner?.displayName ?? null,
      ownerAvatarUrl: owner?.avatarUrl ?? null,
      isVerified: owner?.isVerified ?? false,
    },
  };
}

/** A post as the API serves it: public fields plus the two ownership labels. */
type PublicPostRow = Omit<PostRow, 'audioKind' | 'detectedTrack'> & {
  audio: {
    ownership: 'original' | 'borrowed' | 'commercial';
    soundTitle: string | null;
    ownerUsername: string | null;
    ownerDisplayName: string | null;
    creditedToAnotherCreator: boolean;
  };
  attribution: RowOwnership;
};

/** A catalog row as the API serves it. */
type PublicTrackRow = TrackRow & {
  attribution: RowOwnership;
  label: {
    ownership: 'creator' | 'commercial';
    usedInPublicPosts: number;
    ownerUsername: string | null;
    ownerDisplayName: string | null;
    ownerAvatarUrl: string | null;
    isVerified: boolean;
  };
};

// ── Search and pagination, the same contract the production API serves ─────

const contains = (haystack: string | null | undefined, needle: string): boolean =>
  (haystack ?? '').toLowerCase().includes(needle);

/**
 * The same search the production API runs, in memory.
 *
 * `searchReadings` comes straight from the paid-route module rather than being
 * re-implemented, so a query that widens against the real database widens here
 * too. A chat box sends a sentence: "creators in Nigeria" drops "creators" and
 * "in", resolves the country name, and "lagos producer" still narrows.
 */
function searchBy<T>(
  q: string | null,
  words: ReadonlySet<string>,
  rows: T[],
  fieldsOf: (row: T) => (string | null | undefined)[],
  extra?: (row: T, token: string) => boolean,
): T[] {
  for (const reading of searchReadings(q, words)) {
    const tokens = reading.tokens;
    // No tokens means no filter: the caller asked for the whole shelf.
    if (tokens.length === 0) return rows;
    const hit = (row: T) => {
      const fields = fieldsOf(row);
      const matches = (token: string) => fields.some((field) => contains(field, token)) || Boolean(extra?.(row, token));
      return reading.match === 'any' ? tokens.some(matches) : tokens.every(matches);
    };
    const matched = rows.filter(hit);
    if (matched.length > 0) return matched;
  }
  return [];
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
      truncated: hasMore,
    },
  };
}

/** A creator answers to a country name as well as to the code stored on the row. */
const creatorCountryHit = (creator: CreatorRow, token: string): boolean =>
  asCountryCode(token) === (creator.countryCode ?? null);

/**
 * A creator also answers to the tags behind their posts, which is what keeps
 * the demo's own suggestion chips honest: a chip built from a real tag has to
 * reach the accounts behind that tag.
 */
const creatorTagHit = (creator: CreatorRow, token: string): boolean =>
  POSTS.some((post) => post.creatorId === creator.id && post.hashtags.some((tag) => contains(tag, token)));

function searchCreators(q: string | null): CreatorRow[] {
  const matched = searchBy(
    q,
    CREATOR_QUERY_WORDS,
    CREATORS,
    (creator) => [creator.username, creator.displayName, creator.bio, creator.countryCode],
    (creator, token) => creatorCountryHit(creator, token) || creatorTagHit(creator, token),
  );
  return [...matched].sort(
    (left, right) => right.followerCount - left.followerCount || left.id.localeCompare(right.id),
  );
}

function searchPosts(q: string | null): PostRow[] {
  const matched = searchBy(q, POST_QUERY_WORDS, POSTS, (post) => [
    post.title,
    post.description,
    post.hashtags.join(' '),
  ]);
  return [...matched].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
  );
}

function searchTracks(q: string | null): TrackRow[] {
  const matched = searchBy(q, TRACK_QUERY_WORDS, TRACKS, (track) => [track.title, track.artist, track.isrc]);
  return [...matched].sort(
    (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
  );
}

/**
 * One page per route, resolved in one place.
 *
 * The price hook and the route handler both read a page through these, so the
 * invoice and the rows it pays for cannot disagree. Production does the same
 * thing in `src/x402/pagePlan.ts`, with a cache in front because its rows come
 * from a database; this dataset is in memory and deterministic, so resolving it
 * twice is not just cheap, it is guaranteed to answer identically.
 */
function creatorPage(page: PageRequest): { rows: CreatorRow[]; info: PageInfo } {
  return pageOf(
    searchCreators(page.q),
    page,
    (row, cursor) =>
      row.followerCount < Number(cursor.followerCount) ||
      (row.followerCount === Number(cursor.followerCount) && row.id > cursor.id),
    (row) => ({ followerCount: String(row.followerCount), id: row.id }),
  );
}

function postPage(page: PageRequest): { rows: PostRow[]; info: PageInfo } {
  return pageOf(
    searchPosts(page.q),
    page,
    (row, cursor) => row.createdAt < cursor.createdAt! || (row.createdAt === cursor.createdAt && row.id > cursor.id),
    (row) => ({ createdAt: row.createdAt, id: row.id }),
  );
}

function trackPage(page: PageRequest): { rows: TrackRow[]; info: PageInfo } {
  return pageOf(
    searchTracks(page.q),
    page,
    (row, cursor) => row.title > cursor.title! || (row.title === cursor.title && row.id > cursor.id),
    (row) => ({ title: row.title, id: row.id }),
  );
}

/** The creators a page credits, which is what the invoice is built from. */
function creditedCreators(path: string, page: PageRequest): string[] {
  if (path === '/api/v1/agent/listings') return creatorPage(page).rows.map((row) => row.id);
  if (path === '/api/v1/agent/posts') return creditedCreatorIds(postPage(page).rows.map(postAttribution));
  return creditedCreatorIds(trackPage(page).rows.map(trackAttribution));
}

/**
 * What a request costs, resolved from the page it would return. An amount on a
 * data route is one cent per creator credited, with a one cent floor, so an
 * empty search quotes the floor and is then served without settling.
 */
function quotedAmount(path: string, query: unknown): string {
  const parsed = readPageQuery(query, { defaultLimit: DEFAULT_PAGE_LIMIT, maxLimit: MAX_PAGE_LIMIT });
  if (!parsed.ok) return priceForCreatorCount(0);
  return priceForCreatorCount(creditedCreators(path, parsed.page).length);
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
      // A data route is priced per creator credited, so the amount comes from
      // the page the request would return rather than from a fixed number.
      accepts: [
        {
          scheme: 'exact',
          network: X402_NETWORK,
          payTo: X402_PAY_TO!,
          price: route.queryParams
            ? (context: HTTPRequestContext) => ({
                amount: quotedAmount(route.path, context.adapter.getQueryParams?.() ?? {}),
                asset: X402_ASSET_ADDRESS,
                extra: X402_ASSET_EXTRA,
              })
            : { amount: route.priceAtomic, asset: X402_ASSET_ADDRESS, extra: X402_ASSET_EXTRA },
        },
      ],
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
  /** Creators the invoice paid for, one cent each. */
  creatorsBilled: number;
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
   * The price list, free to read.
   *
   * Reading a price should never cost anything, and a buyer should not have to
   * discover the rule by paying it. This states the rule, the asset, the
   * network and worked examples. The invoice itself is always the authority:
   * the 402 for a specific page carries the exact amount for that page.
   */
  app.get('/api/v1/agent/pricing', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return {
      asset: {
        symbol: X402_ASSET_SYMBOL,
        address: X402_ASSET_ADDRESS,
        decimals: X402_ASSET_DECIMALS,
        network: X402_NETWORK,
        chainId: X402_CHAIN_ID,
      },
      payTo: X402_PAY_TO ?? null,
      rule: PRICE_RULE,
      maximumAtomic: MAX_REQUEST_PRICE_ATOMIC,
      routes: paidRoutes.map((route) => ({
        path: route.path,
        serviceName: route.serviceName,
        title: route.title,
        billedPer: route.queryParams ? 'creator credited' : 'request',
        minimumAtomic: route.priceAtomic,
        maximumAtomic: route.queryParams ? MAX_REQUEST_PRICE_ATOMIC : route.priceAtomic,
      })),
      examples: PRICE_EXAMPLES,
      note: 'GET /api/v1/agent/<route> states the exact amount in the 402 before anything is signed. Reading an invoice and reading this page are both free.',
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

    const { rows: creators, info } = creatorPage(page);
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

    const { rows: posts, info } = postPage(page);
    // Attribution follows the audio, not the account that published the post.
    // A borrowed sound pays its owner and an unowned recording pays nobody, so
    // the credited list is read off the labelled rows rather than off creatorId.
    const labelled = posts.map(labelPost);
    request.x402CreatorIds = creditedCreatorIds(labelled.map((post) => post.attribution));
    return { posts: labelled, page: info, query: { q: page.q, limit: page.limit } };
  });

  /** Music catalog, title A-Z, searchable by title, creator or ISRC. */
  app.get('/api/v1/agent/catalog', async (request, reply) => {
    const parsed = readPageQuery(request.query, { defaultLimit: DEFAULT_PAGE_LIMIT, maxLimit: MAX_PAGE_LIMIT });
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error, code: 'invalid_query' });
    const page = parsed.page;

    const { rows: tracks, info } = trackPage(page);
    const labelled = tracks.map(labelTrack);
    request.x402CreatorIds = creditedCreatorIds(labelled.map((track) => track.attribution));
    return { tracks: labelled, page: info, query: { q: page.q, limit: page.limit } };
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
        catalogTracks: TRACKS.filter((track) => track.ownerId === creator.id).length,
        agentAccess: 'public',
      },
    };
  });
}

/**
 * One model call, over the provider's HTTP API.
 *
 * This server and the browser page are the only two things that know about the
 * model, and the key stays here. A plain POST keeps the reviewer's dependency
 * list short: there is no client library to install for one request.
 */
async function generateWithGemini(apiKey: string, model: string, prompt: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 512 },
      }),
    },
  );
  if (!response.ok) throw new Error(`the model call failed with status ${response.status}`);
  const body = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (!text) throw new Error('the model returned no text');
  return text;
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
  const EXPOSED_PAYMENT_HEADERS =
    'payment-required, payment-response, x-payment-required, x-payment-response, x-no-charge, x-no-charge-reason';
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

  /**
   * The demo chat's interpreter.
   *
   * The page is a browser app, so it sends the visitor's sentence here rather
   * than holding a model key itself. This route decides which call the sentence
   * means and hands the plan back; the page makes that call with its own wallet.
   * It never touches a wallet, a payment or the data routes.
   *
   * With no GEMINI_API_KEY the route answers 503 and the page reads the
   * sentence with its own parser. That is deliberate: a judge with no key still
   * gets a working chat, and the fallback is the same planner production uses.
   */
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_SUPPORT_MODEL ?? 'gemini-2.5-flash-lite';
  const chatBudget = createChatBudget({ max: 20, windowMs: 5 * 60_000 });
  app.post('/api/v1/agent/chat/interpret', async (request, reply) => {
    if (!geminiKey) {
      return reply
        .status(503)
        .send({ error: 'chat_unavailable', reason: 'Set GEMINI_API_KEY to route the chat with a model.' });
    }
    const body = (request.body ?? {}) as { message?: unknown; history?: unknown; moves?: unknown };
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > MAX_CHAT_MESSAGE_CHARS) {
      return reply.status(400).send({ error: 'invalid_request', code: 'invalid_request' });
    }
    if (!chatBudget.take(request.ip)) {
      return reply.status(429).send({ error: 'rate_limited', reason: 'Too many chat requests; wait a minute and try again.' });
    }
    const moves: ChatMoveOption[] = Array.isArray(body.moves)
      ? (body.moves as ChatMoveOption[]).filter(
          (move) => move && typeof move.id === 'string' && typeof move.label === 'string',
        ).slice(0, 24)
      : [];
    const history = Array.isArray(body.history)
      ? (body.history as { role?: unknown; text?: unknown }[])
          .filter((turn) => (turn?.role === 'user' || turn?.role === 'agent') && typeof turn.text === 'string')
          .slice(-6)
          .map((turn) => ({ role: turn.role as 'user' | 'agent', text: turn.text as string }))
      : [];

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('chat interpreter timed out')), 8_000);
    });
    try {
      const plan = await Promise.race([
        planChatMessage({
          message: body.message,
          moves,
          history,
          generate: (prompt) => generateWithGemini(geminiKey, geminiModel, prompt),
        }),
        timeout,
      ]);
      reply.header('cache-control', 'no-store');
      return { plan, model: geminiModel };
    } catch (error) {
      request.log.warn({ err: error }, 'demo chat interpreter failed');
      return { plan: null, model: geminiModel, reason: 'interpreter_failed' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

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
    // A search that matched nothing is not worth a cent, so the page is served
    // unpaid and the response says so. The buyer's signed authorization was
    // never submitted, which is why there is no receipt to show.
    const noCharge = noChargePage(state.adapter.getPath(), Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload ?? ''), request.x402CreatorIds);
    if (noCharge) {
      reply.header('x-no-charge', noCharge.code);
      reply.header('x-no-charge-reason', noCharge.reason);
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
      // The invoice is one cent per creator credited, so the amount both names
      // the creators paid and states what each of them earned before the 60/40
      // split. On chain this is a single transfer to the seller; the split and
      // the creators it belongs to live in the ledger beside it.
      creatorsBilled: creatorsPaidFor(amountAtomic),
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
