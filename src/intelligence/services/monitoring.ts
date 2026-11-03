/**
 * Monitoring and analytics query builders for the intelligence engine.
 *
 * Provides internal observability: enrichment analytics, intelligence
 * analytics, monetization analytics, and health check response builders.
 * All query functions return `{ sql, params, description }` — no database
 * execution.
 */

import {
    INTELLIGENCE_ENABLED,
    INTELLIGENCE_EMBEDDING_MODEL,
    INTELLIGENCE_EMBEDDING_DIMENSIONS,
    INTELLIGENCE_EMBEDDING_PROVIDER,
} from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalyticsQuery {
    sql: string;
    params: unknown[];
    description: string;
}

export interface HealthCheckResponse {
    status: 'ok' | 'degraded' | 'down';
    intelligence: {
        enabled: boolean;
        providers: string[];
        embeddingModel: string;
        embeddingDimensions: number;
    };
    timestamp: string;
}

// ---------------------------------------------------------------------------
// Enrichment analytics
// ---------------------------------------------------------------------------

/**
 * Build a query that returns enrichment pipeline statistics:
 * total enriched creators, total enriched content, successful/failed jobs,
 * provider usage, estimated costs, and freshness distribution.
 */
export function buildEnrichmentAnalyticsQuery(
    range?: { since: Date; to: Date },
): AnalyticsQuery {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (range) {
        conditions.push(`em.created_at >= $${params.length + 1}`);
        params.push(range.since);
        conditions.push(`em.created_at <= $${params.length + 1}`);
        params.push(range.to);
    }

    const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

    const sql = [
        `SELECT`,
        `  COUNT(DISTINCT CASE WHEN em.entity_type = 'creator' THEN em.entity_id END) AS total_enriched_creators,`,
        `  COUNT(DISTINCT CASE WHEN em.entity_type = 'content' THEN em.entity_id END) AS total_enriched_content,`,
        `  COUNT(CASE WHEN em.status = 'completed' THEN 1 END) AS successful_jobs,`,
        `  COUNT(CASE WHEN em.status = 'failed' THEN 1 END) AS failed_jobs,`,
        `  COUNT(CASE WHEN em.status = 'processing' THEN 1 END) AS active_jobs,`,
        `  COUNT(CASE WHEN em.status = 'pending' THEN 1 END) AS pending_jobs,`,
        `  em.provider,`,
        `  COUNT(*) AS provider_job_count,`,
        `  COUNT(DISTINCT CASE`,
        `    WHEN em.last_successful_at >= NOW() - INTERVAL '24 hours' THEN em.entity_id`,
        `  END) AS fresh_24h,`,
        `  COUNT(DISTINCT CASE`,
        `    WHEN em.last_successful_at >= NOW() - INTERVAL '7 days'`,
        `      AND em.last_successful_at < NOW() - INTERVAL '24 hours' THEN em.entity_id`,
        `  END) AS fresh_7d,`,
        `  COUNT(DISTINCT CASE`,
        `    WHEN em.last_successful_at < NOW() - INTERVAL '7 days' THEN em.entity_id`,
        `  END) AS stale`,
        `FROM enrichment_metadata em`,
        whereClause,
        `GROUP BY em.provider`,
        `ORDER BY provider_job_count DESC`,
    ].join('\n');

    return {
        sql,
        params,
        description: 'Enrichment pipeline analytics: job counts by status and provider, freshness distribution',
    };
}

// ---------------------------------------------------------------------------
// Intelligence analytics
// ---------------------------------------------------------------------------

/**
 * Build a query for intelligence index statistics:
 * total indexed entities, embedding volume, search request counts,
 * and cache hit rate.
 */
export function buildIntelligenceAnalyticsQuery(
    range?: { since: Date; to: Date },
): AnalyticsQuery {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (range) {
        conditions.push(`created_at >= $${params.length + 1}`);
        params.push(range.since);
        conditions.push(`created_at <= $${params.length + 1}`);
        params.push(range.to);
    }

    const cacheConditions = range
        ? `WHERE created_at >= $1 AND created_at <= $2`
        : '';

    const creatorWhere = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

    const sql = [
        `SELECT`,
        `  (SELECT COUNT(*) FROM creator_intelligence ${creatorWhere}) AS total_indexed_creators,`,
        `  (SELECT COUNT(*) FROM content_intelligence ${creatorWhere}) AS total_indexed_content,`,
        `  (SELECT COUNT(*) FROM creator_intelligence WHERE embedding IS NOT NULL ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}) AS creators_with_embeddings,`,
        `  (SELECT COUNT(*) FROM content_intelligence WHERE content_embedding IS NOT NULL ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}) AS content_with_embeddings,`,
        `  (SELECT COUNT(*) FROM intelligence_query_cache ${cacheConditions}) AS total_cache_entries,`,
        `  (SELECT COUNT(*) FROM intelligence_query_cache WHERE expires_at > NOW() ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}) AS active_cache_entries`,
    ].join('\n');

    return {
        sql,
        params,
        description: 'Intelligence index analytics: entity counts, embedding coverage, cache stats',
    };
}

// ---------------------------------------------------------------------------
// Monetization analytics
// ---------------------------------------------------------------------------

/**
 * Build a query for monetization statistics:
 * total paid intelligence requests, creator-attributed revenue,
 * platform-attributed revenue, unlinked creator requests.
 */
export function buildMonetizationAnalyticsQuery(
    range?: { since: Date; to: Date },
): AnalyticsQuery {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (range) {
        conditions.push(`ia.created_at >= $${params.length + 1}`);
        params.push(range.since);
        conditions.push(`ia.created_at <= $${params.length + 1}`);
        params.push(range.to);
    }

    const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

    const sql = [
        `SELECT`,
        `  COUNT(DISTINCT ia.request_id) AS total_paid_requests,`,
        `  SUM(CASE WHEN ia.attribution_status = 'verified_linked' THEN ia.attributable_value_atomic::bigint ELSE 0 END) AS creator_attributed_revenue_atomic,`,
        `  SUM(CASE WHEN ia.attribution_status = 'platform_owned' THEN ia.attributable_value_atomic::bigint ELSE 0 END) AS platform_attributed_revenue_atomic,`,
        `  COUNT(DISTINCT CASE WHEN ia.attribution_status = 'unlinked' THEN ia.request_id END) AS unlinked_creator_requests,`,
        `  COUNT(DISTINCT CASE WHEN ia.attribution_status = 'verified_linked' THEN ia.creator_id END) AS unique_earning_creators,`,
        `  COUNT(DISTINCT ia.creator_id) FILTER (WHERE ia.creator_id IS NOT NULL) AS unique_attributed_creators`,
        `FROM intelligence_attribution ia`,
        whereClause,
    ].join('\n');

    return {
        sql,
        params,
        description: 'Monetization analytics: paid requests, creator vs platform revenue, attribution breakdown',
    };
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Build a health check response reflecting the current configuration state.
 * Database connectivity is represented as a placeholder — the actual check
 * is performed when the Fastify server executes the response.
 */
export function buildHealthCheckResponse(): HealthCheckResponse {
    const providers: string[] = [];
    providers.push('native'); // always available
    providers.push(INTELLIGENCE_EMBEDDING_PROVIDER);

    return {
        status: INTELLIGENCE_ENABLED ? 'ok' : 'down',
        intelligence: {
            enabled: INTELLIGENCE_ENABLED,
            providers,
            embeddingModel: INTELLIGENCE_EMBEDDING_MODEL,
            embeddingDimensions: INTELLIGENCE_EMBEDDING_DIMENSIONS,
        },
        timestamp: new Date().toISOString(),
    };
}
