# Streamlivr Intelligence Infrastructure

> **Version:** v1 · **Status:** Implementation complete, production wiring pending
> **Files:** 61 · **Tests:** 506 · **Regressions on existing x402 suite:** 0

---

## 1. Overview

The Streamlivr Intelligence Infrastructure adds AI-powered creator discovery, semantic search, content classification, cross-platform identity resolution, and engagement analysis to the existing x402-gated MCP server. It enriches creator and content profiles through a multi-provider pipeline (X API, Firecrawl, native platform data), indexes the results in PostgreSQL with pgvector embeddings and tsvector full-text search, exposes seven paid intelligence endpoints through the existing x402 pricing/settlement flow, and attributes settled revenue back to the creators whose data was served. Every module is additive — no existing files were modified.

**Core principle:**

> Enrich once. Index once. Retrieve many times. Monetize every eligible request.

### Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        ENRICHMENT LAYER                                 │
│                                                                         │
│   ┌──────────┐   ┌────────────┐   ┌────────────┐                       │
│   │ X API    │   │ Firecrawl  │   │  Native    │  ← Enrichment         │
│   │ Adapter  │   │ Adapter    │   │  Adapter   │    Providers           │
│   └────┬─────┘   └─────┬──────┘   └─────┬──────┘                       │
│        │               │                │                               │
│        └───────────┬────┴────────────────┘                              │
│                    ▼                                                     │
│         ┌──────────────────┐    ┌────────────────────┐                  │
│         │ EnrichmentWorker │───▶│ Entity Resolution  │                  │
│         └────────┬─────────┘    └────────────────────┘                  │
│                  ▼                                                       │
│         ┌──────────────────────────────────────────┐                    │
│         │        REFINEMENT PIPELINE               │                    │
│         │  Classification → Topics → Language →    │                    │
│         │  Summary → Embedding (OpenAI/Gemini)     │                    │
│         └────────────────┬─────────────────────────┘                    │
└──────────────────────────┼──────────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         STORAGE LAYER                                   │
│                                                                         │
│   PostgreSQL 15+ with pgvector                                          │
│                                                                         │
│   ┌─────────────────────┐  ┌──────────────────────┐                    │
│   │ creator_intelligence│  │ content_intelligence │  ← Intelligence    │
│   │  + HNSW index       │  │  + HNSW index        │    Tables          │
│   │  + GIN (tsvector)   │  │  + GIN (tsvector)    │                    │
│   │  + GIN (arrays)     │  │                      │                    │
│   └─────────────────────┘  └──────────────────────┘                    │
│   ┌─────────────────────┐  ┌──────────────────────┐                    │
│   │external_identity_   │  │ enrichment_metadata  │  ← Provenance     │
│   │  links              │  │ data_provenance      │    + Tracking      │
│   └─────────────────────┘  └──────────────────────┘                    │
│   ┌─────────────────────┐  ┌──────────────────────┐                    │
│   │intelligence_query_  │  │intelligence_         │  ← Cache           │
│   │  cache              │  │  attribution         │    + Attribution   │
│   └─────────────────────┘  └──────────────────────┘                    │
└──────────────────────────┼──────────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         RETRIEVAL LAYER                                 │
│                                                                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│   │ Keyword  │  │ Semantic │  │  Hybrid  │  │ Ranking  │              │
│   │(tsvector)│  │(pgvector)│  │  (RRF)   │  │ + Cache  │              │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│        └──────────────┴─────────────┴─────────────┘                    │
│                            ▼                                            │
│                   ┌────────────────┐                                    │
│                   │  Search Plan   │ → SQL + params (no DB execution)   │
│                   └────────┬───────┘                                    │
└────────────────────────────┼────────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      MCP + x402 MONETIZATION                            │
│                                                                         │
│   ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐  │
│   │ 7 Intelligence   │  │  x402 Invoice +  │  │    Revenue          │  │
│   │ Paid Routes      │→ │  Settlement      │→ │    Attribution      │  │
│   │ (catalog.ts)     │  │  (existing x402) │  │    (60/40 BPS)      │  │
│   └──────────────────┘  └──────────────────┘  └─────────────────────┘  │
│                                                                         │
│   Agent pays x402 → settlement confirms → classifier + allocator →     │
│   creator revenue share + platform treasury                             │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Module Map

