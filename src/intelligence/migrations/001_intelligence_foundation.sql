-- 001_intelligence_foundation.sql
-- Phase 1: Enable pgvector and create the five intelligence tables.
-- Run against the main Streamlivr PostgreSQL database.

-- -----------------------------------------------------------------------
-- 1. pgvector extension
-- -----------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------
-- 2. creator_intelligence
-- -----------------------------------------------------------------------
CREATE TABLE creator_intelligence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id      TEXT NOT NULL UNIQUE,
    categories      TEXT[] DEFAULT '{}',
    topics          TEXT[] DEFAULT '{}',
    languages       TEXT[] DEFAULT '{}',
    biography_summary TEXT,
    cross_platform_presence JSONB DEFAULT '{}',
    engagement_signals      JSONB DEFAULT '{}',
    growth_signals          JSONB DEFAULT '{}',
    recommendation_features JSONB DEFAULT '{}',
    confidence_score NUMERIC(5,4) DEFAULT 0,
    embedding        vector(1536),
    embedding_model  TEXT,
    intelligence_version TEXT DEFAULT 'v1',
    last_enriched_at TIMESTAMPTZ,
    search_vector    tsvector,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW index for cosine similarity search on embeddings
CREATE INDEX idx_creator_intelligence_embedding
    ON creator_intelligence USING hnsw (embedding vector_cosine_ops);

-- GIN indexes for array containment / overlap queries
CREATE INDEX idx_creator_intelligence_categories
    ON creator_intelligence USING gin (categories);
CREATE INDEX idx_creator_intelligence_topics
    ON creator_intelligence USING gin (topics);

-- GIN index for full-text search
CREATE INDEX idx_creator_intelligence_search
    ON creator_intelligence USING gin (search_vector);

-- -----------------------------------------------------------------------
-- 3. content_intelligence
-- -----------------------------------------------------------------------
CREATE TABLE content_intelligence (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id        TEXT NOT NULL UNIQUE,
    creator_id        TEXT,
    summary           TEXT,
    topics            TEXT[] DEFAULT '{}',
    categories        TEXT[] DEFAULT '{}',
    language          TEXT,
    content_embedding vector(1536),
    embedding_model   TEXT,
    confidence_score  NUMERIC(5,4) DEFAULT 0,
    intelligence_version TEXT DEFAULT 'v1',
    search_vector     tsvector,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW index for cosine similarity search on content embeddings
CREATE INDEX idx_content_intelligence_embedding
    ON content_intelligence USING hnsw (content_embedding vector_cosine_ops);

-- GIN index for full-text search
CREATE INDEX idx_content_intelligence_search
    ON content_intelligence USING gin (search_vector);

-- -----------------------------------------------------------------------
-- 4. external_identity_links
-- -----------------------------------------------------------------------
CREATE TABLE external_identity_links (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id           TEXT NOT NULL,
    provider             TEXT NOT NULL,
    external_account_id  TEXT NOT NULL,
    external_username    TEXT,
    linked               BOOLEAN DEFAULT FALSE,
    verification_status  TEXT DEFAULT 'unlinked',
    linked_at            TIMESTAMPTZ,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, external_account_id)
);

CREATE INDEX idx_external_identity_creator
    ON external_identity_links (creator_id);

-- -----------------------------------------------------------------------
-- 5. enrichment_metadata
-- -----------------------------------------------------------------------
CREATE TABLE enrichment_metadata (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         TEXT NOT NULL,
    entity_id           TEXT NOT NULL,
    provider            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    last_attempted_at   TIMESTAMPTZ,
    last_successful_at  TIMESTAMPTZ,
    next_refresh_at     TIMESTAMPTZ,
    content_hash        TEXT,
    error_message       TEXT,
    attempts            INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entity_type, entity_id, provider)
);

-- -----------------------------------------------------------------------
-- 6. data_provenance
-- -----------------------------------------------------------------------
CREATE TABLE data_provenance (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type          TEXT NOT NULL,
    entity_id            TEXT NOT NULL,
    source_type          TEXT NOT NULL,
    source_reference     TEXT,
    retrieved_at         TIMESTAMPTZ DEFAULT NOW(),
    retention_policy     TEXT,
    attribution_eligible BOOLEAN DEFAULT FALSE,
    metadata             JSONB DEFAULT '{}'
);

CREATE INDEX idx_data_provenance_entity
    ON data_provenance (entity_type, entity_id);

-- -----------------------------------------------------------------------
-- 7. Full-text search triggers
-- -----------------------------------------------------------------------

-- Creator intelligence: combine categories, topics, biography_summary
CREATE OR REPLACE FUNCTION creator_intelligence_search_vector_update()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(array_to_string(NEW.categories, ' '), '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(array_to_string(NEW.topics, ' '), '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.biography_summary, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_creator_intelligence_search_vector
    BEFORE INSERT OR UPDATE ON creator_intelligence
    FOR EACH ROW
    EXECUTE FUNCTION creator_intelligence_search_vector_update();

-- Content intelligence: combine summary, topics, categories
CREATE OR REPLACE FUNCTION content_intelligence_search_vector_update()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.summary, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(array_to_string(NEW.topics, ' '), '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(array_to_string(NEW.categories, ' '), '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_content_intelligence_search_vector
    BEFORE INSERT OR UPDATE ON content_intelligence
    FOR EACH ROW
    EXECUTE FUNCTION content_intelligence_search_vector_update();
