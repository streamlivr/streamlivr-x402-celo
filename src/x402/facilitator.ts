import { HTTPFacilitatorClient } from '@x402/core/server';
import { X402_API_KEY, X402_FACILITATOR_URL } from './config.js';

export function createX402Facilitator(): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url: X402_FACILITATOR_URL,
    createAuthHeaders: async () => {
      const headers = { 'X-API-Key': X402_API_KEY! };
      return { verify: headers, settle: headers, supported: headers };
    },
  });
}
