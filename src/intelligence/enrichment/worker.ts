/**
 * Enrichment worker — lightweight async job processor.
 *
 * V1 operates entirely in-memory (no Redis/Kafka). Jobs are enqueued,
 * deduplicated, and processed sequentially within the configured concurrency
 * limit. Database persistence is deferred to Phase 3+.
 */

import { randomUUID } from 'node:crypto';

import type { EntityType, EnrichmentStatus, ProviderName } from '../types.js';
import { hasContentChanged } from '../utils/contentHash.js';
import { shouldEnrich } from '../utils/freshness.js';
import type { EnrichmentProvider, EnrichmentResult } from '../providers/interface.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface EnrichmentJob {
    id: string;
    entityType: EntityType;
    entityId: string;
    provider: ProviderName;
    priority: number;
    externalIdentifiers?: Record<string, string>;
    existingData?: Record<string, unknown>;
    /** Optional: metadata from a previous enrichment run for freshness checks. */
    previousMetadata?: {
        status: EnrichmentStatus;
        lastSuccessfulAt: Date | null;
        nextRefreshAt: Date | null;
        attempts: number;
        contentHash: string | null;
    };
}

export interface EnrichmentJobResult {
    jobId: string;
    success: boolean;
    enrichmentResult?: EnrichmentResult;
    error?: string;
    durationMs: number;
    skipped?: boolean;
    skipReason?: string;
}

export interface EnrichmentJobStatus {
    id: string;
    status: EnrichmentStatus;
    enqueuedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    result?: EnrichmentJobResult;
}

export interface WorkerConfig {
    concurrency: number;
    pollIntervalMs: number;
    maxRetries: number;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class EnrichmentWorker {
    private readonly providers: Map<string, EnrichmentProvider>;
    private readonly config: WorkerConfig;
    private readonly queue: EnrichmentJob[] = [];
    private readonly statuses: Map<string, EnrichmentJobStatus> = new Map();
    private activeCount = 0;
    private running = false;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(providers: Map<string, EnrichmentProvider>, config: WorkerConfig) {
        this.providers = providers;
        this.config = config;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Add a job to the in-memory queue.
     * Returns the job ID (auto-generated if not provided).
     */
    enqueueJob(job: Partial<EnrichmentJob> & Pick<EnrichmentJob, 'entityType' | 'entityId' | 'provider'>): string {
        const id = job.id ?? randomUUID();
        const fullJob: EnrichmentJob = {
            id,
            entityType: job.entityType,
            entityId: job.entityId,
            provider: job.provider,
            priority: job.priority ?? 0,
            externalIdentifiers: job.externalIdentifiers,
            existingData: job.existingData,
            previousMetadata: job.previousMetadata,
        };

        this.queue.push(fullJob);
        // Sort by priority descending (higher = more urgent)
        this.queue.sort((a, b) => b.priority - a.priority);

        this.statuses.set(id, {
            id,
            status: 'pending',
            enqueuedAt: new Date(),
        });

        // If the worker is running, kick off processing immediately
        if (this.running) {
            void this.processNextBatch();
        }

        return id;
    }

    /**
     * Retrieve the current status of a job.
     */
    getJobStatus(jobId: string): EnrichmentJobStatus | undefined {
        return this.statuses.get(jobId);
    }

    /**
     * Start the polling/processing loop.
     */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.schedulePoll();
    }

    /**
     * Gracefully shut down — stop accepting new polls, let in-flight jobs finish.
     */
    stop(): void {
        this.running = false;
        if (this.pollTimer !== null) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Process a single job (public for direct invocation in tests).
     */
    async processJob(job: EnrichmentJob): Promise<EnrichmentJobResult> {
        const startTime = Date.now();

        // 1. Check freshness — should we even bother?
        if (job.previousMetadata) {
            const shouldRun = shouldEnrich(job.previousMetadata, this.config.maxRetries);
            if (!shouldRun) {
                return {
                    jobId: job.id,
                    success: true,
                    durationMs: Date.now() - startTime,
                    skipped: true,
                    skipReason: 'freshness_check_passed',
                };
            }
        }

        // 2. Look up the provider
        const provider = this.providers.get(job.provider);
        if (!provider) {
            return {
                jobId: job.id,
                success: false,
                error: `Unknown provider: ${job.provider}`,
                durationMs: Date.now() - startTime,
            };
        }

        // 3. Call the appropriate enrichment method
        try {
            let result: EnrichmentResult;

            if (job.entityType === 'creator') {
                result = await provider.enrichCreator({
                    creatorId: job.entityId,
                    externalIdentifiers: job.externalIdentifiers,
                    existingData: job.existingData,
                });
            } else if (job.entityType === 'content') {
                if (!provider.enrichContent) {
                    return {
                        jobId: job.id,
                        success: false,
                        error: `Provider ${job.provider} does not support content enrichment`,
                        durationMs: Date.now() - startTime,
                    };
                }
                result = await provider.enrichContent({
                    contentId: job.entityId,
                });
            } else {
                return {
                    jobId: job.id,
                    success: false,
                    error: `Unknown entity type: ${job.entityType}`,
                    durationMs: Date.now() - startTime,
                };
            }

            // 4. Check content hash — skip if data hasn't changed
            if (job.previousMetadata?.contentHash) {
                const changed = hasContentChanged(
                    job.previousMetadata.contentHash,
                    result.normalizedData,
                );
                if (!changed) {
                    return {
                        jobId: job.id,
                        success: true,
                        enrichmentResult: result,
                        durationMs: Date.now() - startTime,
                        skipped: true,
                        skipReason: 'content_unchanged',
                    };
                }
            }

            return {
                jobId: job.id,
                success: true,
                enrichmentResult: result,
                durationMs: Date.now() - startTime,
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                jobId: job.id,
                success: false,
                error: message,
                durationMs: Date.now() - startTime,
            };
        }
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    private schedulePoll(): void {
        if (!this.running) return;
        this.pollTimer = setTimeout(() => {
            void this.processNextBatch().finally(() => this.schedulePoll());
        }, this.config.pollIntervalMs);
    }

    private async processNextBatch(): Promise<void> {
        while (this.queue.length > 0 && this.activeCount < this.config.concurrency) {
            const job = this.queue.shift();
            if (!job) break;

            this.activeCount++;
            const status = this.statuses.get(job.id);
            if (status) {
                status.status = 'processing';
                status.startedAt = new Date();
            }

            // Process without blocking the loop for the next concurrent slot
            void this.runJob(job);
        }
    }

    private async runJob(job: EnrichmentJob): Promise<void> {
        try {
            const result = await this.processJob(job);
            const status = this.statuses.get(job.id);
            if (status) {
                status.status = result.success ? 'completed' : 'failed';
                status.completedAt = new Date();
                status.result = result;
            }

            // Retry on failure if retries remain
            if (!result.success) {
                const currentAttempts = (job.previousMetadata?.attempts ?? 0) + 1;
                if (currentAttempts < this.config.maxRetries) {
                    // Re-enqueue with updated attempt count
                    this.enqueueJob({
                        ...job,
                        id: job.id + `-retry-${currentAttempts}`,
                        priority: job.priority - 1, // Lower priority for retries
                        previousMetadata: {
                            status: 'failed',
                            lastSuccessfulAt: job.previousMetadata?.lastSuccessfulAt ?? null,
                            nextRefreshAt: job.previousMetadata?.nextRefreshAt ?? null,
                            attempts: currentAttempts,
                            contentHash: job.previousMetadata?.contentHash ?? null,
                        },
                    });
                }
            }
        } finally {
            this.activeCount--;
        }
    }
}
