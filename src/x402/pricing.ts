/**
 * What one paid request costs.
 *
 * A paid request buys results, not a page. The published unit is one cent per
 * creator credited, with a one cent floor so the smallest request still costs a
 * cent and a single profile or the connectivity check keeps its old price. A
 * page that credits fifty creators therefore costs fifty cents, and each of
 * those creators is credited a whole unit that the 60/40 split then divides,
 * instead of fifty people sharing a single cent.
 *
 * The amount is always `unitPriceAtomic x creators`, so it is exact in atomic
 * units and needs no rounding: the quote the buyer signs is the same integer
 * the seller settles. The invoice states that integer before anything is
 * signed, and the free `/api/v1/agent/pricing` route states the rule, so a
 * buyer can work out the cost of a page before asking for it.
 *
 * Two properties this file is responsible for:
 *
 *   1. A creator credit is never a fraction of a cent. Whatever a page holds,
 *      the amount is a whole number of one cent units.
 *   2. A hostile `limit` cannot produce an unbounded invoice. The billable
 *      creator count is capped, and the cap is checked against the route's own
 *      page ceiling by a test.
 *
 * This module is pure arithmetic plus constants: no Prisma, no Fastify, no
 * network. Everything here is unit tested.
 */

/**
 * Price of one credited creator, in atomic units of the settlement asset.
 * Celo USDC has six decimals, so 10000 atomic units is one cent.
 */
export const CREATOR_UNIT_PRICE_ATOMIC = '10000';

/**
 * Price floor for any single paid request. One cent, which is also the whole
 * price of the liveness route and of a one creator profile.
 */
export const FLOOR_REQUEST_PRICE_ATOMIC = '10000';

/**
 * Most creators a single page can be billed for. A music page can credit more
 * creators than it has rows, because a track can belong to several of them, so
 * the cap is on credited creators rather than on rows. It matches the paid
 * routes' own page ceiling, which keeps the largest possible invoice at two
 * dollars and means a `limit` the API accepts cannot invent a bigger one.
 */
export const MAX_BILLABLE_CREATORS = 200;

/**
 * The most one request can cost, in atomic units. Exported so the operator
 * scripts and the demo can state a real ceiling instead of "it depends".
 */
export const MAX_REQUEST_PRICE_ATOMIC = (
  BigInt(CREATOR_UNIT_PRICE_ATOMIC) * BigInt(MAX_BILLABLE_CREATORS)
).toString();

/** Creators billed for a page, clamped to the cap, and never below one. */
export function billableCreatorCount(creatorCount: number): number {
  const whole = Number.isFinite(creatorCount) ? Math.floor(creatorCount) : 0;
  return Math.min(Math.max(whole, 1), MAX_BILLABLE_CREATORS);
}

/**
 * The amount a page costs, in atomic units, as a decimal string.
 *
 * Always at least one unit: a request that credits one creator and a request
 * that credits none (an empty page, which is served without settling) quote the
 * same floor, so the 402 is a valid invoice either way. A page that credits
 * more than the cap is billed at the cap.
 */
export function priceForCreatorCount(creatorCount: number): string {
  const unit = BigInt(CREATOR_UNIT_PRICE_ATOMIC);
  const billed = BigInt(billableCreatorCount(creatorCount));
  return (unit * billed).toString();
}

/** Creators a settled amount paid for, used to describe a receipt. */
export function creatorsPaidFor(amountAtomic: string): number {
  const unit = BigInt(CREATOR_UNIT_PRICE_ATOMIC);
  if (unit <= 0n) return 0;
  const count = BigInt(amountAtomic || '0') / unit;
  return Number(count < 1n ? 1n : count);
}

/**
 * Share of one creator unit that the creator keeps, in atomic units. The 60/40
 * split divides a single unit, so this is the number the ledger row shows per
 * credited creator on a page that was priced per creator.
 */
export function creatorShareOfUnitAtomic(creatorShareBps: bigint): string {
  const unit = BigInt(CREATOR_UNIT_PRICE_ATOMIC);
  return ((unit * creatorShareBps) / 10000n).toString();
}

export interface PriceRule {
  /** What the buyer is billed for. */
  billedUnit: 'creator';
  unitPriceAtomic: string;
  unitPriceUsd: string;
  floorAtomic: string;
  floorUsd: string;
  maxAtomic: string;
  maxUsd: string;
  maxCreatorsPerRequest: number;
  /** One sentence a human can read, used in 402 descriptions and the docs. */
  summary: string;
  /** What the buyer does not pay for, stated plainly. */
  notCharged: string[];
}

export const PRICE_RULE: PriceRule = {
  billedUnit: 'creator',
  unitPriceAtomic: CREATOR_UNIT_PRICE_ATOMIC,
  unitPriceUsd: '0.01',
  floorAtomic: FLOOR_REQUEST_PRICE_ATOMIC,
  floorUsd: '0.01',
  maxAtomic: MAX_REQUEST_PRICE_ATOMIC,
  maxUsd: '2.00',
  maxCreatorsPerRequest: MAX_BILLABLE_CREATORS,
  summary:
    'One cent in USDC per creator credited, with a one cent minimum per request. A page that credits 50 creators costs $0.50. The 402 invoice carries the exact amount before anything is signed.',
  notCharged: [
    'Reading a 402 invoice costs nothing.',
    'A search that matches nothing is served without settling, so an empty page is free.',
    'GET /api/v1/agent/stats and GET /api/v1/agent/pricing are free.',
  ],
};

/**
 * Worked examples for the free pricing route and for the README. Kept next to
 * the arithmetic so the published examples cannot drift from what the invoice
 * actually charges.
 */
export const PRICE_EXAMPLES: { creators: number; amountAtomic: string; usd: string; perCreatorUsd: string }[] = [
  { creators: 1, amountAtomic: priceForCreatorCount(1), usd: '0.01', perCreatorUsd: '0.01' },
  { creators: 3, amountAtomic: priceForCreatorCount(3), usd: '0.03', perCreatorUsd: '0.01' },
  { creators: 10, amountAtomic: priceForCreatorCount(10), usd: '0.10', perCreatorUsd: '0.01' },
  { creators: 50, amountAtomic: priceForCreatorCount(50), usd: '0.50', perCreatorUsd: '0.01' },
];
