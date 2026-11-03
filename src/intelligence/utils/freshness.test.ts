import { describe, expect, it } from 'vitest';
import { isStale, nextRefreshAt, shouldEnrich } from './freshness.js';

describe('isStale', () => {
    it('returns true when lastEnrichedAt is null', () => {
        expect(isStale(null, 3600)).toBe(true);
    });

    it('returns true when the record exceeds the refresh interval', () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        expect(isStale(twoHoursAgo, 3600)).toBe(true); // 1-hour interval
    });

    it('returns false when the record is within the refresh interval', () => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        expect(isStale(fiveMinutesAgo, 3600)).toBe(false); // 1-hour interval
    });

    it('returns true when exactly at the boundary', () => {
        const exactlyOneHourAgo = new Date(Date.now() - 3600 * 1000);
        expect(isStale(exactlyOneHourAgo, 3600)).toBe(true);
    });
});

describe('nextRefreshAt', () => {
    it('adds the interval to the last successful date', () => {
        const base = new Date('2026-01-01T00:00:00Z');
        const result = nextRefreshAt(base, 3600);
        expect(result.getTime()).toBe(base.getTime() + 3600 * 1000);
    });

    it('handles large intervals (7 days)', () => {
        const base = new Date('2026-06-15T12:00:00Z');
        const result = nextRefreshAt(base, 604800);
        expect(result.toISOString()).toBe('2026-06-22T12:00:00.000Z');
    });
});

describe('shouldEnrich', () => {
    it('returns true when never enriched and no failures', () => {
        expect(
            shouldEnrich(
                { status: 'pending', lastSuccessfulAt: null, nextRefreshAt: null, attempts: 0 },
                3,
            ),
        ).toBe(true);
    });

    it('returns true when never enriched but has retries remaining', () => {
        expect(
            shouldEnrich(
                { status: 'failed', lastSuccessfulAt: null, nextRefreshAt: null, attempts: 2 },
                3,
            ),
        ).toBe(true);
    });

    it('returns false when never enriched and retries exhausted', () => {
        expect(
            shouldEnrich(
                { status: 'failed', lastSuccessfulAt: null, nextRefreshAt: null, attempts: 3 },
                3,
            ),
        ).toBe(false);
    });

    it('returns true when past the refresh window', () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        expect(
            shouldEnrich(
                {
                    status: 'completed',
                    lastSuccessfulAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
                    nextRefreshAt: oneHourAgo,
                    attempts: 1,
                },
                3,
            ),
        ).toBe(true);
    });

    it('returns false when within the refresh window and completed', () => {
        const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
        expect(
            shouldEnrich(
                {
                    status: 'completed',
                    lastSuccessfulAt: new Date(),
                    nextRefreshAt: oneHourFromNow,
                    attempts: 1,
                },
                3,
            ),
        ).toBe(false);
    });

    it('returns true when failed with retries remaining (even if previously successful)', () => {
        const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
        expect(
            shouldEnrich(
                {
                    status: 'failed',
                    lastSuccessfulAt: new Date(),
                    nextRefreshAt: oneHourFromNow,
                    attempts: 1,
                },
                3,
            ),
        ).toBe(true);
    });

    it('returns false when failed and retries exhausted (with previous success)', () => {
        const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
        expect(
            shouldEnrich(
                {
                    status: 'failed',
                    lastSuccessfulAt: new Date(),
                    nextRefreshAt: oneHourFromNow,
                    attempts: 3,
                },
                3,
            ),
        ).toBe(false);
    });

    it('returns false when currently processing', () => {
        const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
        expect(
            shouldEnrich(
                {
                    status: 'processing',
                    lastSuccessfulAt: new Date(),
                    nextRefreshAt: oneHourFromNow,
                    attempts: 1,
                },
                3,
            ),
        ).toBe(false);
    });
});
