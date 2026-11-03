import { describe, expect, it } from 'vitest';
import {
    allocateIntelligenceRevenue,
    buildAttributionLedgerEntries,
    type AllocationInput,
    type CreatorVerificationState,
} from './allocator.js';
import { CREATOR_SHARE_BPS, PLATFORM_SHARE_BPS, BPS_DENOMINATOR } from '../../x402/split.js';
import type { RequestClassification } from './classifier.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function verifiedLinkedState(creatorId: string, wallet = '0xABC'): CreatorVerificationState {
    return { creatorId, exists: true, isVerified: true, isLinked: true, isEligible: true, walletAddress: wallet };
}

function linkedUnverifiedState(creatorId: string): CreatorVerificationState {
    return { creatorId, exists: true, isVerified: false, isLinked: true, isEligible: true };
}

function unlinkedState(creatorId: string): CreatorVerificationState {
    return { creatorId, exists: true, isVerified: false, isLinked: false, isEligible: true };
}

function unknownState(creatorId: string): CreatorVerificationState {
    return { creatorId, exists: false, isVerified: false, isLinked: false, isEligible: false };
}

function ineligibleState(creatorId: string): CreatorVerificationState {
    return { creatorId, exists: true, isVerified: true, isLinked: true, isEligible: false };
}

function creatorSpecific(creatorId: string): RequestClassification {
    return {
        type: 'creator_specific',
        primaryCreatorId: creatorId,
        involvedCreatorIds: [creatorId],
        involvedEntityIds: [],
        platformOwnedCount: 0,
        attributableCount: 1,
    };
}

function multiCreatorSearch(creatorIds: string[]): RequestClassification {
    return {
        type: 'creator_search',
        involvedCreatorIds: creatorIds,
        involvedEntityIds: [],
        platformOwnedCount: 0,
        attributableCount: creatorIds.length,
    };
}

function platformOwned(): RequestClassification {
    return {
        type: 'platform_owned',
        involvedCreatorIds: [],
        involvedEntityIds: ['e1'],
        platformOwnedCount: 1,
        attributableCount: 0,
    };
}

/** Asserts the critical reconciliation invariant. */
function assertReconciliation(result: ReturnType<typeof allocateIntelligenceRevenue>): void {
    const creatorTotal = result.creatorAllocations.reduce(
        (sum, a) => sum + BigInt(a.amountAtomic),
        0n,
    );
    const total = creatorTotal + BigInt(result.platformAllocationAtomic);
    expect(total.toString(), 'reconciliation: creatorAllocations + platformAllocation === settledAmount').toBe(
        result.settledAmountAtomic,
    );
    expect(result.totalAllocatedAtomic).toBe(result.settledAmountAtomic);
    expect(result.reconciled).toBe(true);
}

// ---------------------------------------------------------------------------
// PRD Section 20 test matrix
// ---------------------------------------------------------------------------

