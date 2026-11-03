import { describe, expect, it } from 'vitest';
import {
    classifyCreator,
    detectLanguage,
    extractTopics,
    generateSummary,
} from './classification.js';

// ---------------------------------------------------------------------------
// classifyCreator
// ---------------------------------------------------------------------------

describe('classifyCreator', () => {
    it('classifies a music creator', () => {
        const categories = classifyCreator({
            bio: 'Afrobeats musician and producer. Dropping new tracks every Friday.',
        });
        expect(categories).toContain('music');
    });

    it('classifies a gaming creator', () => {
        const categories = classifyCreator({
            bio: 'Competitive Valorant player. Streaming on Twitch daily.',
            topics: ['esports', 'fps'],
        });
        expect(categories).toContain('gaming');
    });

    it('classifies with topics only (no bio)', () => {
        const categories = classifyCreator({
            topics: ['comedy', 'standup', 'skit'],
        });
        expect(categories).toContain('comedy');
    });

    it('returns multiple categories for multi-niche creators', () => {
        const categories = classifyCreator({
            bio: 'Tech entrepreneur and fitness enthusiast. Building startups by day, hitting the gym by night.',
        });
        expect(categories.length).toBeGreaterThan(1);
        expect(categories).toContain('tech');
        expect(categories).toContain('fitness');
    });

    it('returns at most 3 categories', () => {
        const categories = classifyCreator({
            bio: 'I do everything: music production, gaming streams, comedy skits, tech reviews, cooking tutorials, fashion vlogs, and dance challenges.',
        });
        expect(categories.length).toBeLessThanOrEqual(3);
    });

    it('returns ["other"] for unrecognisable content', () => {
        const categories = classifyCreator({
            bio: 'Just vibing.',
        });
        expect(categories).toEqual(['other']);
    });

    it('returns ["other"] for empty input', () => {
        expect(classifyCreator({})).toEqual(['other']);
        expect(classifyCreator({ bio: '' })).toEqual(['other']);
    });

    it('classifies using contentTypes', () => {
        const categories = classifyCreator({
            contentTypes: ['education', 'tutorial'],
        });
        expect(categories).toContain('education');
    });
});

// ---------------------------------------------------------------------------
// extractTopics
// ---------------------------------------------------------------------------

describe('extractTopics', () => {
    it('extracts hashtags from text', () => {
        const topics = extractTopics(['Check out my new #Afrobeats track! #NewMusic']);
        expect(topics).toContain('afrobeats');
        expect(topics).toContain('newmusic');
    });

    it('extracts @mentions as topics', () => {
        const topics = extractTopics(['Collab with @djkemi']);
        expect(topics).toContain('djkemi');
    });

    it('extracts capitalised named entities', () => {
        const topics = extractTopics(['Performing at Lagos Music Festival']);
        expect(topics).toContain('lagos music festival');
    });

    it('deduplicates topics', () => {
        const topics = extractTopics([
            '#Music #music',
            'I love #MUSIC',
        ]);
        const musicOccurrences = topics.filter((t) => t === 'music');
        expect(musicOccurrences.length).toBeLessThanOrEqual(1);
    });

    it('caps at 20 topics', () => {
        const longText = Array.from({ length: 30 }, (_, i) => `#topic${i}`).join(' ');
        const topics = extractTopics([longText]);
        expect(topics.length).toBeLessThanOrEqual(20);
    });

    it('returns empty array for empty input', () => {
        expect(extractTopics([])).toEqual([]);
        expect(extractTopics([''])).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------

describe('detectLanguage', () => {
    it('detects English text', () => {
        const lang = detectLanguage(
            'The quick brown fox jumps over the lazy dog. This is a test of the language detection system.',
        );
        expect(lang).toBe('en');
    });

    it('detects French text', () => {
        const lang = detectLanguage(
            'Le chat est sur la table. Il est dans le jardin avec les enfants pour une fête.',
        );
        expect(lang).toBe('fr');
    });

    it('detects Portuguese text', () => {
        const lang = detectLanguage(
            'O gato está na mesa. Ele está no jardim com as crianças para uma festa.',
        );
        expect(lang).toBe('pt');
    });

    it('defaults to en for very short text', () => {
        expect(detectLanguage('Hi')).toBe('en');
        expect(detectLanguage('OK')).toBe('en');
    });

    it('defaults to en for empty text', () => {
        expect(detectLanguage('')).toBe('en');
    });

    it('defaults to en when no stopwords match', () => {
        const lang = detectLanguage('xyz123 abc456 def789 ghi012 jkl345');
        expect(lang).toBe('en');
    });
});

// ---------------------------------------------------------------------------
// generateSummary
// ---------------------------------------------------------------------------

describe('generateSummary', () => {
    it('returns short bio as-is', () => {
        const summary = generateSummary('Afrobeats producer from Lagos.');
        expect(summary).toBe('Afrobeats producer from Lagos.');
    });

    it('collapses whitespace and newlines', () => {
        const summary = generateSummary('Multi-genre\n\nproducer.   Based  in Lagos.');
        expect(summary).toBe('Multi-genre producer. Based in Lagos.');
    });

    it('converts pipe separators to sentence separators', () => {
        const summary = generateSummary('Producer | DJ | Streamer');
        expect(summary).toBe('Producer. DJ. Streamer');
    });

    it('truncates long text at sentence boundary', () => {
        const longBio = 'First sentence is here. Second sentence follows. Third sentence is also present. ' +
            'Fourth sentence makes it even longer. Fifth sentence pushes well past the two-hundred-eighty character limit ' +
            'that we use for summary truncation in this module. Sixth sentence is definitely way beyond the limit now.';

        const summary = generateSummary(longBio);
        expect(summary.length).toBeLessThanOrEqual(280);
        // Should end at a sentence boundary (with punctuation)
        expect(summary).toMatch(/[.!?]$/);
    });

    it('appends additional context when distinct', () => {
        const summary = generateSummary('DJ from Lagos.', 'Streams on Streamlivr');
        expect(summary).toContain('Streams on Streamlivr');
    });

    it('does not duplicate context that overlaps with bio', () => {
        const summary = generateSummary('DJ from Lagos streaming daily.', 'DJ from Lagos');
        // Should not contain "DJ from Lagos" twice as a separate appended clause
        const occurrences = summary.split('DJ from Lagos').length - 1;
        expect(occurrences).toBe(1);
    });

    it('returns empty string for empty bio and no context', () => {
        expect(generateSummary('')).toBe('');
    });

    it('returns context when bio is empty but context is provided', () => {
        expect(generateSummary('', 'Some context')).toBe('Some context');
    });
});
