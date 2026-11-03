/**
 * Retrieval-Augmented Generation (RAG) service for the intelligence engine.
 *
 * Provides context retrieval for the future AI assistant chatbot. Parses
 * natural language questions into search intents using keyword matching
 * (no LLM call), builds multiple search queries, and formats retrieved
 * context for LLM prompt injection.
 */

import type { EntityType } from '../types.js';
import type { SearchFilters } from '../retrieval/hybrid.js';
import { buildSearchQuery, parseSearchRequest, type SearchPlan } from '../retrieval/search.js';
import type { SearchService } from './searchService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RagOptions {
    maxContextItems: number;
    maxContextChars: number;
    includeContent: boolean;
    includeCreators: boolean;
}

export interface RagSource {
    entityType: EntityType;
    entityId: string;
    relevanceScore: number;
    snippet: string;
}

export interface QuestionIntent {
    type: 'discover' | 'compare' | 'detail' | 'recommend' | 'trend';
    entityFocus: EntityType[];
    searchTerms: string[];
    filters: Partial<SearchFilters>;
    originalQuestion: string;
}

export interface RagContext {
    queries: SearchPlan[];
    intent: QuestionIntent;
    contextPromptTemplate: string;
    estimatedTokens: number;
    sources: RagSource[];
}

export interface RagService {
    retrieveContext(question: string, options?: Partial<RagOptions>): RagContext;
    parseQuestionIntent(question: string): QuestionIntent;
    buildContextPrompt(context: RagContext): string;
    buildRagSearchQueries(intent: QuestionIntent): SearchPlan[];
}

// ---------------------------------------------------------------------------
// Keyword dictionaries for intent parsing
// ---------------------------------------------------------------------------

const CREATOR_KEYWORDS = [
    'creator', 'creators', 'artist', 'artists', 'producer', 'producers',
    'streamer', 'streamers', 'musician', 'musicians', 'host', 'hosts',
    'influencer', 'influencers', 'who', 'someone', 'people',
];

const CONTENT_KEYWORDS = [
    'content', 'video', 'videos', 'post', 'posts', 'stream', 'streams',
    'song', 'songs', 'track', 'tracks', 'episode', 'episodes', 'clip', 'clips',
    'media', 'recording', 'recordings',
];

const TREND_KEYWORDS = [
    'trending', 'trend', 'trends',
];

/** Weaker trend signals — these alone do not override a discover intent. */
const SOFT_TREND_KEYWORDS = [
    'popular', 'rising', 'hot', 'viral',
    'growth', 'growing', 'emerging', 'new', 'latest', 'recent',
];

const RECOMMEND_KEYWORDS = [
    'recommend', 'recommendations', 'suggest', 'suggestions', 'similar',
    'like', 'alternatives', 'related',
];

const COMPARE_KEYWORDS = [
    'compare', 'comparison', 'versus', 'vs', 'difference', 'between',
    'better', 'which',
];

const DETAIL_KEYWORDS = [
    'tell me about', 'details', 'information', 'info', 'profile',
    'what is', 'who is', 'describe',
];

const LANGUAGE_MAP: Record<string, string> = {
    english: 'en', yoruba: 'yo', igbo: 'ig', hausa: 'ha',
    french: 'fr', spanish: 'es', portuguese: 'pt', arabic: 'ar',
    swahili: 'sw', pidgin: 'pcm',
};

const CATEGORY_KEYWORDS = [
    'music', 'gaming', 'lifestyle', 'comedy', 'education', 'sports',
    'technology', 'fashion', 'food', 'travel', 'fitness', 'art',
    'dance', 'podcast', 'talk show', 'afrobeats', 'hip hop', 'r&b',
    'gospel', 'amapiano',
];

