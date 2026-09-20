/**
 * A small Model Context Protocol server for the paid agent routes.
 *
 * The server is deliberately thin. A tool call forwards to the same HTTP route
 * a browser or an x402 fetch client would call, carrying the caller's x402
 * payment header through untouched. Payment verification, settlement,
 * attribution, and replay protection stay in one place, so MCP can never take
 * a shortcut around the paywall.
 *
 * Transport: Streamable HTTP with JSON responses. That is the subset of the MCP
 * spec that every current client supports, and it needs no session state.
 */
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { buildMcpTools, MCP_PROTOCOL_VERSION, type DiscoveryContext, type McpToolDefinition } from './discovery.js';
import type { PaidRoute } from './catalog.js';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export type McpOutcome =
  /** A JSON-RPC response body to return with status 200. */
  | { kind: 'response'; body: unknown }
  /** A JSON-RPC notification. The HTTP layer answers 202 with an empty body. */
  | { kind: 'notification' };

export interface McpForwardRequest {
  path: string;
  method: 'GET';
  /** Raw value of the x402 payment header, when the caller supplied one. */
  paymentHeader?: string;
}

export interface McpForwardResponse {
  status: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface McpServerOptions {
  context: DiscoveryContext;
  /** Performs the HTTP call to the API itself. Injected so the handler stays testable. */
  forward: (request: McpForwardRequest) => Promise<McpForwardResponse>;
  instructions?: string;
}

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown): unknown {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function toolContent(text: string, structured: Record<string, unknown>, isError = false) {
  return { content: [{ type: 'text', text }], structuredContent: structured, isError };
}

/**
 * Reads the payment header from an MCP tool call. The x402 MCP convention puts
 * the base64 payment payload under `params._meta["x402/payment"]`; accepting
 * `params.arguments._payment` as well keeps hand written clients working.
 */
function extractPaymentHeader(params: Record<string, unknown> | undefined): string | undefined {
  const meta = params?._meta as Record<string, unknown> | undefined;
  const fromMeta = meta?.['x402/payment'];
  const args = params?.arguments as Record<string, unknown> | undefined;
  const fromArgs = args?._payment;
  const value = typeof fromMeta === 'string' ? fromMeta : typeof fromArgs === 'string' ? fromArgs : undefined;
  if (!value) return undefined;
  if (typeof fromMeta === 'object' && fromMeta !== null) return Buffer.from(JSON.stringify(fromMeta)).toString('base64');
  return value;
}

/**
 * Builds the HTTP path for one tool call: the path parameter goes into the URL,
 * and any declared query parameter (search, pagination) is appended. Query
 * values are URL-encoded, and an argument the route does not declare is dropped
 * rather than forwarded, so a caller cannot smuggle in a filter the catalog
 * never advertised.
 */
function buildPath(route: PaidRoute, args: Record<string, unknown>): { path: string; error?: string } {
  let path = route.path;
  if (route.pathParam) {
    const value = args[route.pathParam.name];
    if (typeof value !== 'string' || value.trim() === '') {
      return { path, error: `Missing required argument "${route.pathParam.name}"` };
    }
    path = path.replace(`:${route.pathParam.name}`, encodeURIComponent(value));
  }
  const query = new URLSearchParams();
  for (const param of route.queryParams ?? []) {
    const value = args[param.name];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    query.set(param.name, String(value));
  }
  const search = query.toString();
  return { path: search ? `${path}?${search}` : path };
}

function headerValue(headers: McpForwardResponse['headers'], name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  if (Array.isArray(entry)) return entry[0];
  return entry ?? undefined;
}

/** Decodes a base64 header, returning undefined instead of throwing on bad input. */
function tryDecode<T>(decode: (value: string) => T, value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return decode(value);
  } catch {
    return undefined;
  }
}

