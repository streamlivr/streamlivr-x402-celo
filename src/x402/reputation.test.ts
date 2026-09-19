import { describe, expect, it, vi } from 'vitest';
import { keccak256, stringToHex } from 'viem';
import { buildFeedbackDocument, erc8004NetworkFor, ERC8004_CONTRACTS, reputationRegistryAbi, readReputationSnapshot } from './reputation.js';

const buyer = '0xf5Fe75828381b7E4881E8a5aB4575868A801038c' as const;
const settlementTxHash = `0x${'cd'.repeat(32)}` as const;

describe('ERC-8004 registry addresses', () => {
  it('maps chain ids to the published Celo registries', () => {
    expect(erc8004NetworkFor(42220)).toBe('celo-mainnet');
    expect(erc8004NetworkFor(11142220)).toBe('celo-sepolia');
    expect(ERC8004_CONTRACTS['celo-mainnet'].identityRegistry).toBe('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432');
    expect(ERC8004_CONTRACTS['celo-mainnet'].reputationRegistry).toBe('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63');
  });

  it('matches the deployed giveFeedback signature, where both tags are strings', () => {
    const giveFeedback = reputationRegistryAbi.find((entry) => entry.type === 'function' && entry.name === 'giveFeedback');
    expect(giveFeedback?.inputs.map((input) => input.type)).toEqual([
      'uint256',
      'int128',
      'uint8',
      'string',
      'string',
      'string',
      'string',
      'bytes32',
    ]);
  });
});

describe('feedback document', () => {
  const feedback = buildFeedbackDocument({
    agentId: '9852',
    client: buyer,
    value: 100,
    valueDecimals: 0,
    tag1: 'successRate',
    tag2: 'x402',
    endpoint: 'https://api.streamlivr.com/api/v1/agent/ping',
    settlementTxHash,
    payment: {
      network: 'eip155:42220',
      asset: 'USDC',
      assetAddress: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      amountAtomic: '10000',
      payTo: '0x4503F32dFF9e54Ee4c0Fd9BE25bCC662abB4c4Bf',
    },
    chainId: 42220,
    createdAt: '2026-09-18T00:00:00.000Z',
  });

  it('hashes exactly the JSON it publishes', () => {
    expect(feedback.hash).toBe(keccak256(stringToHex(feedback.json)));
    const decoded = JSON.parse(Buffer.from(feedback.uri.split(',')[1]!, 'base64').toString('utf8'));
    expect(decoded).toEqual(feedback.document);
    expect(decoded.settlementTxHash).toBe(settlementTxHash);
    expect(decoded.agentRegistry).toBe('eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432');
  });

  it('changes the hash when any field changes', () => {
    const other = buildFeedbackDocument({
      agentId: '9852',
      client: buyer,
      value: 50,
      valueDecimals: 0,
      tag1: 'starred',
      endpoint: 'https://api.streamlivr.com/api/v1/agent/ping',
      chainId: 42220,
      createdAt: '2026-09-18T00:00:00.000Z',
    });
    expect(other.hash).not.toBe(feedback.hash);
    expect(other.document.tag2).toBeUndefined();
  });
});

describe('readReputationSnapshot', () => {
  const registry = ERC8004_CONTRACTS['celo-mainnet'].reputationRegistry;

  function fakeClient(overrides: Record<string, unknown> = {}) {
    return {
      readContract: vi.fn(async (args: { functionName: string }) => {
        if (args.functionName === 'getClients') return overrides.getClients ?? [buyer];
        // The registry returns the average and the entry count, not a sum.
        if (args.functionName === 'getSummary') return overrides.getSummary ?? [2n, 95n, 0];
        if (args.functionName === 'readAllFeedback') {
          return overrides.readAllFeedback ?? [[buyer, buyer], [1n, 2n], [90n, 100n], [0, 0], ['successRate', 'starred'], ['x402', 'x402'], [false, false]];
        }
        throw new Error(`unexpected call ${args.functionName}`);
      }),
    };
  }

  it('aggregates the summary and lists every entry', async () => {
    const client = fakeClient();
    const snapshot = await readReputationSnapshot(client as never, 9852n, 42220);
    expect(snapshot.summary).toMatchObject({ count: 2, average: 95, averageDecimals: 0, clients: [buyer] });
    expect(snapshot.feedback).toHaveLength(2);
    expect(snapshot.feedback[1]).toMatchObject({ value: '100', tag1: 'starred', revoked: false });
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: registry, functionName: 'getSummary', args: [9852n, [buyer], '', ''] }));
  });

  it('skips the registry call when nobody has left feedback', async () => {
    const client = fakeClient({ getClients: [] });
    const snapshot = await readReputationSnapshot(client as never, 9852n, 42220);
    expect(snapshot).toEqual({ summary: { count: 0, average: 0, averageDecimals: 0, clients: [] }, feedback: [] });
    expect(client.readContract).toHaveBeenCalledTimes(1);
  });

  it('scales the average by the decimals the registry reports', async () => {
    const client = fakeClient({ getSummary: [3n, 950n, 1] });
    const snapshot = await readReputationSnapshot(client as never, 9852n, 42220);
    expect(snapshot.summary).toMatchObject({ count: 3, average: 95, averageDecimals: 1 });
  });

  it('tolerates short arrays from the registry', async () => {
    const client = fakeClient({ readAllFeedback: [[buyer], [], [], [], [], [], []] });
    const snapshot = await readReputationSnapshot(client as never, 9852n, 42220);
    expect(snapshot.feedback[0]).toMatchObject({ feedbackIndex: '0', value: '0', valueDecimals: 0, tag1: '', revoked: false });
  });
});
