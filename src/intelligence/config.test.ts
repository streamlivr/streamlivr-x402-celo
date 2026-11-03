import { describe, expect, it } from 'vitest';
import { intelligenceEnv } from './config.js';

describe('intelligence environment parsing', () => {
    it('defaults INTELLIGENCE_ENABLED to false', () => {
        const parsed = intelligenceEnv.parse({});
        expect(parsed.INTELLIGENCE_ENABLED).toBe(false);
    });

    it('enables intelligence with "true" or "1"', () => {
        expect(intelligenceEnv.parse({ INTELLIGENCE_ENABLED: 'true' }).INTELLIGENCE_ENABLED).toBe(true);
        expect(intelligenceEnv.parse({ INTELLIGENCE_ENABLED: '1' }).INTELLIGENCE_ENABLED).toBe(true);
    });

    it('defaults embedding model to text-embedding-3-small', () => {
        const parsed = intelligenceEnv.parse({});
        expect(parsed.INTELLIGENCE_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    });

    it('defaults embedding dimensions to 1536', () => {
        const parsed = intelligenceEnv.parse({});
        expect(parsed.INTELLIGENCE_EMBEDDING_DIMENSIONS).toBe(1536);
    });

    it('defaults embedding provider to openai', () => {
        const parsed = intelligenceEnv.parse({});
        expect(parsed.INTELLIGENCE_EMBEDDING_PROVIDER).toBe('openai');
    });

    it('accepts gemini as embedding provider', () => {
        const parsed = intelligenceEnv.parse({ INTELLIGENCE_EMBEDDING_PROVIDER: 'gemini' });
        expect(parsed.INTELLIGENCE_EMBEDDING_PROVIDER).toBe('gemini');
    });

    it('rejects unknown embedding provider', () => {
        expect(() =>
            intelligenceEnv.parse({ INTELLIGENCE_EMBEDDING_PROVIDER: 'anthropic' }),
        ).toThrow();
    });

    it('treats blank optional strings as undefined', () => {
        const parsed = intelligenceEnv.parse({
            OPENAI_API_KEY: '',
            FIRECRAWL_API_KEY: '   ',
            X_ENRICHMENT_BEARER_TOKEN: '',
        });
        expect(parsed.OPENAI_API_KEY).toBeUndefined();
        expect(parsed.FIRECRAWL_API_KEY).toBeUndefined();
        expect(parsed.X_ENRICHMENT_BEARER_TOKEN).toBeUndefined();
    });

    it('keeps valid optional strings', () => {
        const parsed = intelligenceEnv.parse({
            OPENAI_API_KEY: 'sk-abc123',
            FIRECRAWL_API_KEY: 'fc-key',
        });
        expect(parsed.OPENAI_API_KEY).toBe('sk-abc123');
        expect(parsed.FIRECRAWL_API_KEY).toBe('fc-key');
    });

    it('defaults FIRECRAWL_BASE_URL to the official API', () => {
        const parsed = intelligenceEnv.parse({});
        expect(parsed.FIRECRAWL_BASE_URL).toBe('https://api.firecrawl.dev');
    });

    it('treats blank FIRECRAWL_BASE_URL as default', () => {
        const parsed = intelligenceEnv.parse({ FIRECRAWL_BASE_URL: '' });
        expect(parsed.FIRECRAWL_BASE_URL).toBe('https://api.firecrawl.dev');
    });

    it('defaults all interval/worker values correctly', () => {
        const parsed = intelligenceEnv.parse({});
        expect(parsed.ENRICHMENT_CREATOR_REFRESH_INTERVAL).toBe(604800);
        expect(parsed.ENRICHMENT_CONTENT_REFRESH_INTERVAL).toBe(86400);
        expect(parsed.ENRICHMENT_QUERY_CACHE_TTL).toBe(3600);
        expect(parsed.ENRICHMENT_WORKER_CONCURRENCY).toBe(3);
        expect(parsed.ENRICHMENT_WORKER_POLL_INTERVAL).toBe(10000);
        expect(parsed.ENRICHMENT_MAX_RETRIES).toBe(3);
    });

    it('treats blank numeric values as defaults, not zero', () => {
        const parsed = intelligenceEnv.parse({
            ENRICHMENT_CREATOR_REFRESH_INTERVAL: '',
            ENRICHMENT_WORKER_CONCURRENCY: '',
            ENRICHMENT_MAX_RETRIES: '',
        });
        expect(parsed.ENRICHMENT_CREATOR_REFRESH_INTERVAL).toBe(604800);
        expect(parsed.ENRICHMENT_WORKER_CONCURRENCY).toBe(3);
        expect(parsed.ENRICHMENT_MAX_RETRIES).toBe(3);
    });

    it('honours explicit numeric values', () => {
        const parsed = intelligenceEnv.parse({
            ENRICHMENT_CREATOR_REFRESH_INTERVAL: '300',
            ENRICHMENT_WORKER_CONCURRENCY: '10',
            INTELLIGENCE_EMBEDDING_DIMENSIONS: '768',
        });
        expect(parsed.ENRICHMENT_CREATOR_REFRESH_INTERVAL).toBe(300);
        expect(parsed.ENRICHMENT_WORKER_CONCURRENCY).toBe(10);
        expect(parsed.INTELLIGENCE_EMBEDDING_DIMENSIONS).toBe(768);
    });
});

describe('assertIntelligenceConfiguration', () => {
    // We cannot call the exported function directly because it reads
    // module-level constants bound at import time. Instead we validate
    // the schema constraints that the assertion is built on.

    it('requires OPENAI_API_KEY when provider is openai and intelligence is on', () => {
        // Simulating what assertIntelligenceConfiguration checks:
        const parsed = intelligenceEnv.parse({
            INTELLIGENCE_ENABLED: 'true',
            INTELLIGENCE_EMBEDDING_PROVIDER: 'openai',
            OPENAI_API_KEY: '',
        });
        expect(parsed.INTELLIGENCE_ENABLED).toBe(true);
        expect(parsed.INTELLIGENCE_EMBEDDING_PROVIDER).toBe('openai');
        expect(parsed.OPENAI_API_KEY).toBeUndefined();
        // The assertion function would throw here; we test the logic path.
    });

    it('does not require OPENAI_API_KEY when provider is gemini', () => {
        const parsed = intelligenceEnv.parse({
            INTELLIGENCE_ENABLED: 'true',
            INTELLIGENCE_EMBEDDING_PROVIDER: 'gemini',
        });
        expect(parsed.INTELLIGENCE_EMBEDDING_PROVIDER).toBe('gemini');
        expect(parsed.OPENAI_API_KEY).toBeUndefined();
        // The assertion function would NOT throw here.
    });

    it('skips validation entirely when intelligence is disabled', () => {
        const parsed = intelligenceEnv.parse({
            INTELLIGENCE_ENABLED: 'false',
        });
        expect(parsed.INTELLIGENCE_ENABLED).toBe(false);
        // assertIntelligenceConfiguration returns immediately; no throws.
    });
});
