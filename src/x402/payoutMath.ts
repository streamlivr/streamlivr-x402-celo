/**
 * Creator balance math for x402 payouts.
 *
 * Money is only ever handled as atomic-unit integer strings. `number` is never
 * used here: a payout balance that drifts by a rounding error is a real transfer
 * of the wrong amount.
 */

/** Payout states that already commit (or have moved) money for a creator. */
export const RESERVING_PAYOUT_STATUSES = ['PENDING', 'APPROVED', 'SUBMITTED', 'CONFIRMED'] as const;

/**
 * Smallest balance a payout run will move: one USDC.
 *
 * A page-wide split of a one cent payment leaves most creators holding a few
 * thousandths of a cent, and transferring that costs more in gas than it moves.
 * The floor is the reason those balances sit in the ledger instead of being
 * paid out, so the demo reports how much is below it rather than listing the
 * same rounding dust as an unpaid balance.
 */
export const MIN_PAYOUT_ATOMIC = 1_000_000n;

export interface AttributionShare {
  creatorId: string | null;
  shareAtomic: string;
  creatorUsername?: string | null;
}

export interface PayoutAmount {
  creatorId: string | null;
  amountAtomic: string;
  status: string;
}

export interface CreatorBalance {
  creatorId: string;
  username: string | null;
  attributedAtomic: string;
  reservedAtomic: string;
  outstandingAtomic: string;
}

/**
 * Outstanding = attributed shares minus every payout that is not
 * failed/cancelled, so a failed transfer releases the balance again.
 *
 * A negative outstanding balance means reserved payouts exceed recorded
 * attribution. It is returned as-is rather than clamped to zero: silently
 * rounding it up would pay out money the platform never attributed.
 */
export function computeCreatorBalances(
  attributions: readonly AttributionShare[],
  payouts: readonly PayoutAmount[],
): CreatorBalance[] {
  const attributed = new Map<string, bigint>();
  const usernames = new Map<string, string | null>();
  for (const row of attributions) {
    if (!row.creatorId) continue;
    attributed.set(row.creatorId, (attributed.get(row.creatorId) ?? 0n) + BigInt(row.shareAtomic));
    if (row.creatorUsername && !usernames.get(row.creatorId)) usernames.set(row.creatorId, row.creatorUsername);
  }

  const reserving = new Set<string>(RESERVING_PAYOUT_STATUSES);
  const reserved = new Map<string, bigint>();
  for (const row of payouts) {
    if (!row.creatorId || !reserving.has(row.status)) continue;
    reserved.set(row.creatorId, (reserved.get(row.creatorId) ?? 0n) + BigInt(row.amountAtomic));
  }

  return [...attributed.entries()]
    .map(([creatorId, attributedAtomic]) => {
      const reservedAtomic = reserved.get(creatorId) ?? 0n;
      return {
        creatorId,
        username: usernames.get(creatorId) ?? null,
        attributedAtomic: attributedAtomic.toString(),
        reservedAtomic: reservedAtomic.toString(),
        outstandingAtomic: (attributedAtomic - reservedAtomic).toString(),
      };
    })
    .sort((left, right) => (BigInt(right.outstandingAtomic) > BigInt(left.outstandingAtomic) ? 1 : -1));
}

/** Creators whose outstanding balance meets the payout floor. */
export function selectPayableCreators(balances: readonly CreatorBalance[], minimumAtomic: bigint): CreatorBalance[] {
  return balances.filter((balance) => BigInt(balance.outstandingAtomic) >= minimumAtomic);
}