```
src/intelligence/
├── config.ts                           # Zod-parsed env vars for the intelligence subsystem
├── config.test.ts                      # Config validation tests
├── types.ts                            # TypeScript interfaces mirroring all 7 SQL tables
├── catalog.ts                          # 7 intelligence PaidRoute definitions (extends x402 catalog)
├── catalog.test.ts                     # Catalog structure + pricing tests
├── routes.ts                           # Pure response builder functions for each endpoint
├── routes.test.ts                      # Response builder tests
├── mcpTools.ts                         # MCP instructions text for agent clients
├── mcpTools.test.ts                    # MCP instructions tests
├── index.ts                            # Public API barrel — re-exports for external consumers
├── index.test.ts                       # Public API surface tests
│
├── migrations/
│   ├── 001_intelligence_foundation.sql # pgvector, 5 tables, HNSW + GIN indexes, tsvector triggers
│   ├── 002_query_cache.sql             # Query cache + attribution tables
│   ├── rollback_001.sql                # Safe reverse of 001 (triggers → tables → extension)
│   └── rollback_002.sql                # Safe reverse of 002
│
├── providers/
│   ├── interface.ts                    # EnrichmentProvider contract + EnrichmentResult type
│   ├── x-api.ts                        # X (Twitter) API v2 adapter with rate-limit tracking
│   ├── x-api.test.ts                   # X API adapter tests
│   ├── firecrawl.ts                    # Firecrawl web-scraping adapter
│   ├── firecrawl.test.ts               # Firecrawl adapter tests
│   ├── native.ts                       # First-party Streamlivr data normalizer
│   └── native.test.ts                  # Native adapter tests
│
├── enrichment/
│   ├── worker.ts                       # In-memory async job queue with concurrency, retry, freshness
│   ├── worker.test.ts                  # Worker lifecycle + job processing tests
│   ├── entityResolution.ts             # Cross-platform identity matching + merge logic
│   └── entityResolution.test.ts        # Entity resolution tests
│
├── refinement/
│   ├── classification.ts               # Rule-based 18-category taxonomy + topic extraction
│   ├── classification.test.ts          # Classification tests
│   ├── embedding.ts                    # OpenAI / Gemini embedding generation
│   ├── embedding.test.ts               # Embedding tests
│   └── pipeline.ts                     # Orchestrator: classify → topics → language → summary → embed
│
├── retrieval/
│   ├── keyword.ts                      # tsvector full-text search query builder
│   ├── keyword.test.ts                 # Keyword search tests
│   ├── semantic.ts                     # pgvector cosine similarity query builder
│   ├── semantic.test.ts                # Semantic search tests
│   ├── hybrid.ts                       # Reciprocal Rank Fusion (RRF) merging keyword + semantic
│   ├── hybrid.test.ts                  # Hybrid search tests
│   ├── ranking.ts                      # Configurable multi-signal ranking (freshness, engagement, etc.)
│   ├── ranking.test.ts                 # Ranking tests
│   ├── cache.ts                        # Query cache lookup + TTL management
│   ├── cache.test.ts                   # Cache tests
│   ├── search.ts                       # Unified search orchestrator — parses, plans, builds SQL
│   └── search.test.ts                  # Search orchestrator tests
│
├── attribution/
│   ├── classifier.ts                   # Request classification (creator_specific, search, platform_owned…)
│   ├── classifier.test.ts              # Classifier tests
│   ├── allocator.ts                    # Revenue allocation engine (60/40 BPS split, BigInt arithmetic)
│   └── allocator.test.ts              # Allocator tests (reconciliation invariant enforcement)
│
├── services/
│   ├── searchService.ts                # Shared search API for MCP + in-app consumers
│   ├── searchService.test.ts           # Search service tests
│   ├── ragService.ts                   # RAG context retrieval for AI assistant (intent parse + plans)
│   ├── ragService.test.ts              # RAG service tests
│   ├── recommendationService.ts        # Similar creators, related content, trending, discovery
│   ├── recommendationService.test.ts   # Recommendation service tests
│   ├── monitoring.ts                   # Health check + analytics query builders (enrichment, monetization)
│   └── monitoring.test.ts              # Monitoring tests
│
└── utils/
    ├── contentHash.ts                  # SHA-256 content hashing for dedup
    ├── contentHash.test.ts             # Content hash tests
    ├── freshness.ts                    # Enrichment freshness/staleness logic
    ├── freshness.test.ts               # Freshness tests
    ├── idempotency.ts                  # Query hash + attribution key generation
    └── idempotency.test.ts             # Idempotency tests
```

---

## 3. Database Setup

### Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| PostgreSQL | 15+ | Required for `gen_random_uuid()` and JSON operators |
| pgvector extension | 0.5+ | HNSW index support requires 0.5+ |
| Existing Streamlivr DB | — | Migrations run against the same database that holds the `User` table |

### Run Migrations

```bash
# Migration 001: pgvector extension, 5 intelligence tables, indexes, tsvector triggers
psql $DATABASE_URL -f src/intelligence/migrations/001_intelligence_foundation.sql

# Migration 002: query cache + attribution tables
psql $DATABASE_URL -f src/intelligence/migrations/002_query_cache.sql
```

### Verify

```sql
-- Confirm pgvector is enabled
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Confirm all 7 intelligence tables exist
\dt *intelligence*
\dt external_identity_links
\dt enrichment_metadata
\dt data_provenance
```

### Rollback

Rollback scripts are provided in reverse order. Always rollback 002 before 001:

```bash
# Remove query cache + attribution tables
psql $DATABASE_URL -f src/intelligence/migrations/rollback_002.sql

# Remove all intelligence tables, triggers, functions, and pgvector extension
psql $DATABASE_URL -f src/intelligence/migrations/rollback_001.sql
```

> ⚠️ `rollback_001.sql` drops the `vector` extension. If other schemas use pgvector, remove that line before executing.

### Table Reference

