/**
 * Intelligence module public API.
 *
 * Re-exports the subset of types, functions, and services that external
 * consumers need. Internal implementation details (providers, enrichment
 * internals, migration SQL) are deliberately kept private.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export {
    INTELLIGENCE_ENABLED,
    INTELLIGENCE_EMBEDDING_MODEL,
    INTELLIGENCE_EMBEDDING_DIMENSIONS,
    assertIntelligenceConfiguration,
} from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
    CreatorIntelligence,
    ContentIntelligence,
    ExternalIdentityLink,
    EnrichmentMetadata,
    DataProvenance,
    IntelligenceQueryCache,
    IntelligenceAttribution,
    EntityType,
    EnrichmentStatus,
    VerificationStatus,
    AttributionStatus,
    ProviderName,
} from './types.js';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export { buildIntelligencePaidRoutes } from './catalog.js';

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export { createSearchService } from './services/searchService.js';
export type {
    SearchService,
    SearchServiceConfig,
    SearchServiceRequest,
    SearchServiceResponse,
    CreatorIntelligenceQuery,
    ContentIntelligenceQuery,
} from './services/searchService.js';

export { createRagService } from './services/ragService.js';
export type {
    RagService,
    RagOptions,
    RagContext,
    RagSource,
    QuestionIntent,
} from './services/ragService.js';

export { createRecommendationService } from './services/recommendationService.js';
export type {
    RecommendationService,
    DiscoveryContext,
    RecommendationCandidate,
    RecommendationContext,
    TrendingQuery,
} from './services/recommendationService.js';

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export { classifyIntelligenceRequest } from './attribution/classifier.js';
export type { RequestClassification, ClassifyRequest } from './attribution/classifier.js';

export { allocateIntelligenceRevenue } from './attribution/allocator.js';
export type { AllocationResult, AllocationInput } from './attribution/allocator.js';

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export { INTELLIGENCE_MCP_INSTRUCTIONS } from './mcpTools.js';

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

export {
    buildCreatorSearchResponse,
    buildContentSearchResponse,
    buildUnifiedSearchResponse,
    buildCreatorIntelligenceResponse,
    buildContentIntelligenceResponse,
    buildEnrichmentResponse,
} from './routes.js';

export type {
    CreatorSearchResult,
    CreatorSearchResponse,
    ContentSearchResult,
    ContentSearchResponse,
    UnifiedSearchResponse,
    CreatorIntelligenceResponse,
    ContentIntelligenceResponse,
    EnrichmentResponse,
    PageInfo,
    AttributionInfo,
} from './routes.js';

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export {
    buildHealthCheckResponse,
    buildEnrichmentAnalyticsQuery,
    buildIntelligenceAnalyticsQuery,
    buildMonetizationAnalyticsQuery,
} from './services/monitoring.js';

export type { AnalyticsQuery, HealthCheckResponse } from './services/monitoring.js';
