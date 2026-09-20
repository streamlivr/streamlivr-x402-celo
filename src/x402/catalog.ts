/**
 * The paid agent routes, described once and reused everywhere.
 *
 * The x402 route config, the A2A agent card, the MCP tool list, and the
 * ERC-8004 registration metadata all read from this catalog. Prices and
 * descriptions live in one place so an agent that discovered a route cannot
 * be quoted a different price by a different surface.
 *
 * Every data route is paginated and searchable. The seller holds thousands of
 * creators, posts and tracks, so a response is one page plus the total that
 * matched and a cursor for the next page. `q`, `limit` and `cursor` travel as
 * query parameters and never change the price: an agent that pages through the
 * whole catalog pays the per-request price for each page it asks for.
 */
import { X402_PING_PRICE_ATOMIC } from './config.js';

export const LISTINGS_PRICE_ATOMIC = '10000';
export const CATALOG_PRICE_ATOMIC = '10000';
export const POSTS_PRICE_ATOMIC = '10000';
export const CREATOR_PROFILE_PRICE_ATOMIC = '5000';

/** Rows one paid page returns unless the caller asks for fewer. */
export const DEFAULT_PAGE_LIMIT = 50;
/** Hard ceiling per request, so one payment cannot ask for the whole database. */
export const MAX_PAGE_LIMIT = 200;

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
    description: 'Free-text search. Matches names, titles, bios and tags on that route. Omit to list everything.',
    example: 'lagos',
  },
  {
    name: 'limit',
    description: `Rows to return, 1-${MAX_PAGE_LIMIT}, default ${DEFAULT_PAGE_LIMIT}. Does not change the price.`,
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
 * an operator can raise it without a code change; the data routes are fixed
 * because their prices are documented in the hackathon submission.
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
      title: 'Creator listings',
      description:
        'Every public Streamlivr creator with their profile fields, avatar URL, country and follower counts. Searchable with ?q= and paginated: the response carries the total that matched and a nextCursor. Every creator on the page is recorded for revenue attribution when the payment settles.',
      tags: ['x402', 'celo', 'creators', 'discovery', 'search'],
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
      title: 'Public posts',
      description:
        'Published public posts from every public account: caption, hashtags, media and length, engagement counts, thumbnail and creator id. Searchable with ?q= and paginated. This is the same public feed content the app renders, sold per page.',
      tags: ['x402', 'celo', 'posts', 'content', 'search'],
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
      title: 'Music catalog',
      description:
        'Every catalogued track with title, artist, ISRC, artwork, a playable preview clip when the source provides one, and the public creator ids that supplied each track. Searchable with ?q= and paginated. Matches how the Streamlivr app indexes audio for video, so agent results line up with in-app search.',
      tags: ['x402', 'celo', 'music', 'catalog', 'search'],
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
        'One public creator profile by id, with the counts of their published posts and catalogued tracks. Cheaper than a listings page when the agent already knows which creator it needs.',
      tags: ['x402', 'celo', 'creators', 'profile'],
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
