/**
 * Embedding module for generating vector representations of creator
 * and content intelligence data.
 *
 * Supports OpenAI and Gemini embedding providers. External API calls
 * use the global `fetch()` (Node 20+).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingConfig {
    provider: 'openai' | 'gemini';
    model: string;
    dimensions: number;
    apiKey: string;
}

export class EmbeddingError extends Error {
    readonly status: number;
    readonly provider: string;

    constructor(message: string, status: number, provider: string) {
        super(message);
        this.name = 'EmbeddingError';
        this.status = status;
        this.provider = provider;
    }
}

// ---------------------------------------------------------------------------
// Text preparation
// ---------------------------------------------------------------------------

/**
 * Concatenate relevant fields into a single string suitable for embedding.
 * Normalises whitespace and removes characters that don't carry semantic weight.
 */
export function prepareTextForEmbedding(data: {
    categories?: string[];
    topics?: string[];
    biography?: string;
    name?: string;
}): string {
    const parts: string[] = [];

    if (data.name) {
        parts.push(`Name: ${data.name.trim()}`);
    }

    if (data.biography) {
        parts.push(`Bio: ${data.biography.trim()}`);
    }

    if (data.categories && data.categories.length > 0) {
        parts.push(`Categories: ${data.categories.join(', ')}`);
    }

    if (data.topics && data.topics.length > 0) {
        parts.push(`Topics: ${data.topics.join(', ')}`);
    }

    const combined = parts.join('. ');

    // Normalise whitespace and strip non-semantic characters
    return combined
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/[^\w\s.,;:!?'"()\-\/&@#]+/g, '')
        .trim();
}

// ---------------------------------------------------------------------------
// Embedding generation
// ---------------------------------------------------------------------------

/**
 * Generate an embedding vector for the given text using the configured provider.
 *
 * @throws {EmbeddingError} on auth, rate-limit, or provider errors.
 */
export async function generateEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
    if (!config.apiKey) {
        throw new EmbeddingError(
            `${config.provider.toUpperCase()}_API_KEY is required for embedding generation`,
            401,
            config.provider,
        );
    }

    if (!text || text.trim().length === 0) {
        throw new EmbeddingError(
            'Cannot generate embedding for empty text',
            400,
            config.provider,
        );
    }

    switch (config.provider) {
        case 'openai':
            return generateOpenAIEmbedding(text, config);
        case 'gemini':
            return generateGeminiEmbedding(text, config);
        default:
            throw new EmbeddingError(
                `Unsupported embedding provider: ${config.provider}`,
                400,
                config.provider,
            );
    }
}

// ---------------------------------------------------------------------------
// Provider-specific implementations
// ---------------------------------------------------------------------------

async function generateOpenAIEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: config.model,
            input: text,
            dimensions: config.dimensions,
        }),
    });

    if (response.status === 401) {
        throw new EmbeddingError('OpenAI authentication failed — invalid API key', 401, 'openai');
    }

    if (response.status === 429) {
        throw new EmbeddingError('OpenAI rate limit exceeded', 429, 'openai');
    }

    if (!response.ok) {
        const body = await response.text();
        throw new EmbeddingError(
            `OpenAI embedding request failed (${response.status}): ${body}`,
            response.status,
            'openai',
        );
    }

    const body = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
        usage: { prompt_tokens: number; total_tokens: number };
    };

    if (!body.data || body.data.length === 0 || !body.data[0].embedding) {
        throw new EmbeddingError('OpenAI returned empty embedding data', 500, 'openai');
    }

    return body.data[0].embedding;
}

async function generateGeminiEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:embedContent?key=${config.apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content: {
                parts: [{ text }],
            },
        }),
    });

    if (response.status === 401 || response.status === 403) {
        throw new EmbeddingError('Gemini authentication failed — invalid API key', response.status, 'gemini');
    }

    if (response.status === 429) {
        throw new EmbeddingError('Gemini rate limit exceeded', 429, 'gemini');
    }

    if (!response.ok) {
        const body = await response.text();
        throw new EmbeddingError(
            `Gemini embedding request failed (${response.status}): ${body}`,
            response.status,
            'gemini',
        );
    }

    const body = (await response.json()) as {
        embedding: { values: number[] };
    };

    if (!body.embedding || !body.embedding.values) {
        throw new EmbeddingError('Gemini returned empty embedding data', 500, 'gemini');
    }

    return body.embedding.values;
}
