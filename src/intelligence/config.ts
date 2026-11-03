import { z } from 'zod';

/**
 * Intelligence-specific environment configuration.
 *
 * Follows the same pattern as {@link ../x402/config.ts}: parse with zod,
 * export named constants, and provide an assertion function that gates on
 * the feature flag.
 */

const blankToUndefined = (value: unknown): unknown =>
    typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = z.preprocess(blankToUndefined, z.string().trim().optional());

export const intelligenceEnv = z.object({
    INTELLIGENCE_ENABLED: z
        .string()
        .default('false')
        .transform((v) => v === 'true' || v === '1'),

    INTELLIGENCE_EMBEDDING_MODEL: z.preprocess(
        blankToUndefined,
        z.string().trim().default('text-embedding-3-small'),
    ),

    INTELLIGENCE_EMBEDDING_DIMENSIONS: z.preprocess(
        blankToUndefined,
        z.coerce.number().int().positive().default(1536),
    ),

    INTELLIGENCE_EMBEDDING_PROVIDER: z.preprocess(
        blankToUndefined,
        z.enum(['openai', 'gemini']).default('openai'),
    ),

    OPENAI_API_KEY: optionalText,
    FIRECRAWL_API_KEY: optionalText,

    FIRECRAWL_BASE_URL: z.preprocess(
        blankToUndefined,
        z.string().trim().url().default('https://api.firecrawl.dev'),
    ),

    X_ENRICHMENT_BEARER_TOKEN: optionalText,

    /** Creator profile refresh interval in seconds (default 7 days). */
    ENRICHMENT_CREATOR_REFRESH_INTERVAL: z.preprocess(
        blankToUndefined,
        z.coerce.number().int().nonnegative().default(604800),
    ),

    /** Content refresh interval in seconds (default 1 day). */
    ENRICHMENT_CONTENT_REFRESH_INTERVAL: z.preprocess(
        blankToUndefined,
        z.coerce.number().int().nonnegative().default(86400),
    ),

    /** Query cache TTL in seconds (default 1 hour). */
    ENRICHMENT_QUERY_CACHE_TTL: z.preprocess(
        blankToUndefined,
        z.coerce.number().int().nonnegative().default(3600),
    ),

    /** Max concurrent enrichment jobs (default 3). */
    ENRICHMENT_WORKER_CONCURRENCY: z.preprocess(
        blankToUndefined,
        z.coerce.number().int().positive().default(3),
    ),

    /** Worker poll interval in milliseconds (default 10 000). */
    ENRICHMENT_WORKER_POLL_INTERVAL: z.preprocess(
        blankToUndefined,
        z.coerce.number().int().positive().default(10000),
    ),

    /** Max enrichment retry attempts before marking permanently failed (default 3). */
    ENRICHMENT_MAX_RETRIES: z.preprocess(
        blankToUndefined,
        z.coerce.number().int().nonnegative().default(3),
    ),
});

const parsed = intelligenceEnv.parse(process.env);

export const INTELLIGENCE_ENABLED = parsed.INTELLIGENCE_ENABLED;
export const INTELLIGENCE_EMBEDDING_MODEL = parsed.INTELLIGENCE_EMBEDDING_MODEL;
export const INTELLIGENCE_EMBEDDING_DIMENSIONS = parsed.INTELLIGENCE_EMBEDDING_DIMENSIONS;
export const INTELLIGENCE_EMBEDDING_PROVIDER = parsed.INTELLIGENCE_EMBEDDING_PROVIDER;
export const OPENAI_API_KEY = parsed.OPENAI_API_KEY;
export const FIRECRAWL_API_KEY = parsed.FIRECRAWL_API_KEY;
export const FIRECRAWL_BASE_URL = parsed.FIRECRAWL_BASE_URL;
export const X_ENRICHMENT_BEARER_TOKEN = parsed.X_ENRICHMENT_BEARER_TOKEN;
export const ENRICHMENT_CREATOR_REFRESH_INTERVAL = parsed.ENRICHMENT_CREATOR_REFRESH_INTERVAL;
export const ENRICHMENT_CONTENT_REFRESH_INTERVAL = parsed.ENRICHMENT_CONTENT_REFRESH_INTERVAL;
export const ENRICHMENT_QUERY_CACHE_TTL = parsed.ENRICHMENT_QUERY_CACHE_TTL;
export const ENRICHMENT_WORKER_CONCURRENCY = parsed.ENRICHMENT_WORKER_CONCURRENCY;
export const ENRICHMENT_WORKER_POLL_INTERVAL = parsed.ENRICHMENT_WORKER_POLL_INTERVAL;
export const ENRICHMENT_MAX_RETRIES = parsed.ENRICHMENT_MAX_RETRIES;

/**
 * Validates that all required provider credentials are set when the
 * intelligence subsystem is enabled. Call at server boot, after env parsing.
 *
 * @throws {Error} if a required key is missing while INTELLIGENCE_ENABLED=true.
 */
export function assertIntelligenceConfiguration(): void {
    if (!INTELLIGENCE_ENABLED) return;

    if (INTELLIGENCE_EMBEDDING_PROVIDER === 'openai' && !OPENAI_API_KEY) {
        throw new Error(
            'OPENAI_API_KEY is required when INTELLIGENCE_ENABLED=true and INTELLIGENCE_EMBEDDING_PROVIDER=openai',
        );
    }
}
