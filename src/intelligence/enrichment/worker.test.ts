import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnrichmentProvider, EnrichmentResult } from '../providers/interface.js';
import { EnrichmentWorker, type WorkerConfig } from './worker.js';

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

function makeMockProvider(name: string, resultOverrides?: Partial<EnrichmentResult>): EnrichmentProvider {
    return {
        name: name as EnrichmentProvider['name'],
        enrichCreator: vi.fn(async (input) => ({
            success: true,
            provider: name as EnrichmentResult['provider'],
            entityType: 'creator' as const,
            entityId: input.creatorId,
            normalizedData: { username: 'test', followerCount: 100 },
            rawDataHash: 'abc123def456',
            retrievedAt: new Date(),
            retentionPolicy: 'standard' as const,
            attributionEligible: false,
            confidenceScore: 0.8,
            ...resultOverrides,
        })),
        enrichContent: vi.fn(async (input) => ({
            success: true,
            provider: name as EnrichmentResult['provider'],
            entityType: 'content' as const,
            entityId: input.contentId ?? 'unknown',
            normalizedData: { text: 'test content' },
            rawDataHash: 'content-hash-123',
            retrievedAt: new Date(),
            retentionPolicy: 'standard' as const,
            attributionEligible: false,
            confidenceScore: 0.7,
            ...resultOverrides,
        })),
    };
}

