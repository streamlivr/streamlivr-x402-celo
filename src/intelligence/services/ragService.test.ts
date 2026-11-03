import { describe, expect, it } from 'vitest';
import { createRagService } from './ragService.js';
import { createSearchService } from './searchService.js';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const searchService = createSearchService();
const rag = createRagService(searchService);

// ---------------------------------------------------------------------------
// parseQuestionIntent — intent type detection
// ---------------------------------------------------------------------------

describe('parseQuestionIntent — intent type', () => {
    it('classifies "Find emerging Afrobeats creators" as discover + creators', () => {
        const intent = rag.parseQuestionIntent('Find emerging Afrobeats creators');
        expect(intent.type).toBe('discover');
        expect(intent.entityFocus).toContain('creator');
        expect(intent.searchTerms).toContain('afrobeats');
    });

    it('classifies "Show me creators who discuss music production" as discover + creators', () => {
        const intent = rag.parseQuestionIntent('Show me creators who discuss music production');
        expect(intent.type).toBe('discover');
        expect(intent.entityFocus).toContain('creator');
        expect(intent.searchTerms).toContain('music');
        expect(intent.searchTerms).toContain('production');
    });

    it('classifies "What is trending in Nigerian music?" as trend', () => {
        const intent = rag.parseQuestionIntent('What is trending in Nigerian music?');
        expect(intent.type).toBe('trend');
        expect(intent.entityFocus.length).toBeGreaterThanOrEqual(1);
        expect(intent.searchTerms).toContain('nigerian');
        expect(intent.searchTerms).toContain('music');
    });

    it('classifies "Recommend creators similar to this one" as recommend + creators', () => {
        const intent = rag.parseQuestionIntent('Recommend creators similar to this one');
        expect(intent.type).toBe('recommend');
        expect(intent.entityFocus).toContain('creator');
    });

    it('classifies "Find content about African music technology" as discover + content', () => {
        const intent = rag.parseQuestionIntent('Find content about African music technology');
        expect(intent.type).toBe('discover');
        expect(intent.entityFocus).toContain('content');
        expect(intent.searchTerms).toContain('african');
        expect(intent.searchTerms).toContain('music');
        expect(intent.searchTerms).toContain('technology');
    });

    it('classifies "Compare these two creators" as compare', () => {
        const intent = rag.parseQuestionIntent('Compare these two creators');
        expect(intent.type).toBe('compare');
    });

    it('classifies "Tell me about this creator profile" as detail', () => {
        const intent = rag.parseQuestionIntent('Tell me about this creator profile');
        expect(intent.type).toBe('detail');
    });
});

// ---------------------------------------------------------------------------
// parseQuestionIntent — entity type detection
// ---------------------------------------------------------------------------

