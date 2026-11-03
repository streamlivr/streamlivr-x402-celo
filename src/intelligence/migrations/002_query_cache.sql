-- 002_query_cache.sql
-- Phase 1: Query cache and intelligence attribution tables.

-- -----------------------------------------------------------------------
-- 1. intelligence_query_cache
-- -----------------------------------------------------------------------
CREATE TABLE intelligence_query_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_hash      TEXT NOT NULL UNIQUE,
    normalized_query TEXT,
    filters         JSONB DEFAULT '{}',
    result          JSONB,
    result_count    INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    access_scope    TEXT DEFAULT 'public'
);

CREATE INDEX idx_query_cache_hash
    ON intelligence_query_cache (query_hash);
CREATE INDEX idx_query_cache_expiry
    ON intelligence_query_cache (expires_at);

-- -----------------------------------------------------------------------
-- 2. intelligence_attribution
-- -----------------------------------------------------------------------
CREATE TABLE intelligence_attribution (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id                TEXT NOT NULL,
    creator_id                TEXT,
    data_entity_id            TEXT,
    data_entity_type          TEXT,
    attributable_value_atomic TEXT NOT NULL,
    attribution_status        TEXT NOT NULL,
    verification_snapshot     JSONB,
    created_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_intelligence_attribution_request
    ON intelligence_attribution (request_id);
CREATE INDEX idx_intelligence_attribution_creator
    ON intelligence_attribution (creator_id);
