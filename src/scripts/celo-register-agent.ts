/**
 * Registers the Streamlivr agent in the ERC-8004 Identity Registry on Celo, or
 * updates the metadata of an agent that is already registered.
 *
 *   npm run x402:register-agent              # first registration, prints the agent id
 *   npm run x402:register-agent -- --update 9852
 *   npm run x402:register-agent -- --update 9852 --dry-run
 *
 * The metadata comes from `x402/discovery.ts`, the same module the API serves
 * at `/.well-known/agent.json` and `/.well-known/mcp.json`. The services array
 * therefore lists the paid routes the server actually settles, and it cannot
 * drift from the running code.
 *
 * A registration transaction carries the ERC-8021 attribution tag, because
 * Streamlivr signs it itself. x402 settlements cannot: the facilitator relayer
 * broadcasts those.
 *
 * The URI is a base64 `data:` document, so registration needs no IPFS pinning
 * step and the metadata cannot be silently mutated afterwards.
 */
import 'dotenv/config';
import { createPublicClient, createWalletClient, decodeEventLog, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo, celoSepolia } from 'viem/chains';
import { buildAttributionSuffix, verifyTx } from '../x402/attribution.js';
import { X402_ATTRIBUTION_TAG, X402_CHAIN_ID, X402_NETWORK } from '../x402/config.js';
import { buildAgentMetadata, currentDiscoveryContext, toDataUri } from '../x402/discovery.js';
import { ERC8004_CONTRACTS, erc8004NetworkFor, identityRegistryAbi } from '../x402/reputation.js';

function readAgentIdArgument(): bigint | null {
  const index = process.argv.findIndex((value) => value === '--update' || value === '--agent-id');
  if (index === -1) return null;
  const raw = process.argv[index + 1] ?? process.env.ERC8004_AGENT_ID;
  if (!raw || !/^\d+$/.test(raw)) throw new Error('--update needs an ERC-8004 agent id, for example: --update 9852');
  return BigInt(raw);
}

/** `--dry-run` prints the exact document and exits before any transaction is signed. */
function isDryRun(): boolean {
  return process.argv.includes('--dry-run');
}

async function main() {
  const privateKey = (process.env.CELO_AGENT_REGISTRATION_PRIVATE_KEY ?? process.env.X402_TREASURY_PRIVATE_KEY) as Hex | undefined;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('Set CELO_AGENT_REGISTRATION_PRIVATE_KEY (or X402_TREASURY_PRIVATE_KEY) to a funded Celo key');
  }
  const chain = X402_CHAIN_ID === 42220 ? celo : celoSepolia;
  const rpcUrl = process.env.CELO_RPC_URL ?? (chain === celo ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org');
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  const updateAgentId = readAgentIdArgument();
  const context = currentDiscoveryContext({
    agentId: updateAgentId ? updateAgentId.toString() : null,
    chainId: X402_CHAIN_ID,
    networkName: erc8004NetworkFor(X402_CHAIN_ID),
  });
  const metadata = buildAgentMetadata({ ...context, ...(process.env.AGENT_IMAGE ? { image: process.env.AGENT_IMAGE } : {}) });
  const agentURI = toDataUri(metadata);
  const registry = ERC8004_CONTRACTS[erc8004NetworkFor(X402_CHAIN_ID)].identityRegistry;
  const dataSuffix = buildAttributionSuffix();

  if (isDryRun()) {
    console.log(JSON.stringify({ dryRun: true, step: updateAgentId ? 'setAgentURI' : 'register', owner: account.address, registry, agentURI, metadata }, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        step: updateAgentId ? 'setAgentURI' : 'register',
        network: X402_NETWORK,
        owner: account.address,
        registry,
        attributionTag: X402_ATTRIBUTION_TAG ?? null,
        services: (metadata.services as { name: string; endpoint: string }[]).map((service) => service.name),
      },
      null,
      2,
    ),
  );

  const hash = updateAgentId
    ? await wallet.writeContract({ address: registry, abi: identityRegistryAbi, functionName: 'setAgentURI', args: [updateAgentId, agentURI], ...(dataSuffix ? { dataSuffix } : {}) })
    : await wallet.writeContract({ address: registry, abi: identityRegistryAbi, functionName: 'register', args: [agentURI], ...(dataSuffix ? { dataSuffix } : {}) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Agent ${updateAgentId ? 'metadata update' : 'registration'} reverted: ${hash}`);

  let agentId = updateAgentId;
  if (agentId === null) {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: identityRegistryAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === 'Transfer') agentId = decoded.args.tokenId as bigint;
      } catch {
        // The registry emits other logs too; only the ERC-721 transfer carries the id.
      }
    }
  }
  if (agentId === null) throw new Error('Transaction succeeded but no ERC-721 Transfer event was found; read the agent id from the explorer');

  const verified = await verifyTx({ client: publicClient, hash });
  const agentIdUrl =
    chain === celo
      ? `https://8004scan.io/agents/celo/${agentId}`
      : `https://celoscan.io/nft/${registry}/${agentId}`;
  console.log(
    JSON.stringify(
      {
        ok: true,
        txHash: hash,
        agentId: agentId.toString(),
        agentIdUrl,
        metadataUri: agentURI,
        attribution: verified,
        next: updateAgentId
          ? 'Metadata updated. The discovery documents at /.well-known/agent.json and /mcp now match the on-chain record.'
          : 'Set ERC8004_AGENT_ID in backend/.env to the agent id above, then restart the API.',
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