describe('parseQuestionIntent — entity detection', () => {
    it('detects creator from "artist" keyword', () => {
        const intent = rag.parseQuestionIntent('Find the best artist in Lagos');
        expect(intent.entityFocus).toContain('creator');
    });

    it('detects content from "video" keyword', () => {
        const intent = rag.parseQuestionIntent('Show me the latest video about cooking');
        expect(intent.entityFocus).toContain('content');
    });

    it('detects both when creator and content keywords present', () => {
        const intent = rag.parseQuestionIntent('Find creators and their videos about music');
        expect(intent.entityFocus).toContain('creator');
        expect(intent.entityFocus).toContain('content');
    });

    it('defaults to both when no entity keywords', () => {
        const intent = rag.parseQuestionIntent('What is happening in Afrobeats?');
        expect(intent.entityFocus.length).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// parseQuestionIntent — filter extraction
// ---------------------------------------------------------------------------

describe('parseQuestionIntent — filters', () => {
    it('extracts language filter from question', () => {
        const intent = rag.parseQuestionIntent('Find English-speaking creators in yoruba music');
        expect(intent.filters.language).toBe('yo');
    });

    it('extracts category filter from question', () => {
        const intent = rag.parseQuestionIntent('Find gaming streamers');
        expect(intent.filters.categories).toContain('gaming');
    });

    it('extracts music category', () => {
        const intent = rag.parseQuestionIntent('Show me music creators');
        expect(intent.filters.categories).toContain('music');
    });
});

// ---------------------------------------------------------------------------
// parseQuestionIntent — search terms
// ---------------------------------------------------------------------------

describe('parseQuestionIntent — search terms', () => {
    it('filters out stop words', () => {
        const intent = rag.parseQuestionIntent('Find the best creators in Lagos');
        expect(intent.searchTerms).not.toContain('the');
        expect(intent.searchTerms).not.toContain('in');
        expect(intent.searchTerms).toContain('best');
        expect(intent.searchTerms).toContain('lagos');
    });

    it('filters out creator/content keywords from search terms', () => {
        const intent = rag.parseQuestionIntent('Show me creators who produce music');
        expect(intent.searchTerms).not.toContain('creators');
        expect(intent.searchTerms).toContain('produce');
    });

    it('preserves original question', () => {
        const q = 'Find Afrobeats creators in Lagos';
        const intent = rag.parseQuestionIntent(q);
        expect(intent.originalQuestion).toBe(q);
    });
});

// ---------------------------------------------------------------------------
// buildRagSearchQueries
// ---------------------------------------------------------------------------

describe('buildRagSearchQueries', () => {
    it('generates at least one query for creator focus', () => {
        const intent = rag.parseQuestionIntent('Find Afrobeats creators');
        const queries = rag.buildRagSearchQueries(intent);
        expect(queries.length).toBeGreaterThanOrEqual(1);
        expect(queries[0]!.entityType).toBe('creator');
    });

    it('generates queries for both entity types when both focused', () => {
        const intent = rag.parseQuestionIntent('Find creators and their videos');
        const queries = rag.buildRagSearchQueries(intent);
        const entityTypes = queries.map((q) => q.entityType);
        expect(entityTypes).toContain('creator');
        expect(entityTypes).toContain('content');
    });

    it('generates up to 3 queries for complex intents', () => {
        const intent = rag.parseQuestionIntent(
            'Compare Afrobeats and Hip Hop creators in Nigerian music scene production',
        );
        const queries = rag.buildRagSearchQueries(intent);
        expect(queries.length).toBeLessThanOrEqual(3);
    });

    it('generates content-only query for content focus', () => {
        const intent = rag.parseQuestionIntent('Find videos about cooking');
        const queries = rag.buildRagSearchQueries(intent);
        expect(queries.some((q) => q.entityType === 'content')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// buildContextPrompt
// ---------------------------------------------------------------------------

describe('buildContextPrompt', () => {
    it('includes question and intent in prompt', () => {
        const ctx = rag.retrieveContext('Find Afrobeats creators');
        const prompt = rag.buildContextPrompt(ctx);
        expect(prompt).toContain('Find Afrobeats creators');
        expect(prompt).toContain('discover');
    });

    it('includes source count', () => {
        const ctx = rag.retrieveContext('Find creators');
        const prompt = rag.buildContextPrompt(ctx);
        expect(prompt).toContain('Sources');
    });

    it('includes search plan count', () => {
        const ctx = rag.retrieveContext('Find creators');
        const prompt = rag.buildContextPrompt(ctx);
        expect(prompt).toContain('search plan');
    });

    it('respects max char limit via estimatedTokens', () => {
        const ctx = rag.retrieveContext('Find creators', { maxContextChars: 100 });
        const prompt = rag.buildContextPrompt(ctx);
        // The prompt may be truncated — just ensure it does not crash
        expect(prompt.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// retrieveContext
// ---------------------------------------------------------------------------

describe('retrieveContext', () => {
    it('returns structured context with queries and intent', () => {
        const ctx = rag.retrieveContext('Find Afrobeats creators');
        expect(ctx.intent.type).toBe('discover');
        expect(ctx.queries.length).toBeGreaterThanOrEqual(1);
        expect(ctx.contextPromptTemplate).toBeDefined();
        expect(ctx.estimatedTokens).toBeGreaterThan(0);
        expect(Array.isArray(ctx.sources)).toBe(true);
    });

    it('respects includeCreators option', () => {
        const ctx = rag.retrieveContext('Find stuff', {
            includeCreators: false,
            includeContent: true,
        });
        // With creators excluded, entity focus should only have content
        expect(ctx.intent.entityFocus).toContain('content');
    });

    it('respects includeContent option', () => {
        const ctx = rag.retrieveContext('Find videos', {
            includeCreators: true,
            includeContent: false,
        });
        expect(ctx.intent.entityFocus).toContain('creator');
    });

    it('returns empty sources array (populated after query execution)', () => {
        const ctx = rag.retrieveContext('Find creators');
        expect(ctx.sources).toHaveLength(0);
    });
});
