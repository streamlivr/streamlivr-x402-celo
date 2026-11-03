/**
 * Revenue allocation engine for intelligence requests.
 *
 * Splits a settled x402 payment between eligible creators and the platform
 * treasury. Reuses the 60/40 split constants from `src/x402/split.ts` and
 * follows the same BigInt string arithmetic pattern for exact, rounding-free
 * allocation.
 *
 * The critical invariant enforced by every code path:
 *   `sum(creatorAllocations) + platformAllocation === settledDistributableAmount`
 *
 * No floating point is used for monetary values anywhere in this module.
 */
import { CREATOR_SHARE_BPS, PLATFORM_SHARE_BPS, BPS_DENOMINATOR } from '../../x402/split.js';
import { generateAttributionKey } from '../utils/idempotency.js';
import type { AttributionStatus } from '../types.js';
import type { RequestClassification } from './classifier.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatorVerificationState {
    creatorId: string;
    exists: boolean;
    isVerified: boolean;
    isLinked: boolean;
    isEligible: boolean;
    walletAddress?: string;
}

export interface AllocationInput {
    requestId: string;
    settledAmountAtomic: string;
    classification: RequestClassification;
    creatorStates: Map<string, CreatorVerificationState>;
}

export interface CreatorAllocation {
    creatorId: string;
    amountAtomic: string;
    attributionStatus: AttributionStatus;
    shareBps: number;
}

export interface AllocationResult {
    requestId: string;
    settledAmountAtomic: string;
    creatorAllocations: CreatorAllocation[];
    platformAllocationAtomic: string;
    totalAllocatedAtomic: string;
    reconciled: boolean;
}