| Table | Purpose | Key Columns |
|---|---|---|
| `creator_intelligence` | AI-enriched creator profiles | `creator_id` (unique), `categories TEXT[]`, `topics TEXT[]`, `languages TEXT[]`, `biography_summary`, `embedding vector(1536)`, `confidence_score`, `search_vector tsvector` |
| `content_intelligence` | AI-enriched content metadata | `content_id` (unique), `creator_id`, `summary`, `topics TEXT[]`, `categories TEXT[]`, `content_embedding vector(1536)`, `search_vector tsvector` |
| `external_identity_links` | Cross-platform identity mapping | `creator_id`, `provider`, `external_account_id` (unique per provider), `verification_status` |
| `enrichment_metadata` | Job tracking per entity+provider | `entity_type`, `entity_id`, `provider` (unique triple), `status`, `attempts`, `content_hash`, `next_refresh_at` |
| `data_provenance` | Audit trail of data sources | `entity_type`, `entity_id`, `source_type`, `retention_policy`, `attribution_eligible` |
| `intelligence_query_cache` | TTL-based search result cache | `query_hash` (unique), `result JSONB`, `expires_at`, `access_scope` |
| `intelligence_attribution` | Per-request revenue attribution ledger | `request_id`, `creator_id`, `attributable_value_atomic`, `attribution_status`, `verification_snapshot JSONB` |

### Index Reference

| Index | Type | Table | Purpose |
|---|---|---|---|
| `idx_creator_intelligence_embedding` | HNSW (`vector_cosine_ops`) | `creator_intelligence` | Semantic similarity search on creator embeddings |
| `idx_content_intelligence_embedding` | HNSW (`vector_cosine_ops`) | `content_intelligence` | Semantic similarity search on content embeddings |
| `idx_creator_intelligence_categories` | GIN | `creator_intelligence` | Array containment/overlap on `categories` |
| `idx_creator_intelligence_topics` | GIN | `creator_intelligence` | Array containment/overlap on `topics` |
| `idx_creator_intelligence_search` | GIN | `creator_intelligence` | Full-text search on `search_vector` tsvector |
| `idx_content_intelligence_search` | GIN | `content_intelligence` | Full-text search on content `search_vector` tsvector |
| `idx_external_identity_creator` | B-tree | `external_identity_links` | Lookup by `creator_id` |
| `idx_data_provenance_entity` | B-tree | `data_provenance` | Lookup by `entity_type + entity_id` |
| `idx_query_cache_hash` | B-tree | `intelligence_query_cache` | Cache key lookup |
| `idx_query_cache_expiry` | B-tree | `intelligence_query_cache` | TTL expiry scans |
| `idx_intelligence_attribution_request` | B-tree | `intelligence_attribution` | Lookup by `request_id` |
| `idx_intelligence_attribution_creator` | B-tree | `intelligence_attribution` | Lookup by `creator_id` |

---

## 4. Environment Variables

### Intelligence-Specific Variables

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `INTELLIGENCE_ENABLED` | `boolean` | `false` | Yes | Feature flag — set to `true` to enable the intelligence subsystem |
| `INTELLIGENCE_EMBEDDING_MODEL` | `string` | `text-embedding-3-small` | No | OpenAI/Gemini embedding model name |
| `INTELLIGENCE_EMBEDDING_DIMENSIONS` | `integer` | `1536` | No | Vector dimensions for embeddings |
| `INTELLIGENCE_EMBEDDING_PROVIDER` | `openai \| gemini` | `openai` | No | Which embedding API to use |
| `OPENAI_API_KEY` | `string` | — | When provider=openai | OpenAI API key for embedding generation |
| `FIRECRAWL_API_KEY` | `string` | — | Optional | Firecrawl API key for web scraping enrichment |
| `FIRECRAWL_BASE_URL` | `string (url)` | `https://api.firecrawl.dev` | No | Firecrawl API base URL |
| `X_ENRICHMENT_BEARER_TOKEN` | `string` | — | Optional | X/Twitter API v2 bearer token for profile enrichment |
| `ENRICHMENT_CREATOR_REFRESH_INTERVAL` | `integer (seconds)` | `604800` (7 days) | No | How often to re-enrich creator profiles |
| `ENRICHMENT_CONTENT_REFRESH_INTERVAL` | `integer (seconds)` | `86400` (1 day) | No | How often to re-enrich content |
| `ENRICHMENT_QUERY_CACHE_TTL` | `integer (seconds)` | `3600` (1 hour) | No | Query result cache TTL |
| `ENRICHMENT_WORKER_CONCURRENCY` | `integer` | `3` | No | Max concurrent enrichment jobs |
| `ENRICHMENT_WORKER_POLL_INTERVAL` | `integer (ms)` | `10000` | No | Worker queue poll interval |
| `ENRICHMENT_MAX_RETRIES` | `integer` | `3` | No | Max retry attempts before permanent failure |

### Required x402 Variables

The intelligence module extends the existing x402 server. All existing x402 environment variables must also be set. Refer to the main [`README.md`](../README.md) for the complete list. Key ones:

- `X402_FACILITATOR_ADDRESS` — Celo facilitator contract
- `X402_RESOURCE_ADDRESS` — Server wallet address
- `X402_CELO_RPC_URL` — Celo RPC endpoint

