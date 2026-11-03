import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createXApiProvider, XApiError } from './x-api.js';

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

function makeUserResponse(overrides: Record<string, unknown> = {}) {
    return {
        data: {
            id: '123456',
            name: 'Test Creator',
            username: 'testcreator',
            description: 'Afrobeat musician and producer from Lagos 🎵',
            location: 'Lagos, Nigeria',
            public_metrics: {
                followers_count: 15000,
                following_count: 500,
                tweet_count: 3200,
                listed_count: 42,
            },
            profile_image_url: 'https://pbs.twimg.com/profile_images/test.jpg',
            verified: false,
            created_at: '2020-01-15T00:00:00.000Z',
            ...overrides,
        },
    };
}

function makeTweetResponse(overrides: Record<string, unknown> = {}) {
    return {
        data: {
            id: '999888777',
            text: 'New track dropping Friday! #Afrobeats #NewMusic',
            public_metrics: {
                like_count: 350,
                retweet_count: 120,
                reply_count: 45,
                quote_count: 12,
                impression_count: 50000,
            },
            created_at: '2024-06-01T12:00:00.000Z',
            entities: {
                hashtags: [
                    { tag: 'Afrobeats' },
                    { tag: 'NewMusic' },
                ],
            },
            lang: 'en',
            ...overrides,
        },
    };
}

