import { describe, expect, it } from 'vitest';
import {
    buildEnrichmentAnalyticsQuery,
    buildIntelligenceAnalyticsQuery,
    buildMonetizationAnalyticsQuery,
    buildHealthCheckResponse,
} from './monitoring.js';

// ---------------------------------------------------------------------------
// buildEnrichmentAnalyticsQuery
// ---------------------------------------------------------------------------

describe('buildEnrichmentAnalyticsQuery', () => {
    it('returns a query with description', () => {
        const q = buildEnrichmentAnalyticsQuery();
        expect(q.sql).toBeDefined();
        expect(q.description).toBeDefined();
        expect(q.description.length).toBeGreaterThan(0);
    });

    it('queries enrichment_metadata table', () => {
        const q = buildEnrichmentAnalyticsQuery();
        expect(q.sql).toContain('enrichment_metadata');
    });

    it('includes provider breakdown', () => {
        const q = buildEnrichmentAnalyticsQuery();
        expect(q.sql).toContain('provider');
        expect(q.sql).toContain('GROUP BY');
    });

    it('includes freshness distribution columns', () => {
        const q = buildEnrichmentAnalyticsQuery();
        expect(q.sql).toContain('fresh_24h');
        expect(q.sql).toContain('fresh_7d');
        expect(q.sql).toContain('stale');
    });

    it('includes job status counts', () => {
        const q = buildEnrichmentAnalyticsQuery();
        expect(q.sql).toContain('successful_jobs');
        expect(q.sql).toContain('failed_jobs');
    });

    it('passes no params without date range', () => {
        const q = buildEnrichmentAnalyticsQuery();
        expect(q.params).toHaveLength(0);
    });

    it('passes date range params when provided', () => {
        const since = new Date('2024-01-01');
        const to = new Date('2024-12-31');
        const q = buildEnrichmentAnalyticsQuery({ since, to });
        expect(q.params).toContain(since);
        expect(q.params).toContain(to);
        expect(q.sql).toContain('$1');
        expect(q.sql).toContain('$2');
    });
});

// ---------------------------------------------------------------------------
// buildIntelligenceAnalyticsQuery
// ---------------------------------------------------------------------------

describe('buildIntelligenceAnalyticsQuery', () => {
    it('returns a query with description', () => {
        const q = buildIntelligenceAnalyticsQuery();
        expect(q.sql).toBeDefined();
        expect(q.description.length).toBeGreaterThan(0);
    });

    it('queries both intelligence tables', () => {
        const q = buildIntelligenceAnalyticsQuery();
        expect(q.sql).toContain('creator_intelligence');
        expect(q.sql).toContain('content_intelligence');
    });

    it('includes embedding coverage', () => {
        const q = buildIntelligenceAnalyticsQuery();
        expect(q.sql).toContain('embedding');
    });

    it('includes cache stats', () => {
        const q = buildIntelligenceAnalyticsQuery();
        expect(q.sql).toContain('intelligence_query_cache');
    });

    it('accepts date range', () => {
        const since = new Date('2024-06-01');
        const to = new Date('2024-06-30');
        const q = buildIntelligenceAnalyticsQuery({ since, to });
        expect(q.params).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// buildMonetizationAnalyticsQuery
// ---------------------------------------------------------------------------

describe('buildMonetizationAnalyticsQuery', () => {
    it('returns a query with description', () => {
        const q = buildMonetizationAnalyticsQuery();
        expect(q.sql).toBeDefined();
        expect(q.description.length).toBeGreaterThan(0);
    });

    it('queries intelligence_attribution table', () => {
        const q = buildMonetizationAnalyticsQuery();
        expect(q.sql).toContain('intelligence_attribution');
    });

    it('includes creator-attributed revenue', () => {
        const q = buildMonetizationAnalyticsQuery();
        expect(q.sql).toContain('creator_attributed_revenue_atomic');
    });

    it('includes platform-attributed revenue', () => {
        const q = buildMonetizationAnalyticsQuery();
        expect(q.sql).toContain('platform_attributed_revenue_atomic');
    });

    it('includes unlinked creator requests count', () => {
        const q = buildMonetizationAnalyticsQuery();
        expect(q.sql).toContain('unlinked_creator_requests');
    });

    it('passes no params without date range', () => {
        const q = buildMonetizationAnalyticsQuery();
        expect(q.params).toHaveLength(0);
    });

    it('passes date range params when provided', () => {
        const since = new Date('2024-01-01');
        const to = new Date('2024-12-31');
        const q = buildMonetizationAnalyticsQuery({ since, to });
        expect(q.params).toHaveLength(2);
        expect(q.sql).toContain('$1');
    });
});

// ---------------------------------------------------------------------------
// buildHealthCheckResponse
// ---------------------------------------------------------------------------

describe('buildHealthCheckResponse', () => {
    it('returns a health check with intelligence status', () => {
        const hc = buildHealthCheckResponse();
        expect(hc.status).toBeDefined();
        expect(['ok', 'degraded', 'down']).toContain(hc.status);
    });

    it('includes intelligence configuration', () => {
        const hc = buildHealthCheckResponse();
        expect(typeof hc.intelligence.enabled).toBe('boolean');
        expect(Array.isArray(hc.intelligence.providers)).toBe(true);
        expect(hc.intelligence.providers.length).toBeGreaterThan(0);
    });

    it('includes embedding model info', () => {
        const hc = buildHealthCheckResponse();
        expect(typeof hc.intelligence.embeddingModel).toBe('string');
        expect(hc.intelligence.embeddingModel.length).toBeGreaterThan(0);
    });

    it('includes embedding dimensions', () => {
        const hc = buildHealthCheckResponse();
        expect(typeof hc.intelligence.embeddingDimensions).toBe('number');
        expect(hc.intelligence.embeddingDimensions).toBeGreaterThan(0);
    });

    it('includes ISO timestamp', () => {
        const hc = buildHealthCheckResponse();
        expect(hc.timestamp).toBeDefined();
        // Should be parseable as a date
        expect(new Date(hc.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('reports down when intelligence is disabled', () => {
        // Since INTELLIGENCE_ENABLED defaults to false in test env
        const hc = buildHealthCheckResponse();
        expect(hc.status).toBe('down');
        expect(hc.intelligence.enabled).toBe(false);
    });

    it('always includes native provider', () => {
        const hc = buildHealthCheckResponse();
        expect(hc.intelligence.providers).toContain('native');
    });
});