### Example `.env` Additions

```bash
# ── Intelligence Infrastructure ──────────────────────────────────
INTELLIGENCE_ENABLED=true
INTELLIGENCE_EMBEDDING_PROVIDER=openai
INTELLIGENCE_EMBEDDING_MODEL=text-embedding-3-small
INTELLIGENCE_EMBEDDING_DIMENSIONS=1536

# Provider credentials (set the ones you need)
OPENAI_API_KEY=sk-...
FIRECRAWL_API_KEY=fc-...
X_ENRICHMENT_BEARER_TOKEN=AAAA...

# Tuning (all optional — defaults are sane for production)
ENRICHMENT_WORKER_CONCURRENCY=3
ENRICHMENT_WORKER_POLL_INTERVAL=10000
ENRICHMENT_MAX_RETRIES=3
ENRICHMENT_QUERY_CACHE_TTL=3600
```

---

## 5. Production Wiring Guide

This section is the step-by-step integration guide for the senior engineer wiring the intelligence module into the production Streamlivr server. Each step is independent and idempotent.

### Step 1: Run Database Migrations

Execute the SQL migration files against the main Streamlivr PostgreSQL database:

```bash
psql $DATABASE_URL -f src/intelligence/migrations/001_intelligence_foundation.sql
psql $DATABASE_URL -f src/intelligence/migrations/002_query_cache.sql
```

Verify:

```sql
-- pgvector enabled
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Tables exist
\dt *intelligence*
\dt external_identity_links
\dt enrichment_metadata
\dt data_provenance

-- Triggers installed
SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_%intelligence%';
```

Expected triggers:
- `trg_creator_intelligence_search_vector`
- `trg_content_intelligence_search_vector`

---

### Step 2: Extend the Paid Route Catalog

In your main server entry point (e.g., `demo/server.ts` or your production `server.ts`):

```typescript
// Import the intelligence catalog builder
import { buildIntelligencePaidRoutes } from '../intelligence/catalog.js';

// Import the existing x402 catalog builder
import { buildPaidRoutes } from '../x402/catalog.js';

// Merge both catalogs — intelligence routes extend, never replace
const paidRoutes = [...buildPaidRoutes(), ...buildIntelligencePaidRoutes()];
```

This automatically:
- Registers 7 new MCP tools in the tool list
- Updates the agent card / discovery document
- Enables x402 pricing for intelligence endpoints
- Preserves all existing x402 routes

The 7 intelligence routes registered:

| Route | ID | Pricing |
|---|---|---|
| `GET /api/intelligence/creators/search` | `search-creators-intelligence` | $0.01 per creator |
| `GET /api/intelligence/creators/:id` | `get-creator-intelligence` | $0.01 flat |
| `GET /api/intelligence/content/search` | `search-content-intelligence` | $0.01 per creator |
| `GET /api/intelligence/content/:id` | `get-content-intelligence` | $0.01 flat |
| `GET /api/intelligence/discover` | `discover-creators` | $0.01 per creator |
| `POST /api/intelligence/enrich/:id` | `enrich-creator` | $0.01 flat |
| `GET /api/intelligence/search` | `search-streamlivr-unified` | $0.01 per creator |

---

### Step 3: Register Intelligence Fastify Routes

The intelligence module produces **SQL plans** (query + params) and **response builders** — it does not execute queries. Your Fastify routes bridge the gap by executing the SQL plans against your database.

#### Pattern: Creator Search

```typescript
import { parseSearchRequest, buildSearchQuery } from '../intelligence/retrieval/search.js';
import { buildCreatorSearchResponse } from '../intelligence/routes.js';
import type { PageInfo } from '../intelligence/routes.js';

app.get('/api/intelligence/creators/search', async (request, reply) => {
  // 1. Parse and validate the incoming query parameters
  const parsed = parseSearchRequest({
    query: (request.query as any).q,
    entityTypes: ['creator'],
    filters: {
      categories: (request.query as any).category ? [(request.query as any).category] : undefined,
      language: (request.query as any).language,
      isVerified: (request.query as any).verified === 'true' ? true : undefined,
    },
    limit: parseInt((request.query as any).limit ?? '10', 10),
  });

  // 2. Build the search plan (SQL + params)
  const plan = buildSearchQuery(parsed);

  // 3. Execute the SQL plan against PostgreSQL
  const rows = await prisma.$queryRawUnsafe(plan.searchQuery.sql, ...plan.searchQuery.params);

  // 4. Build pagination info
  const pageInfo: PageInfo = {
    total: rows.length, // Replace with COUNT(*) query for accurate total
    limit: plan.pagination.limit,
    returned: rows.length,
    hasMore: rows.length === plan.pagination.limit,
    nextCursor: null, // Compute from last row ID
    truncated: false,
  };

  // 5. Build and return the standardised response
  return buildCreatorSearchResponse(rows as any, pageInfo, {
    q: (request.query as any).q,
    limit: plan.pagination.limit,
  });
});
```

#### Pattern: Creator Intelligence Profile