function ok(body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
            'content-type': 'application/json',
            'x-rate-limit-remaining': '450',
            'x-rate-limit-reset': '1700000000',
            ...headers,
        },
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createXApiProvider', () => {
    const provider = createXApiProvider('test-bearer-token');

    describe('enrichCreator', () => {
        it('normalises X API user response', async () => {
            mockFetch.mockResolvedValueOnce(ok(makeUserResponse()));

            const result = await provider.enrichCreator({
                creatorId: 'slvr-001',
                externalIdentifiers: { x: '@testcreator' },
            });

            expect(result.success).toBe(true);
            expect(result.provider).toBe('x_api');
            expect(result.entityType).toBe('creator');
            expect(result.entityId).toBe('slvr-001');
            expect(result.retentionPolicy).toBe('x_api_30d');
            expect(result.attributionEligible).toBe(false);

            expect(result.normalizedData.username).toBe('testcreator');
            expect(result.normalizedData.displayName).toBe('Test Creator');
            expect(result.normalizedData.biography).toBe('Afrobeat musician and producer from Lagos 🎵');
            expect(result.normalizedData.followerCount).toBe(15000);
            expect(result.normalizedData.tweetCount).toBe(3200);
            expect(result.normalizedData.verified).toBe(false);
        });

        it('uses account ID when xAccountId is provided', async () => {
            mockFetch.mockResolvedValueOnce(ok(makeUserResponse()));

            await provider.enrichCreator({
                creatorId: 'slvr-001',
                externalIdentifiers: { xAccountId: '123456' },
            });

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/2/users/123456'),
                expect.any(Object),
            );
        });

        it('strips @ from username in URL', async () => {
            mockFetch.mockResolvedValueOnce(ok(makeUserResponse()));

            await provider.enrichCreator({
                creatorId: 'slvr-001',
                externalIdentifiers: { x: '@testcreator' },
            });

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/2/users/by/username/testcreator'),
                expect.any(Object),
            );
        });

        it('throws if no X identifier is provided', async () => {
            await expect(
                provider.enrichCreator({ creatorId: 'slvr-001' }),
            ).rejects.toThrow(XApiError);
        });

        it('computes a deterministic content hash', async () => {
            mockFetch.mockResolvedValueOnce(ok(makeUserResponse()));
            mockFetch.mockResolvedValueOnce(ok(makeUserResponse()));

            const r1 = await provider.enrichCreator({
                creatorId: 'slvr-001',
                externalIdentifiers: { x: 'testcreator' },
            });
            const r2 = await provider.enrichCreator({
                creatorId: 'slvr-001',
                externalIdentifiers: { x: 'testcreator' },
            });

            expect(r1.rawDataHash).toBe(r2.rawDataHash);
            expect(r1.rawDataHash).toMatch(/^[0-9a-f]{64}$/);
        });
    });

    describe('enrichContent', () => {
        it('normalises X API tweet response', async () => {
            mockFetch.mockResolvedValueOnce(ok(makeTweetResponse()));

            const result = await provider.enrichContent({
                contentId: '999888777',
            });

            expect(result.success).toBe(true);
            expect(result.provider).toBe('x_api');
            expect(result.entityType).toBe('content');
            expect(result.normalizedData.text).toBe('New track dropping Friday! #Afrobeats #NewMusic');
            expect(result.normalizedData.topics).toEqual(['Afrobeats', 'NewMusic']);
            expect(result.normalizedData.likeCount).toBe(350);
            expect(result.normalizedData.language).toBe('en');
        });

        it('extracts tweet ID from URL', async () => {
            mockFetch.mockResolvedValueOnce(ok(makeTweetResponse()));

            await provider.enrichContent({
                url: 'https://x.com/testcreator/status/999888777',
            });

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/2/tweets/999888777'),
                expect.any(Object),
            );
        });

        it('throws if no content identifier is provided', async () => {
            await expect(
                provider.enrichContent({}),
            ).rejects.toThrow(XApiError);
        });
    });

    describe('rate limiting', () => {
        it('throws XApiError with rateLimitReset on 429', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(JSON.stringify({ errors: [{ message: 'Too Many Requests' }] }), {
                    status: 429,
                    headers: {
                        'x-rate-limit-remaining': '0',
                        'x-rate-limit-reset': '1700000100',
                    },
                }),
            );

            try {
                await provider.enrichCreator({
                    creatorId: 'slvr-001',
                    externalIdentifiers: { x: 'testcreator' },
                });
                expect.fail('Should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(XApiError);
                const xErr = err as XApiError;
                expect(xErr.status).toBe(429);
                expect(xErr.code).toBe('RATE_LIMITED');
                expect(xErr.rateLimitReset).toBe(1700000100);
            }
        });
    });

    describe('authentication errors', () => {
        it('throws XApiError on 401', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(JSON.stringify({ errors: [{ message: 'Unauthorized' }] }), {
                    status: 401,
                    headers: {},
                }),
            );

            try {
                await provider.enrichCreator({
                    creatorId: 'slvr-001',
                    externalIdentifiers: { x: 'testcreator' },
                });
                expect.fail('Should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(XApiError);
                const xErr = err as XApiError;
                expect(xErr.status).toBe(401);
                expect(xErr.code).toBe('AUTH_ERROR');
            }
        });

        it('throws XApiError on 403', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(JSON.stringify({ errors: [{ message: 'Forbidden' }] }), {
                    status: 403,
                    headers: {},
                }),
            );

            try {
                await provider.enrichCreator({
                    creatorId: 'slvr-001',
                    externalIdentifiers: { x: 'testcreator' },
                });
                expect.fail('Should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(XApiError);
                expect((err as XApiError).status).toBe(403);
            }
        });
    });

    describe('getUsageCost', () => {
        it('tracks request count', async () => {
            const fresh = createXApiProvider('token');
            mockFetch.mockResolvedValueOnce(ok(makeUserResponse()));
            mockFetch.mockResolvedValueOnce(ok(makeUserResponse()));

            await fresh.enrichCreator({
                creatorId: 'c1',
                externalIdentifiers: { x: 'u1' },
            });
            await fresh.enrichCreator({
                creatorId: 'c2',
                externalIdentifiers: { x: 'u2' },
            });

            const usage = await fresh.getUsageCost();
            expect(usage.provider).toBe('x_api');
            expect(usage.requestsToday).toBe(2);
            expect(usage.costEstimateUsd).toBeGreaterThan(0);
        });
    });
});