describe('allocateIntelligenceRevenue', () => {
    const ONE_CENT = '10000'; // 0.01 USDC in atomic units
    const TEN_CENTS = '100000'; // 0.10 USDC
    const FIFTY_CENTS = '500000'; // 0.50 USDC

    describe('single verified linked creator', () => {
        it('allocates 60% to creator and 40% to platform', () => {
            const states = new Map([['c1', verifiedLinkedState('c1')]]);
            const input: AllocationInput = {
                requestId: 'req-1',
                settledAmountAtomic: ONE_CENT,
                classification: creatorSpecific('c1'),
                creatorStates: states,
            };
            const result = allocateIntelligenceRevenue(input);

            expect(result.creatorAllocations).toHaveLength(1);
            expect(result.creatorAllocations[0].creatorId).toBe('c1');
            expect(result.creatorAllocations[0].attributionStatus).toBe('verified_linked');

            // 60% of 10000 = 6000
            const expectedCreator = (BigInt(ONE_CENT) * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
            expect(result.creatorAllocations[0].amountAtomic).toBe(expectedCreator.toString());
            // 40% of 10000 = 4000
            const expectedPlatform = BigInt(ONE_CENT) - expectedCreator;
            expect(result.platformAllocationAtomic).toBe(expectedPlatform.toString());

            assertReconciliation(result);
        });
    });

    describe('linked but unverified creator', () => {
        it('routes 100% to platform treasury', () => {
            const states = new Map([['c1', linkedUnverifiedState('c1')]]);
            const input: AllocationInput = {
                requestId: 'req-2',
                settledAmountAtomic: ONE_CENT,
                classification: creatorSpecific('c1'),
                creatorStates: states,
            };
            const result = allocateIntelligenceRevenue(input);

            expect(result.creatorAllocations).toHaveLength(0);
            expect(result.platformAllocationAtomic).toBe(ONE_CENT);
            assertReconciliation(result);
        });
    });

    describe('unlinked external creator', () => {
        it('routes 100% to platform treasury', () => {
            const states = new Map([['c1', unlinkedState('c1')]]);
            const input: AllocationInput = {
                requestId: 'req-3',
                settledAmountAtomic: ONE_CENT,
                classification: creatorSpecific('c1'),
                creatorStates: states,
            };
            const result = allocateIntelligenceRevenue(input);

            expect(result.creatorAllocations).toHaveLength(0);
            expect(result.platformAllocationAtomic).toBe(ONE_CENT);
            assertReconciliation(result);
        });
    });

    describe('unknown creator', () => {
        it('routes 100% to platform treasury', () => {
            const states = new Map([['c1', unknownState('c1')]]);
            const input: AllocationInput = {
                requestId: 'req-4',
                settledAmountAtomic: ONE_CENT,
                classification: creatorSpecific('c1'),
                creatorStates: states,
            };
            const result = allocateIntelligenceRevenue(input);

            expect(result.creatorAllocations).toHaveLength(0);
            expect(result.platformAllocationAtomic).toBe(ONE_CENT);
            assertReconciliation(result);
        });
    });

    describe('platform-owned data', () => {
        it('routes 100% to platform treasury', () => {
            const states = new Map<string, CreatorVerificationState>();
            const input: AllocationInput = {
                requestId: 'req-5',
                settledAmountAtomic: ONE_CENT,
                classification: platformOwned(),
                creatorStates: states,
            };
            const result = allocateIntelligenceRevenue(input);

            expect(result.creatorAllocations).toHaveLength(0);
            expect(result.platformAllocationAtomic).toBe(ONE_CENT);
            assertReconciliation(result);
        });
    });

    describe('multiple verified creators', () => {
        it('divides the 60% pool equally among eligible creators', () => {
            const states = new Map([
                ['c1', verifiedLinkedState('c1')],
                ['c2', verifiedLinkedState('c2')],
                ['c3', verifiedLinkedState('c3')],
            ]);
            const input: AllocationInput = {
                requestId: 'req-6',
                settledAmountAtomic: TEN_CENTS,
                classification: multiCreatorSearch(['c1', 'c2', 'c3']),
                creatorStates: states,
            };
            const result = allocateIntelligenceRevenue(input);

            expect(result.creatorAllocations).toHaveLength(3);

            // 60% of 100000 = 60000, divided by 3 = 20000 each
            const pool = (BigInt(TEN_CENTS) * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
            const expectedBase = pool / 3n;
            const expectedRemainder = pool % 3n;

            // Verify total creator allocation equals the pool
            const totalCreator = result.creatorAllocations.reduce(
                (sum, a) => sum + BigInt(a.amountAtomic),
                0n,
            );
            expect(totalCreator).toBe(pool);

            // Each creator should get base, first gets +1 if remainder > 0
            for (let i = 0; i < result.creatorAllocations.length; i++) {
                const expected = expectedBase + (BigInt(i) < expectedRemainder ? 1n : 0n);
                expect(result.creatorAllocations[i].amountAtomic).toBe(expected.toString());
                expect(result.creatorAllocations[i].attributionStatus).toBe('verified_linked');
            }

            assertReconciliation(result);
        });

        it('produces deterministic allocation order', () => {
            const states = new Map([
                ['c1', verifiedLinkedState('c1')],
                ['c2', verifiedLinkedState('c2')],
            ]);
            const input: AllocationInput = {
                requestId: 'req-7',
                settledAmountAtomic: TEN_CENTS,
                classification: multiCreatorSearch(['c1', 'c2']),
                creatorStates: states,
            };
            const r1 = allocateIntelligenceRevenue(input);
            const r2 = allocateIntelligenceRevenue(input);

            expect(r1.creatorAllocations).toEqual(r2.creatorAllocations);
            expect(r1.platformAllocationAtomic).toBe(r2.platformAllocationAtomic);
        });
    });

    describe('mixed eligible and ineligible data', () => {
        it('allocates only to eligible creators, rest to platform', () => {
            const states = new Map([
                ['c1', verifiedLinkedState('c1')],
                ['c2', linkedUnverifiedState('c2')],
                ['c3', unlinkedState('c3')],
            ]);
            const input: AllocationInput = {
                requestId: 'req-8',
                settledAmountAtomic: FIFTY_CENTS,
                classification: multiCreatorSearch(['c1', 'c2', 'c3']),
                creatorStates: states,
            };
            const result = allocateIntelligenceRevenue(input);

            // Only c1 is eligible
            expect(result.creatorAllocations).toHaveLength(1);
            expect(result.creatorAllocations[0].creatorId).toBe('c1');
            expect(result.creatorAllocations[0].attributionStatus).toBe('verified_linked');

            // c1 gets the entire 60% pool since they're the only eligible creator
            const pool = (BigInt(FIFTY_CENTS) * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
            expect(result.creatorAllocations[0].amountAtomic).toBe(pool.toString());

            // Platform gets 40% + ineligible creators' share (which is 0 because
            // we calculate pool for eligible only)
            const expectedPlatform = BigInt(FIFTY_CENTS) - pool;
            expect(result.platformAllocationAtomic).toBe(expectedPlatform.toString());

            assertReconciliation(result);
        });

        it('routes fully ineligible mix to platform', () => {
            const states = new Map([
                ['c1', linkedUnverifiedState('c1')],
                ['c2', ineligibleState('c2')],
            ]);
            const input: AllocationInput = {
                requestId: 'req-9',
                settledAmountAtomic: ONE_CENT,
                classification: multiCreatorSearch(['c1', 'c2']),
                creatorStates: states,
            };
            const result = allocateIntelligenceRevenue(input);

            expect(result.creatorAllocations).toHaveLength(0);
            expect(result.platformAllocationAtomic).toBe(ONE_CENT);
            assertReconciliation(result);
        });
    });

    describe('reconciliation invariant', () => {
        it('always reconciles for various amounts', () => {
            const amounts = ['1', '10000', '10001', '33333', '100000', '999999', '1000000'];
            for (const amount of amounts) {
                const states = new Map([
                    ['c1', verifiedLinkedState('c1')],
                    ['c2', verifiedLinkedState('c2')],
                    ['c3', verifiedLinkedState('c3')],
                ]);
                const result = allocateIntelligenceRevenue({
                    requestId: `req-recon-${amount}`,
                    settledAmountAtomic: amount,
                    classification: multiCreatorSearch(['c1', 'c2', 'c3']),
                    creatorStates: states,
                });
                assertReconciliation(result);
            }
        });

        it('reconciles for a single atomic unit', () => {
            const states = new Map([['c1', verifiedLinkedState('c1')]]);
            const result = allocateIntelligenceRevenue({
                requestId: 'req-single-unit',
                settledAmountAtomic: '1',
                classification: creatorSpecific('c1'),
                creatorStates: states,
            });
            assertReconciliation(result);
        });

        it('reconciles when creator pool does not divide evenly', () => {
            const states = new Map([
                ['c1', verifiedLinkedState('c1')],
                ['c2', verifiedLinkedState('c2')],
                ['c3', verifiedLinkedState('c3')],
            ]);
            // 7 atomic units: 60% = 4, 4/3 = 1 each + 1 remainder
            const result = allocateIntelligenceRevenue({
                requestId: 'req-uneven',
                settledAmountAtomic: '7',
                classification: multiCreatorSearch(['c1', 'c2', 'c3']),
                creatorStates: states,
            });
            assertReconciliation(result);
        });
    });

    describe('BigInt arithmetic correctness', () => {
        it('never uses floating point for monetary values', () => {
            const states = new Map([['c1', verifiedLinkedState('c1')]]);
            const result = allocateIntelligenceRevenue({
                requestId: 'req-bigint',
                settledAmountAtomic: '333333',
                classification: creatorSpecific('c1'),
                creatorStates: states,
            });

            // 60% of 333333 = 199999.8 in float, but BigInt truncates to 199999
            const pool = (BigInt('333333') * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
            expect(result.creatorAllocations[0].amountAtomic).toBe(pool.toString());
            expect(Number.isInteger(Number(result.creatorAllocations[0].amountAtomic))).toBe(true);
            assertReconciliation(result);
        });
    });

    describe('non_attributable classification', () => {
        it('routes 100% to platform', () => {
            const result = allocateIntelligenceRevenue({
                requestId: 'req-na',
                settledAmountAtomic: ONE_CENT,
                classification: {
                    type: 'non_attributable',
                    involvedCreatorIds: [],
                    involvedEntityIds: [],
                    platformOwnedCount: 0,
                    attributableCount: 0,
                },
                creatorStates: new Map(),
            });
            expect(result.creatorAllocations).toHaveLength(0);
            expect(result.platformAllocationAtomic).toBe(ONE_CENT);
            assertReconciliation(result);
        });
    });

    describe('no creator states provided', () => {
        it('routes 100% to platform when states map is empty', () => {
            const result = allocateIntelligenceRevenue({
                requestId: 'req-empty-states',
                settledAmountAtomic: ONE_CENT,
                classification: creatorSpecific('c1'),
                creatorStates: new Map(),
            });
            expect(result.creatorAllocations).toHaveLength(0);
            expect(result.platformAllocationAtomic).toBe(ONE_CENT);
            assertReconciliation(result);
        });
    });
});

// ---------------------------------------------------------------------------
// buildAttributionLedgerEntries
// ---------------------------------------------------------------------------

describe('buildAttributionLedgerEntries', () => {
    it('generates entries for each creator allocation and platform', () => {
        const states = new Map([
            ['c1', { creatorId: 'c1', exists: true, isVerified: true, isLinked: true, isEligible: true, walletAddress: '0xABC' } as CreatorVerificationState],
        ]);
        const allocation = allocateIntelligenceRevenue({
            requestId: 'req-ledger',
            settledAmountAtomic: '10000',
            classification: creatorSpecific('c1'),
            creatorStates: states,
        });
        const entries = buildAttributionLedgerEntries(allocation, states, 'entity-1', 'creator');

        // One creator + one platform entry
        expect(entries).toHaveLength(2);

        const creatorEntry = entries.find((e) => e.creatorId === 'c1')!;
        expect(creatorEntry.attributionStatus).toBe('verified_linked');
        expect(creatorEntry.idempotencyKey).toBe('attr:req-ledger:c1');
        expect(creatorEntry.dataEntityId).toBe('entity-1');
        expect(creatorEntry.dataEntityType).toBe('creator');
        expect(creatorEntry.verificationSnapshot).toMatchObject({
            exists: true,
            isVerified: true,
            isLinked: true,
            isEligible: true,
            walletAddress: '0xABC',
        });

        const platformEntry = entries.find((e) => e.creatorId === null)!;
        expect(platformEntry.attributionStatus).toBe('platform_owned');
        expect(platformEntry.idempotencyKey).toBe('attr:req-ledger:platform');
    });

    it('generates deterministic idempotency keys', () => {
        const states = new Map([['c1', verifiedLinkedState('c1')]]);
        const allocation = allocateIntelligenceRevenue({
            requestId: 'req-idem',
            settledAmountAtomic: '10000',
            classification: creatorSpecific('c1'),
            creatorStates: states,
        });
        const e1 = buildAttributionLedgerEntries(allocation, states);
        const e2 = buildAttributionLedgerEntries(allocation, states);

        expect(e1.map((e) => e.idempotencyKey)).toEqual(e2.map((e) => e.idempotencyKey));
    });

    it('omits platform entry when platform allocation is zero', () => {
        // This can happen if settled amount rounds entirely into creator pool
        // For a realistic scenario, 100% to platform never happens with eligible
        // creators, but verify the edge case of no platform entry
        const states = new Map<string, CreatorVerificationState>();
        const allocation = allocateIntelligenceRevenue({
            requestId: 'req-no-platform',
            settledAmountAtomic: '0',
            classification: platformOwned(),
            creatorStates: states,
        });
        const entries = buildAttributionLedgerEntries(allocation, states);
        // 0 settled → no entries at all (0n > 0n is false)
        expect(entries).toHaveLength(0);
    });

    function verifiedLinkedState(creatorId: string): CreatorVerificationState {
        return { creatorId, exists: true, isVerified: true, isLinked: true, isEligible: true, walletAddress: '0xABC' };
    }

    function platformOwned(): import('./classifier.js').RequestClassification {
        return {
            type: 'platform_owned',
            involvedCreatorIds: [],
            involvedEntityIds: ['e1'],
            platformOwnedCount: 1,
            attributableCount: 0,
        };
    }
});