export interface IntelligenceAttributionEntry {
    requestId: string;
    creatorId: string | null;
    dataEntityId?: string;
    dataEntityType?: string;
    attributableValueAtomic: string;
    attributionStatus: AttributionStatus;
    verificationSnapshot: Record<string, unknown>;
    idempotencyKey: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether a creator is eligible for revenue share.
 * Only verified + linked creators receive direct revenue allocation.
 */
function isEligibleForRevenue(state: CreatorVerificationState): boolean {
    return state.exists && state.isVerified && state.isLinked && state.isEligible;
}

/**
 * Derives the attribution status from a creator's verification state.
 */
function statusFromState(state: CreatorVerificationState): AttributionStatus {
    if (!state.exists) return 'unknown';
    if (!state.isEligible) return 'ineligible';
    if (!state.isLinked) return 'unlinked';
    if (!state.isVerified) return 'linked_unverified';
    return 'verified_linked';
}

// ---------------------------------------------------------------------------
// Core allocation
// ---------------------------------------------------------------------------

/**
 * Allocates revenue from a settled x402 intelligence payment.
 *
 * Business rules:
 * - The 60% creator pool is divided equally among eligible (verified + linked)
 *   creators.
 * - Ineligible creators' shares go to the platform treasury.
 * - Platform-owned requests route 100% to the platform.
 * - The allocation always reconciles exactly with no remainder.
 */
export function allocateIntelligenceRevenue(input: AllocationInput): AllocationResult {
    const { requestId, settledAmountAtomic, classification, creatorStates } = input;
    const settled = BigInt(settledAmountAtomic);

    // Platform-owned or non-attributable — 100% to platform
    if (
        classification.type === 'platform_owned' ||
        classification.type === 'non_attributable' ||
        classification.involvedCreatorIds.length === 0
    ) {
        return {
            requestId,
            settledAmountAtomic,
            creatorAllocations: [],
            platformAllocationAtomic: settled.toString(),
            totalAllocatedAtomic: settled.toString(),
            reconciled: true,
        };
    }

    // Identify eligible creators
    const eligibleCreators: CreatorVerificationState[] = [];
    for (const creatorId of classification.involvedCreatorIds) {
        const state = creatorStates.get(creatorId);
        if (state && isEligibleForRevenue(state)) {
            eligibleCreators.push(state);
        }
    }

    // No eligible creators — 100% to platform
    if (eligibleCreators.length === 0) {
        return {
            requestId,
            settledAmountAtomic,
            creatorAllocations: [],
            platformAllocationAtomic: settled.toString(),
            totalAllocatedAtomic: settled.toString(),
            reconciled: true,
        };
    }

    // Calculate the creator pool (60% of settled amount)
    const creatorPool = (settled * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
    const eligibleCount = BigInt(eligibleCreators.length);

    // Divide equally among eligible creators, distributing remainder one unit at
    // a time in order (same pattern as calculateAttributionShares in split.ts)
    const base = creatorPool / eligibleCount;
    let remainder = creatorPool % eligibleCount;

    // BPS per creator
    const baseBps = CREATOR_SHARE_BPS / eligibleCount;
    let bpsRemainder = CREATOR_SHARE_BPS % eligibleCount;

    const creatorAllocations: CreatorAllocation[] = eligibleCreators.map((state) => {
        const amount = base + (remainder-- > 0n ? 1n : 0n);
        const bps = Number(baseBps + (bpsRemainder-- > 0n ? 1n : 0n));
        return {
            creatorId: state.creatorId,
            amountAtomic: amount.toString(),
            attributionStatus: 'verified_linked' as AttributionStatus,
            shareBps: bps,
        };
    });

    // Platform gets everything that was not allocated to creators
    const totalCreatorAmount = creatorAllocations.reduce(
        (sum, alloc) => sum + BigInt(alloc.amountAtomic),
        0n,
    );
    const platformAllocation = settled - totalCreatorAmount;

    const totalAllocated = totalCreatorAmount + platformAllocation;

    return {
        requestId,
        settledAmountAtomic,
        creatorAllocations,
        platformAllocationAtomic: platformAllocation.toString(),
        totalAllocatedAtomic: totalAllocated.toString(),
        reconciled: totalAllocated === settled,
    };
}

// ---------------------------------------------------------------------------
// Ledger entry builder
// ---------------------------------------------------------------------------

/**
 * Generates ledger entries for each attribution in an allocation result.
 * Each entry includes a verification snapshot capturing the creator's state
 * at the time of allocation and an idempotency key for deduplication.
 */
export function buildAttributionLedgerEntries(
    allocation: AllocationResult,
    creatorStates?: Map<string, CreatorVerificationState>,
    entityId?: string,
    entityType?: string,
): IntelligenceAttributionEntry[] {
    const entries: IntelligenceAttributionEntry[] = [];

    // Creator entries
    for (const creatorAlloc of allocation.creatorAllocations) {
        const state = creatorStates?.get(creatorAlloc.creatorId);
        entries.push({
            requestId: allocation.requestId,
            creatorId: creatorAlloc.creatorId,
            dataEntityId: entityId,
            dataEntityType: entityType,
            attributableValueAtomic: creatorAlloc.amountAtomic,
            attributionStatus: creatorAlloc.attributionStatus,
            verificationSnapshot: state
                ? {
                    exists: state.exists,
                    isVerified: state.isVerified,
                    isLinked: state.isLinked,
                    isEligible: state.isEligible,
                    walletAddress: state.walletAddress ?? null,
                }
                : {},
            idempotencyKey: generateAttributionKey(allocation.requestId, creatorAlloc.creatorId),
        });
    }

    // Platform entry (if there is a platform allocation)
    if (BigInt(allocation.platformAllocationAtomic) > 0n) {
        entries.push({
            requestId: allocation.requestId,
            creatorId: null,
            dataEntityId: entityId,
            dataEntityType: entityType,
            attributableValueAtomic: allocation.platformAllocationAtomic,
            attributionStatus: 'platform_owned',
            verificationSnapshot: { reason: 'platform_treasury' },
            idempotencyKey: generateAttributionKey(allocation.requestId, null),
        });
    }

    return entries;
}
