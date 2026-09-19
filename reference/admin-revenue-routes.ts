/**
 * Platform revenue. Mounted at /api/v1/admin/revenue.
 *
 * This is the "what the business actually earns" view, distinct from Finance
 * (on-chain transaction flow + network gas) and Onchain (raw treasury). It
 * consolidates the platform's real take across every monetised surface:
 *
 *   • Gift platform fees , our 10% ($LIVR) / 30% (USDT + USDC) cut of gifts
 *   • Pro subscriptions  , MRR from active PRO_MONTHLY / PRO_YEARLY
 *   • Algorithm boosts   , amountPaidUsd on ContentBoosts (paid feed influence)
 *   • Ads / withdrawal fees, placeholder lines (revenue streams land later)
 *
 *   GET /overview?days=30  , headline numbers + breakdowns
 *   GET /timeseries?days=30, daily revenue series (from PlatformDailyRollup)
 */
import type { FastifyPluginAsync } from 'fastify';
import { SubscriptionStatus, UserRole, type KycStatus } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { adminAuth } from '../../middleware/adminAuth.js';
import { LIVR_PRICE_USD } from '../../services/tvlService.js';
import { kycSource, PAYOUT_BLOCKER_TEXT, payoutBlockers, type PayoutBlocker } from '../../x402/kyc.js';

// $/month list price per plan. Pro is $7/mo (PRD); yearly billed at ~10 months.
// Kept here (not a DB setting) because it's a pricing fact, not a tuned knob.
const PLAN_MONTHLY_USD: Record<string, number> = {
  PRO_MONTHLY: 7,
  PRO_YEARLY: 70 / 12,
};

/**
 * Resolve the reporting window. Honours an explicit from/to (custom date range
 * picker) and falls back to a rolling `days` window ending now.
 */
function parseRange(q: { from?: string; to?: string; days?: string }): { since: Date; to: Date; days: number } {
  const to = q.to ? new Date(q.to) : new Date();
  const days = Math.min(365, Math.max(1, parseInt(q.days ?? '30', 10)));
  const since = q.from ? new Date(q.from) : new Date(to.getTime() - days * 86_400_000);
  return { since, to, days: Math.ceil((to.getTime() - since.getTime()) / 86_400_000) };
}