```typescript
import { createSearchService } from '../intelligence/services/searchService.js';
import { buildCreatorIntelligenceResponse } from '../intelligence/routes.js';

const searchService = createSearchService();

app.get('/api/intelligence/creators/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  // 1. Build the query plan
  const query = searchService.getCreatorIntelligence(id);

  // 2. Execute
  const rows = await prisma.$queryRawUnsafe(query.sql, ...query.params);
  if (!rows[0]) return reply.code(404).send({ error: 'Creator not found' });

  // 3. Fetch the base User profile
  const user = await prisma.user.findUnique({ where: { id } });

  // 4. Build response
  return buildCreatorIntelligenceResponse(rows[0] as any, user as any);
});
```

#### Pattern: Content Search

```typescript
import { buildContentSearchResponse } from '../intelligence/routes.js';

app.get('/api/intelligence/content/search', async (request, reply) => {
  const parsed = parseSearchRequest({
    query: (request.query as any).q,
    entityTypes: ['content'],
    filters: {
      categories: (request.query as any).category ? [(request.query as any).category] : undefined,
      language: (request.query as any).language,
    },
    limit: parseInt((request.query as any).limit ?? '10', 10),
  });

  const plan = buildSearchQuery(parsed);
  const rows = await prisma.$queryRawUnsafe(plan.searchQuery.sql, ...plan.searchQuery.params);

  const pageInfo: PageInfo = { /* same pattern */ };
  return buildContentSearchResponse(rows as any, pageInfo, {
    q: (request.query as any).q,
    limit: plan.pagination.limit,
  });
});
```

#### Pattern: Content Intelligence Profile

```typescript
import { buildContentIntelligenceResponse } from '../intelligence/routes.js';

app.get('/api/intelligence/content/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = searchService.getContentIntelligence(id);
  const rows = await prisma.$queryRawUnsafe(query.sql, ...query.params);
  if (!rows[0]) return reply.code(404).send({ error: 'Content not found' });
  return buildContentIntelligenceResponse(rows[0] as any);
});
```

#### Pattern: Discover (Recommendations)

```typescript
import { createRecommendationService } from '../intelligence/services/recommendationService.js';

const recommendationService = createRecommendationService();

app.get('/api/intelligence/discover', async (request, reply) => {
  // Uses the same search pipeline with recommendation scoring
  const parsed = parseSearchRequest({
    query: (request.query as any).q,
    entityTypes: ['creator'],
    filters: {
      categories: (request.query as any).category ? [(request.query as any).category] : undefined,
      language: (request.query as any).language,
    },
    limit: parseInt((request.query as any).limit ?? '10', 10),
  });

  const plan = buildSearchQuery(parsed);
  const rows = await prisma.$queryRawUnsafe(plan.searchQuery.sql, ...plan.searchQuery.params);

  // Score and rank with recommendation engine
  // ... build response with relevanceScore and matchReason fields
  return buildCreatorSearchResponse(rows as any, pageInfo, {
    q: (request.query as any).q,
    limit: plan.pagination.limit,
  });
});
```

#### Pattern: Enrichment Request

```typescript
import { buildEnrichmentResponse } from '../intelligence/routes.js';
import { EnrichmentWorker } from '../intelligence/enrichment/worker.js';

// Assumes `worker` is initialized (see Step 5)
app.post('/api/intelligence/enrich/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  const jobId = worker.enqueueJob({
    entityType: 'creator',
    entityId: id,
    provider: 'native',
    priority: 1,
  });

  return buildEnrichmentResponse('queued', jobId);
});
```

#### Pattern: Unified Search

```typescript
import { buildUnifiedSearchResponse } from '../intelligence/routes.js';

app.get('/api/intelligence/search', async (request, reply) => {
  const entityType = (request.query as any).entity_type;
  const entityTypes = entityType ? [entityType] : ['creator', 'content'];

  const parsed = parseSearchRequest({
    query: (request.query as any).q,
    entityTypes,
    filters: {
      categories: (request.query as any).category ? [(request.query as any).category] : undefined,
      language: (request.query as any).language,
    },
    limit: parseInt((request.query as any).limit ?? '10', 10),
  });

  const plan = buildSearchQuery(parsed);
  const rows = await prisma.$queryRawUnsafe(plan.searchQuery.sql, ...plan.searchQuery.params);

  // Separate rows into creators and content based on plan.entityType
  const creators = plan.entityType === 'creator' ? rows : [];
  const content = plan.entityType === 'content' ? rows : [];

  return buildUnifiedSearchResponse(creators as any, content as any, pageInfo, {
    q: (request.query as any).q,
    limit: plan.pagination.limit,
  });
});
```

**Pipeline summary for every route:**

```
HTTP request → parseSearchRequest() → buildSearchQuery() → SearchPlan
  → execute plan.searchQuery.sql with plan.searchQuery.params against PostgreSQL
  → build response with buildXxxResponse()
  → return JSON
```

---

### Step 4: Wire Attribution into x402 Settlement

After x402 settlement confirms for an intelligence route, classify the request and allocate revenue:

