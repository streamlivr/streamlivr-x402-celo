import { describe, expect, it } from 'vitest';
import {
  CREATOR_UNIT_PRICE_ATOMIC,
  FLOOR_REQUEST_PRICE_ATOMIC,
  MAX_BILLABLE_CREATORS,
  MAX_REQUEST_PRICE_ATOMIC,
  PRICE_EXAMPLES,
  PRICE_RULE,
  billableCreatorCount,
  creatorShareOfUnitAtomic,
  creatorsPaidFor,
  priceForCreatorCount,
} from './pricing.js';
import { MAX_PAGE_LIMIT, buildPaidRoutes, DEFAULT_PAGE_LIMIT } from './catalog.js';
import { CREATOR_SHARE_BPS, calculateAttributionShares } from './split.js';

/**
 * The price of a request is the part of this integration a buyer feels most
 * directly, so the arithmetic is pinned here rather than inferred from a route.
 *
 * The rule these tests defend: the amount is a whole number of one cent units,
 * a page is never billed for more creators than the route can return, and every
 * credited creator receives a full unit share instead of a fraction of a cent.
 */
describe('per creator pricing', () => {
  it('keeps one cent as both the unit price and the request floor', () => {
    expect(CREATOR_UNIT_PRICE_ATOMIC).toBe('10000');
    expect(FLOOR_REQUEST_PRICE_ATOMIC).toBe('10000');
    expect(PRICE_RULE.unitPriceUsd).toBe('0.01');
    expect(PRICE_RULE.floorUsd).toBe('0.01');
  });

  it('bills one unit per credited creator', () => {
    expect(priceForCreatorCount(1)).toBe('10000');
    expect(priceForCreatorCount(3)).toBe('30000');
    expect(priceForCreatorCount(10)).toBe('100000');
    expect(priceForCreatorCount(50)).toBe('500000');
  });

  it('never quotes less than the floor, including for an empty page', () => {
    expect(priceForCreatorCount(0)).toBe(FLOOR_REQUEST_PRICE_ATOMIC);
    expect(priceForCreatorCount(-4)).toBe(FLOOR_REQUEST_PRICE_ATOMIC);
    expect(priceForCreatorCount(Number.NaN)).toBe(FLOOR_REQUEST_PRICE_ATOMIC);
    expect(priceForCreatorCount(0.9)).toBe(FLOOR_REQUEST_PRICE_ATOMIC);
  });

  it('caps the billable count so a hostile limit cannot invent an invoice', () => {
    expect(billableCreatorCount(5_000)).toBe(MAX_BILLABLE_CREATORS);
    expect(priceForCreatorCount(5_000)).toBe(MAX_REQUEST_PRICE_ATOMIC);
    expect(MAX_REQUEST_PRICE_ATOMIC).toBe('2000000');
    // The cap has to be at least the page the routes will actually serve, or a
    // legitimate page could be billed for fewer creators than it credits.
    expect(MAX_PAGE_LIMIT).toBeLessThanOrEqual(MAX_BILLABLE_CREATORS);
    expect(DEFAULT_PAGE_LIMIT).toBeLessThanOrEqual(MAX_PAGE_LIMIT);
  });

  it('states worked examples that match the arithmetic', () => {
    for (const example of PRICE_EXAMPLES) {
      expect(example.amountAtomic).toBe(priceForCreatorCount(example.creators));
    }
  });

  it('reads the creator count back out of a settled amount', () => {
    expect(creatorsPaidFor('10000')).toBe(1);
    expect(creatorsPaidFor('500000')).toBe(50);
    expect(creatorsPaidFor('0')).toBe(1);
  });
});

describe('what each credited creator receives', () => {
  it('gives every creator a whole unit share, not a fraction of one cent', () => {
    // The bug this replaces: a single cent split fifty ways, so each creator
    // was credited 120 atomic units. At one unit per creator the split lands on
    // the same number for every creator on the page, whatever the page holds.
    const perUnit = creatorShareOfUnitAtomic(CREATOR_SHARE_BPS);
    expect(perUnit).toBe('6000');

    for (const creators of [1, 2, 3, 10, 50]) {
      const ids = Array.from({ length: creators }, (_, index) => `creator-${index}`);
      const amountAtomic = priceForCreatorCount(creators);
      const shares = calculateAttributionShares(amountAtomic, ids);
      expect(shares).toHaveLength(creators);
      for (const share of shares) expect(share.shareAtomic).toBe('6000');
      const total = shares.reduce((sum, share) => sum + BigInt(share.shareAtomic), 0n);
      // 60 percent of the pool, with the platform holding the other 40.
      expect(total).toBe((BigInt(amountAtomic) * 6000n) / 10000n);
    }
  });

  it('splits the platform share out of the same unit', () => {
    // A page of ten creators is a ten unit invoice. Each creator keeps 60
    // percent of one unit, and the platform keeps 40 percent of the invoice.
    const amountAtomic = priceForCreatorCount(10);
    const shares = calculateAttributionShares(amountAtomic, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const creatorTotal = shares.reduce((sum, share) => sum + BigInt(share.shareAtomic), 0n);
    expect(creatorTotal).toBe(60000n);
    expect(BigInt(amountAtomic) - creatorTotal).toBe(40000n);
  });
});

describe('route prices', () => {
  it('publishes a one cent minimum on every paid route', () => {
    for (const route of buildPaidRoutes()) {
      expect(route.priceAtomic).toBe('10000');
    }
  });

  it('states the per creator rule in the data route descriptions', () => {
    const dataRoutes = buildPaidRoutes().filter((route) => route.queryParams);
    expect(dataRoutes).toHaveLength(3);
    for (const route of dataRoutes) {
      expect(route.description).toContain('one cent');
      expect(route.description).toContain('creator');
    }
  });
});