// ---------------------------------------------------------------------------
// Stop words to filter from search terms
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'not', 'only', 'same', 'so',
    'than', 'too', 'very', 'just', 'about', 'up', 'it', 'its', 'i', 'me',
    'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
    'they', 'them', 'their', 'what', 'this', 'that', 'these', 'those',
    'and', 'but', 'or', 'if', 'while', 'because', 'until', 'although',
    'find', 'show', 'get', 'give', 'make', 'let', 'tell',
]);

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultRagOptions(): RagOptions {
    return {
        maxContextItems: 10,
        maxContextChars: 4000,
        includeContent: true,
        includeCreators: true,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\w\s&'-]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1);
}

function hasAnyKeyword(tokens: string[], keywords: string[]): boolean {
    return tokens.some((t) => keywords.includes(t));
}

function hasAnyPhrase(text: string, phrases: string[]): boolean {
    const lower = text.toLowerCase();
    return phrases.some((p) => lower.includes(p));
}

function extractSearchTerms(tokens: string[]): string[] {
    return tokens.filter(
        (t) =>
            !STOP_WORDS.has(t) &&
            !CREATOR_KEYWORDS.includes(t) &&
            !CONTENT_KEYWORDS.includes(t) &&
            !TREND_KEYWORDS.includes(t) &&
            !SOFT_TREND_KEYWORDS.includes(t) &&
            !RECOMMEND_KEYWORDS.includes(t) &&
            !COMPARE_KEYWORDS.includes(t),
    );
}

function detectLanguageFilter(tokens: string[]): string | undefined {
    for (const token of tokens) {
        if (LANGUAGE_MAP[token]) {
            return LANGUAGE_MAP[token];
        }
    }
    return undefined;
}

function detectCategoryFilter(tokens: string[], text: string): string[] {
    const found: string[] = [];
    // Check multi-word categories first
    const lower = text.toLowerCase();
    for (const cat of CATEGORY_KEYWORDS) {
        if (cat.includes(' ') && lower.includes(cat)) {
            found.push(cat);
        } else if (!cat.includes(' ') && tokens.includes(cat)) {
            found.push(cat);
        }
    }
    return found;
}

/**
 * Rough token estimate: ~4 chars per token for English text.
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a RAG service that retrieves intelligence context for LLM prompts.
 *
 * The service uses keyword-based intent parsing (no LLM call) and builds
 * search plans that the caller can execute against the database.
 */
export function createRagService(searchService: SearchService): RagService {
    function parseQuestionIntent(question: string): QuestionIntent {
        const tokens = tokenize(question);
        const lower = question.toLowerCase();

        // Determine intent type.
        // Priority: compare > strong-trend > recommend > detail > discover
        // Soft trend keywords (emerging, popular, etc.) do NOT override discover.
        let type: QuestionIntent['type'] = 'discover';

        if (hasAnyKeyword(tokens, COMPARE_KEYWORDS)) {
            type = 'compare';
        } else if (hasAnyKeyword(tokens, TREND_KEYWORDS)) {
            type = 'trend';
        } else if (hasAnyKeyword(tokens, RECOMMEND_KEYWORDS)) {
            type = 'recommend';
        } else if (hasAnyPhrase(lower, DETAIL_KEYWORDS)) {
            type = 'detail';
        }

        // Determine entity focus
        const hasCreatorSignal = hasAnyKeyword(tokens, CREATOR_KEYWORDS);
        const hasContentSignal = hasAnyKeyword(tokens, CONTENT_KEYWORDS);

        let entityFocus: EntityType[];
        if (hasCreatorSignal && hasContentSignal) {
            entityFocus = ['creator', 'content'];
        } else if (hasContentSignal) {
            entityFocus = ['content'];
        } else if (hasCreatorSignal) {
            entityFocus = ['creator'];
        } else {
            // Default: both for trend/discover, creator for recommend
            entityFocus = type === 'recommend' ? ['creator'] : ['creator', 'content'];
        }

        // Extract meaningful search terms
        const searchTerms = extractSearchTerms(tokens);

        // Build filters from keywords
        const filters: Partial<SearchFilters> = {};
        const language = detectLanguageFilter(tokens);
        if (language) filters.language = language;
        const categories = detectCategoryFilter(tokens, question);
        if (categories.length > 0) filters.categories = categories;

        return {
            type,
            entityFocus,
            searchTerms,
            filters,
            originalQuestion: question,
        };
    }

    function buildRagSearchQueries(intent: QuestionIntent): SearchPlan[] {
        const plans: SearchPlan[] = [];
        const query = intent.searchTerms.join(' ');

        // Primary query for the main entity focus
        if (intent.entityFocus.includes('creator')) {
            const parsed = parseSearchRequest({
                query: query || undefined,
                entityTypes: ['creator'],
                filters: intent.filters as SearchFilters | undefined,
                limit: 10,
            });
            plans.push(buildSearchQuery(parsed));
        }

        // Secondary query for content if included
        if (intent.entityFocus.includes('content')) {
            const parsed = parseSearchRequest({
                query: query || undefined,
                entityTypes: ['content'],
                filters: intent.filters as SearchFilters | undefined,
                limit: 10,
            });
            plans.push(buildSearchQuery(parsed));
        }

        // For compare/detail intents, add a broader query if we have search terms
        if (
            (intent.type === 'compare' || intent.type === 'detail') &&
            intent.searchTerms.length > 2
        ) {
            // Use only the first two terms for a broader search
            const broaderQuery = intent.searchTerms.slice(0, 2).join(' ');
            const parsed = parseSearchRequest({
                query: broaderQuery,
                entityTypes: intent.entityFocus,
                limit: 5,
            });
            plans.push(buildSearchQuery(parsed));
        }

        return plans;
    }

    function buildContextPrompt(context: RagContext): string {
        const parts: string[] = [];

        parts.push(`## Retrieved Intelligence Context`);
        parts.push(`**Question:** ${context.intent.originalQuestion}`);
        parts.push(`**Intent:** ${context.intent.type}`);
        parts.push(`**Entity Focus:** ${context.intent.entityFocus.join(', ')}`);
        parts.push('');

        if (context.sources.length > 0) {
            parts.push(`### Sources (${context.sources.length} items)`);
            for (const source of context.sources) {
                parts.push(
                    `- [${source.entityType}:${source.entityId}] (relevance: ${source.relevanceScore.toFixed(2)}) ${source.snippet}`,
                );
            }
        } else {
            parts.push('### Sources');
            parts.push('No pre-fetched sources available. Execute the search plans to retrieve context.');
        }

        parts.push('');
        parts.push(`### Search Queries`);
        parts.push(`${context.queries.length} search plan(s) prepared for execution.`);

        let result = parts.join('\n');

        // Cap to max chars
        if (result.length > context.estimatedTokens * 4) {
            result = result.slice(0, context.estimatedTokens * 4) + '\n\n[Context truncated]';
        }

        return result;
    }

    function retrieveContext(
        question: string,
        options?: Partial<RagOptions>,
    ): RagContext {
        const opts: RagOptions = { ...defaultRagOptions(), ...options };

        // Parse intent
        const intent = parseQuestionIntent(question);

        // Adjust entity focus based on options
        if (!opts.includeCreators) {
            intent.entityFocus = intent.entityFocus.filter((e) => e !== 'creator');
            if (intent.entityFocus.length === 0) intent.entityFocus = ['content'];
        }
        if (!opts.includeContent) {
            intent.entityFocus = intent.entityFocus.filter((e) => e !== 'content');
            if (intent.entityFocus.length === 0) intent.entityFocus = ['creator'];
        }

        // Build search queries
        const queries = buildRagSearchQueries(intent);

        // Build the context prompt template
        const contextPromptTemplate = [
            `Use the following intelligence data to answer the user's question.`,
            `Only use information from the provided context. If the context does not`,
            `contain enough information, say so clearly.`,
            ``,
            `Question: ${question}`,
            `Intent: ${intent.type}`,
            `Entity focus: ${intent.entityFocus.join(', ')}`,
            `Search terms: ${intent.searchTerms.join(', ')}`,
        ].join('\n');

        const estimatedTokens = Math.min(
            estimateTokens(contextPromptTemplate) + opts.maxContextItems * 100,
            Math.ceil(opts.maxContextChars / 4),
        );

        return {
            queries,
            intent,
            contextPromptTemplate,
            estimatedTokens,
            sources: [], // Populated after query execution
        };
    }

    return {
        retrieveContext,
        parseQuestionIntent,
        buildContextPrompt,
        buildRagSearchQueries,
    };
}
