import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirecrawlProvider, FirecrawlError } from './firecrawl.js';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScrapeResponse(overrides: Record<string, unknown> = {}) {
    return {
        success: true,
        data: {
            markdown: '# DJ Kemi\n\nAfrobeats producer from Lagos.\n\nFollow on [Twitter](https://x.com/djkemi) and [Instagram](https://instagram.com/djkemi.live)',
            extract: {
                name: 'DJ Kemi',
                description: 'Afrobeats producer and live streamer from Lagos, Nigeria.',
                bio: 'Multi-genre producer blending afrobeats and electronic music.',
            },
            metadata: {
                title: 'DJ Kemi - Official Site',
                description: 'Afrobeats producer from Lagos',
                keywords: 'afrobeats,music,producer,lagos,electronic',
                sourceURL: 'https://djkemi.com',
                language: 'en',
            },
            ...overrides,
        },
    };
}

function makeContentScrapeResponse() {
    return {
        success: true,
        data: {
            markdown: '# New EP Release: "Midnight Vibes"\n\nAvailable on all platforms.',
            extract: {
                title: 'Midnight Vibes EP',
                description: 'A 5-track EP blending lo-fi afrobeats with jazz.',
            },
            metadata: {
                title: 'Midnight Vibes EP - DJ Kemi',
                description: 'A new EP from DJ Kemi',
                keywords: 'EP,afrobeats,jazz,music',
                sourceURL: 'https://djkemi.com/midnight-vibes',
                language: 'en',
            },
        },
    };
}

function ok(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createFirecrawlProvider', () => {
    const provider = createFirecrawlProvider('fc-test-key', 'https://api.firecrawl.dev');

    describe('enrichCreator', () => {
        it('normalises Firecrawl scrape response for creator', async () => {
            mockFetch.mockResolvedValueOnce(ok(makeScrapeResponse()));

            const result = await provider.enrichCreator({
                creatorId: 'slvr-002',
                externalIdentifiers: { website: 'https://djkemi.com' },
            });

            expect(result.success).toBe(true);
            expect(result.provider).toBe('firecrawl');
            expect(result.entityType).toBe('creator');
            expect(result.entityId).toBe('slvr-002');
            expect(result.retentionPolicy).toBe('standard');
            expect(result.attributionEligible).toBe(false);

            expect(result.normalizedData.name).toBe('DJ Kemi');
            expect(result.normalizedData.bio).toBe('Afrobeats producer and live streamer from Lagos, Nigeria.');
            expect(result.normalizedData.topics).toEqual(
                expect.arrayContaining(['afrobeats', 'music', 'producer']),
            );
        });

        it('extracts social links from markdown', async () => {
            mockFetch.mockResolvedValueOnce(ok(makeScrapeResponse()));

            const result = await provider.enrichCreator({
                creatorId: 'slvr-002',
                externalIdentifiers: { website: 'https://djkemi.com' },
            });

            const socialLinks = result.normalizedData.socialLinks as Record<string, string>;
            expect(socialLinks.twitter).toBe('djkemi');
            expect(socialLinks.instagram).toBe('djkemi.live');
        });

        it('throws if no website URL is provided', async () => {
            await expect(
                provider.enrichCreator({ creatorId: 'slvr-002' }),
            ).rejects.toThrow(FirecrawlError);
        });

        it('computes a deterministic content hash', async () => {
            mockFetch.mockResolvedValueOnce(ok(makeScrapeResponse()));
            mockFetch.mockResolvedValueOnce(ok(makeScrapeResponse()));

            const r1 = await provider.enrichCreator({
                creatorId: 'slvr-002',
                externalIdentifiers: { website: 'https://djkemi.com' },
            });
            const r2 = await provider.enrichCreator({
                creatorId: 'slvr-002',
                externalIdentifiers: { website: 'https://djkemi.com' },
            });

            expect(r1.rawDataHash).toBe(r2.rawDataHash);
            expect(r1.rawDataHash).toMatch(/^[0-9a-f]{64}$/);
        });
    });

    describe('enrichContent', () => {
        it('normalises Firecrawl scrape response for content', async () => {
            mockFetch.mockResolvedValueOnce(ok(makeContentScrapeResponse()));

            const result = await provider.enrichContent({
                url: 'https://djkemi.com/midnight-vibes',
            });

            expect(result.success).toBe(true);
            expect(result.provider).toBe('firecrawl');
            expect(result.entityType).toBe('content');
            expect(result.normalizedData.title).toBe('Midnight Vibes EP');
            expect(result.normalizedData.topics).toEqual(
                expect.arrayContaining(['EP', 'afrobeats']),
            );
        });

        it('throws if no URL is provided', async () => {
            await expect(
                provider.enrichContent({}),
            ).rejects.toThrow(FirecrawlError);
        });
    });

    describe('error handling', () => {
        it('throws FirecrawlError on 401', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response('Unauthorized', { status: 401 }),
            );

            try {
                await provider.enrichCreator({
                    creatorId: 'slvr-002',
                    externalIdentifiers: { website: 'https://example.com' },
                });
                expect.fail('Should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(FirecrawlError);
                expect((err as FirecrawlError).status).toBe(401);
            }
        });

        it('throws FirecrawlError on 429', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response('Too Many Requests', { status: 429 }),
            );

            try {
                await provider.enrichCreator({
                    creatorId: 'slvr-002',
                    externalIdentifiers: { website: 'https://example.com' },
                });
                expect.fail('Should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(FirecrawlError);
                expect((err as FirecrawlError).status).toBe(429);
            }
        });

        it('throws FirecrawlError on 500', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response('Internal Server Error', { status: 500 }),
            );

            try {
                await provider.enrichCreator({
                    creatorId: 'slvr-002',
                    externalIdentifiers: { website: 'https://example.com' },
                });
                expect.fail('Should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(FirecrawlError);
                expect((err as FirecrawlError).status).toBe(500);
            }
        });
    });

    describe('getUsageCost', () => {
        it('tracks request count', async () => {
            const fresh = createFirecrawlProvider('key', 'https://api.firecrawl.dev');
            mockFetch.mockResolvedValue(ok(makeScrapeResponse()));

            await fresh.enrichCreator({
                creatorId: 'c1',
                externalIdentifiers: { website: 'https://a.com' },
            });

            const usage = await fresh.getUsageCost();
            expect(usage.provider).toBe('firecrawl');
            expect(usage.requestsToday).toBe(1);
            expect(usage.rateLimitRemaining).toBeNull();
        });
    });
});
