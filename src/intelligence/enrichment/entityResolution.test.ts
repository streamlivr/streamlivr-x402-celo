import { describe, expect, it } from 'vitest';
import type { ExternalIdentityLink } from '../types.js';
import {
    matchConfidence,
    normalizeExternalIdentifier,
    resolveCreatorIdentity,
} from './entityResolution.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLink(overrides: Partial<ExternalIdentityLink> = {}): ExternalIdentityLink {
    return {
        id: 'link-001',
        creatorId: 'slvr-100',
        provider: 'x',
        externalAccountId: '123456',
        externalUsername: 'djkemi',
        linked: true,
        verificationStatus: 'linked',
        linkedAt: new Date('2024-01-01'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// normalizeExternalIdentifier
// ---------------------------------------------------------------------------

describe('normalizeExternalIdentifier', () => {
    it('strips @ and lowercases X usernames', () => {
        expect(normalizeExternalIdentifier('x', '@DJKemi')).toBe('djkemi');
        expect(normalizeExternalIdentifier('twitter', '@DJKemi')).toBe('djkemi');
        expect(normalizeExternalIdentifier('x_api', '@TestUser')).toBe('testuser');
    });

    it('handles usernames without @', () => {
        expect(normalizeExternalIdentifier('x', 'djkemi')).toBe('djkemi');
    });

    it('strips protocol and trailing slash from URLs', () => {
        expect(normalizeExternalIdentifier('website', 'https://djkemi.com/')).toBe('djkemi.com');
        expect(normalizeExternalIdentifier('url', 'http://example.com/page/')).toBe('example.com/page');
    });

    it('lowercases and trims generic identifiers', () => {
        expect(normalizeExternalIdentifier('instagram', '  DJKemi_Live  ')).toBe('djkemi_live');
    });
});

// ---------------------------------------------------------------------------
// resolveCreatorIdentity
// ---------------------------------------------------------------------------

describe('resolveCreatorIdentity', () => {
    it('returns unknown status when no external identifiers are provided', () => {
        const result = resolveCreatorIdentity({
            creatorId: 'slvr-100',
        });

        expect(result.canonicalId).toBe('slvr-100');
        expect(result.linkingStatus).toBe('unknown');
        expect(result.externalMatches.size).toBe(0);
        expect(result.confidence).toBe(0.1);
    });

    it('returns unlinked when external identifiers have no matching links', () => {
        const result = resolveCreatorIdentity({
            creatorId: 'slvr-100',
            externalIdentifiers: { x: 'unknownuser' },
            existingLinks: [makeLink({ externalUsername: 'djkemi' })],
        });

        expect(result.linkingStatus).toBe('unlinked');
        expect(result.externalMatches.size).toBe(0);
        expect(result.confidence).toBe(0.3);
    });

    it('returns linked_unverified when a match exists with linked status', () => {
        const result = resolveCreatorIdentity({
            creatorId: 'slvr-100',
            externalIdentifiers: { x: '@DJKemi' },
            existingLinks: [makeLink({
                provider: 'x',
                externalUsername: 'djkemi',
                verificationStatus: 'linked',
            })],
        });

        expect(result.linkingStatus).toBe('linked_unverified');
        expect(result.externalMatches.size).toBe(1);
        expect(result.externalMatches.has('x')).toBe(true);
        expect(result.confidence).toBe(0.7);
    });

    it('returns verified_linked when a match exists with verified status', () => {
        const result = resolveCreatorIdentity({
            creatorId: 'slvr-100',
            externalIdentifiers: { x: 'djkemi' },
            existingLinks: [makeLink({
                provider: 'x',
                externalUsername: 'djkemi',
                verificationStatus: 'verified',
            })],
        });

        expect(result.linkingStatus).toBe('verified_linked');
        expect(result.confidence).toBe(1.0);
    });

    it('matches by external account ID', () => {
        const result = resolveCreatorIdentity({
            creatorId: 'slvr-100',
            externalIdentifiers: { x: '123456' },
            existingLinks: [makeLink({
                provider: 'x',
                externalAccountId: '123456',
                externalUsername: null,
                verificationStatus: 'verified',
            })],
        });

        expect(result.linkingStatus).toBe('verified_linked');
        expect(result.externalMatches.size).toBe(1);
    });

    it('handles cross-provider name matching (x ↔ x_api)', () => {
        const result = resolveCreatorIdentity({
            creatorId: 'slvr-100',
            externalIdentifiers: { x: 'djkemi' },
            existingLinks: [makeLink({
                provider: 'x_api',
                externalUsername: 'djkemi',
                verificationStatus: 'linked',
            })],
        });

        expect(result.linkingStatus).toBe('linked_unverified');
        expect(result.externalMatches.size).toBe(1);
    });

    it('returns unlinked when identifiers provided but no existing links exist', () => {
        const result = resolveCreatorIdentity({
            creatorId: 'slvr-100',
            externalIdentifiers: { x: 'djkemi' },
            existingLinks: [],
        });

        expect(result.linkingStatus).toBe('unlinked');
        expect(result.confidence).toBe(0.3);
    });

    it('handles multiple external identifiers', () => {
        const result = resolveCreatorIdentity({
            creatorId: 'slvr-100',
            externalIdentifiers: { x: 'djkemi', instagram: 'djkemi_live' },
            existingLinks: [
                makeLink({
                    id: 'link-001',
                    provider: 'x',
                    externalUsername: 'djkemi',
                    verificationStatus: 'verified',
                }),
            ],
        });

        // Only X matched
        expect(result.externalMatches.size).toBe(1);
        expect(result.linkingStatus).toBe('verified_linked');
    });
});

// ---------------------------------------------------------------------------
// matchConfidence
// ---------------------------------------------------------------------------

describe('matchConfidence', () => {
    it('returns 1.0 for identical names and usernames', () => {
        const score = matchConfidence(
            { username: 'djkemi', displayName: 'DJ Kemi' },
            { username: 'djkemi', displayName: 'DJ Kemi' },
        );
        expect(score).toBe(1.0);
    });

    it('returns partial score for similar names', () => {
        const score = matchConfidence(
            { displayName: 'DJ Kemi Official' },
            { displayName: 'DJ Kemi' },
        );
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(1.0);
    });

    it('returns 0 for completely different data', () => {
        const score = matchConfidence(
            { username: 'alice', displayName: 'Alice Wonder' },
            { username: 'bob', displayName: 'Bob Builder' },
        );
        expect(score).toBe(0);
    });

    it('returns 0 when both records are empty', () => {
        const score = matchConfidence({}, {});
        expect(score).toBe(0);
    });

    it('incorporates bio similarity', () => {
        const score = matchConfidence(
            { displayName: 'Test', bio: 'Afrobeats producer and live streamer from Lagos' },
            { displayName: 'Different', biography: 'Afrobeats producer and live streamer from Lagos' },
        );
        // Bio match should give a positive score even if name differs
        expect(score).toBeGreaterThan(0);
    });

    it('incorporates location matching', () => {
        const withLocation = matchConfidence(
            { username: 'test', location: 'Lagos' },
            { username: 'test', location: 'Lagos' },
        );
        // Location matching contributes a positive signal
        expect(withLocation).toBeGreaterThan(0);
        // With matching username + matching location, score should be meaningful
        expect(withLocation).toBeGreaterThan(0.5);
    });
});
