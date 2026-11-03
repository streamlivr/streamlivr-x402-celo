import { describe, expect, it } from 'vitest';
import * as intelligence from './index.js';

// ---------------------------------------------------------------------------
// Module can be imported without errors
// ---------------------------------------------------------------------------

describe('intelligence module import', () => {
    it('imports without errors', () => {
        expect(intelligence).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Expected exports are present
// ---------------------------------------------------------------------------

describe('intelligence module exports', () => {
    // Configuration
    it('exports INTELLIGENCE_ENABLED', () => {
        expect(typeof intelligence.INTELLIGENCE_ENABLED).toBe('boolean');
    });

    it('exports INTELLIGENCE_EMBEDDING_MODEL', () => {
        expect(typeof intelligence.INTELLIGENCE_EMBEDDING_MODEL).toBe('string');
    });

    it('exports INTELLIGENCE_EMBEDDING_DIMENSIONS', () => {
        expect(typeof intelligence.INTELLIGENCE_EMBEDDING_DIMENSIONS).toBe('number');
    });

    it('exports assertIntelligenceConfiguration', () => {
        expect(typeof intelligence.assertIntelligenceConfiguration).toBe('function');
    });

    // Catalog
    it('exports buildIntelligencePaidRoutes', () => {
        expect(typeof intelligence.buildIntelligencePaidRoutes).toBe('function');
    });

    // Services
    it('exports createSearchService', () => {
        expect(typeof intelligence.createSearchService).toBe('function');
    });

    it('exports createRagService', () => {
        expect(typeof intelligence.createRagService).toBe('function');
    });

    it('exports createRecommendationService', () => {
        expect(typeof intelligence.createRecommendationService).toBe('function');
    });

    // Attribution
    it('exports classifyIntelligenceRequest', () => {
        expect(typeof intelligence.classifyIntelligenceRequest).toBe('function');
    });

    it('exports allocateIntelligenceRevenue', () => {
        expect(typeof intelligence.allocateIntelligenceRevenue).toBe('function');
    });

    // MCP
    it('exports INTELLIGENCE_MCP_INSTRUCTIONS', () => {
        expect(typeof intelligence.INTELLIGENCE_MCP_INSTRUCTIONS).toBe('string');
        expect(intelligence.INTELLIGENCE_MCP_INSTRUCTIONS.length).toBeGreaterThan(0);
    });

    // Response builders
    it('exports buildCreatorSearchResponse', () => {
        expect(typeof intelligence.buildCreatorSearchResponse).toBe('function');
    });

    it('exports buildContentSearchResponse', () => {
        expect(typeof intelligence.buildContentSearchResponse).toBe('function');
    });

    it('exports buildUnifiedSearchResponse', () => {
        expect(typeof intelligence.buildUnifiedSearchResponse).toBe('function');
    });

    it('exports buildCreatorIntelligenceResponse', () => {
        expect(typeof intelligence.buildCreatorIntelligenceResponse).toBe('function');
    });

    it('exports buildContentIntelligenceResponse', () => {
        expect(typeof intelligence.buildContentIntelligenceResponse).toBe('function');
    });

    it('exports buildEnrichmentResponse', () => {
        expect(typeof intelligence.buildEnrichmentResponse).toBe('function');
    });

    // Monitoring
    it('exports buildHealthCheckResponse', () => {
        expect(typeof intelligence.buildHealthCheckResponse).toBe('function');
    });

    it('exports buildEnrichmentAnalyticsQuery', () => {
        expect(typeof intelligence.buildEnrichmentAnalyticsQuery).toBe('function');
    });

    it('exports buildIntelligenceAnalyticsQuery', () => {
        expect(typeof intelligence.buildIntelligenceAnalyticsQuery).toBe('function');
    });

    it('exports buildMonetizationAnalyticsQuery', () => {
        expect(typeof intelligence.buildMonetizationAnalyticsQuery).toBe('function');
    });
});

// ---------------------------------------------------------------------------
// Services are functional through re-exports
// ---------------------------------------------------------------------------

describe('intelligence services through re-exports', () => {
    it('createSearchService returns a service object', () => {
        const svc = intelligence.createSearchService();
        expect(typeof svc.search).toBe('function');
        expect(typeof svc.searchCreators).toBe('function');
        expect(typeof svc.searchContent).toBe('function');
        expect(typeof svc.getCreatorIntelligence).toBe('function');
        expect(typeof svc.getContentIntelligence).toBe('function');
    });

    it('createRagService returns a service object', () => {
        const searchSvc = intelligence.createSearchService();
        const ragSvc = intelligence.createRagService(searchSvc);
        expect(typeof ragSvc.retrieveContext).toBe('function');
        expect(typeof ragSvc.parseQuestionIntent).toBe('function');
        expect(typeof ragSvc.buildContextPrompt).toBe('function');
        expect(typeof ragSvc.buildRagSearchQueries).toBe('function');
    });

    it('createRecommendationService returns a service object', () => {
        const recSvc = intelligence.createRecommendationService();
        expect(typeof recSvc.buildSimilarCreatorsQuery).toBe('function');
        expect(typeof recSvc.buildRelatedContentQuery).toBe('function');
        expect(typeof recSvc.buildCreatorDiscoveryQuery).toBe('function');
        expect(typeof recSvc.buildTrendingQuery).toBe('function');
        expect(typeof recSvc.scoreRecommendation).toBe('function');
    });
});
