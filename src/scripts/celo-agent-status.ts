/**
 * Prints what the Celo ERC-8004 registries currently hold for the Streamlivr
 * agent: the metadata document, the services it advertises, and the reputation
 * buyers have left.
 *
 *   npm run x402:agent-status
 *   npm run x402:agent-status -- --agent-id 9852
 *
 * Read only. Nothing is signed and no key is required.
 */
import 'dotenv/config';
import { createPublicClient, http } from 'viem';
import { ERC8004_AGENT_ID, X402_CHAIN_ID } from '../x402/config.js';
import { ERC8004_CONTRACTS, chainFor, erc8004NetworkFor, identityRegistryAbi, readReputationSnapshot } from '../x402/reputation.js';

export function decodeAgentUri(uri: string): unknown {
  if (uri.startsWith('data:application/json;base64,')) {
    return JSON.parse(Buffer.from(uri.slice('data:application/json;base64,'.length), 'base64').toString('utf8'));
  }
  if (uri.startsWith('data:application/json,')) {
    return JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)));
  }
  return { uri };
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const agentIdRaw = readFlag('agent-id') ?? ERC8004_AGENT_ID;
  if (!agentIdRaw || !/^\d+$/.test(agentIdRaw)) throw new Error('Pass --agent-id or set ERC8004_AGENT_ID');
  const agentId = BigInt(agentIdRaw);
  const chain = chainFor(X402_CHAIN_ID);
  const rpcUrl = process.env.CELO_RPC_URL ?? (X402_CHAIN_ID === 42220 ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org');
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const network = erc8004NetworkFor(X402_CHAIN_ID);
  const registries = ERC8004_CONTRACTS[network];

  const [owner, agentWallet, uri, reputation] = await Promise.all([
    client.readContract({ address: registries.identityRegistry, abi: identityRegistryAbi, functionName: 'ownerOf', args: [agentId] }),
    client.readContract({ address: registries.identityRegistry, abi: identityRegistryAbi, functionName: 'getAgentWallet', args: [agentId] }).catch(() => null),
    client.readContract({ address: registries.identityRegistry, abi: identityRegistryAbi, functionName: 'tokenURI', args: [agentId] }),
    readReputationSnapshot(client, agentId, X402_CHAIN_ID),
  ]);

  console.log(
    JSON.stringify(
      {
        agentId: agentIdRaw,
        network,
        chainId: X402_CHAIN_ID,
        identityRegistry: registries.identityRegistry,
        reputationRegistry: registries.reputationRegistry,
        owner,
        agentWallet,
        metadataUriPrefix: uri.slice(0, 32),
        metadata: decodeAgentUri(uri),
        reputation,
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
