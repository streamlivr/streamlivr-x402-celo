/**
 * Intelligence MCP tool instructions.
 *
 * The MCP tool schemas themselves are auto-generated from the catalog by the
 * existing `buildMcpTools()` in `src/x402/discovery.ts` — this file provides
 * supplementary instructions that describe the intelligence service, its
 * enrichment pipeline, pricing model, and attribution mechanics to MCP
 * clients that consume the tool list.
 */

/**
 * MCP instructions for the Streamlivr Intelligence service.
 *
 * These are appended to the MCP server card or tool descriptions so an
 * agent client understands what enrichment means, how attribution works,
 * and what the pricing model is.
 */
export const INTELLIGENCE_MCP_INSTRUCTIONS = `
## Streamlivr Intelligence Service

The Streamlivr Intelligence service provides AI-enriched creator and content
discovery on top of the base Streamlivr creator directory. It adds semantic
search, cross-platform identity resolution, content classification, and
engagement signal analysis to every creator and piece of content on the
platform.

### How to search creators semantically

Use the \`search_creators_intelligence\` tool with a natural language query
in the \`q\` parameter. The system matches against enriched categories, topics,
biography summaries, and embedding vectors for semantic similarity. You can
filter by \`category\`, \`language\`, and \`verified\` status. Results include
AI-derived intelligence fields: categories, topics, confidence scores, and
the last enrichment timestamp.

For discovery recommendations, use \`discover_creators\` with a descriptive
query like "nigerian afrobeats producers with growing audiences". This uses
the full recommendation engine including growth signals and engagement
analysis.

For unified search across both creators and content, use
\`search_streamlivr_unified\` with an optional \`entity_type\` filter.

### How enrichment works

Each creator profile is periodically enriched through a multi-provider
pipeline:

1. **Native enrichment** — extracts intelligence from Streamlivr's own
   platform data (posts, engagement, follower patterns).
2. **Cross-platform resolution** — resolves external identities (Twitter/X,
   Instagram, etc.) and fetches public profile data.
3. **AI refinement** — classifies creators into categories and topics,
   generates biography summaries, and computes embedding vectors for
   semantic search.

You can request on-demand enrichment for a specific creator using the
\`enrich_creator\` tool. The enrichment job runs asynchronously and updates
the creator's intelligence profile within minutes.

### How attribution works

Every settled x402 payment is attributed back to the creators whose data was
served. The attribution rules are:

- **Verified + linked creators** receive a 60% revenue share, split equally
  among all eligible creators in the result set.
- **Linked but unverified**, **unlinked**, **unknown**, or **ineligible**
  creators' shares are retained by the platform treasury.
- **Platform-owned data** (content with no identified creator) routes 100%
  to the platform treasury.

Attribution is deterministic, idempotent, and always reconciles: the sum of
all creator allocations plus the platform allocation equals the settled
payment amount exactly.

### Pricing model

Intelligence routes follow the same pricing model as the base Streamlivr
catalog:

- **Per-creator routes** (search, discover, unified search): $0.01 USDC per
  creator credited in the result page. A page of 10 creators costs $0.10.
- **Per-request routes** (single profile, enrichment): $0.01 USDC flat per
  request.
- All prices are in Celo USDC atomic units (6 decimals). The 402 invoice
  carries the exact amount before anything is signed.
- A search that matches nothing is served without settling, so empty pages
  are free.
`.trim();

/**
 * Returns the MCP server instructions text for the intelligence tools.
 */
export function buildIntelligenceMcpInstructions(): string {
    return INTELLIGENCE_MCP_INSTRUCTIONS;
}
