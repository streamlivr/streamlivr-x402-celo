/**
 * Entity resolution service.
 *
 * Maps external identifiers (X username, website URL, etc.) to canonical
 * Streamlivr creator IDs and determines the linking/verification status
 * of each external identity.
 */

import type { ExternalIdentityLink, VerificationStatus } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LinkingStatus = 'verified_linked' | 'linked_unverified' | 'unlinked' | 'unknown';

export interface ResolvedIdentity {
    /** The canonical Streamlivr creator ID. */
    canonicalId: string;
    /** Map of provider → matched external identity link (if found). */
    externalMatches: Map<string, ExternalIdentityLink>;
    /** Overall linking status across all external identifiers. */
    linkingStatus: LinkingStatus;
    /** Confidence score (0–1) that the resolved identity is correct. */
    confidence: number;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise an external identifier based on its provider type.
 *
 * - X usernames: strip leading `@`, lowercase
 * - URLs: strip protocol (`https://`, `http://`), strip trailing `/`
 * - Default: trim and lowercase
 */
export function normalizeExternalIdentifier(provider: string, rawId: string): string {
    const trimmed = rawId.trim();

    switch (provider) {
        case 'x':
        case 'x_api':
        case 'twitter':
            return trimmed.replace(/^@/, '').toLowerCase();

        case 'website':
        case 'url': {
            let normalized = trimmed.toLowerCase();
            normalized = normalized.replace(/^https?:\/\//, '');
            normalized = normalized.replace(/\/+$/, '');
            return normalized;
        }

        default:
            return trimmed.toLowerCase();
    }
}

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a creator's identity across external platforms.
 *
 * Given a canonical Streamlivr `creatorId`, optional external identifiers,
 * and any already-persisted {@link ExternalIdentityLink} records, determine
 * which identifiers match and the overall linking status.
 */
export function resolveCreatorIdentity(input: {
    creatorId: string;
    externalIdentifiers?: Record<string, string>;
    existingLinks?: ExternalIdentityLink[];
}): ResolvedIdentity {
    const { creatorId, externalIdentifiers, existingLinks } = input;

    const externalMatches = new Map<string, ExternalIdentityLink>();
    let bestVerification: VerificationStatus = 'unlinked';

    if (externalIdentifiers && existingLinks && existingLinks.length > 0) {
        for (const [provider, rawId] of Object.entries(externalIdentifiers)) {
            const normalizedId = normalizeExternalIdentifier(provider, rawId);

            const match = existingLinks.find((link) => {
                const linkProvider = link.provider.toLowerCase();
                const normalizedProvider = provider.toLowerCase();

                // Match provider names (x_api ↔ x ↔ twitter)
                const providerMatch =
                    linkProvider === normalizedProvider ||
                    (linkProvider === 'x_api' && (normalizedProvider === 'x' || normalizedProvider === 'twitter')) ||
                    (normalizedProvider === 'x_api' && (linkProvider === 'x' || linkProvider === 'twitter'));

                if (!providerMatch) return false;

                // Match by username or account ID
                const linkUsername = link.externalUsername
                    ? normalizeExternalIdentifier(provider, link.externalUsername)
                    : null;
                const linkAccountId = normalizeExternalIdentifier(provider, link.externalAccountId);

                return linkUsername === normalizedId || linkAccountId === normalizedId;
            });

            if (match) {
                externalMatches.set(provider, match);

                // Track the best verification status
                if (match.verificationStatus === 'verified') {
                    bestVerification = 'verified';
                } else if (match.verificationStatus === 'linked' && bestVerification !== 'verified') {
                    bestVerification = 'linked';
                }
            }
        }
    }

    // Determine linking status
    let linkingStatus: LinkingStatus;
    if (externalMatches.size === 0) {
        linkingStatus = externalIdentifiers && Object.keys(externalIdentifiers).length > 0
            ? 'unlinked'
            : 'unknown';
    } else if (bestVerification === 'verified') {
        linkingStatus = 'verified_linked';
    } else {
        linkingStatus = 'linked_unverified';
    }

    // Confidence based on linking status
    let confidence: number;
    switch (linkingStatus) {
        case 'verified_linked':
            confidence = 1.0;
            break;
        case 'linked_unverified':
            confidence = 0.7;
            break;
        case 'unlinked':
            confidence = 0.3;
            break;
        case 'unknown':
        default:
            confidence = 0.1;
            break;
    }

    return {
        canonicalId: creatorId,
        externalMatches,
        linkingStatus,
        confidence,
    };
}

// ---------------------------------------------------------------------------
// Cross-platform matching
// ---------------------------------------------------------------------------

/**
 * Compute a naive confidence score (0–1) that two data records refer to
 * the same entity by comparing normalised names, bios, and identifiers.
 *
 * Used to _suggest_ potential links — never to auto-verify.
 */
export function matchConfidence(
    nativeData: Record<string, unknown>,
    externalData: Record<string, unknown>,
): number {
    let score = 0;
    let signals = 0;

    // Compare display names
    const nativeName = stringOrNull(nativeData.displayName ?? nativeData.name ?? nativeData.username);
    const externalName = stringOrNull(externalData.displayName ?? externalData.name ?? externalData.username);
    if (nativeName && externalName) {
        signals++;
        if (nativeName.toLowerCase() === externalName.toLowerCase()) {
            score += 1.0;
        } else if (nativeName.toLowerCase().includes(externalName.toLowerCase()) ||
            externalName.toLowerCase().includes(nativeName.toLowerCase())) {
            score += 0.5;
        }
    }

    // Compare bios
    const nativeBio = stringOrNull(nativeData.bio ?? nativeData.biography);
    const externalBio = stringOrNull(externalData.bio ?? externalData.biography ?? externalData.description);
    if (nativeBio && externalBio) {
        signals++;
        const nativeWords = new Set(nativeBio.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
        const externalWords = new Set(externalBio.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
        if (nativeWords.size > 0 && externalWords.size > 0) {
            let overlap = 0;
            for (const word of nativeWords) {
                if (externalWords.has(word)) overlap++;
            }
            const unionSize = new Set([...nativeWords, ...externalWords]).size;
            score += unionSize > 0 ? overlap / unionSize : 0;
        }
    }

    // Compare usernames
    const nativeUsername = stringOrNull(nativeData.username);
    const externalUsername = stringOrNull(externalData.username);
    if (nativeUsername && externalUsername) {
        signals++;
        if (nativeUsername.toLowerCase() === externalUsername.toLowerCase()) {
            score += 1.0;
        }
    }

    // Compare locations
    const nativeLoc = stringOrNull(nativeData.location ?? nativeData.countryCode);
    const externalLoc = stringOrNull(externalData.location);
    if (nativeLoc && externalLoc) {
        signals++;
        if (nativeLoc.toLowerCase() === externalLoc.toLowerCase()) {
            score += 0.5;
        }
    }

    return signals > 0 ? Math.min(score / signals, 1.0) : 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringOrNull(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    return null;
}
