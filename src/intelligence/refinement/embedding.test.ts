import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EmbeddingError,
    generateEmbedding,
    prepareTextForEmbedding,
    type EmbeddingConfig,
} from './embedding.js';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const openaiConfig: EmbeddingConfig = {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    apiKey: 'sk-test-key',
};

const geminiConfig: EmbeddingConfig = {
    provider: 'gemini',
    model: 'text-embedding-004',
    dimensions: 768,
    apiKey: 'gemini-test-key',
};

function mockOpenAIResponse(embedding: number[]): Response {
    return new Response(
        JSON.stringify({
            data: [{ embedding, index: 0 }],
            usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

function mockGeminiResponse(values: number[]): Response {
    return new Response(
        JSON.stringify({
            embedding: { values },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

// ---------------------------------------------------------------------------
// prepareTextForEmbedding
// ---------------------------------------------------------------------------

describe('prepareTextForEmbedding', () => {
    it('concatenates name, bio, categories, and topics', () => {
        const text = prepareTextForEmbedding({
            name: 'DJ Kemi',
            biography: 'Afrobeats producer from Lagos',
            categories: ['music', 'entertainment'],
            topics: ['afrobeats', 'live streaming'],
        });

        expect(text).toContain('Name: DJ Kemi');
        expect(text).toContain('Bio: Afrobeats producer from Lagos');
        expect(text).toContain('Categories: music, entertainment');
        expect(text).toContain('Topics: afrobeats, live streaming');
    });

    it('handles missing fields gracefully', () => {
        const text = prepareTextForEmbedding({
            name: 'Test',
        });

        expect(text).toBe('Name: Test');
    });

    it('normalises whitespace', () => {
        const text = prepareTextForEmbedding({
            biography: 'Multiple   spaces\nand\nnewlines\there',
        });

        expect(text).not.toContain('\n');
        expect(text).not.toContain('\t');
        expect(text).not.toContain('  ');
    });

    it('returns empty string for empty input', () => {
        expect(prepareTextForEmbedding({})).toBe('');
    });

    it('skips empty arrays', () => {
        const text = prepareTextForEmbedding({
            name: 'Test',
            categories: [],
            topics: [],
        });

        expect(text).toBe('Name: Test');
        expect(text).not.toContain('Categories');
        expect(text).not.toContain('Topics');
    });
});

// ---------------------------------------------------------------------------
// generateEmbedding — OpenAI
// ---------------------------------------------------------------------------

describe('generateEmbedding (OpenAI)', () => {
    it('calls the OpenAI embedding endpoint', async () => {
        const fakeEmbedding = Array.from({ length: 10 }, (_, i) => i * 0.1);
        mockFetch.mockResolvedValueOnce(mockOpenAIResponse(fakeEmbedding));

        const result = await generateEmbedding('Test text', openaiConfig);

        expect(result).toEqual(fakeEmbedding);
        expect(mockFetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/embeddings',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer sk-test-key',
                }),
            }),
        );
    });

    it('sends the correct model and dimensions', async () => {
        mockFetch.mockResolvedValueOnce(mockOpenAIResponse([0.1, 0.2]));

        await generateEmbedding('Test', openaiConfig);

        const callBody = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
        expect(callBody.model).toBe('text-embedding-3-small');
        expect(callBody.dimensions).toBe(1536);
        expect(callBody.input).toBe('Test');
    });

    it('throws EmbeddingError on 401 auth failure', async () => {
        mockFetch.mockResolvedValueOnce(
            new Response('Unauthorized', { status: 401 }),
        );

        try {
            await generateEmbedding('Test', openaiConfig);
            expect.fail('Should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(EmbeddingError);
            expect((err as EmbeddingError).status).toBe(401);
            expect((err as EmbeddingError).provider).toBe('openai');
        }
    });

    it('throws EmbeddingError on 429 rate limit', async () => {
        mockFetch.mockResolvedValueOnce(
            new Response('Rate Limited', { status: 429 }),
        );

        await expect(
            generateEmbedding('Test', openaiConfig),
        ).rejects.toThrow(EmbeddingError);
    });

    it('throws EmbeddingError when response has empty data', async () => {
        mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify({ data: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );

        await expect(
            generateEmbedding('Test', openaiConfig),
        ).rejects.toThrow(EmbeddingError);
    });
});

// ---------------------------------------------------------------------------
// generateEmbedding — Gemini
// ---------------------------------------------------------------------------

describe('generateEmbedding (Gemini)', () => {
    it('calls the Gemini embedding endpoint', async () => {
        const fakeEmbedding = [0.1, 0.2, 0.3];
        mockFetch.mockResolvedValueOnce(mockGeminiResponse(fakeEmbedding));

        const result = await generateEmbedding('Test text', geminiConfig);

        expect(result).toEqual(fakeEmbedding);
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('generativelanguage.googleapis.com'),
            expect.any(Object),
        );
    });

    it('includes API key in URL', async () => {
        mockFetch.mockResolvedValueOnce(mockGeminiResponse([0.1]));

        await generateEmbedding('Test', geminiConfig);

        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('key=gemini-test-key'),
            expect.any(Object),
        );
    });

    it('throws EmbeddingError on auth failure', async () => {
        mockFetch.mockResolvedValueOnce(
            new Response('Forbidden', { status: 403 }),
        );

        try {
            await generateEmbedding('Test', geminiConfig);
            expect.fail('Should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(EmbeddingError);
            expect((err as EmbeddingError).provider).toBe('gemini');
        }
    });
});

// ---------------------------------------------------------------------------
// generateEmbedding — validation
// ---------------------------------------------------------------------------

describe('generateEmbedding (validation)', () => {
    it('throws when API key is missing', async () => {
        await expect(
            generateEmbedding('Test', { ...openaiConfig, apiKey: '' }),
        ).rejects.toThrow(EmbeddingError);
    });

    it('throws when text is empty', async () => {
        await expect(
            generateEmbedding('', openaiConfig),
        ).rejects.toThrow(EmbeddingError);
    });

    it('throws when text is whitespace only', async () => {
        await expect(
            generateEmbedding('   ', openaiConfig),
        ).rejects.toThrow(EmbeddingError);
    });
});
