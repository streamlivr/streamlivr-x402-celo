/**
 * ERC-8004 reputation for the Streamlivr agent.
 *
 * The Reputation Registry refuses feedback from the agent owner or any
 * authorized operator, so the agent cannot rate itself. Feedback is therefore
 * signed by the paying client wallet, which is the same wallet that signed the
 * x402 payment. The feedback document points back at the settlement
 * transaction, which makes every rating verifiable by anyone with an RPC.
 *
 * Contract: https://eips.ethereum.org/EIPS/eip-8004
 */
import { createPublicClient, http, keccak256, parseAbi, stringToHex, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from 'viem';
import { celo, celoSepolia } from 'viem/chains';

export type Erc8004Network = 'celo-mainnet' | 'celo-sepolia';

export const ERC8004_CONTRACTS: Record<Erc8004Network, { identityRegistry: Address; reputationRegistry: Address }> = {
  'celo-mainnet': {
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  },
  'celo-sepolia': {
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  },
};

export function erc8004NetworkFor(chainId: number): Erc8004Network {
  return chainId === 42220 ? 'celo-mainnet' : 'celo-sepolia';
}

export function chainFor(chainId: number) {
  return chainId === 42220 ? celo : celoSepolia;
}

/**
 * Function signatures copied from the verified Celo deployment. Note that
 * `tag1` and `tag2` are `string` on this deployment, not `bytes32`, and the
 * feedback index is a `uint64`.
 */
export const reputationRegistryAbi = parseAbi([
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'function revokeFeedback(uint256 agentId, uint64 feedbackIndex)',
  'function appendResponse(uint256 agentId, address clientAddress, uint64 feedbackIndex, string responseURI, bytes32 responseHash)',
  'function getClients(uint256 agentId) view returns (address[])',
  'function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)',
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
  'function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)',
  'function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revoked)',
]);

export const identityRegistryAbi = parseAbi([
  'function register(string agentURI) returns (uint256)',
  'function setAgentURI(uint256 agentId, string uri)',
  'function tokenURI(uint256 agentId) view returns (string)',
  'function ownerOf(uint256 agentId) view returns (address)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'function isAuthorizedOrOwner(address spender, uint256 agentId) view returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

/** Standard tags from the EIP, used for the feedback Streamlivr asks buyers to leave. */
export const FEEDBACK_TAGS = {
  /** 0 to 100 quality score. */
  starred: 'starred',
  /** Percentage of successful calls. */
  successRate: 'successRate',
  /** Percentage uptime. */
  uptime: 'uptime',
  /** Milliseconds to first byte. */
  responseTime: 'responseTime',
  /** Boolean reachability. */
  reachable: 'reachable',
} as const;

export interface FeedbackDocumentInput {
  agentId: string;
  client: Address;
  value: number;
  valueDecimals: number;
  tag1: string;
  tag2?: string;
  endpoint: string;
  settlementTxHash?: Hex;
  payment?: { network: string; asset: string; assetAddress: string; amountAtomic: string; payTo: string };
  chainId: number;
  createdAt?: string;
}

export interface FeedbackDocument {
  document: Record<string, unknown>;
  /** Canonical JSON the hash is taken over, so a verifier can reproduce it. */
  json: string;
  /** keccak256 of `json`, stored on-chain next to the URI. */
  hash: Hex;
  /** Self-contained `data:` URI, so the document cannot be edited after the fact. */
  uri: string;
}

/**
 * Builds the feedback document, its content hash, and a base64 `data:` URI.
 * The document carries the settlement transaction so a reader can check the
 * rating against the payment that earned it.
 */
export function buildFeedbackDocument(input: FeedbackDocumentInput): FeedbackDocument {
  const network = erc8004NetworkFor(input.chainId);
  const document = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#feedback-v1',
    agentId: input.agentId,
    agentRegistry: `eip155:${input.chainId}:${ERC8004_CONTRACTS[network].identityRegistry}`,
    reputationRegistry: ERC8004_CONTRACTS[network].reputationRegistry,
    client: input.client,
    value: input.value,
    valueDecimals: input.valueDecimals,
    tag1: input.tag1,
    ...(input.tag2 ? { tag2: input.tag2 } : {}),
    endpoint: input.endpoint,
    ...(input.settlementTxHash ? { settlementTxHash: input.settlementTxHash } : {}),
    ...(input.payment ? { payment: input.payment } : {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const json = JSON.stringify(document);
  return {
    document,
    json,
    hash: keccak256(stringToHex(json)),
    uri: `data:application/json;base64,${Buffer.from(json).toString('base64')}`,
  };
}

export interface ReputationSummary {
  /** Number of feedback entries counted. */
  count: number;
  /**
   * Mean feedback value. The registry returns an average, not a sum: it adds
   * every value in WAD precision, divides by the entry count, then scales back
   * to the most common decimal count.
   */
  average: number;
  /** Decimals the average is expressed in. */
  averageDecimals: number;
  /** Clients that have left feedback, which the registry requires for a summary. */
  clients: Address[];
}

export interface ReputationFeedback {
  client: Address;
  feedbackIndex: string;
  value: string;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  revoked: boolean;
}

export interface ReputationSnapshot {
  summary: ReputationSummary;
  feedback: ReputationFeedback[];
}

/** Reads the aggregate and every feedback entry a set of clients has left. */
export async function readReputationSnapshot<TTransport extends Transport, TChain extends Chain | undefined, TAccount extends Account | undefined>(
  client: PublicClient<TTransport, TChain, TAccount>,
  agentId: bigint,
  chainId: number,
  clients?: Address[],
  tags: { tag1?: string; tag2?: string } = {},
): Promise<ReputationSnapshot> {
  const registry = ERC8004_CONTRACTS[erc8004NetworkFor(chainId)].reputationRegistry;
  const clientList = clients && clients.length > 0 ? clients : ((await client.readContract({ address: registry, abi: reputationRegistryAbi, functionName: 'getClients', args: [agentId] })) as Address[]);
  const summary: ReputationSummary = { count: 0, average: 0, averageDecimals: 0, clients: clientList };
  if (clientList.length === 0) return { summary, feedback: [] };

  const [count, averageValue, averageDecimals] = (await client.readContract({
    address: registry,
    abi: reputationRegistryAbi,
    functionName: 'getSummary',
    args: [agentId, clientList, tags.tag1 ?? '', tags.tag2 ?? ''],
  })) as [bigint, bigint, number];

  const averageScale = Number(averageDecimals);
  const aggregate: ReputationSummary = {
    count: Number(count),
    average: count > 0n ? Number(averageValue) / 10 ** averageScale : 0,
    averageDecimals: averageScale,
    clients: clientList,
  };

  const [feedbackClients, indexes, values, decimals, tag1s, tag2s, revoked] = (await client.readContract({
    address: registry,
    abi: reputationRegistryAbi,
    functionName: 'readAllFeedback',
    args: [agentId, clientList, tags.tag1 ?? '', tags.tag2 ?? '', true],
  })) as [Address[], bigint[], bigint[], number[], string[], string[], boolean[]];

  return {
    summary: aggregate,
    feedback: feedbackClients.map((entryClient, index) => ({
      client: entryClient,
      feedbackIndex: (indexes[index] ?? 0n).toString(),
      value: (values[index] ?? 0n).toString(),
      valueDecimals: Number(decimals[index] ?? 0),
      tag1: tag1s[index] ?? '',
      tag2: tag2s[index] ?? '',
      revoked: revoked[index] ?? false,
    })),
  };
}

/**
 * Reads reputation for the configured chain. The client is built per branch so
 * viem keeps the chain type concrete; a union of chains loses its method types.
 */
export async function readReputation(agentId: bigint, chainId: number, rpcUrl?: string): Promise<ReputationSnapshot> {
  const transport = http(rpcUrl ?? (chainId === 42220 ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org'));
  return chainId === 42220
    ? readReputationSnapshot(createPublicClient({ chain: celo, transport }), agentId, chainId)
    : readReputationSnapshot(createPublicClient({ chain: celoSepolia, transport }), agentId, chainId);
}

export interface GiveFeedbackInput {
  wallet: WalletClient<Transport, Chain, Account>;
  agentId: bigint;
  value: number;
  valueDecimals?: number;
  tag1: string;
  tag2?: string;
  endpoint: string;
  feedback: FeedbackDocument;
  dataSuffix?: Hex;
  /** Optional Celo fee-currency adapter; leave unset to pay gas in CELO. */
  feeCurrency?: Address;
}

/** Sends the feedback transaction. The caller's wallet becomes the feedback client. */
export async function giveFeedback(input: GiveFeedbackInput): Promise<Hex> {
  const chainId = input.wallet.chain?.id;
  if (!chainId) throw new Error('Wallet client has no chain; pass a chain when creating it');
  const registry = ERC8004_CONTRACTS[erc8004NetworkFor(chainId)].reputationRegistry;
  return input.wallet.writeContract({
    address: registry,
    abi: reputationRegistryAbi,
    functionName: 'giveFeedback',
    args: [
      input.agentId,
      BigInt(input.value),
      input.valueDecimals ?? 0,
      input.tag1,
      input.tag2 ?? '',
      input.endpoint,
      input.feedback.uri,
      input.feedback.hash,
    ],
    ...(input.dataSuffix ? { dataSuffix: input.dataSuffix } : {}),
    ...(input.feeCurrency ? { feeCurrency: input.feeCurrency } : {}),
  });
}
