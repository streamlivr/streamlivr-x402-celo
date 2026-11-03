/**
 * Request classification for intelligence attribution.
 *
 * Determines the revenue ownership category of an intelligence request and
 * the attribution status of each involved creator. This drives the revenue
 * allocation engine: a request classified as `creator_specific` with a
 * verified-linked creator routes revenue to that creator, while a
 * `platform_owned` request routes 100% to the platform treasury.
 */
import type { AttributionStatus } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RequestClassificationType =
    | 'creator_specific'
    | 'content_specific'
    | 'creator_search'
    | 'content_search'
    | 'platform_owned'
    | 'mixed'
    | 'general_search'
    | 'non_attributable';

export interface RequestClassification {
    type: RequestClassificationType;
    primaryCreatorId?: string;
    involvedCreatorIds: string[];
    involvedEntityIds: string[];
    platformOwnedCount: number;
    attributableCount: number;
}

export interface VerificationState {
    exists: boolean;
    isVerified: boolean;
    isLinked: boolean;
    isEligible: boolean;
}

export interface ClassifyRequest {
    path: string;
    query?: Record<string, unknown>;
    resultCreatorIds?: string[];
    resultEntityIds?: string[];
}

// ---------------------------------------------------------------------------
// Path patterns
// ---------------------------------------------------------------------------

const CREATOR_ID_PATTERN = /^\/api\/intelligence\/creators\/([^/]+)$/;
const CONTENT_ID_PATTERN = /^\/api\/intelligence\/content\/([^/]+)$/;
const ENRICH_PATTERN = /^\/api\/intelligence\/enrich\/([^/]+)$/;
const CREATOR_SEARCH_PATH = '/api/intelligence/creators/search';
const CONTENT_SEARCH_PATH = '/api/intelligence/content/search';
const DISCOVER_PATH = '/api/intelligence/discover';
const UNIFIED_SEARCH_PATH = '/api/intelligence/search';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Determines the revenue ownership category for an intelligence request.
 *
 * The classifier inspects the request path and result sets to decide whether
 * revenue should be attributed to a specific creator, split among creators
 * in a search result, or retained by the platform.
 *
 * IMPORTANT: Literal search/discover paths are checked BEFORE ID-parameter
 * patterns, so `/api/intelligence/creators/search` is classified as a search
 * route, not as a creator with id="search".
 */
