import { describe, expect, it } from 'vitest';
import { buildIntelligenceMcpInstructions, INTELLIGENCE_MCP_INSTRUCTIONS } from './mcpTools.js';

describe('intelligence MCP instructions', () => {
    it('exports a non-empty instructions constant', () => {
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toBeTruthy();
        expect(INTELLIGENCE_MCP_INSTRUCTIONS.length).toBeGreaterThan(100);
    });

    it('buildIntelligenceMcpInstructions returns the same string', () => {
        expect(buildIntelligenceMcpInstructions()).toBe(INTELLIGENCE_MCP_INSTRUCTIONS);
    });

    it('mentions enrichment', () => {
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('enrichment');
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('enrich');
    });

    it('mentions attribution', () => {
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('attribution');
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('attributed');
    });

    it('mentions pricing', () => {
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('pricing');
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('$0.01');
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('USDC');
    });

    it('mentions semantic search', () => {
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('semantic');
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('search_creators_intelligence');
    });

    it('mentions the 60/40 revenue split', () => {
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('60%');
    });

    it('mentions key tools', () => {
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('discover_creators');
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('enrich_creator');
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('search_streamlivr_unified');
    });

    it('describes the enrichment pipeline stages', () => {
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('Native enrichment');
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('Cross-platform resolution');
        expect(INTELLIGENCE_MCP_INSTRUCTIONS).toContain('AI refinement');
    });
});
