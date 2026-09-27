/**
 * The paid agent routes, described once and reused everywhere.
 *
 * The x402 route config, the A2A agent card, the MCP tool list, and the
 * ERC-8004 registration metadata all read from this catalog. Prices and
 * descriptions live in one place so an agent that discovered a route cannot
 * be quoted a different price by a different surface.
 *
 * Every data route is paginated and searchable. The seller holds thousands of
 * creators, posts and tracks covering African and global creators, brands,
 * music, content and platform activity, so a response is one page plus the
 * total that matched and a cursor for the next page. `q`, `limit` and `cursor`
 * travel as query parameters, and `limit` is the one that moves the price: the
 * buyer is billed one cent per creator the page credits, so asking for a bigger
 * page costs more and a buyer that pages through the whole catalog pays for
 * each page as it arrives.
 */
import { X402_PING_PRICE_ATOMIC } from './config.js';
import { CREATOR_UNIT_PRICE_ATOMIC, FLOOR_REQUEST_PRICE_ATOMIC, PRICE_RULE } from './pricing.js';

/**
 * What each route costs at its cheapest.
 *
 * The published number is one cent, which is the unit price of a credited
 * creator and the floor for any request. The amount on a data route is that
 * unit multiplied by the creators the page credits, so the 402 invoice is
 * always one cent or more and never a fraction of one. `priceAtomic` on a route
 * means "the amount in the invoice when this page credits one creator", which
 * is what a discovery catalog needs to rank a route by cost before it calls it.
 */
export const LISTINGS_PRICE_ATOMIC = CREATOR_UNIT_PRICE_ATOMIC;
export const CATALOG_PRICE_ATOMIC = CREATOR_UNIT_PRICE_ATOMIC;
export const POSTS_PRICE_ATOMIC = CREATOR_UNIT_PRICE_ATOMIC;
export const CREATOR_PROFILE_PRICE_ATOMIC = FLOOR_REQUEST_PRICE_ATOMIC;

/**
 * Rows one paid page returns unless the caller asks for fewer.
 *
 * Ten, not the fifty this used to be: rows are what the buyer pays for now, so
 * the default has to be a small bill. A caller that wants fifty creators asks
 * for `limit=50` and is quoted fifty cents for it.
 */
export const DEFAULT_PAGE_LIMIT = 10;
/** Hard ceiling per request, so one payment cannot ask for the whole database. */
export const MAX_PAGE_LIMIT = 200;

/**
 * The body key each paid data route answers with.
 *
 * Used to tell an empty page from a real one. A buyer who pays and receives
 * nothing has been charged for a search that found nothing, which reads as the
 * seller taking money for no answer, so those requests are served without
 * settling. The liveness route is not in this list: it always sells its answer.
 */
export const PAGE_BODY_KEYS: Record<string, string> = {
  '/api/v1/agent/listings': 'creators',
  '/api/v1/agent/posts': 'posts',
  '/api/v1/agent/catalog': 'tracks',
};

/**
 * The body key of a paid route whose page came back with no rows, or null when
 * the body holds rows or is not a page at all.
 */
export function emptyPageKey(path: string, payload: string): string | null {
  const bodyKey = PAGE_BODY_KEYS[path];
  if (!bodyKey) return null;
  try {
    const body = JSON.parse(payload) as Record<string, unknown>;
    const rows = body[bodyKey];
    if (Array.isArray(rows) && rows.length === 0) return bodyKey;
  } catch {
    // A body that will not parse is not an empty page, so it settles normally.
  }
  return null;
}

export interface PaidRoutePathParam {
  name: string;
  description: string;
  example: string;
}

export interface PaidRouteQueryParam {
  name: string;
  description: string;
  example: string;
}

export interface PaidRoute {
  /** Fastify path pattern, with `:param` placeholders. */
  path: string;
  /** Stable machine name used by the Bazaar declaration and the ERC-8004 services array. */
  serviceName: string;
  /** A2A skill id and MCP tool name. Clients cache on these, so treat them as permanent. */
  id: string;
  /** Short human title for agent cards. */
  title: string;
  description: string;
  /** Free tags surfaced to discovery catalogs. */
  tags: string[];
  /** Price in the settlement asset's atomic units (6 decimals for Celo USDC). */
  priceAtomic: string;
  /** Set when the route needs a value in the URL rather than a query string. */
  pathParam?: PaidRoutePathParam;
  /** Optional query parameters, published to MCP clients and listed in the 402. */
  queryParams?: PaidRouteQueryParam[];
  /** Example success body. Discovery clients use it to plan calls without paying first. */
  example: unknown;
}

