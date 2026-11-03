-- rollback_001.sql
-- Reverses 001_intelligence_foundation.sql in safe reverse order.

DROP TRIGGER IF EXISTS trg_content_intelligence_search_vector ON content_intelligence;
DROP FUNCTION IF EXISTS content_intelligence_search_vector_update();

DROP TRIGGER IF EXISTS trg_creator_intelligence_search_vector ON creator_intelligence;
DROP FUNCTION IF EXISTS creator_intelligence_search_vector_update();

DROP TABLE IF EXISTS data_provenance;
DROP TABLE IF EXISTS enrichment_metadata;
DROP TABLE IF EXISTS external_identity_links;
DROP TABLE IF EXISTS content_intelligence;
DROP TABLE IF EXISTS creator_intelligence;

DROP EXTENSION IF EXISTS vector;
