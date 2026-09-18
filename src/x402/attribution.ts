import { toDataSuffix } from '@celo/attribution-tags';
import type { Hex } from 'viem';
import { X402_ATTRIBUTION_CODES, X402_ATTRIBUTION_TAG } from './config.js';

/**
 * ERC-8021 attribution for transactions Streamlivr sends itself.
 *
 * x402 settlements are broadcast by the facilitator relayer and cannot carry
 * our suffix, which is why the hackathon attributes those by registered agent
 * wallet instead. Everything the treasury signs directly - creator payouts,
 * agent registration - must carry the assigned tag, and the tag has to be in
 * the calldata at send time. There is no backfill.
 */
export function buildAttributionSuffix(codes: readonly string[] = X402_ATTRIBUTION_CODES): Hex | undefined {
  if (codes.length === 0) return undefined;
  return toDataSuffix(codes) as Hex;
}

/** True when an issued attribution tag is configured (own codes alone are not credited). */
export function hasIssuedAttributionTag(): boolean {
  return X402_ATTRIBUTION_TAG !== undefined;
}

/**
 * Decodes the suffix off raw calldata. Used by tests and by the ops script that
 * confirms the very first tagged transaction actually landed the code on-chain.
 */
export { fromDataSuffix, verifyTx } from '@celo/attribution-tags';