```typescript
import { classifyIntelligenceRequest } from '../intelligence/attribution/classifier.js';
import {
  allocateIntelligenceRevenue,
  buildAttributionLedgerEntries,
} from '../intelligence/attribution/allocator.js';
import type { CreatorVerificationState } from '../intelligence/attribution/allocator.js';

// In your x402 settlement callback / post-settlement hook:
async function handleIntelligenceSettlement(
  settlementId: string,
  path: string,
  amountAtomic: string,
  resultCreatorIds: string[],
) {
  // 1. Classify the request
  const classification = classifyIntelligenceRequest({
    path,
    resultCreatorIds,
  });

  // 2. Fetch verification states for involved creators
  const creatorStates = new Map<string, CreatorVerificationState>();
  for (const creatorId of classification.involvedCreatorIds) {
    const user = await prisma.user.findUnique({ where: { id: creatorId } });
    creatorStates.set(creatorId, {
      creatorId,
      exists: !!user,
      isVerified: user?.isVerified ?? false,
      isLinked: user?.isLinked ?? false, // Your linked-account field
      isEligible: user?.status === 'active', // Your eligibility field
      walletAddress: user?.walletAddress ?? undefined,
    });
  }

  // 3. Allocate revenue
  const allocation = allocateIntelligenceRevenue({
    requestId: settlementId,
    settledAmountAtomic: amountAtomic,
    classification,
    creatorStates,
  });

  // 4. Verify reconciliation (always true — enforced by the allocator)
  if (!allocation.reconciled) {
    throw new Error('CRITICAL: Attribution allocation did not reconcile');
  }

  // 5. Build ledger entries for database persistence
  const entries = buildAttributionLedgerEntries(allocation, creatorStates);

  // 6. Write to intelligence_attribution table
  for (const entry of entries) {
    await prisma.$executeRaw`
      INSERT INTO intelligence_attribution (
        request_id, creator_id, data_entity_id, data_entity_type,
        attributable_value_atomic, attribution_status, verification_snapshot
      ) VALUES (
        ${entry.requestId}, ${entry.creatorId}, ${entry.dataEntityId ?? null},
        ${entry.dataEntityType ?? null}, ${entry.attributableValueAtomic},
        ${entry.attributionStatus}, ${JSON.stringify(entry.verificationSnapshot)}::jsonb
      )
      ON CONFLICT DO NOTHING  -- idempotent via requestId + creatorId
    `;
  }

  // 7. Execute creator payouts for verified_linked allocations
  for (const alloc of allocation.creatorAllocations) {
    if (alloc.attributionStatus === 'verified_linked') {
      const state = creatorStates.get(alloc.creatorId);
      if (state?.walletAddress) {
        // Trigger payout via your existing payment infrastructure
        await payoutToCreator(state.walletAddress, alloc.amountAtomic);
      }
    }
  }

  // 8. Credit platform treasury
  if (BigInt(allocation.platformAllocationAtomic) > 0n) {
    await creditPlatformTreasury(allocation.platformAllocationAtomic);
  }
}
```

---

### Step 5: Start the Enrichment Worker

The enrichment worker runs as a background process within your server:

```typescript
import { createXApiProvider } from '../intelligence/providers/x-api.js';
import { createFirecrawlProvider } from '../intelligence/providers/firecrawl.js';
import { createNativeProvider } from '../intelligence/providers/native.js';
import { EnrichmentWorker } from '../intelligence/enrichment/worker.js';
import {
  INTELLIGENCE_ENABLED,
  X_ENRICHMENT_BEARER_TOKEN,
  FIRECRAWL_API_KEY,
  FIRECRAWL_BASE_URL,
  ENRICHMENT_WORKER_CONCURRENCY,
  ENRICHMENT_WORKER_POLL_INTERVAL,
  ENRICHMENT_MAX_RETRIES,
  assertIntelligenceConfiguration,
} from '../intelligence/config.js';

// Validate configuration at boot
assertIntelligenceConfiguration();

if (INTELLIGENCE_ENABLED) {
  // Build the provider registry
  const providers = new Map();
  providers.set('native', createNativeProvider());

  if (X_ENRICHMENT_BEARER_TOKEN) {
    providers.set('x_api', createXApiProvider(X_ENRICHMENT_BEARER_TOKEN));
  }

  if (FIRECRAWL_API_KEY) {
    providers.set('firecrawl', createFirecrawlProvider(FIRECRAWL_API_KEY, FIRECRAWL_BASE_URL));
  }

  // Create and start the worker
  const worker = new EnrichmentWorker(providers, {
    concurrency: ENRICHMENT_WORKER_CONCURRENCY,   // default: 3
    pollIntervalMs: ENRICHMENT_WORKER_POLL_INTERVAL, // default: 10000
    maxRetries: ENRICHMENT_MAX_RETRIES,              // default: 3
  });

  worker.start();

  // Graceful shutdown
  process.on('SIGTERM', () => worker.stop());
  process.on('SIGINT', () => worker.stop());
}
```

The worker:
- Processes jobs from an in-memory priority queue
- Checks freshness before making provider calls (skip if data is still fresh)
- Computes content hashes to skip when data hasn't changed
- Retries failed jobs with decreasing priority
- Respects the configured concurrency limit

---

### Step 6: Wire Services for In-App Use

The intelligence module provides three high-level services for in-app consumers (dashboard, chatbot, recommendation engine):

