/**
 * Leaves ERC-8004 reputation feedback for the Streamlivr agent, signed by a
 * buyer wallet.
 *
 *   npm run x402:give-feedback -- --tx 0x<settlement hash> --endpoint https://api.streamlivr.com/api/v1/agent/ping
 *   npm run x402:give-feedback -- --revoke 1
 *
 * The Reputation Registry blocks feedback from the agent owner and from any
 * authorized operator, so this script must run with the buyer key
 * (`X402_BUYER_PRIVATE_KEY`), the same wallet that signed the x402 payment. The
 * feedback document embeds the settlement transaction, which lets anyone check
 * the rating against the payment behind it.
 */
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  CELO_X402_ASSETS,
  X402_ASSET_ADDRESS,
  X402_ASSET_SYMBOL,
  X402_CHAIN_ID,
  X402_NETWORK,
  X402_PAY_TO,
  ERC8004_AGENT_ID,
} from '../x402/config.js';
import { buildAttributionSuffix } from '../x402/attribution.js';
import { resolveDiscoveryBaseUrl } from '../x402/discovery.js';
import { buildFeedbackDocument, chainFor, erc8004NetworkFor, FEEDBACK_TAGS, giveFeedback, ERC8004_CONTRACTS, reputationRegistryAbi, readReputationSnapshot } from '../x402/reputation.js';

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const privateKey = process.env.X402_BUYER_PRIVATE_KEY as Hex | undefined;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('X402_BUYER_PRIVATE_KEY must be a 32-byte EVM private key for the wallet that paid');
  const agentIdRaw = readFlag('agent-id') ?? ERC8004_AGENT_ID;
  if (!agentIdRaw || !/^\d+$/.test(agentIdRaw)) throw new Error('Pass --agent-id or set ERC8004_AGENT_ID');
  const agentId = BigInt(agentIdRaw);

  const account = privateKeyToAccount(privateKey);
  const chain = chainFor(X402_CHAIN_ID);
  const rpcUrl = process.env.X402_BUYER_RPC_URL ?? (X402_CHAIN_ID === 42220 ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org');
  const transport = http(rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  const registry = ERC8004_CONTRACTS[erc8004NetworkFor(X402_CHAIN_ID)].reputationRegistry;
  const dataSuffix = buildAttributionSuffix();

  const revokeIndex = readFlag('revoke');
  if (revokeIndex) {
    if (!/^\d+$/.test(revokeIndex)) throw new Error('--revoke takes the feedback index printed by an earlier run');
    const hash = await wallet.writeContract({
      address: registry,
      abi: reputationRegistryAbi,
      functionName: 'revokeFeedback',
      args: [agentId, BigInt(revokeIndex)],
      ...(dataSuffix ? { dataSuffix } : {}),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(JSON.stringify({ ok: receipt.status === 'success', action: 'revokeFeedback', txHash: hash }, null, 2));
    return;
  }

  const endpoint = readFlag('endpoint') ?? `${resolveDiscoveryBaseUrl()}${readFlag('path') ?? '/api/v1/agent/ping'}`;
  const value = Number(readFlag('value') ?? '100');
  const tag1 = readFlag('tag') ?? FEEDBACK_TAGS.successRate;
  const settlementTxHash = readFlag('tx') as Hex | undefined;
  if (settlementTxHash && !/^0x[0-9a-fA-F]{64}$/.test(settlementTxHash)) throw new Error('--tx must be a 32-byte transaction hash');

  /**
   * Celo can charge the gas for this transaction in a stablecoin, which is the
   * point of fee abstraction: a buyer that only holds USDC can still leave
   * reputation. `--fee-currency none` forces the buyer to pay in CELO instead.
   */
  const feeCurrencyFlag = readFlag('fee-currency');
  const feeCurrency =
    feeCurrencyFlag === 'none'
      ? undefined
      : ((feeCurrencyFlag ?? process.env.X402_BUYER_FEE_CURRENCY) as Address | undefined) ??
        (X402_CHAIN_ID === 42220 ? (CELO_X402_ASSETS.USDC.feeCurrencyAdapter as Address | undefined) : undefined);

  const feedback = buildFeedbackDocument({
    agentId: agentIdRaw,
    client: account.address as Address,
    value,
    valueDecimals: 0,
    tag1,
    tag2: 'x402',
    endpoint,
    ...(settlementTxHash ? { settlementTxHash } : {}),
    payment: {
      network: X402_NETWORK,
      asset: X402_ASSET_SYMBOL,
      assetAddress: X402_ASSET_ADDRESS,
      amountAtomic: readFlag('amount-atomic') ?? '10000',
      payTo: X402_PAY_TO ?? '',
    },
    chainId: X402_CHAIN_ID,
  });

  const hash = await giveFeedback({
    wallet,
    agentId,
    value,
    tag1,
    tag2: 'x402',
    endpoint,
    feedback,
    ...(dataSuffix ? { dataSuffix } : {}),
    ...(feeCurrency ? { feeCurrency } : {}),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const snapshot = await readReputationSnapshot(publicClient, agentId, X402_CHAIN_ID);
  const explorer = X402_CHAIN_ID === 42220 ? `https://celo.blockscout.com/tx/${hash}` : `https://celo-sepolia.blockscout.com/tx/${hash}`;

  console.log(
    JSON.stringify(
      {
        ok: receipt.status === 'success',
        action: 'giveFeedback',
        client: account.address,
        agentId: agentIdRaw,
        registry,
        value,
        tag1,
        tag2: 'x402',
        endpoint,
        feedbackHash: feedback.hash,
        txHash: hash,
        explorer,
        summary: snapshot.summary,
        feedback: snapshot.feedback,
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