export function classifyIntelligenceRequest(request: ClassifyRequest): RequestClassification {
    const { path, resultCreatorIds = [], resultEntityIds = [] } = request;

    // --- Literal paths first (before ID patterns that would capture "search") ---

    // Creator search
    if (path === CREATOR_SEARCH_PATH || path === DISCOVER_PATH) {
        const uniqueCreators = [...new Set(resultCreatorIds)];
        if (uniqueCreators.length === 0) {
            return {
                type: 'non_attributable',
                involvedCreatorIds: [],
                involvedEntityIds: [],
                platformOwnedCount: 0,
                attributableCount: 0,
            };
        }
        return {
            type: 'creator_search',
            primaryCreatorId: uniqueCreators.length === 1 ? uniqueCreators[0] : undefined,
            involvedCreatorIds: uniqueCreators,
            involvedEntityIds: [],
            platformOwnedCount: 0,
            attributableCount: uniqueCreators.length,
        };
    }

    // Content search
    if (path === CONTENT_SEARCH_PATH) {
        const uniqueCreators = [...new Set(resultCreatorIds)];
        const uniqueEntities = [...new Set(resultEntityIds)];
        const platformOwned = uniqueEntities.length - uniqueCreators.length;
        if (uniqueCreators.length === 0 && uniqueEntities.length === 0) {
            return {
                type: 'non_attributable',
                involvedCreatorIds: [],
                involvedEntityIds: [],
                platformOwnedCount: 0,
                attributableCount: 0,
            };
        }
        return {
            type: 'content_search',
            primaryCreatorId: uniqueCreators.length === 1 ? uniqueCreators[0] : undefined,
            involvedCreatorIds: uniqueCreators,
            involvedEntityIds: uniqueEntities,
            platformOwnedCount: Math.max(0, platformOwned),
            attributableCount: uniqueCreators.length,
        };
    }

    // Unified search — may return both creators and content
    if (path === UNIFIED_SEARCH_PATH) {
        const uniqueCreators = [...new Set(resultCreatorIds)];
        const uniqueEntities = [...new Set(resultEntityIds)];
        if (uniqueCreators.length === 0 && uniqueEntities.length === 0) {
            return {
                type: 'non_attributable',
                involvedCreatorIds: [],
                involvedEntityIds: [],
                platformOwnedCount: 0,
                attributableCount: 0,
            };
        }
        const hasCreators = uniqueCreators.length > 0;
        const hasEntities = uniqueEntities.length > 0;
        const platformOwned = hasEntities ? Math.max(0, uniqueEntities.length - uniqueCreators.length) : 0;
        return {
            type: hasCreators && hasEntities ? 'mixed' : hasCreators ? 'general_search' : 'platform_owned',
            primaryCreatorId: uniqueCreators.length === 1 ? uniqueCreators[0] : undefined,
            involvedCreatorIds: uniqueCreators,
            involvedEntityIds: uniqueEntities,
            platformOwnedCount: platformOwned,
            attributableCount: uniqueCreators.length,
        };
    }

    // --- ID-parameter paths (after literal paths) ---

    // Single creator by ID
    const creatorIdMatch = CREATOR_ID_PATTERN.exec(path) ?? ENRICH_PATTERN.exec(path);
    if (creatorIdMatch) {
        const creatorId = creatorIdMatch[1];
        return {
            type: 'creator_specific',
            primaryCreatorId: creatorId,
            involvedCreatorIds: [creatorId],
            involvedEntityIds: [],
            platformOwnedCount: 0,
            attributableCount: 1,
        };
    }

    // Single content by ID
    const contentIdMatch = CONTENT_ID_PATTERN.exec(path);
    if (contentIdMatch) {
        const contentId = contentIdMatch[1];
        const creatorIds = resultCreatorIds.length > 0 ? [...new Set(resultCreatorIds)] : [];
        return {
            type: 'content_specific',
            primaryCreatorId: creatorIds[0],
            involvedCreatorIds: creatorIds,
            involvedEntityIds: [contentId],
            platformOwnedCount: creatorIds.length === 0 ? 1 : 0,
            attributableCount: creatorIds.length,
        };
    }

    // Unknown path — non-attributable
    return {
        type: 'non_attributable',
        involvedCreatorIds: [],
        involvedEntityIds: [],
        platformOwnedCount: 0,
        attributableCount: 0,
    };
}

// ---------------------------------------------------------------------------
// Attribution status determination
// ---------------------------------------------------------------------------

/**
 * Determines the attribution status for a creator based on their verification
 * state and the request classification.
 *
 * Attribution rules from PRD Section 6.3:
 * - Verified AND linked → `verified_linked`
 * - Linked but unverified → `linked_unverified`
 * - Unlinked → `unlinked`
 * - Unknown (does not exist) → `unknown`
 * - Platform-owned data → `platform_owned`
 * - Ineligible → `ineligible`
 */
export function determineAttributionStatus(
    classification: RequestClassification,
    creatorId: string | null,
    verificationState: VerificationState,
): AttributionStatus {
    // Platform-owned classification always yields platform_owned
    if (classification.type === 'platform_owned') {
        return 'platform_owned';
    }

    // No creator specified — platform owned
    if (creatorId === null) {
        return 'platform_owned';
    }

    // Creator does not exist in the system
    if (!verificationState.exists) {
        return 'unknown';
    }

    // Creator exists but is not eligible (e.g. suspended, banned)
    if (!verificationState.isEligible) {
        return 'ineligible';
    }

    // Creator is not linked to any external identity
    if (!verificationState.isLinked) {
        return 'unlinked';
    }

    // Linked but not verified
    if (!verificationState.isVerified) {
        return 'linked_unverified';
    }

    // Verified and linked — eligible for creator revenue share
    return 'verified_linked';
}