```typescript
import { createSearchService } from '../intelligence/services/searchService.js';
import { createRagService } from '../intelligence/services/ragService.js';
import { createRecommendationService } from '../intelligence/services/recommendationService.js';

// Search service — orchestrates the search pipeline
const searchService = createSearchService({
  defaultLimit: 10,
  maxLimit: 200,
  cacheTtlSeconds: 3600,
  embeddingDimensions: 1536,
});

// RAG service — retrieves intelligence context for LLM prompts
const ragService = createRagService(searchService);

// Recommendation service — similar creators, trending, discovery
const recommendationService = createRecommendationService();
```

**SearchService API:**
- `search(request)` → `SearchServiceResponse` — unified search with auto-response-builder selection
- `searchCreators(query, filters?, limit?)` → `SearchPlan` — creator-only search plan
- `searchContent(query, filters?, limit?)` → `SearchPlan` — content-only search plan
- `getCreatorIntelligence(creatorId)` → `{ sql, params }` — single creator lookup
- `getContentIntelligence(contentId)` → `{ sql, params }` — single content lookup

**RagService API:**
- `retrieveContext(question, options?)` → `RagContext` — full RAG pipeline
- `parseQuestionIntent(question)` → `QuestionIntent` — intent classification (discover, compare, detail, recommend, trend)
- `buildRagSearchQueries(intent)` → `SearchPlan[]` — search plans for a parsed intent
- `buildContextPrompt(context)` → `string` — formatted context for LLM injection

**RecommendationService API:**
- `buildSimilarCreatorsQuery(creatorId, limit)` → `SearchPlan` — pgvector cosine similarity
- `buildRelatedContentQuery(contentId, limit)` → `SearchPlan` — content embedding similarity
- `buildCreatorDiscoveryQuery(context)` → `SearchPlan` — interest-based discovery
- `buildTrendingQuery(entityType, limit, windowHours?)` → `TrendingQuery` — recently enriched + high engagement
- `scoreRecommendation(candidate, context)` → `number` — multi-signal relevance score (0–1)

---

### Step 7: Health Check and Monitoring

```typescript
import {
  buildHealthCheckResponse,
  buildEnrichmentAnalyticsQuery,
  buildIntelligenceAnalyticsQuery,
  buildMonetizationAnalyticsQuery,
} from '../intelligence/services/monitoring.js';

// Health check endpoint
app.get('/api/intelligence/health', async () => {
  return buildHealthCheckResponse();
});

// Analytics endpoints (admin-only, not x402-gated)
app.get('/api/intelligence/analytics/enrichment', async (request) => {
  const query = buildEnrichmentAnalyticsQuery(/* optional date range */);
  const rows = await prisma.$queryRawUnsafe(query.sql, ...query.params);
  return { description: query.description, data: rows };
});

app.get('/api/intelligence/analytics/intelligence', async () => {
  const query = buildIntelligenceAnalyticsQuery();
  const rows = await prisma.$queryRawUnsafe(query.sql, ...query.params);
  return { description: query.description, data: rows };
});

app.get('/api/intelligence/analytics/monetization', async () => {
  const query = buildMonetizationAnalyticsQuery();
  const rows = await prisma.$queryRawUnsafe(query.sql, ...query.params);
  return { description: query.description, data: rows };
});
```

Health check response shape:

```json
{
  "status": "ok",
  "intelligence": {
    "enabled": true,
    "providers": ["native", "openai"],
    "embeddingModel": "text-embedding-3-small",
    "embeddingDimensions": 1536
  },
  "timestamp": "2026-11-03T14:30:00.000Z"
}
```

---

## 6. Revenue Attribution Rules

### Attribution Status Matrix

| Creator State | Attribution Status | Revenue Destination |
|---|---|---|
| Verified + Linked + Eligible | `verified_linked` | Creator receives 60% share (split equally among eligible creators in result set) |
| Linked but not verified | `linked_unverified` | Platform treasury |
| Not linked to external identity | `unlinked` | Platform treasury |
| Creator does not exist | `unknown` | Platform treasury |
| Creator suspended/banned | `ineligible` | Platform treasury |
| Content with no creator | `platform_owned` | Platform treasury (100%) |
| Empty result set | `non_attributable` | No settlement (free) |

### Revenue Split Constants

From [`src/x402/split.ts`](../src/x402/split.ts):

```typescript
export const CREATOR_SHARE_BPS = 6000n;   // 60%
export const PLATFORM_SHARE_BPS = 4000n;  // 40%
export const BPS_DENOMINATOR = 10000n;
```

### Reconciliation Invariant

The allocator enforces this invariant on every allocation:

```
sum(creatorAllocations.amountAtomic) + platformAllocationAtomic === settledAmountAtomic
```

This is enforced with BigInt arithmetic — no floating point is used for monetary values anywhere in the attribution system. The `allocation.reconciled` field is `true` when the invariant holds (which is always, by construction).

### Distribution Algorithm

1. Compute the creator pool: `(settledAmount × 6000) / 10000`
2. Divide equally among eligible creators: `base = pool / eligibleCount`
3. Distribute remainder one atomic unit at a time in order: `remainder = pool % eligibleCount`
4. Platform receives: `settled - totalCreatorAmount`

