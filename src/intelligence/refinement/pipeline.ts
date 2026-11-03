/**
 * Intelligence refinement pipeline.
 *
 * Orchestrates the classification, topic extraction, language detection,
 * summary generation, and (optional) embedding steps to produce structured
 * intelligence output from raw enrichment data.
 */

import {
    classifyCreator,
    detectLanguage,
    extractTopics,
    generateSummary,
} from './classification.js';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface RefinedCreatorIntelligence {
    categories: string[];
    topics: string[];
    languages: string[];
    biographySummary: string;
    crossPlatformPresence: Record<string, unknown>;
    engagementSignals: Record<string, unknown>;
    recommendationFeatures: Record<string, unknown>;
    confidenceScore: number;
}

export interface RefinedContentIntelligence {
    summary: string;
    topics: string[];
    categories: string[];
    language: string;
    confidenceScore: number;
}

// ---------------------------------------------------------------------------
// Creator refinement
// ---------------------------------------------------------------------------

/**
 * Refine raw enrichment data into structured creator intelligence.
 *
 * Calls classification, topic extraction, language detection, and summary
 * generation. Assembles all outputs into a validated result.
 */
export async function refineCreatorIntelligence(
    rawData: Record<string, unknown>,
): Promise<RefinedCreatorIntelligence> {
    // Extract text fields for analysis
    const bio = asString(rawData.biography ?? rawData.bio ?? rawData.description);
    const name = asString(rawData.displayName ?? rawData.name ?? rawData.username);
    const existingTopics = asStringArray(rawData.topics);
    const existingCategories = asStringArray(rawData.categories);
    const existingLanguages = asStringArray(rawData.languages);

    // Collect text inputs for topic extraction
    const textInputs: string[] = [];
    if (bio) textInputs.push(bio);
    if (name) textInputs.push(name);

    // 1. Classify creator
    const categories = existingCategories.length > 0
        ? existingCategories
        : classifyCreator({ bio: bio ?? undefined, topics: existingTopics });

    // 2. Extract topics
    const extractedTopics = textInputs.length > 0
        ? extractTopics(textInputs)
        : [];
    const allTopics = deduplicateStrings([...existingTopics, ...extractedTopics]);

    // 3. Detect language(s)
    const detectedLang = bio ? detectLanguage(bio) : 'en';
    const languages = existingLanguages.length > 0
        ? existingLanguages
        : [detectedLang];

    // 4. Generate biography summary
    const biographySummary = bio ? generateSummary(bio) : '';

    // 5. Build cross-platform presence
    const crossPlatformPresence: Record<string, unknown> = {};
    if (rawData.xId || rawData.username) {
        crossPlatformPresence.x = {
            id: rawData.xId ?? null,
            username: rawData.username ?? null,
            followerCount: rawData.followerCount ?? null,
        };
    }
    if (rawData.socialLinks && typeof rawData.socialLinks === 'object') {
        Object.assign(crossPlatformPresence, rawData.socialLinks);
    }

    // 6. Build engagement signals
    const engagementSignals: Record<string, unknown> = {};
    if (rawData.followerCount !== undefined) engagementSignals.followerCount = rawData.followerCount;
    if (rawData.followingCount !== undefined) engagementSignals.followingCount = rawData.followingCount;
    if (rawData.tweetCount !== undefined) engagementSignals.tweetCount = rawData.tweetCount;
    if (rawData.listedCount !== undefined) engagementSignals.listedCount = rawData.listedCount;
    if (rawData.contentCount !== undefined) engagementSignals.contentCount = rawData.contentCount;
    if (rawData.viewCount !== undefined) engagementSignals.viewCount = rawData.viewCount;

    // 7. Build recommendation features
    const recommendationFeatures: Record<string, unknown> = {
        categories,
        topicCount: allTopics.length,
        hasProfileImage: rawData.profileImageUrl !== null && rawData.profileImageUrl !== undefined,
        hasBio: bio !== null && bio.length > 0,
        isVerified: rawData.verified === true || rawData.isVerified === true,
        primaryLanguage: languages[0] ?? 'en',
    };

    // 8. Compute confidence score
    let confidenceScore = 0.3; // Base
    if (bio && bio.length > 20) confidenceScore += 0.2;
    if (allTopics.length > 0) confidenceScore += 0.1;
    if (categories.length > 0 && categories[0] !== 'other') confidenceScore += 0.1;
    if (Object.keys(crossPlatformPresence).length > 0) confidenceScore += 0.1;
    if (Object.keys(engagementSignals).length > 2) confidenceScore += 0.1;
    confidenceScore = Math.min(confidenceScore, 1.0);

    return {
        categories,
        topics: allTopics,
        languages,
        biographySummary,
        crossPlatformPresence,
        engagementSignals,
        recommendationFeatures,
        confidenceScore,
    };
}

// ---------------------------------------------------------------------------
// Content refinement
// ---------------------------------------------------------------------------

/**
 * Refine raw enrichment data into structured content intelligence.
 */
export async function refineContentIntelligence(
    rawData: Record<string, unknown>,
): Promise<RefinedContentIntelligence> {
    const text = asString(rawData.text ?? rawData.description ?? rawData.title ?? rawData.markdownPreview);
    const existingTopics = asStringArray(rawData.topics);
    const existingCategories = asStringArray(rawData.categories);

    // Collect text inputs
    const textInputs: string[] = [];
    if (text) textInputs.push(text);
    const title = asString(rawData.title);
    if (title) textInputs.push(title);

    // 1. Extract topics
    const extractedTopics = textInputs.length > 0
        ? extractTopics(textInputs)
        : [];
    const allTopics = deduplicateStrings([...existingTopics, ...extractedTopics]);

    // 2. Classify content
    const categories = existingCategories.length > 0
        ? existingCategories
        : classifyCreator({ bio: text ?? undefined, topics: allTopics });

    // 3. Detect language
    const language = asString(rawData.language) ?? (text ? detectLanguage(text) : 'en');

    // 4. Generate summary
    const summary = text ? generateSummary(text) : (title ?? '');

    // 5. Compute confidence score
    let confidenceScore = 0.3;
    if (text && text.length > 50) confidenceScore += 0.3;
    if (allTopics.length > 0) confidenceScore += 0.1;
    if (categories.length > 0 && categories[0] !== 'other') confidenceScore += 0.1;
    if (language !== 'en') confidenceScore += 0.1; // Extra signal from language detection
    confidenceScore = Math.min(confidenceScore, 1.0);

    return {
        summary,
        topics: allTopics,
        categories,
        language,
        confidenceScore,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    return null;
}

function asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((v) => typeof v === 'string');
    return [];
}

function deduplicateStrings(arr: string[]): string[] {
    return [...new Set(arr.map((s) => s.toLowerCase()))];
}
