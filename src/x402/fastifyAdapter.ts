import type { FastifyRequest } from 'fastify';
import type { HTTPAdapter } from '@x402/core/server';

const PLACEHOLDER_ORIGIN = 'http://streamlivr.local';

/**
 * Bridges a Fastify request to the x402 HTTP adapter contract.
 *
 * This is the only Fastify-specific piece of the seller flow: the resource
 * server only ever sees headers, method, path, query params and body. Keeping
 * it in its own module lets the public reference server reuse it unchanged.
 */
export class FastifyAdapter implements HTTPAdapter {
  constructor(private readonly request: FastifyRequest) {}

  getHeader(name: string): string | undefined {
    const value = this.request.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  getMethod(): string {
    return this.request.method;
  }

  getPath(): string {
    return this.url().pathname;
  }

  getUrl(): string {
    return this.url().toString();
  }

  getAcceptHeader(): string {
    return this.getHeader('accept') ?? '';
  }

  getUserAgent(): string {
    return this.getHeader('user-agent') ?? '';
  }

  getQueryParams(): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const [key, value] of this.url().searchParams.entries()) {
      const current = result[key];
      result[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
    }
    return result;
  }

  getQueryParam(name: string): string | string[] | undefined {
    return this.getQueryParams()[name];
  }

  async getBody(): Promise<unknown> {
    return this.request.body;
  }

  private url(): URL {
    return new URL(this.request.url, PLACEHOLDER_ORIGIN);
  }
}
