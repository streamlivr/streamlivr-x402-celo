/**
 * Registers the Streamlivr agent in the ERC-8004 Identity Registry on Celo and
 * prints the agent ID URL the hackathon asks for at registration.
 *
 *   npm run x402:register-agent
 *
 * The registration transaction carries the ERC-8021 attribution tag, because
 * Streamlivr signs it itself (x402 settlements cannot: the facilitator relayer
 * broadcasts those). Metadata follows the current spec shape the 8004 validator
 * expects: the versioned `type` URI, `services` (not `endpoints`), and an
 * `endpoint` field per service.
 *
 * The URI is a base64 `data:` document so registration needs no IPFS pinning
 * step and the metadata cannot be silently mutated afterwards.
 */
import 'dotenv/config';
import { createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo, celoSepolia } from 'viem/chains';
import { buildAttributionSuffix, verifyTx } from '../x402/attribution.js';
import { X402_ATTRIBUTION_TAG, X402_NETWORK } from '../x402/config.js';

const identityRegistryAbi = parseAbi([
  'function register(string agentURI) returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const IDENTITY_REGISTRY = {
  mainnet: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  sepolia: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
} as const;

const REGISTRATION_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';

interface ServiceEntry {
  name: string;
  endpoint: string;
}

function buildAgentMetadata(): string {
  const services: ServiceEntry[] = [];
  if (process.env.AGENT_SERVICE_URL) services.push({ name: 'web', endpoint: process.env.AGENT_SERVICE_URL });
  if (process.env.AGENT_A2A_URL) services.push({ name: 'A2A', endpoint: process.env.AGENT_A2A_URL });
  if (process.env.AGENT_MCP_URL) services.push({ name: 'MCP', endpoint: process.env.AGENT_MCP_URL });
  if (services.length === 0) {
    throw new Error('Set at least one of AGENT_SERVICE_URL, AGENT_A2A_URL, or AGENT_MCP_URL so the agent has a resolvable service endpoint');
  }
  const metadata = {
    type: REGISTRATION_TYPE,
    name: process.env.AGENT_NAME ?? 'Streamlivr',
    description:
      process.env.AGENT_DESCRIPTION ??
      'Streamlivr pays creators over x402 on Celo. Agents can discover opted-in creator listings, catalogs, and profiles, and every settled payment is attributed back to the creators who supplied the data.',
    ...(process.env.AGENT_IMAGE ? { image: process.env.AGENT_IMAGE } : {}),
    services,
    supportedTrust: ['reputation'],
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;
}

async function main() {
  const privateKey = (process.env.CELO_AGENT_REGISTRATION_PRIVATE_KEY ?? process.env.X402_TREASURY_PRIVATE_KEY) as Hex | undefined;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('Set CELO_AGENT_REGISTRATION_PRIVATE_KEY (or X402_TREASURY_PRIVATE_KEY) to a funded Celo key');
  }
  const chain = X402_NETWORK === 'eip155:42220' ? celo : celoSepolia;
  const rpcUrl = process.env.CELO_RPC_URL ?? (chain === celo ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org');
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  const agentURI = buildAgentMetadata();
  const dataSuffix = buildAttributionSuffix();
  console.log(JSON.stringify({ step: 'register', network: X402_NETWORK, owner: account.address, registry: IDENTITY_REGISTRY[chain === celo ? 'mainnet' : 'sepolia'], attributionTag: X402_ATTRIBUTION_TAG ?? null }, null, 2));

  const hash = await wallet.writeContract({
    address: IDENTITY_REGISTRY[chain === celo ? 'mainnet' : 'sepolia'],
    abi: identityRegistryAbi,
    functionName: 'register',
    args: [agentURI],
    ...(dataSuffix ? { dataSuffix } : {}),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Agent registration reverted: ${hash}`);

  let agentId: bigint | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== IDENTITY_REGISTRY[chain === celo ? 'mainnet' : 'sepolia'].toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: identityRegistryAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === 'Transfer') agentId = decoded.args.tokenId as bigint;
    } catch {
      // Not the event we are looking for; the registry emits other logs too.
    }
  }
  if (agentId === null) throw new Error('Registration succeeded but no ERC-721 Transfer event was found; read the agent ID from the explorer');

  const verified = await verifyTx({ client: publicClient, hash });
  const agentIdUrl =
    chain === celo
      ? `https://8004scan.io/agents/celo/${agentId}`
      : `https://celoscan.io/nft/${IDENTITY_REGISTRY.sepolia}/${agentId}`;
  console.log(
    JSON.stringify(
      {
        ok: true,
        txHash: hash,
        agentId: agentId.toString(),
        agentIdUrl,
        attribution: verified,
        note: 'Paste agentIdUrl into the hackathon registration. The tx hash above is public: keep it for the submission.',
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
