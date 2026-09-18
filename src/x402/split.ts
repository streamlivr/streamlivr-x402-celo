/**
 * Creator revenue split for a settled x402 payment.
 *
 * Kept in its own module (no Prisma, no Redis, no Fastify) so the arithmetic
 * can be unit tested without booting the server. Money is handled as atomic
 * integer strings only: the pool, the per-creator share, and the remainder are
 * all bigint, and the remainder is handed out in response order so the sum of
 * the shares always equals the pool exactly.
 */
export const CREATOR_SHARE_BPS = 6000n;
export const PLATFORM_SHARE_BPS = 4000n;
export const BPS_DENOMINATOR = 10000n;

export interface AttributionShareInput {
  creatorId: string;
  shareAtomic: string;
  shareBps: number;
}

export function calculateAttributionShares(amountAtomic: string, creatorIds: string[]): AttributionShareInput[] {
  const uniqueCreators = [...new Set(creatorIds)];
  if (uniqueCreators.length === 0) return [];
  const pool = (BigInt(amountAtomic) * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
  const base = pool / BigInt(uniqueCreators.length);
  let remainder = pool % BigInt(uniqueCreators.length);
  const baseBps = CREATOR_SHARE_BPS / BigInt(uniqueCreators.length);
  let bpsRemainder = CREATOR_SHARE_BPS % BigInt(uniqueCreators.length);
  return uniqueCreators.map((creatorId) => ({
    creatorId,
    shareAtomic: (base + (remainder-- > 0n ? 1n : 0n)).toString(),
    shareBps: Number(baseBps + (bpsRemainder-- > 0n ? 1n : 0n)),
  }));
}