function makeConfig(overrides?: Partial<WorkerConfig>): WorkerConfig {
    return {
        concurrency: 2,
        pollIntervalMs: 100,
        maxRetries: 3,
        ...overrides,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnrichmentWorker', () => {
    describe('enqueueJob', () => {
        it('returns a job ID', () => {
            const providers = new Map([['native', makeMockProvider('native')]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            const jobId = worker.enqueueJob({
                entityType: 'creator',
                entityId: 'slvr-001',
                provider: 'native',
            });

            expect(typeof jobId).toBe('string');
            expect(jobId.length).toBeGreaterThan(0);
        });

        it('uses provided job ID when given', () => {
            const providers = new Map([['native', makeMockProvider('native')]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            const jobId = worker.enqueueJob({
                id: 'custom-id-123',
                entityType: 'creator',
                entityId: 'slvr-001',
                provider: 'native',
            });

            expect(jobId).toBe('custom-id-123');
        });

        it('sets initial status to pending', () => {
            const providers = new Map([['native', makeMockProvider('native')]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            const jobId = worker.enqueueJob({
                entityType: 'creator',
                entityId: 'slvr-001',
                provider: 'native',
            });

            const status = worker.getJobStatus(jobId);
            expect(status).toBeDefined();
            expect(status!.status).toBe('pending');
            expect(status!.enqueuedAt).toBeInstanceOf(Date);
        });
    });

    describe('getJobStatus', () => {
        it('returns undefined for unknown job IDs', () => {
            const providers = new Map([['native', makeMockProvider('native')]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            expect(worker.getJobStatus('nonexistent')).toBeUndefined();
        });
    });

    describe('processJob', () => {
        it('calls the appropriate provider for creator enrichment', async () => {
            const mockProvider = makeMockProvider('native');
            const providers = new Map([['native', mockProvider]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            const result = await worker.processJob({
                id: 'job-001',
                entityType: 'creator',
                entityId: 'slvr-001',
                provider: 'native',
                priority: 0,
            });

            expect(result.success).toBe(true);
            expect(result.jobId).toBe('job-001');
            expect(result.enrichmentResult).toBeDefined();
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(mockProvider.enrichCreator).toHaveBeenCalledOnce();
        });

        it('calls enrichContent for content entity type', async () => {
            const mockProvider = makeMockProvider('native');
            const providers = new Map([['native', mockProvider]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            const result = await worker.processJob({
                id: 'job-002',
                entityType: 'content',
                entityId: 'vid-001',
                provider: 'native',
                priority: 0,
            });

            expect(result.success).toBe(true);
            expect(mockProvider.enrichContent).toHaveBeenCalledOnce();
        });

        it('fails gracefully for unknown provider', async () => {
            const providers = new Map([['native', makeMockProvider('native')]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            const result = await worker.processJob({
                id: 'job-003',
                entityType: 'creator',
                entityId: 'slvr-001',
                provider: 'x_api',
                priority: 0,
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('Unknown provider');
        });

        it('skips processing when freshness check passes', async () => {
            const mockProvider = makeMockProvider('native');
            const providers = new Map([['native', mockProvider]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            const result = await worker.processJob({
                id: 'job-004',
                entityType: 'creator',
                entityId: 'slvr-001',
                provider: 'native',
                priority: 0,
                previousMetadata: {
                    status: 'completed',
                    lastSuccessfulAt: new Date(), // Just now — still fresh
                    nextRefreshAt: new Date(Date.now() + 86400_000), // 24h from now
                    attempts: 0,
                    contentHash: null,
                },
            });

            expect(result.skipped).toBe(true);
            expect(result.skipReason).toBe('freshness_check_passed');
            expect(mockProvider.enrichCreator).not.toHaveBeenCalled();
        });

        it('skips when content hash is unchanged', async () => {
            // The mock provider returns normalizedData: { username: 'test', followerCount: 100 }
            // We need to compute the hash of that data and pass it as previousMetadata.contentHash
            const { computeContentHash } = await import('../utils/contentHash.js');
            const expectedHash = computeContentHash({ username: 'test', followerCount: 100 });

            const mockProvider = makeMockProvider('native');
            const providers = new Map([['native', mockProvider]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            const result = await worker.processJob({
                id: 'job-005',
                entityType: 'creator',
                entityId: 'slvr-001',
                provider: 'native',
                priority: 0,
                previousMetadata: {
                    status: 'completed',
                    lastSuccessfulAt: null, // Never enriched — forces enrichment
                    nextRefreshAt: null,
                    attempts: 0,
                    contentHash: expectedHash,
                },
            });

            expect(result.skipped).toBe(true);
            expect(result.skipReason).toBe('content_unchanged');
        });

        it('catches provider errors and returns failure', async () => {
            const failingProvider: EnrichmentProvider = {
                name: 'x_api',
                enrichCreator: vi.fn(async () => {
                    throw new Error('Network timeout');
                }),
            };
            const providers = new Map([['x_api', failingProvider]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            const result = await worker.processJob({
                id: 'job-006',
                entityType: 'creator',
                entityId: 'slvr-001',
                provider: 'x_api',
                priority: 0,
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Network timeout');
        });
    });

    describe('start / stop', () => {
        it('starts and stops without error', () => {
            const providers = new Map([['native', makeMockProvider('native')]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            expect(() => worker.start()).not.toThrow();
            expect(() => worker.stop()).not.toThrow();
        });

        it('is idempotent — multiple starts/stops are safe', () => {
            const providers = new Map([['native', makeMockProvider('native')]]);
            const worker = new EnrichmentWorker(providers, makeConfig());

            worker.start();
            worker.start(); // Should not double-poll
            worker.stop();
            worker.stop(); // Should not throw
        });
    });

    describe('concurrency limiting', () => {
        it('respects the configured concurrency limit', async () => {
            let activeJobs = 0;
            let maxActiveJobs = 0;

            const slowProvider: EnrichmentProvider = {
                name: 'native',
                enrichCreator: vi.fn(async (input) => {
                    activeJobs++;
                    maxActiveJobs = Math.max(maxActiveJobs, activeJobs);
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    activeJobs--;
                    return {
                        success: true,
                        provider: 'native' as const,
                        entityType: 'creator' as const,
                        entityId: input.creatorId,
                        normalizedData: {},
                        rawDataHash: 'hash',
                        retrievedAt: new Date(),
                        retentionPolicy: 'standard' as const,
                        attributionEligible: true,
                        confidenceScore: 1.0,
                    };
                }),
            };

            const providers = new Map([['native', slowProvider]]);
            const worker = new EnrichmentWorker(providers, makeConfig({ concurrency: 1 }));

            // Enqueue multiple jobs
            worker.enqueueJob({ entityType: 'creator', entityId: 'c1', provider: 'native' });
            worker.enqueueJob({ entityType: 'creator', entityId: 'c2', provider: 'native' });
            worker.enqueueJob({ entityType: 'creator', entityId: 'c3', provider: 'native' });

            worker.start();

            // Wait for all jobs to complete
            await new Promise((resolve) => setTimeout(resolve, 300));

            worker.stop();

            // With concurrency=1, max active should never exceed 1
            expect(maxActiveJobs).toBeLessThanOrEqual(1);
        });
    });
});