/**
 * The three parameters every paginated data route accepts. Declared once so the
 * HTTP routes, the MCP tool schemas and the docs cannot drift apart.
 */
export const PAGE_QUERY_PARAMS: PaidRouteQueryParam[] = [
  {
    name: 'q',
    description:
      'Free-text search. Matches names, titles, bios, hashtags, country names and country codes on that route. Omit to list everything.',
    example: 'lagos',
  },
  {
    name: 'limit',
    description: `Rows to return, 1-${MAX_PAGE_LIMIT}, default ${DEFAULT_PAGE_LIMIT}. This is the cost control: the invoice is one cent per creator the page credits, so a bigger page costs more.`,
    example: String(DEFAULT_PAGE_LIMIT),
  },
  {
    name: 'cursor',
    description: 'nextCursor from the previous page. Omit for the first page.',
    example: 'eyJpZCI6ImNtbWdnYnRpazAwMDBxcnFiem9udHZzeTM4In0',
  },
];

/**
 * Builds the paid route list. The price of the liveness route is an env var so
 * an operator can raise it without a code change; every data route is billed as
 * one cent per creator credited, which is the unit price stated in the
 * hackathon submission.
 */
export function buildPaidRoutes(pingPriceAtomic: string = X402_PING_PRICE_ATOMIC): PaidRoute[] {
  return [
    {
      path: '/api/v1/agent/ping',
      serviceName: 'streamlivr-ping',
      id: 'x402-ping',
      title: 'Payment connectivity check',
      description:
        'Returns liveness and the settlement network the API is running on. Use it to confirm a buyer wallet, facilitator key, and x402 client all work before paying for data.',
      tags: ['x402', 'celo', 'health'],
      priceAtomic: pingPriceAtomic,
      example: { ok: true, paid: true, network: 'eip155:42220', assetSymbol: 'USDC' },
    },
    {
      path: '/api/v1/agent/listings',
      serviceName: 'streamlivr-listings',
      id: 'creator-listings',
      title: 'Creator and brand directory',
      description:
        `Public creator and brand profiles from Streamlivr and the wider African and global creator economy: display name, bio, avatar, country, follower and following counts, verification and account age. Searchable by name, bio, country name or country code with ?q=, and paginated, so the response carries the total that matched and a nextCursor. Priced per creator credited and attributed to each one when the payment settles. ${PRICE_RULE.summary}`,
      tags: ['x402', 'celo', 'creators', 'brands', 'africa', 'global', 'discovery', 'search'],
      priceAtomic: LISTINGS_PRICE_ATOMIC,
      queryParams: PAGE_QUERY_PARAMS,
      example: {
        creators: [
          {
            id: 'cmmggbkik0000rqbzontvsy38',
            username: 'grant',
            displayName: 'ekegrant59',
            bio: 'Afrobeats producer, Lagos',
            avatarUrl: 'https://assets.example.com/avatars/creator.jpg',
            countryCode: 'NG',
            followerCount: 2,
            followingCount: 1,
            isVerified: false,
          },
        ],
        page: { total: 2431, limit: 50, returned: 1, hasMore: true, nextCursor: 'eyJpZCI6ImNtbWdnYnRpazAwMDBxcnFiem9udHZzeTM4In0', truncated: true },
        query: { q: 'lagos', limit: 50 },
      },
    },
    {
      path: '/api/v1/agent/posts',
      serviceName: 'streamlivr-posts',
      id: 'public-posts',
      title: 'Public content feed',
      description:
        `Published public content from every public account: title, caption, hashtags, media type and length, engagement counts, and thumbnail. Each row carries an "audio" label and an "attribution" note naming the creator who owns the audio on it, because a post pays whoever made its sound rather than whoever posted it: a borrowed sound credits its owner, and audio with no Streamlivr owner is retained by the platform. That is African and global creator content, brand activity and platform engagement metadata together. Searchable by caption, hashtag or creator with ?q=, and paginated. Priced per creator credited and attributed to each one when the payment settles. ${PRICE_RULE.summary}`,
      tags: ['x402', 'celo', 'posts', 'content', 'africa', 'global', 'brands', 'engagement', 'search'],
      priceAtomic: POSTS_PRICE_ATOMIC,
      queryParams: PAGE_QUERY_PARAMS,
      example: {
        posts: [
          {
            id: 'cmvideo0000rqbzontvsy38',
            creatorId: 'cmmggbkik0000rqbzontvsy38',
            title: 'Lagos at night',
            description: 'Shot on the way home from the studio',
            hashtags: ['afrobeats', 'lagos'],
            mediaType: 'VIDEO',
            durationSeconds: 21,
            aspectRatio: '9:16',
            thumbnailUrl: 'https://assets.example.com/thumbs/post.jpg',
            videoUrl: 'https://assets.example.com/videos/post.mp4',
            viewCount: 1820,
            likeCount: 140,
            commentCount: 12,
            shareCount: 4,
            repostCount: 3,
            isAiGenerated: false,
            isLivestreamVod: false,
            createdAt: '2026-05-02T18:04:00.000Z',
          },
        ],
        page: { total: 6120, limit: 50, returned: 1, hasMore: true, nextCursor: 'eyJpZCI6ImNtdmlkZW8wMDAwcURxYnphbnR2c3kzOCJ9', truncated: true },
        query: { q: 'afrobeats', limit: 50 },
      },
    },
    {
      path: '/api/v1/agent/catalog',
      serviceName: 'streamlivr-catalog',
      id: 'music-catalog',
      title: 'Music and audio metadata',
      description:
        `Music and audio metadata for African and global repertoire: title, artist, ISRC, artwork, and a playable preview clip when the source provides one. Each row carries a "label" block that names its owner and how many public posts draw on it, and an "attribution" note. A recording is credited to the artist who owns it, never to the accounts whose posts used it; a recording with no Streamlivr owner is retained by the platform. Searchable by title or artist with ?q= and paginated. Matches how the Streamlivr app indexes audio for video, so agent results line up with in-app search. Priced per creator credited and attributed to each one when the payment settles. ${PRICE_RULE.summary}`,
      tags: ['x402', 'celo', 'music', 'audio', 'metadata', 'isrc', 'africa', 'global', 'search'],
      priceAtomic: CATALOG_PRICE_ATOMIC,
      queryParams: PAGE_QUERY_PARAMS,
      example: {
        tracks: [
          {
            id: 'tr_01',
            title: 'Lagos Nights',
            artist: 'Ada',
            isrc: 'NGAAA2600001',
            coverUrl: 'https://cdn-images.dzcdn.net/images/cover/example/500x500-000000-80-0-0.jpg',
            previewUrl: 'https://cdnt-preview.dzcdn.net/api/1/1/example/preview.mp3?hdnea=exp=1790000000~acl=/api/*~hmac=example',
            creatorIds: ['cr_01'],
          },
        ],
        page: { total: 5013, limit: 50, returned: 1, hasMore: true, nextCursor: 'eyJpZCI6InRyXzAxIn0', truncated: true },
        query: { q: 'lagos', limit: 50 },
      },
    },
    {
      path: '/api/v1/agent/creator/:id',
      serviceName: 'streamlivr-creator-profile',
      id: 'creator-profile',
      title: 'Creator profile',
      description:
        'One public creator or brand profile by id, with the counts of their published content and catalogued tracks. One creator, so one cent, which is the cheapest way to buy when the agent already knows which profile it needs.',
      tags: ['x402', 'celo', 'creators', 'brands', 'profile'],
      priceAtomic: CREATOR_PROFILE_PRICE_ATOMIC,
      pathParam: {
        name: 'id',
        description: 'Streamlivr creator id, taken from the listings, posts or catalog response.',
        example: 'cmmggbkik0000rqbzontvsy38',
      },
      example: {
        id: 'cmmggbkik0000rqbzontvsy38',
        username: 'grant',
        displayName: 'ekegrant59',
        bio: 'Afrobeats producer, Lagos',
        avatarUrl: 'https://assets.example.com/avatars/creator.jpg',
        countryCode: 'NG',
        isVerified: false,
        followerCount: 2,
        followingCount: 1,
        createdAt: '2026-01-14T09:20:00.000Z',
        stats: { publishedVideos: 12, catalogTracks: 4, agentAccess: 'public' },
      },
    },
  ];
}

/** Route patterns in the `GET /path` form the x402 route config expects. */
export function routePattern(route: PaidRoute): string {
  return `GET ${route.path}`;
}

/**
 * Fills the `:param` segment with the example value and appends the example
 * query string, so discovery documents publish a URL a client can call as
 * written.
 */
export function examplePath(route: PaidRoute): string {
  const path = route.pathParam
    ? route.path.replace(`:${route.pathParam.name}`, route.pathParam.example)
    : route.path;
  const query = (route.queryParams ?? []).map((param) => `${param.name}=${encodeURIComponent(param.example)}`).join('&');
  return query ? `${path}?${query}` : path;
}

/** Renders an atomic amount as a decimal string, for pricing shown to humans and agents. */
export function formatAtomic(amountAtomic: string, decimals = 6): string {
  const negative = amountAtomic.startsWith('-');
  const digits = (negative ? amountAtomic.slice(1) : amountAtomic).padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  const rendered = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${rendered}` : rendered;
}