export const adminRevenueRoutes: FastifyPluginAsync = async (app) => {
  // Read-only revenue reporting, analysts may view it; nothing here mutates.
  app.addHook('preHandler', adminAuth({ minRole: UserRole.ANALYST }));

  app.get<{ Querystring: { days?: string; from?: string; to?: string } }>('/overview', async (request) => {
    const { since, to, days } = parseRange(request.query);

    const inRange = { gte: since, lte: to };
    const [
      giftFees,
      activeSubs,
      newSubs,
      subRevenueRange,
      boostAgg,
      boostAggRange,
      activeBoostCount,
      rampAllTime,
      rampRange,
      rampByTarget,
      x402Payments,
      x402Attributions,
      x402Outbox,
      x402PayoutRows,
      x402CreatorBalances,
    ] = await Promise.all([
      // Gift platform fees by token, in range (our cut of every gift)
      prisma.gift.groupBy({
        by: ['tokenType'],
        where: { createdAt: inRange },
        _sum: { platformFee: true, amount: true, creatorAmount: true },
        _count: { _all: true },
      }),
      // Active subscriptions → MRR
      prisma.subscription.groupBy({
        by: ['plan'],
        where: { status: SubscriptionStatus.ACTIVE },
        _count: { _all: true },
      }),
      // New subscriptions started in range
      prisma.subscription.count({ where: { createdAt: inRange } }),
      // Subscription revenue actually earned in range (daily rollup)
      prisma.platformDailyRollup.aggregate({
        _sum: { subscriptionRevenueUsd: true },
        where: { date: inRange },
      }),
      // Boost revenue, all-time
      prisma.contentBoost.aggregate({ _sum: { amountPaidUsd: true } }),
      // Boost revenue, in range
      prisma.contentBoost.aggregate({
        _sum: { amountPaidUsd: true },
        where: { createdAt: inRange },
      }),
      prisma.contentBoost.count({ where: { status: 'ACTIVE' } }),
      // Ramp (Busha), completed orders only, all-time
      prisma.rampTransaction.aggregate({
        where: { status: { in: ['COMPLETED', 'PAYING_OUT'] } },
        _sum: { platformFeeUsd: true, bridgeAmountUsdc: true },
        _count: { _all: true },
      }),
      // Ramp, in range
      prisma.rampTransaction.aggregate({
        where: { status: { in: ['COMPLETED', 'PAYING_OUT'] }, createdAt: inRange },
        _sum: { platformFeeUsd: true, bridgeAmountUsdc: true },
        _count: { _all: true },
      }),
      // Ramp, fee by target asset, in range
      prisma.rampTransaction.groupBy({
        by: ['targetSymbol', 'kind'],
        where: { status: { in: ['COMPLETED', 'PAYING_OUT'] }, createdAt: inRange },
        _sum: { platformFeeUsd: true, bridgeAmountUsdc: true },
        _count: { _all: true },
      }),
      prisma.x402Payment.findMany({ where: { createdAt: inRange }, select: { amountAtomic: true, endpoint: true, payTo: true, network: true, settlementTxHash: true, createdAt: true } }),
      prisma.x402Attribution.findMany({ where: { createdAt: inRange }, select: { shareAtomic: true, payment: { select: { network: true } } } }).catch(() => []),
      prisma.x402SettlementOutbox.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => []),
      prisma.x402Payout.findMany({ where: { createdAt: inRange }, select: { status: true, amountAtomic: true } }).catch(() => []),
      prisma.$queryRaw<Array<{ creatorId: string; username: string | null; displayName: string | null; walletAddress: string | null; attributedAtomic: string; reservedAtomic: string; kycStatus: string | null; bushaCustomerId: string | null; fraudRiskScore: number | null; isFraudSuspended: boolean | null }>>`
        SELECT a."creatorId",
               MAX(COALESCE(u."username", a."creatorUsername")) AS username,
               MAX(COALESCE(u."displayName", a."creatorDisplayName")) AS "displayName",
               MAX(w."address") AS "walletAddress",
               SUM(a."shareAtomic"::numeric)::text AS "attributedAtomic",
               COALESCE(p."reservedAtomic", 0)::text AS "reservedAtomic",
               MAX(u."kycStatus"::text) AS "kycStatus",
               MAX(u."bushaCustomerId") AS "bushaCustomerId",
               MAX(u."fraudRiskScore") AS "fraudRiskScore",
               BOOL_OR(u."isFraudSuspended") AS "isFraudSuspended"
        FROM "X402Attribution" a
        LEFT JOIN "User" u ON u.id = a."creatorId"
        LEFT JOIN "UserWallet" w ON w."userId" = a."creatorId" AND w.chain = 'CELO' AND w."isPrimary" = true
        LEFT JOIN (
          SELECT "creatorId", SUM("amountAtomic"::numeric) AS "reservedAtomic"
          FROM "X402Payout"
          WHERE status IN ('PENDING', 'APPROVED', 'SUBMITTED', 'CONFIRMED')
          GROUP BY "creatorId"
        ) p ON p."creatorId" = a."creatorId"
        WHERE a."creatorId" IS NOT NULL
        GROUP BY a."creatorId", p."reservedAtomic"
        ORDER BY (SUM(a."shareAtomic"::numeric) - COALESCE(p."reservedAtomic", 0)) DESC
        LIMIT 100
      `.catch(() => []),
    ]);

    const x402Atomic = x402Payments.reduce((sum, payment) => sum + BigInt(payment.amountAtomic), 0n);
    const x402CreatorAtomic = x402Attributions.reduce((sum, attribution) => sum + BigInt(attribution.shareAtomic), 0n);
    // Sepolia and mainnet settle the same asset symbol but not the same money.
    // Keeping them in one bucket made test payments read as platform revenue.
    const x402NetworkTotals = new Map<string, { count: number; gross: bigint; creator: bigint }>();
    for (const payment of x402Payments) {
      const row = x402NetworkTotals.get(payment.network) ?? { count: 0, gross: 0n, creator: 0n };
      row.count += 1;
      row.gross += BigInt(payment.amountAtomic);
      x402NetworkTotals.set(payment.network, row);
    }
    for (const attribution of x402Attributions) {
      const network = attribution.payment?.network;
      if (!network) continue;
      const row = x402NetworkTotals.get(network) ?? { count: 0, gross: 0n, creator: 0n };
      row.creator += BigInt(attribution.shareAtomic);
      x402NetworkTotals.set(network, row);
    }
    const x402Mainnet = x402NetworkTotals.get('eip155:42220') ?? { count: 0, gross: 0n, creator: 0n };
    const x402OutboxByStatus = Object.fromEntries(x402Outbox.map((row) => [row.status, row._count._all]));
    const endpointTotals = new Map<string, { count: number; amount: bigint }>();
    for (const row of x402Payments) { const current = endpointTotals.get(row.endpoint) ?? { count: 0, amount: 0n }; current.count += 1; current.amount += BigInt(row.amountAtomic); endpointTotals.set(row.endpoint, current); }
    const payoutTotals = new Map<string, { count: number; amount: bigint }>();
    for (const row of x402PayoutRows) { const current = payoutTotals.get(row.status) ?? { count: 0, amount: 0n }; current.count += 1; current.amount += BigInt(row.amountAtomic); payoutTotals.set(row.status, current); }

    // MRR from active subs
    let mrrUsd = 0;
    const subsByPlan = activeSubs.map((s) => {
      const monthly = (PLAN_MONTHLY_USD[s.plan] ?? 0) * s._count._all;
      mrrUsd += monthly;
      return { plan: s.plan, activeCount: s._count._all, monthlyUsd: monthly };
    });

    // ── Consolidated revenue (USD, in range) ──────────────────────────────────
    // The headline metric: what the platform actually earned across every fee
    // surface, gift fees, Pro subscriptions, paid boosts, and ramp spread.
    // $LIVR gift fees convert at the fixed reference price; USDT/USDC each peg to
    // $1 but are summed from their own buckets so the two stablecoins never mix.
    const giftFeeLivr = giftFees.find((g) => g.tokenType === 'LIVR')?._sum.platformFee ?? 0;
    const giftFeeUsdt = giftFees.find((g) => g.tokenType === 'USDT')?._sum.platformFee ?? 0;
    const giftFeeUsdc = giftFees.find((g) => g.tokenType === 'USDC')?._sum.platformFee ?? 0;
    const giftFeesUsd = giftFeeUsdt + giftFeeUsdc + giftFeeLivr * LIVR_PRICE_USD;
    const subscriptionsUsd = subRevenueRange._sum.subscriptionRevenueUsd ?? 0;
    const boostsUsd = boostAggRange._sum.amountPaidUsd ?? 0;
    const rampFeesUsd = rampRange._sum.platformFeeUsd ?? 0;
    // Headline platform revenue counts settled mainnet money only. Sepolia
    // volume is test data and must not inflate it.
    const x402PlatformUsd = Number(x402Mainnet.gross - x402Mainnet.creator) / 1_000_000;
    const totalRevenueUsd = giftFeesUsd + subscriptionsUsd + boostsUsd + rampFeesUsd + x402PlatformUsd;

    return {
      rangeDays: days,
      total: {
        revenueUsd: totalRevenueUsd,
        breakdown: {
          giftFeesUsd,
          subscriptionsUsd,
          boostsUsd,
          rampFeesUsd,
          x402GrossUsd: Number(x402Atomic) / 1_000_000,
          x402PlatformUsd,
        },
      },
      x402: {
        paymentCount: x402Payments.length,
        grossAtomic: x402Atomic.toString(),
        grossUsd: Number(x402Atomic) / 1_000_000,
        creatorAttributedAtomic: x402CreatorAtomic.toString(),
        creatorAttributedUsd: Number(x402CreatorAtomic) / 1_000_000,
        platformAtomic: (x402Atomic - x402CreatorAtomic).toString(),
        platformUsd: x402PlatformUsd,
        // Mainnet-only slice, the one that represents real money.
        mainnet: {
          paymentCount: x402Mainnet.count,
          grossAtomic: x402Mainnet.gross.toString(),
          grossUsd: Number(x402Mainnet.gross) / 1_000_000,
          creatorAttributedAtomic: x402Mainnet.creator.toString(),
          creatorAttributedUsd: Number(x402Mainnet.creator) / 1_000_000,
          platformAtomic: (x402Mainnet.gross - x402Mainnet.creator).toString(),
          platformUsd: x402PlatformUsd,
        },
        byNetwork: [...x402NetworkTotals.entries()].map(([network, row]) => ({
          network,
          count: row.count,
          grossAtomic: row.gross.toString(),
          grossUsd: Number(row.gross) / 1_000_000,
          creatorAttributedAtomic: row.creator.toString(),
          creatorAttributedUsd: Number(row.creator) / 1_000_000,
          platformUsd: Number(row.gross - row.creator) / 1_000_000,
        })),
        byEndpoint: [...endpointTotals.entries()].map(([endpoint, row]) => ({ endpoint, count: row.count, amountAtomic: row.amount.toString(), amountUsd: Number(row.amount) / 1_000_000 })),
        treasuryReceipts: x402Payments.map((payment) => ({ txHash: payment.settlementTxHash, payTo: payment.payTo, network: payment.network, amountAtomic: payment.amountAtomic, createdAt: payment.createdAt.toISOString() })).slice(0, 100),
        outbox: { pending: x402OutboxByStatus.PENDING ?? 0, retrying: x402OutboxByStatus.RETRYING ?? 0, failed: x402OutboxByStatus.FAILED ?? 0, completed: x402OutboxByStatus.COMPLETED ?? 0 },
        payouts: [...payoutTotals.entries()].map(([status, row]) => ({ status, count: row.count, amountAtomic: row.amount.toString(), amountUsd: Number(row.amount) / 1_000_000 })),
        creatorBalances: x402CreatorBalances.map((row) => {
          const outstandingAtomic = BigInt(row.attributedAtomic) - BigInt(row.reservedAtomic);
          // The gate works off the same helper the payout routes use, so this
          // panel can never tell an admin a creator is payable when the API
          // would refuse the batch.
          const state = row.kycStatus
            ? {
                kycStatus: row.kycStatus as KycStatus,
                bushaCustomerId: row.bushaCustomerId,
                fraudRiskScore: row.fraudRiskScore ?? 0,
                isFraudSuspended: row.isFraudSuspended ?? false,
                hasPrimaryCeloWallet: Boolean(row.walletAddress),
              }
            : null;
          const blockers: PayoutBlocker[] = state ? payoutBlockers(state) : ['ACCOUNT_MISSING'];
          return {
            ...row,
            outstandingAtomic: outstandingAtomic.toString(),
            outstandingUsd: Number(outstandingAtomic) / 1_000_000,
            kycSource: state ? kycSource(state) : null,
            eligible: blockers.length === 0,
            blockers,
            blockerMessages: blockers.map((blocker) => PAYOUT_BLOCKER_TEXT[blocker]),
          };
        }),
      },
      giftFees: giftFees.map((g) => ({
        token: g.tokenType,
        platformFee: g._sum.platformFee ?? 0,
        grossAmount: g._sum.amount ?? 0,
        creatorPayout: g._sum.creatorAmount ?? 0,
        count: g._count._all,
      })),
      subscriptions: {
        mrrUsd,
        arrUsd: mrrUsd * 12,
        byPlan: subsByPlan,
        newInRange: newSubs,
      },
      boosts: {
        revenueAllTimeUsd: boostAgg._sum.amountPaidUsd ?? 0,
        revenueInRangeUsd: boostAggRange._sum.amountPaidUsd ?? 0,
        activeCampaigns: activeBoostCount,
      },
      ramp: {
        feeAllTimeUsd: rampAllTime._sum.platformFeeUsd ?? 0,
        feeInRangeUsd: rampRange._sum.platformFeeUsd ?? 0,
        volumeAllTimeUsd: rampAllTime._sum.bridgeAmountUsdc ?? 0,
        volumeInRangeUsd: rampRange._sum.bridgeAmountUsdc ?? 0,
        countInRange: rampRange._count._all,
        byTarget: rampByTarget.map((r) => ({
          targetSymbol: r.targetSymbol,
          kind: r.kind,
          feeUsd: r._sum.platformFeeUsd ?? 0,
          volumeUsd: r._sum.bridgeAmountUsdc ?? 0,
          count: r._count._all,
        })),
      },
      // Revenue streams not yet wired, surfaced so the page shows the full P&L shape.
      pending: [
        { key: 'ads', label: 'Advertising', note: 'Sponsored feed placements (coming later)' },
      ],
      generatedAt: new Date().toISOString(),
    };
  });

  app.get<{ Querystring: { days?: string; from?: string; to?: string } }>('/timeseries', async (request) => {
    const { since, to } = parseRange(request.query);
    const rows = await prisma.platformDailyRollup.findMany({
      where: { date: { gte: since, lte: to } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        platformFeeLivr: true,
        platformFeeUsdt: true,
        platformFeeUsdc: true,
        subscriptionRevenueUsd: true,
        newProSubs: true,
        subsCanceled: true,
        rampFeeUsd: true,
        rampVolumeUsd: true,
        rampCount: true,
      },
    });
    return {
      rows: rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        platformFeeLivr: r.platformFeeLivr,
        platformFeeUsdt: r.platformFeeUsdt,
        platformFeeUsdc: r.platformFeeUsdc,
        subscriptionRevenueUsd: r.subscriptionRevenueUsd,
        newProSubs: r.newProSubs,
        subsCanceled: r.subsCanceled,
        rampFeeUsd: r.rampFeeUsd,
        rampVolumeUsd: r.rampVolumeUsd,
        rampCount: r.rampCount,
      })),
    };
  });
};
