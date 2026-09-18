import { describe, expect, it } from 'vitest';
import { concat, decodeFunctionData, encodeFunctionData } from 'viem';
import { fromDataSuffix } from '@celo/attribution-tags';
import { buildAttributionSuffix } from './attribution.js';
import { BPS_DENOMINATOR, CREATOR_SHARE_BPS, PLATFORM_SHARE_BPS, calculateAttributionShares } from './split.js';

const erc20 = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

describe('calculateAttributionShares', () => {
  it('splits 60/40 between creators and the platform', () => {
    expect(CREATOR_SHARE_BPS + PLATFORM_SHARE_BPS).toBe(BPS_DENOMINATOR);
    const shares = calculateAttributionShares('10000', ['creator-a']);
    expect(shares).toEqual([{ creatorId: 'creator-a', shareAtomic: '6000', shareBps: 6000 }]);
  });

  it('deduplicates creators and hands the remainder out in response order', () => {
    const shares = calculateAttributionShares('10001', ['creator-a', 'creator-b', 'creator-a']);
    expect(shares.map((share) => share.creatorId)).toEqual(['creator-a', 'creator-b']);
    // 10001 * 6000 / 10000 = 6000 (floor), split two ways = 3000 each, remainder 0.
    expect(shares.map((share) => share.shareAtomic)).toEqual(['3000', '3000']);

    const uneven = calculateAttributionShares('10007', ['a', 'b', 'c']);
    // 10007 * 6000 / 10000 = 6004 atomic, split three ways: 2002/2001/2001.
    expect(uneven.map((share) => share.shareAtomic)).toEqual(['2002', '2001', '2001']);
    expect(uneven.reduce((sum, share) => sum + BigInt(share.shareAtomic), 0n)).toBe(6004n);
  });

  it('returns nothing when an endpoint produced no consenting creators', () => {
    expect(calculateAttributionShares('10000', [])).toEqual([]);
  });
});

describe('buildAttributionSuffix', () => {
  it('returns undefined when no code is configured', () => {
    expect(buildAttributionSuffix([])).toBeUndefined();
  });

  it('encodes every configured code and decodes back, with the issued tag last', () => {
    const suffix = buildAttributionSuffix(['streamlivr', 'celo_abc123def456']);
    expect(suffix).toBeDefined();
    const decoded = fromDataSuffix(suffix!);
    expect(decoded?.codes).toEqual(['streamlivr', 'celo_abc123def456']);
  });

  it('appends the suffix after real transfer calldata without changing the call', () => {
    const call = encodeFunctionData({ abi: erc20, functionName: 'transfer', args: ['0x1111111111111111111111111111111111111111', 1_000_000n] });
    const tagged = concat([call, buildAttributionSuffix(['celo_abc123def456'])!]);

    // The ERC-8021 marker is on the wire, the token contract still sees only its
    // own calldata, and the transfer arguments decode unchanged.
    expect(tagged.toLowerCase()).toContain('80218021802180218021802180218021');
    expect(tagged.startsWith(call)).toBe(true);
    const decoded = decodeFunctionData({ abi: erc20, data: call });
    expect(decoded.args).toEqual(['0x1111111111111111111111111111111111111111', 1_000_000n]);
    expect(fromDataSuffix(`0x${tagged.slice(call.length)}` as `0x${string}`)?.codes).toEqual(['celo_abc123def456']);
  });

  it('rejects codes outside the ERC-8021 charset instead of writing an unattributable suffix', () => {
    expect(() => buildAttributionSuffix(['Not_Valid'])).toThrow();
  });
});
