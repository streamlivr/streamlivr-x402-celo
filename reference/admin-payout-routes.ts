import type { FastifyPluginAsync } from 'fastify';
import { UserRole, type X402Payout } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { adminAuth, getAdmin, writeAudit } from '../../middleware/adminAuth.js';
import { X402_ASSET_ADDRESS, X402_ATTRIBUTION_TAG, X402_FEE_CURRENCY, X402_NETWORK } from '../../x402/config.js';
import { buildAttributionSuffix } from '../../x402/attribution.js';
import { computeCreatorBalances, selectPayableCreators } from '../../x402/payoutMath.js';
import {
  isPayoutEligible,
  kycSource,
  PAYOUT_BLOCKER_TEXT,
  payoutBlockers,
  type PayoutBlocker,
} from '../../x402/kyc.js';
import { localKycOverrideEnabled, LocalKycOverrideDisabledError, markLocalKycVerified } from '../../x402/localOverride.js';
import { refreshRampKyc } from '../../services/rampService.js';
import { createWalletClient, http, parseAbi, publicActions } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';

const erc20 = parseAbi(['function transfer(address to, uint256 value) returns (bool)']);
const MIN_PAYOUT = 1_000_000n;
const STUCK_SUBMISSION_MS = 10 * 60_000;

/**
 * Treasury sends must never run concurrently: two in-flight transfers would be
 * assigned the same account nonce and one would silently replace the other.
 * Admin-initiated payouts are low volume, so a single in-process queue is
 * enough here. A horizontally scaled deployment must move this serialization
 * to a distributed lock before running more than one API instance.
 */
let payoutChain: Promise<unknown> = Promise.resolve();
function serializePayout<T>(task: () => Promise<T>): Promise<T> {
  const run = payoutChain.then(task, task);
  payoutChain = run.catch(() => undefined);
  return run;
}

