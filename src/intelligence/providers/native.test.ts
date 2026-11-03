import { describe, expect, it } from 'vitest';
import { createNativeProvider } from './native.js';

describe('createNativeProvider', () => {
    const provider = createNativeProvider();

    describe('enrichCreator', () => {
        it('normalises existing creator profile data', async () => {
            const result = await provider.enrichCreator({
                creatorId: 'slvr-100',
                existingData: {
                    username: 'djkemi',
                    displayName: 'DJ Kemi',
                    bio: 'Afrobeats producer and streamer',
                    countryCode: 'NG',
                    isVerified: true,
                    followerCount: 5000,
                    followingCount: 200,
                    contentCount: 150,
                    profileImageUrl: 'https://cdn.streamlivr.com/avatars/djkemi.jpg',
                    categories: ['music'],
                    languages: ['en', 'yo'],
                },
            });

            expect(result.success).toBe(true);
            expect(result.provider).toBe('native');
            expect(result.entityType).toBe('creator');
            expect(result.entityId).toBe('slvr-100');

            expect(result.normalizedData.username).toBe('djkemi');
            expect(result.normalizedData.displayName).toBe('DJ Kemi');
            expect(result.normalizedData.biography).toBe('Afrobeats producer and streamer');
            expect(result.normalizedData.countryCode).toBe('NG');
            expect(result.normalizedData.isVerified).toBe(true);
            expect(result.normalizedData.followerCount).toBe(5000);
            expect(result.normalizedData.categories).toEqual(['music']);
            expect(result.normalizedData.languages).toEqual(['en', 'yo']);
        });

        it('sets retentionPolicy to indefinite (first-party data)', async () => {
            const result = await provider.enrichCreator({
                creatorId: 'slvr-100',
                existingData: { username: 'test' },
            });

            expect(result.retentionPolicy).toBe('indefinite');
        });

        it('sets attributionEligible to true', async () => {
            const result = await provider.enrichCreator({
                creatorId: 'slvr-100',
                existingData: { username: 'test' },
            });

            expect(result.attributionEligible).toBe(true);
        });

        it('has confidenceScore of 1.0', async () => {
            const result = await provider.enrichCreator({
                creatorId: 'slvr-100',
                existingData: {},
            });

            expect(result.confidenceScore).toBe(1.0);
        });

        it('handles missing existingData gracefully', async () => {
            const result = await provider.enrichCreator({
                creatorId: 'slvr-200',
            });

            expect(result.success).toBe(true);
            expect(result.normalizedData.username).toBeNull();
            expect(result.normalizedData.displayName).toBeNull();
            expect(result.normalizedData.followerCount).toBe(0);
        });

        it('handles snake_case keys from the database', async () => {
            const result = await provider.enrichCreator({
                creatorId: 'slvr-300',
                existingData: {
                    display_name: 'Snake Case Creator',
                    country_code: 'KE',
                    is_verified: true,
                    follower_count: 1200,
                    following_count: 300,
                    content_count: 50,
                    profile_image_url: 'https://cdn.streamlivr.com/avatars/snake.jpg',
                },
            });

            expect(result.normalizedData.displayName).toBe('Snake Case Creator');
            expect(result.normalizedData.countryCode).toBe('KE');
            expect(result.normalizedData.isVerified).toBe(true);
            expect(result.normalizedData.followerCount).toBe(1200);
        });

        it('computes a deterministic content hash', async () => {
            const data = { username: 'test', displayName: 'Test', bio: 'Hello' };

            const r1 = await provider.enrichCreator({ creatorId: 'c1', existingData: data });
            const r2 = await provider.enrichCreator({ creatorId: 'c1', existingData: data });

            expect(r1.rawDataHash).toBe(r2.rawDataHash);
            expect(r1.rawDataHash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('produces different hashes when data changes', async () => {
            const r1 = await provider.enrichCreator({
                creatorId: 'c1',
                existingData: { username: 'test', followerCount: 100 },
            });
            const r2 = await provider.enrichCreator({
                creatorId: 'c1',
                existingData: { username: 'test', followerCount: 200 },
            });

            expect(r1.rawDataHash).not.toBe(r2.rawDataHash);
        });
    });

    describe('enrichContent', () => {
        it('returns a valid enrichment result for content', async () => {
            const result = await provider.enrichContent({
                contentId: 'vid-001',
            });

            expect(result.success).toBe(true);
            expect(result.provider).toBe('native');
            expect(result.entityType).toBe('content');
            expect(result.entityId).toBe('vid-001');
            expect(result.retentionPolicy).toBe('indefinite');
            expect(result.attributionEligible).toBe(true);
        });
    });

    describe('getUsageCost', () => {
        it('reports zero cost for native data', async () => {
            const fresh = createNativeProvider();
            await fresh.enrichCreator({ creatorId: 'c1', existingData: {} });

            const usage = await fresh.getUsageCost();
            expect(usage.provider).toBe('native');
            expect(usage.requestsToday).toBe(1);
            expect(usage.costEstimateUsd).toBe(0);
            expect(usage.rateLimitRemaining).toBeNull();
        });
    });
});
