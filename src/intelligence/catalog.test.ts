import { describe, expect, it } from 'vitest';
import { buildIntelligencePaidRoutes } from './catalog.js';
import { CREATOR_UNIT_PRICE_ATOMIC, FLOOR_REQUEST_PRICE_ATOMIC } from '../x402/pricing.js';

describe('intelligence catalog', () => {
    const routes = buildIntelligencePaidRoutes();

    it('builds exactly 7 intelligence routes', () => {
        expect(routes).toHaveLength(7);
    });

    it('assigns unique ids to every route', () => {
        const ids = routes.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('assigns unique service names to every route', () => {
        const names = routes.map((r) => r.serviceName);
        expect(new Set(names).size).toBe(names.length);
    });

    it('assigns unique paths to every route', () => {
        const paths = routes.map((r) => r.path);
        expect(new Set(paths).size).toBe(paths.length);
    });

    it('includes all expected route ids', () => {
        const ids = routes.map((r) => r.id);
        expect(ids).toContain('search-creators-intelligence');
        expect(ids).toContain('get-creator-intelligence');
        expect(ids).toContain('search-content-intelligence');
        expect(ids).toContain('get-content-intelligence');
        expect(ids).toContain('discover-creators');
        expect(ids).toContain('enrich-creator');
        expect(ids).toContain('search-streamlivr-unified');
    });

    describe('pricing', () => {
        it('prices search routes at CREATOR_UNIT_PRICE_ATOMIC', () => {
            const searchRoutes = routes.filter((r) => r.id.includes('search') || r.id === 'discover-creators');
            for (const route of searchRoutes) {
                expect(route.priceAtomic, `${route.id} should cost CREATOR_UNIT_PRICE_ATOMIC`).toBe(CREATOR_UNIT_PRICE_ATOMIC);
            }
        });

        it('prices single-entity routes at FLOOR_REQUEST_PRICE_ATOMIC', () => {
            const profileRoutes = routes.filter(
                (r) => r.id === 'get-creator-intelligence' || r.id === 'get-content-intelligence' || r.id === 'enrich-creator',
            );
            for (const route of profileRoutes) {
                expect(route.priceAtomic, `${route.id} should cost FLOOR_REQUEST_PRICE_ATOMIC`).toBe(FLOOR_REQUEST_PRICE_ATOMIC);
            }
        });
    });

    describe('query params', () => {
        it('defines query params for search routes', () => {
            const searchRoutes = routes.filter((r) => r.queryParams && r.queryParams.length > 0);
            // 4 routes have queryParams: creator search, content search, discover, unified
            expect(searchRoutes.length).toBeGreaterThanOrEqual(4);
            for (const route of searchRoutes) {
                const paramNames = route.queryParams!.map((p) => p.name);
                expect(paramNames, `${route.id} should include q`).toContain('q');
                expect(paramNames, `${route.id} should include limit`).toContain('limit');
            }
        });

        it('defines creator search params correctly', () => {
            const route = routes.find((r) => r.id === 'search-creators-intelligence')!;
            const paramNames = route.queryParams!.map((p) => p.name);
            expect(paramNames).toContain('q');
            expect(paramNames).toContain('limit');
            expect(paramNames).toContain('cursor');
            expect(paramNames).toContain('category');
            expect(paramNames).toContain('language');
            expect(paramNames).toContain('verified');
        });

        it('defines unified search params with entity_type', () => {
            const route = routes.find((r) => r.id === 'search-streamlivr-unified')!;
            const paramNames = route.queryParams!.map((p) => p.name);
            expect(paramNames).toContain('entity_type');
            const entityTypeParam = route.queryParams!.find((p) => p.name === 'entity_type')!;
            expect(entityTypeParam.values).toEqual(['creator', 'content']);
        });
    });

    describe('path params', () => {
        it('defines path params for ID routes', () => {
            const idRoutes = routes.filter((r) => r.path.includes(':id'));
            expect(idRoutes.length).toBe(3);
            for (const route of idRoutes) {
                expect(route.pathParam, `${route.id} should have a pathParam`).toBeDefined();
                expect(route.pathParam!.name).toBe('id');
                expect(route.pathParam!.example).toBeTruthy();
                expect(route.pathParam!.description).toBeTruthy();
            }
        });

        it('does not define path params for search routes', () => {
            const searchRoutes = routes.filter((r) => !r.path.includes(':id'));
            for (const route of searchRoutes) {
                expect(route.pathParam, `${route.id} should not have a pathParam`).toBeUndefined();
            }
        });
    });

    describe('examples', () => {
        it('provides an example response for every route', () => {
            for (const route of routes) {
                expect(route.example, `${route.id} should have an example`).toBeDefined();
                expect(route.example, `${route.id} example should not be null`).not.toBeNull();
            }
        });

        it('example responses contain expected top-level keys', () => {
            const creatorSearch = routes.find((r) => r.id === 'search-creators-intelligence')!;
            const example = creatorSearch.example as Record<string, unknown>;
            expect(example).toHaveProperty('creators');
            expect(example).toHaveProperty('page');
            expect(example).toHaveProperty('query');
        });
    });

    describe('tags', () => {
        it('includes x402 and celo tags on every route', () => {
            for (const route of routes) {
                expect(route.tags, `${route.id} should include x402`).toContain('x402');
                expect(route.tags, `${route.id} should include celo`).toContain('celo');
            }
        });

        it('includes intelligence tag on every route', () => {
            for (const route of routes) {
                expect(route.tags, `${route.id} should include intelligence`).toContain('intelligence');
            }
        });
    });

    describe('PaidRoute interface compliance', () => {
        it('every route has all required fields', () => {
            for (const route of routes) {
                expect(typeof route.path).toBe('string');
                expect(typeof route.serviceName).toBe('string');
                expect(typeof route.id).toBe('string');
                expect(typeof route.title).toBe('string');
                expect(typeof route.description).toBe('string');
                expect(typeof route.priceAtomic).toBe('string');
                expect(Array.isArray(route.tags)).toBe(true);
                expect(route.path.startsWith('/api/intelligence/')).toBe(true);
            }
        });

        it('priceAtomic values are valid BigInt strings', () => {
            for (const route of routes) {
                expect(() => BigInt(route.priceAtomic)).not.toThrow();
                expect(BigInt(route.priceAtomic)).toBeGreaterThan(0n);
            }
        });
    });
});