function treasuryClient() {
  const key = process.env.X402_TREASURY_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  const chain = X402_NETWORK === 'eip155:42220' ? celo : celoSepolia;
  const account = privateKeyToAccount(key);
  const client = createWalletClient({
    account,
    chain,
    transport: http(process.env.X402_TREASURY_RPC_URL ?? (chain === celo ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org')),
  }).extend(publicActions);
  return { client, treasuryAddress: account.address };
}

export const adminX402Routes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', adminAuth({ minRole: UserRole.ANALYST }));

  app.get('/payouts', async () => {
    const rows = await prisma.x402Payout.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    // The UI hides the local-verify button unless the API says the override is
    // live, so a production deployment never renders it.
    return { rows, localKycOverrideEnabled: localKycOverrideEnabled() };
  });

  /**
   * Why each creator is or isn't payable: KYC status and its source, fraud
   * state, wallet, and the blockers keeping anyone out of a batch.
   */
  app.get('/creators', async () => {
    const [attributions, payoutHistory] = await Promise.all([
      prisma.x402Attribution.findMany({ where: { creatorId: { not: null } }, select: { creatorId: true, creatorUsername: true, shareAtomic: true } }),
      prisma.x402Payout.findMany({ where: { creatorId: { not: null } }, select: { creatorId: true, amountAtomic: true, status: true } }),
    ]);
    const balances = computeCreatorBalances(attributions, payoutHistory);
    const users = await prisma.user.findMany({
      where: { id: { in: balances.map((balance) => balance.creatorId) } },
      select: {
        id: true,
        username: true,
        displayName: true,
        kycStatus: true,
        bushaCustomerId: true,
        fraudRiskScore: true,
        isFraudSuspended: true,
        wallets: { where: { chain: 'CELO', isPrimary: true }, select: { address: true }, take: 1 },
      },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
      localKycOverrideEnabled: localKycOverrideEnabled(),
      rows: balances.map((balance) => {
        const user = byId.get(balance.creatorId);
        const state = user ? { ...user, hasPrimaryCeloWallet: user.wallets.length > 0 } : null;
        const blockers: PayoutBlocker[] = state ? payoutBlockers(state) : ['ACCOUNT_MISSING'];
        return {
          creatorId: balance.creatorId,
          username: user?.username ?? balance.username,
          displayName: user?.displayName ?? null,
          attributedAtomic: balance.attributedAtomic,
          reservedAtomic: balance.reservedAtomic,
          outstandingAtomic: balance.outstandingAtomic,
          walletAddress: user?.wallets[0]?.address ?? null,
          kycStatus: user?.kycStatus ?? null,
          kycSource: state ? kycSource(state) : null,
          hasBushaCustomer: Boolean(user?.bushaCustomerId),
          fraudRiskScore: user?.fraudRiskScore ?? null,
          isFraudSuspended: user?.isFraudSuspended ?? null,
          eligible: blockers.length === 0,
          blockers,
          blockerMessages: blockers.map((blocker) => PAYOUT_BLOCKER_TEXT[blocker]),
        };
      }),
    };
  });

  /**
   * Pull one creator's status from the provider and persist it, without waiting
   * for the reconcile worker.
   */
  app.post<{ Params: { id: string } }>('/creators/:id/kyc/refresh', async (request, reply) => {
    const admin = await getAdmin(request);
    if (!admin || admin.role !== UserRole.SUPER_ADMIN) return reply.status(403).send({ error: 'SUPER_ADMIN required' });
    const user = await prisma.user.findUnique({ where: { id: request.params.id }, select: { id: true, bushaCustomerId: true } });
    if (!user) return reply.status(404).send({ error: 'Creator not found' });
    if (!user.bushaCustomerId) {
      return reply.status(409).send({
        error: 'This account has no Busha customer, so there is no provider status to pull. The creator has to run verification in the app first.',
      });
    }
    const view = await refreshRampKyc(user.id);
    await writeAudit(request, {
      action: 'x402.creator.kyc_refresh',
      targetType: 'User',
      targetId: user.id,
      metadata: { kycStatus: view.kycStatus, bushaCustomerId: user.bushaCustomerId },
    });
    return { kycStatus: view.kycStatus, rejectionReason: view.rejectionReason ?? null };
  });

  /**
   * Development only: mark a creator VERIFIED without a provider review. See
   * x402/kyc.ts for the production guard.
   */
  app.post<{ Params: { id: string } }>('/creators/:id/kyc/local-verify', async (request, reply) => {
    const admin = await getAdmin(request);
    if (!admin || admin.role !== UserRole.SUPER_ADMIN) return reply.status(403).send({ error: 'SUPER_ADMIN required' });
    const user = await prisma.user.findUnique({ where: { id: request.params.id }, select: { id: true, username: true, bushaCustomerId: true } });
    if (!user) return reply.status(404).send({ error: 'Creator not found' });
    try {
      const { previous, current } = await markLocalKycVerified(user.id);
      await writeAudit(request, {
        action: 'x402.creator.kyc_local_override',
        targetType: 'User',
        targetId: user.id,
        metadata: { previous, current, bushaCustomerId: user.bushaCustomerId },
      });
      return { kycStatus: current, previous, localOverride: true };
    } catch (error) {
      if (error instanceof LocalKycOverrideDisabledError) return reply.status(403).send({ error: error.message });
      throw error;
    }
  });

  app.post('/payouts/prepare', async (request, reply) => {
    const admin = await getAdmin(request);
    if (!admin || admin.role !== UserRole.SUPER_ADMIN) return reply.status(403).send({ error: 'SUPER_ADMIN required' });
    const body = z.object({ batchKey: z.string().min(3).max(80).optional(), minimumAtomic: z.string().regex(/^\d+$/).optional() }).parse(request.body ?? {});
    const batchKey = body.batchKey ?? `x402-${new Date().toISOString().slice(0, 10)}`;
    const minimum = BigInt(body.minimumAtomic ?? MIN_PAYOUT.toString());
    const [attributions, payoutHistory] = await Promise.all([
      prisma.x402Attribution.findMany({ where: { creatorId: { not: null } }, select: { creatorId: true, creatorUsername: true, shareAtomic: true } }),
      prisma.x402Payout.findMany({ where: { creatorId: { not: null } }, select: { creatorId: true, amountAtomic: true, status: true } }),
    ]);
    const balances = selectPayableCreators(computeCreatorBalances(attributions, payoutHistory), minimum);
    // Fetched unfiltered so a creator who fails the gate lands in `skipped` with a
    // reason, instead of vanishing from a batch with no explanation.
    const candidates = await prisma.user.findMany({
      where: { id: { in: balances.map((balance) => balance.creatorId) } },
      select: {
        id: true,
        username: true,
        kycStatus: true,
        bushaCustomerId: true,
        fraudRiskScore: true,
        isFraudSuspended: true,
        wallets: { where: { chain: 'CELO', isPrimary: true }, select: { address: true }, take: 1 },
      },
    });
    const eligibleById = new Map(
      candidates
        .map((creator) => ({ ...creator, hasPrimaryCeloWallet: creator.wallets.length > 0 }))
        .filter(isPayoutEligible)
        .map((creator) => [creator.id, creator] as const),
    );
    const created = [];
    const skipped: Array<{ creatorId: string; username: string | null; outstandingAtomic: string; blockers: PayoutBlocker[]; blockerMessages: string[] }> = [];
    for (const balance of balances) {
      const { creatorId } = balance;
      const wallet = eligibleById.get(creatorId)?.wallets[0]?.address;
      if (!wallet) {
        const blocked = candidates.find((candidate) => candidate.id === creatorId);
        const blockers = blocked ? payoutBlockers({ ...blocked, hasPrimaryCeloWallet: blocked.wallets.length > 0 }) : (['ACCOUNT_MISSING'] as PayoutBlocker[]);
        skipped.push({
          creatorId,
          username: blocked?.username ?? balance.username,
          outstandingAtomic: balance.outstandingAtomic,
          blockers,
          blockerMessages: blockers.map((blocker) => PAYOUT_BLOCKER_TEXT[blocker]),
        });
        continue;
      }
      created.push(await prisma.x402Payout.upsert({ where: { batchKey_creatorId_walletAddress: { batchKey, creatorId, walletAddress: wallet } }, create: { creatorId, creatorUsername: eligibleById.get(creatorId)?.username ?? balance.username, walletAddress: wallet, network: X402_NETWORK, assetAddress: X402_ASSET_ADDRESS, amountAtomic: balance.outstandingAtomic, batchKey }, update: { amountAtomic: balance.outstandingAtomic, status: 'PENDING', failureReason: null } }));
    }
    await writeAudit(request, { action: 'x402.payout.prepare', metadata: { batchKey, minimumAtomic: minimum.toString(), created: created.length, skipped: skipped.length } });
    return { batchKey, created: created.length, rows: created, skipped };
  });

  app.post<{ Params: { id: string } }>('/payouts/:id/approve', async (request, reply) => {
    const admin = await getAdmin(request);
    if (!admin || admin.role !== UserRole.SUPER_ADMIN) return reply.status(403).send({ error: 'SUPER_ADMIN required' });
    const existing = await prisma.x402Payout.findFirst({ where: { id: request.params.id, status: 'PENDING' } });
    const row = existing ? await prisma.x402Payout.update({ where: { id: existing.id }, data: { status: 'APPROVED', approvedBy: admin.sub } }) : null;
    if (!row) return reply.status(404).send({ error: 'Pending payout not found' });
    await writeAudit(request, { action: 'x402.payout.approve', targetType: 'X402Payout', targetId: row.id, metadata: { amountAtomic: row.amountAtomic, walletAddress: row.walletAddress } });
    return { payout: row };
  });

  app.post<{ Params: { id: string } }>('/payouts/:id/cancel', async (request, reply) => {
    const admin = await getAdmin(request);
    if (admin.role !== UserRole.SUPER_ADMIN) return reply.status(403).send({ error: 'SUPER_ADMIN required' });
    const result = await prisma.x402Payout.updateMany({ where: { id: request.params.id, status: { in: ['PENDING', 'APPROVED', 'FAILED'] } }, data: { status: 'CANCELLED', failureReason: 'Cancelled by administrator' } });
    if (result.count !== 1) return reply.status(409).send({ error: 'Only pending, approved, or failed payouts can be cancelled' });
    await writeAudit(request, { action: 'x402.payout.cancel', targetType: 'X402Payout', targetId: request.params.id });
    return { payout: await prisma.x402Payout.findUnique({ where: { id: request.params.id } }) };
  });

  app.post<{ Params: { id: string } }>('/payouts/:id/execute', async (request, reply) => {
    const admin = await getAdmin(request);
    if (!admin || admin.role !== UserRole.SUPER_ADMIN) return reply.status(403).send({ error: 'SUPER_ADMIN required' });
    const row = await prisma.x402Payout.findUnique({ where: { id: request.params.id } });
    if (!row || row.status !== 'APPROVED') return reply.status(409).send({ error: 'Payout must be approved first' });
    if (!row.creatorId) return reply.status(409).send({ error: 'Creator account no longer exists; manual review required' });
    const creator = await prisma.user.findUnique({
      where: { id: row.creatorId },
      select: { isFraudSuspended: true, fraudRiskScore: true, kycStatus: true, bushaCustomerId: true, wallets: { where: { chain: 'CELO', isPrimary: true }, select: { address: true }, take: 1 } },
    });
    if (!creator) return reply.status(409).send({ error: 'Creator account no longer exists; manual review required' });
    // Re-checked at execute time, not just at prepare: KYC, fraud state, or the
    // verified wallet can all change between a batch being prepared and sent.
    const blockers = payoutBlockers({ ...creator, hasPrimaryCeloWallet: creator.wallets.length > 0 });
    if (blockers.length) {
      return reply.status(409).send({
        error: 'Creator is not currently eligible for payout',
        blockers,
        blockerMessages: blockers.map((blocker) => PAYOUT_BLOCKER_TEXT[blocker]),
      });
    }
    if (creator.wallets[0]?.address.toLowerCase() !== row.walletAddress.toLowerCase()) {
      return reply.status(409).send({ error: 'Verified payout wallet changed; cancel and prepare a new payout' });
    }
    const treasury = treasuryClient();
    if (!treasury) return reply.status(503).send({ error: 'Treasury signer is not configured' });

    const outcome = await serializePayout<ExecuteOutcome>(async () => {
      const claimed = await prisma.x402Payout.updateMany({ where: { id: row.id, status: 'APPROVED' }, data: { status: 'SUBMITTED', attempts: { increment: 1 }, submittedAt: new Date(), failureReason: null } });
      if (claimed.count !== 1) return { kind: 'conflict', message: 'Payout is already being processed' };

      // Every treasury-signed transaction carries the ERC-8021 attribution tag.
      // The tag is calldata-only metadata: the token contract never sees it.
      const dataSuffix = buildAttributionSuffix();
      let txHash: `0x${string}`;
      try {
        txHash = await treasury.client.writeContract({
          address: row.assetAddress as `0x${string}`,
          abi: erc20,
          functionName: 'transfer',
          args: [row.walletAddress as `0x${string}`, BigInt(row.amountAtomic)],
          ...(dataSuffix ? { dataSuffix } : {}),
          ...(X402_FEE_CURRENCY ? { feeCurrency: X402_FEE_CURRENCY } : {}),
        });
      } catch (error) {
        // The transfer never left the treasury, so it is safe to release the row.
        const payout = await prisma.x402Payout.update({ where: { id: row.id }, data: { status: 'FAILED', failureReason: error instanceof Error ? error.message.slice(0, 500) : 'Broadcast failed before submission' } });
        return { kind: 'broadcast-failed', payout };
      }

      // Record the hash before confirming: if confirmation times out, the
      // on-chain transfer must stay reconcilable rather than look unsent.
      await prisma.x402Payout.update({ where: { id: row.id }, data: { txHash } });
      try {
        const receipt = await treasury.client.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
        const payout = await prisma.x402Payout.update({ where: { id: row.id }, data: receipt.status === 'success' ? { status: 'CONFIRMED', confirmedAt: new Date(), failureReason: null } : { status: 'FAILED', confirmedAt: new Date(), failureReason: 'Transaction reverted on-chain' } });
        return { kind: 'settled', payout };
      } catch {
        const payout = await prisma.x402Payout.update({ where: { id: row.id }, data: { failureReason: 'Broadcast; confirmation pending reconciliation' } });
        return { kind: 'pending', payout };
      }
    });

    if (outcome.kind === 'conflict') return reply.status(409).send({ error: outcome.message });
    if (outcome.kind === 'broadcast-failed') {
      await writeAudit(request, { action: 'x402.payout.broadcast_failed', targetType: 'X402Payout', targetId: row.id, success: false, metadata: { amountAtomic: row.amountAtomic, failureReason: outcome.payout.failureReason } });
      return reply.status(502).send({ error: outcome.payout.failureReason, payout: outcome.payout });
    }
    await writeAudit(request, {
      action: outcome.kind === 'pending' ? 'x402.payout.broadcast_pending' : 'x402.payout.confirmed',
      targetType: 'X402Payout',
      targetId: row.id,
      metadata: {
        txHash: outcome.payout.txHash,
        amountAtomic: row.amountAtomic,
        attributionTag: X402_ATTRIBUTION_TAG ?? null,
        feeCurrency: X402_FEE_CURRENCY ?? null,
      },
    });
    if (outcome.kind === 'pending') return reply.status(202).send({ payout: outcome.payout, pendingConfirmation: true });
    return { payout: outcome.payout };
  });

  /**
   * Terminal step for payouts whose confirmation was never observed. A row with
   * a recorded hash is resolved from the chain and never re-sent; a row with no
   * hash is only released after the claim is old enough that no broadcast can
   * still be in flight.
   */
  app.post<{ Params: { id: string } }>('/payouts/:id/reconcile', async (request, reply) => {
    const admin = await getAdmin(request);
    if (admin.role !== UserRole.SUPER_ADMIN) return reply.status(403).send({ error: 'SUPER_ADMIN required' });
    const row = await prisma.x402Payout.findUnique({ where: { id: request.params.id } });
    if (!row) return reply.status(404).send({ error: 'Payout not found' });
    if (row.status !== 'SUBMITTED') return reply.status(409).send({ error: 'Only submitted payouts can be reconciled' });
    const treasury = treasuryClient();
    if (!treasury) return reply.status(503).send({ error: 'Treasury signer is not configured' });
    try {
      if (!row.txHash) {
        const claimedAt = row.submittedAt ?? row.updatedAt;
        if (Date.now() - claimedAt.getTime() < STUCK_SUBMISSION_MS) return reply.status(409).send({ error: 'Payout was claimed recently; wait before reconciling' });
        const payout = await prisma.x402Payout.update({ where: { id: row.id }, data: { status: 'FAILED', failureReason: 'No transaction hash recorded; verify treasury nonce before replaying' } });
        await writeAudit(request, { action: 'x402.payout.reconcile_stuck', targetType: 'X402Payout', targetId: row.id, success: false, metadata: { amountAtomic: row.amountAtomic } });
        return { payout, reconciled: 'failed-without-broadcast' };
      }
      const receipt = await treasury.client.getTransactionReceipt({ hash: row.txHash as `0x${string}` });
      if (!receipt) return { payout: row, reconciled: 'pending' };
      const payout = await prisma.x402Payout.update({ where: { id: row.id }, data: receipt.status === 'success' ? { status: 'CONFIRMED', confirmedAt: new Date(), failureReason: null } : { status: 'FAILED', confirmedAt: new Date(), failureReason: 'Transaction reverted on-chain' } });
      await writeAudit(request, { action: 'x402.payout.reconciled', targetType: 'X402Payout', targetId: row.id, metadata: { txHash: row.txHash, status: payout.status } });
      return { payout, reconciled: payout.status.toLowerCase() };
    } catch (error) {
      return reply.status(502).send({ error: error instanceof Error ? error.message : 'Reconciliation failed' });
    }
  });
};

type ExecuteOutcome =
  | { kind: 'conflict'; message: string }
  | { kind: 'broadcast-failed'; payout: X402Payout }
  | { kind: 'pending'; payout: X402Payout }
  | { kind: 'settled'; payout: X402Payout };
