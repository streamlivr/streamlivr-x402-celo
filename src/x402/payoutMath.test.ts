import { describe, expect, it } from 'vitest';
import { computeCreatorBalances, selectPayableCreators, type AttributionShare } from './payoutMath.js';

const share = (creatorId: string | null, shareAtomic: string, creatorUsername?: string): AttributionShare =>
  creatorUsername === undefined ? { creatorId, shareAtomic } : { creatorId, shareAtomic, creatorUsername };
const payout = (creatorId: string | null, amountAtomic: string, status: string) => ({ creatorId, amountAtomic, status });

describe('x402 creator payout math', () => {
  it('sums attributed shares per creator', () => {
    const [row] = computeCreatorBalances([share('creator-a', '3000'), share('creator-a', '2000')], []);
    expect(row).toMatchObject({ creatorId: 'creator-a', attributedAtomic: '5000', reservedAtomic: '0', outstandingAtomic: '5000' });
  });

  it('reserves pending, approved, submitted and confirmed payouts', () => {
    const balances = computeCreatorBalances(
      [share('creator-a', '10000')],
      [payout('creator-a', '2000', 'PENDING'), payout('creator-a', '1000', 'APPROVED'), payout('creator-a', '500', 'SUBMITTED'), payout('creator-a', '500', 'CONFIRMED')],
    );
    expect(balances[0]).toMatchObject({ reservedAtomic: '4000', outstandingAtomic: '6000' });
  });

  it('releases the balance for failed and cancelled payouts', () => {
    const balances = computeCreatorBalances(
      [share('creator-a', '10000')],
      [payout('creator-a', '4000', 'FAILED'), payout('creator-a', '4000', 'CANCELLED')],
    );
    expect(balances[0]).toMatchObject({ reservedAtomic: '0', outstandingAtomic: '10000' });
  });

  it('keeps oversized reservations negative instead of paying unattributed money', () => {
    const balances = computeCreatorBalances([share('creator-a', '1000')], [payout('creator-a', '2500', 'CONFIRMED')]);
    expect(balances[0]!.outstandingAtomic).toBe('-1500');
    expect(selectPayableCreators(balances, 1n)).toHaveLength(0);
  });

  it('ignores rows with no creator and keeps atomic precision beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = '9007199254740993';
    const balances = computeCreatorBalances([share(null, '5000'), share('creator-a', huge)], []);
    expect(balances).toHaveLength(1);
    expect(balances[0]!.outstandingAtomic).toBe(huge);
  });

  it('applies the payout floor and sorts the largest balances first', () => {
    const balances = computeCreatorBalances(
      [share('creator-a', '500000'), share('creator-b', '2000000'), share('creator-c', '999999')],
      [],
    );
    const payable = selectPayableCreators(balances, 1_000_000n);
    expect(payable.map((row) => row.creatorId)).toEqual(['creator-b']);
    expect(balances[0]!.creatorId).toBe('creator-b');
  });
});
