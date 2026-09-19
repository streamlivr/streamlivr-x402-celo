/**
 * The paid agent routes, described once and reused everywhere.
 *
 * The x402 route config, the A2A agent card, the MCP tool list, and the
 * ERC-8004 registration metadata all read from this catalog. Prices and
 * descriptions live in one place so an agent that discovered a route cannot
 * be quoted a different price by a different surface.
 */
import { X402_PING_PRICE_ATOMIC } from './config.js';

export const LISTINGS_PRICE_ATOMIC = '10000';
export const CATALOG_PRICE_ATOMIC = '10000';
export const CREATOR_PROFILE_PRICE_ATOMIC = '5000';

export interface PaidRoutePathParam {
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
  /** Example success body. Discovery clients use it to plan calls without paying first. */
  example: unknown;
}

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
        'Opted-in Streamlivr creators with their public profile fields, avatar URL, country and follower counts. Every creator in the response is recorded for revenue attribution when the payment settles.',
      tags: ['x402', 'celo', 'creators', 'discovery'],
      priceAtomic: LISTINGS_PRICE_ATOMIC,
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
      },
    },
    {
      path: '/api/v1/agent/catalog',
      serviceName: 'streamlivr-catalog',
      id: 'music-catalog',
      title: 'Music catalog',
      description:
        'Opted-in music tracks with title, artist, ISRC, artwork, a playable preview clip when the source provides one, and the creator ids that supplied each track. Matches how the Streamlivr app indexes audio for video, so agent results line up with in-app search.',
      tags: ['x402', 'celo', 'music', 'catalog'],
      priceAtomic: CATALOG_PRICE_ATOMIC,
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
      },
    },
    {
      path: '/api/v1/agent/creator/:id',
      serviceName: 'streamlivr-creator-profile',
      id: 'creator-profile',
      title: 'Creator profile',
      description:
        'One opted-in creator profile by id. Cheaper than the listings route when the agent already knows which creator it needs.',
      tags: ['x402', 'celo', 'creators', 'profile'],
      priceAtomic: CREATOR_PROFILE_PRICE_ATOMIC,
      pathParam: {
        name: 'id',
        description: 'Streamlivr creator id, taken from the listings or catalog response.',
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
        stats: {
          publishedVideos: 12,
          catalogTracks: 4,
          consent: { listings: true, catalog: true, profile: true },
        },
      },
    },
  ];
}

/** Route patterns in the `GET /path` form the x402 route config expects. */
export function routePattern(route: PaidRoute): string {
  return `GET ${route.path}`;
}

/**
 * Fills the `:param` segment with the example value so discovery documents can
 * publish a URL a client can call as written.
 */
export function examplePath(route: PaidRoute): string {
  if (!route.pathParam) return route.path;
  return route.path.replace(`:${route.pathParam.name}`, route.pathParam.example);
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