export function createMcpHandler(options: McpServerOptions) {
  const tools: McpToolDefinition[] = buildMcpTools(options.context);
  const routesById = new Map((options.context.routes ?? []).map((route) => [route.id, route]));

  return async function handle(request: JsonRpcRequest): Promise<McpOutcome> {
    const id = request.id ?? null;
    const method = request.method ?? '';

    if (method.startsWith('notifications/')) return { kind: 'notification' };
    if (!request.method) return { kind: 'response', body: jsonRpcError(id, -32600, 'Missing method') };

    if (method === 'initialize') {
      return {
        kind: 'response',
        body: jsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'streamlivr-x402', title: 'Streamlivr x402 agent tools', version: '1.0.0' },
          instructions:
            options.instructions ??
            'Streamlivr exposes creator data over paid x402 routes on Celo. Call a tool without payment to receive the exact x402 requirements, pay them with any x402 client, then repeat the call with the payment payload in params._meta["x402/payment"] to receive the data and the settlement transaction hash.',
        }),
      };
    }

    if (method === 'ping') return { kind: 'response', body: jsonRpcResult(id, {}) };

    if (method === 'tools/list') {
      return {
        kind: 'response',
        body: jsonRpcResult(id, {
          tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
        }),
      };
    }

    if (method === 'tools/call') {
      const params = request.params ?? {};
      const name = params.name;
      if (typeof name !== 'string') return { kind: 'response', body: jsonRpcError(id, -32602, 'params.name is required') };
      const tool = tools.find((entry) => entry.name === name);
      const routeId = tool ? tool.name.replace(/_/g, '-') : undefined;
      const route = routeId ? routesById.get(routeId) : undefined;
      if (!tool || !route) return { kind: 'response', body: jsonRpcError(id, -32602, `Unknown tool: ${name}`) };

      const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
      const { path, error } = buildPath(route, args);
      if (error) return { kind: 'response', body: jsonRpcError(id, -32602, error) };

      const paymentHeader = extractPaymentHeader(params);
      let response: McpForwardResponse;
      try {
        response = await options.forward({ path, method: 'GET', ...(paymentHeader ? { paymentHeader } : {}) });
      } catch (forwardError) {
        return {
          kind: 'response',
          body: jsonRpcResult(
            id,
            toolContent(
              `The API could not be reached over its internal address. Call the paid route directly instead: ${tool.x402.url}`,
              { error: forwardError instanceof Error ? forwardError.message : 'forward failed', x402: tool.x402 },
              true,
            ),
          ),
        };
      }

      if (response.status === 402) {
        const requirements = tryDecode(decodePaymentRequiredHeader, headerValue(response.headers, 'payment-required')) ?? response.body;
        return {
          kind: 'response',
          body: jsonRpcResult(
            id,
            toolContent(
              `Payment required. Pay ${tool.x402.price.amount} ${tool.x402.price.asset} on ${tool.x402.price.network} to ${tool.x402.price.payTo}, then call ${name} again with the base64 payment payload in params._meta["x402/payment"].`,
              { paymentRequired: true, x402: tool.x402, paymentRequirements: requirements },
            ),
          ),
        };
      }

      if (response.status >= 400) {
        return {
          kind: 'response',
          body: jsonRpcResult(
            id,
            toolContent(`The paid route returned HTTP ${response.status}.`, { status: response.status, body: response.body, x402: tool.x402 }, true),
          ),
        };
      }

      const settlement =
        tryDecode(decodePaymentResponseHeader, headerValue(response.headers, 'payment-response')) ??
        tryDecode(decodePaymentResponseHeader, headerValue(response.headers, 'x-payment-response')) ??
        null;
      return {
        kind: 'response',
        body: jsonRpcResult(
          id,
          toolContent(JSON.stringify(response.body, null, 2), { data: response.body, settlement, x402: tool.x402 }),
        ),
      };
    }

    return { kind: 'response', body: jsonRpcError(id, -32601, `Method not found: ${method}`) };
  };
}
