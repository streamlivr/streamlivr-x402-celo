import { describe, expect, it } from 'vitest';
import {
    classifyIntelligenceRequest,
    determineAttributionStatus,
    type RequestClassification,
    type VerificationState,
} from './classifier.js';

// ---------------------------------------------------------------------------
// classifyIntelligenceRequest
// ---------------------------------------------------------------------------

describe('classifyIntelligenceRequest', () => {
    it('classifies a single-creator profile request as creator_specific', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/creators/creator-abc',
        });
        expect(result.type).toBe('creator_specific');
        expect(result.primaryCreatorId).toBe('creator-abc');
        expect(result.involvedCreatorIds).toEqual(['creator-abc']);
        expect(result.attributableCount).toBe(1);
        expect(result.platformOwnedCount).toBe(0);
    });

    it('classifies an enrichment request as creator_specific', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/enrich/creator-abc',
        });
        expect(result.type).toBe('creator_specific');
        expect(result.primaryCreatorId).toBe('creator-abc');
        expect(result.involvedCreatorIds).toEqual(['creator-abc']);
    });

    it('classifies a content profile request as content_specific', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/content/content-xyz',
            resultCreatorIds: ['creator-abc'],
        });
        expect(result.type).toBe('content_specific');
        expect(result.primaryCreatorId).toBe('creator-abc');
        expect(result.involvedCreatorIds).toEqual(['creator-abc']);
        expect(result.involvedEntityIds).toEqual(['content-xyz']);
        expect(result.platformOwnedCount).toBe(0);
    });

    it('classifies content with no creator as content_specific with platform ownership', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/content/content-xyz',
            resultCreatorIds: [],
        });
        expect(result.type).toBe('content_specific');
        expect(result.involvedCreatorIds).toEqual([]);
        expect(result.platformOwnedCount).toBe(1);
        expect(result.attributableCount).toBe(0);
    });

    it('classifies creator search with results as creator_search', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/creators/search',
            resultCreatorIds: ['c1', 'c2', 'c3'],
        });
        expect(result.type).toBe('creator_search');
        expect(result.involvedCreatorIds).toEqual(['c1', 'c2', 'c3']);
        expect(result.attributableCount).toBe(3);
    });

    it('classifies creator search with no results as non_attributable', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/creators/search',
            resultCreatorIds: [],
        });
        expect(result.type).toBe('non_attributable');
        expect(result.attributableCount).toBe(0);
    });

    it('classifies discover as creator_search', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/discover',
            resultCreatorIds: ['c1', 'c2'],
        });
        expect(result.type).toBe('creator_search');
        expect(result.involvedCreatorIds).toEqual(['c1', 'c2']);
    });

    it('classifies content search with results as content_search', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/content/search',
            resultCreatorIds: ['c1'],
            resultEntityIds: ['e1', 'e2'],
        });
        expect(result.type).toBe('content_search');
        expect(result.involvedCreatorIds).toEqual(['c1']);
        expect(result.involvedEntityIds).toEqual(['e1', 'e2']);
        expect(result.platformOwnedCount).toBe(1);
    });

    it('deduplicates creator ids in search results', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/creators/search',
            resultCreatorIds: ['c1', 'c1', 'c2', 'c2', 'c2'],
        });
        expect(result.involvedCreatorIds).toEqual(['c1', 'c2']);
        expect(result.attributableCount).toBe(2);
    });

    it('classifies unified search with both types as mixed', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/search',
            resultCreatorIds: ['c1', 'c2'],
            resultEntityIds: ['e1'],
        });
        expect(result.type).toBe('mixed');
        expect(result.involvedCreatorIds).toEqual(['c1', 'c2']);
        expect(result.involvedEntityIds).toEqual(['e1']);
    });

    it('classifies unified search with only creators as general_search', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/search',
            resultCreatorIds: ['c1'],
            resultEntityIds: [],
        });
        expect(result.type).toBe('general_search');
    });

    it('classifies unified search with only entities as platform_owned', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/search',
            resultCreatorIds: [],
            resultEntityIds: ['e1'],
        });
        expect(result.type).toBe('platform_owned');
    });

    it('classifies unified search with nothing as non_attributable', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/intelligence/search',
            resultCreatorIds: [],
            resultEntityIds: [],
        });
        expect(result.type).toBe('non_attributable');
    });

    it('classifies unknown paths as non_attributable', () => {
        const result = classifyIntelligenceRequest({
            path: '/api/something/unknown',
        });
        expect(result.type).toBe('non_attributable');
    });
});

// ---------------------------------------------------------------------------
// determineAttributionStatus
// ---------------------------------------------------------------------------

describe('determineAttributionStatus', () => {
    const baseClassification: RequestClassification = {
        type: 'creator_specific',
        primaryCreatorId: 'c1',
        involvedCreatorIds: ['c1'],
        involvedEntityIds: [],
        platformOwnedCount: 0,
        attributableCount: 1,
    };

    it('returns verified_linked for verified + linked creator', () => {
        const state: VerificationState = { exists: true, isVerified: true, isLinked: true, isEligible: true };
        expect(determineAttributionStatus(baseClassification, 'c1', state)).toBe('verified_linked');
    });

    it('returns linked_unverified for linked but unverified creator', () => {
        const state: VerificationState = { exists: true, isVerified: false, isLinked: true, isEligible: true };
        expect(determineAttributionStatus(baseClassification, 'c1', state)).toBe('linked_unverified');
    });

    it('returns unlinked for existing but unlinked creator', () => {
        const state: VerificationState = { exists: true, isVerified: false, isLinked: false, isEligible: true };
        expect(determineAttributionStatus(baseClassification, 'c1', state)).toBe('unlinked');
    });

    it('returns unknown for non-existent creator', () => {
        const state: VerificationState = { exists: false, isVerified: false, isLinked: false, isEligible: false };
        expect(determineAttributionStatus(baseClassification, 'c1', state)).toBe('unknown');
    });

    it('returns platform_owned for platform-owned classification', () => {
        const platformClassification: RequestClassification = {
            type: 'platform_owned',
            involvedCreatorIds: [],
            involvedEntityIds: ['e1'],
            platformOwnedCount: 1,
            attributableCount: 0,
        };
        const state: VerificationState = { exists: true, isVerified: true, isLinked: true, isEligible: true };
        expect(determineAttributionStatus(platformClassification, 'c1', state)).toBe('platform_owned');
    });

    it('returns platform_owned when creatorId is null', () => {
        const state: VerificationState = { exists: false, isVerified: false, isLinked: false, isEligible: false };
        expect(determineAttributionStatus(baseClassification, null, state)).toBe('platform_owned');
    });

    it('returns ineligible for existing but ineligible creator', () => {
        const state: VerificationState = { exists: true, isVerified: true, isLinked: true, isEligible: false };
        expect(determineAttributionStatus(baseClassification, 'c1', state)).toBe('ineligible');
    });
});