---

## 7. MCP Integration

### How Intelligence Tools Appear

When the intelligence catalog is merged with the base x402 catalog, the existing `buildMcpTools()` function in `src/x402/discovery.ts` automatically generates MCP tool schemas for each intelligence route. No changes to the MCP tool builder are needed.

The intelligence module provides supplementary instructions via [`INTELLIGENCE_MCP_INSTRUCTIONS`](../src/intelligence/mcpTools.ts) that describe:
- How to search creators semantically
- How enrichment works
- How attribution works
- The pricing model

Append these instructions to your MCP server card:

```typescript
import { INTELLIGENCE_MCP_INSTRUCTIONS } from '../intelligence/mcpTools.js';
// or: import { buildIntelligenceMcpInstructions } from '../intelligence/mcpTools.js';

// Append to your existing MCP server instructions
const serverInstructions = `${existingInstructions}\n\n${INTELLIGENCE_MCP_INSTRUCTIONS}`;
```

### Agent Payment Flow

```
1. Agent discovers intelligence tools via MCP tool list
2. Agent calls e.g. search_creators_intelligence({ q: "afrobeats" })
3. Server returns HTTP 402 with x402 invoice ($0.01 × 10 creators = $0.10)
4. Agent signs USDC payment on Celo
5. Server verifies payment via facilitator contract
6. Server executes the search plan against PostgreSQL
7. Server returns enriched creator results
8. Settlement confirms → classifier determines attribution type
9. Allocator splits revenue: 60% to eligible creators, 40% to platform
10. Attribution ledger entries written to intelligence_attribution table
```

---

## 8. Testing

### Run the Full Intelligence Test Suite

```bash
npm test -- src/intelligence
```

### Test Statistics

| Metric | Count |
|---|---|
| Test files | 22 |
| Test suites (`describe` blocks) | 130 |
| Test cases (`it` blocks) | 506 |

### Run Specific Module Tests

```bash
# Config + types
npm test -- src/intelligence/config.test.ts

# Providers
npm test -- src/intelligence/providers/

# Enrichment (worker + entity resolution)
npm test -- src/intelligence/enrichment/

# Refinement (classification + embedding + pipeline)
npm test -- src/intelligence/refinement/

# Retrieval (keyword + semantic + hybrid + ranking + cache + search)
npm test -- src/intelligence/retrieval/

# Attribution (classifier + allocator)
npm test -- src/intelligence/attribution/

# Services (search + RAG + recommendations + monitoring)
npm test -- src/intelligence/services/

# Utilities
npm test -- src/intelligence/utils/

# Top-level (catalog + routes + MCP tools + index)
npm test -- src/intelligence/catalog.test.ts src/intelligence/routes.test.ts src/intelligence/mcpTools.test.ts src/intelligence/index.test.ts
```

### No Regressions

The intelligence module is purely additive. Running the existing x402 test suite confirms zero regressions:

```bash
npm test -- src/x402
```

---

## 9. Rollback

### Disable Intelligence Without Removing Data

Set `INTELLIGENCE_ENABLED=false` in your environment. The intelligence routes will return `503 Service Unavailable` (or simply not be registered if you gate on the flag at route registration), and the enrichment worker will not start. Existing x402 routes are completely unaffected.

```bash
# In your .env
INTELLIGENCE_ENABLED=false
```

### Remove Intelligence Tables

If you need to fully remove the intelligence data:

```bash
# Always rollback in reverse order
psql $DATABASE_URL -f src/intelligence/migrations/rollback_002.sql
psql $DATABASE_URL -f src/intelligence/migrations/rollback_001.sql
```

> ⚠️ `rollback_001.sql` includes `DROP EXTENSION IF EXISTS vector`. If other parts of your schema use pgvector, remove that line before executing.

### Remove Intelligence Routes

Remove the `buildIntelligencePaidRoutes()` call from your server:

```typescript
// Before (intelligence enabled)
const paidRoutes = [...buildPaidRoutes(), ...buildIntelligencePaidRoutes()];

// After (intelligence removed)
const paidRoutes = buildPaidRoutes();
```

### Corrupted Enrichment Data

If enrichment data is corrupted, you can safely truncate the intelligence tables without affecting the rest of the system:

```sql
-- Clear all enriched data (preserves table structure)
TRUNCATE creator_intelligence CASCADE;
TRUNCATE content_intelligence CASCADE;
TRUNCATE enrichment_metadata CASCADE;
TRUNCATE data_provenance CASCADE;
TRUNCATE intelligence_query_cache CASCADE;

-- Re-run enrichment by starting the worker — it will re-enrich all creators
```

The enrichment worker will treat all creators as never-enriched and re-process them from scratch.

---

## References

- **PRD:** `plans/STREAMLIVR_INTELLIGENCE_INFRASTRUCTURE.md`
- **x402 Server:** [`src/x402/`](../src/x402/)
- **Revenue Split:** [`src/x402/split.ts`](../src/x402/split.ts)
- **Pricing:** [`src/x402/pricing.ts`](../src/x402/pricing.ts)
- **Main README:** [`README.md`](../README.md)
