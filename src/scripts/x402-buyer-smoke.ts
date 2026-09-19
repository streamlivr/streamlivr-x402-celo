import 'dotenv/config';
import { decodePaymentResponseHeader, x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CELO_X402_ASSETS, ERC8004_AGENT_ID, X402_ASSET_ADDRESS, X402_ASSET_SYMBOL, X402_CHAIN_ID, X402_NETWORK, X402_PAY_TO } from '../x402/config.js';
import { buildAttributionSuffix } from '../x402/attribution.js';
import { buildFeedbackDocument, chainFor, FEEDBACK_TAGS, giveFeedback, readReputationSnapshot } from '../x402/reputation.js';

/**
 * Optional second half of the canary: after a real settlement, leave ERC-8004
 * reputation for the agent with the same buyer wallet. Set X402_FEEDBACK=true.
 * The registry rejects feedback from the agent owner, so this only works
 * because the buyer key is a separate wallet.
 */
async function leaveFeedback(options: { account: ReturnType<typeof privateKeyToAccount>; rpcUrl: string; endpoint: string; amountAtomic: string; settlementTxHash: Hex }) {
  const agentIdRaw = ERC8004_AGENT_ID;
  if (!agentIdRaw || !/^\d+$/.test(agentIdRaw)) throw new Error('X402_FEEDBACK=true needs ERC8004_AGENT_ID set to the registered agent id');
  const chain = chainFor(X402_CHAIN_ID);
  const transport = http(options.rpcUrl);
  const wallet = createWalletClient({ account: options.account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  const feeCurrency =
    process.env.X402_BUYER_FEE_CURRENCY === 'none'
      ? undefined
      : ((process.env.X402_BUYER_FEE_CURRENCY as Address | undefined) ??
        (X402_CHAIN_ID === 42220 ? (CELO_X402_ASSETS.USDC.feeCurrencyAdapter as Address | undefined) : undefined));
  const feedback = buildFeedbackDocument({
    agentId: agentIdRaw,
    client: options.account.address,
    value: 100,
    valueDecimals: 0,
    tag1: FEEDBACK_TAGS.successRate,
    tag2: 'x402',
    endpoint: options.endpoint,
    settlementTxHash: options.settlementTxHash,
    payment: { network: X402_NETWORK, asset: X402_ASSET_SYMBOL, assetAddress: X402_ASSET_ADDRESS, amountAtomic: options.amountAtomic, payTo: X402_PAY_TO ?? '' },
    chainId: X402_CHAIN_ID,
  });
  const dataSuffix = buildAttributionSuffix();
  const hash = await giveFeedback({
    wallet,
    agentId: BigInt(agentIdRaw),
    value: 100,
    tag1: FEEDBACK_TAGS.successRate,
    tag2: 'x402',
    endpoint: options.endpoint,
    feedback,
    ...(dataSuffix ? { dataSuffix } : {}),
    ...(feeCurrency ? { feeCurrency } : {}),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const snapshot = await readReputationSnapshot(publicClient, BigInt(agentIdRaw), X402_CHAIN_ID);
  return { ok: receipt.status === 'success', txHash: hash, feedbackHash: feedback.hash, feeCurrency: feeCurrency ?? null, summary: snapshot.summary };
}

async function main() {
  const baseUrl = process.env.X402_BUYER_BASE_URL ?? 'http://localhost:3000';
  const privateKey = process.env.X402_BUYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('X402_BUYER_PRIVATE_KEY must be a 32-byte EVM private key (smoke test only)');

  const network = X402_NETWORK;
  const rpcUrl = process.env.X402_BUYER_RPC_URL ?? (network === 'eip155:42220' ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org');
  const asset = X402_ASSET_ADDRESS;
  const maxAmountPerPayment = process.env.X402_BUYER_MAX_ATOMIC ?? '10000';
  // Default is the unattributed liveness route. Point this at a creator route
  // (/api/v1/agent/listings, /catalog, /creator/:id) to exercise attribution.
  const paidPath = process.env.X402_BUYER_PATH ?? '/api/v1/agent/ping';
  const account = privateKeyToAccount(privateKey);
  const client = new x402Client().setSpendControls({ allowedAssets: [{ network, asset, maxAmountPerPayment }] });
  client.register(network, new ExactEvmScheme(account, { rpcUrl }));
  const paidFetch = wrapFetchWithPayment(fetch, client);

  const response = await paidFetch(`${baseUrl}${paidPath}`, { headers: { accept: 'application/json' } });
  const body = await response.text();
  if (!response.ok) throw new Error(`x402 buyer request failed (${response.status}): ${body}`);
  // A 200 alone does not prove settlement. Decode the settlement header so a
  // canary run fails loudly when no on-chain transfer actually happened.
  const settlementHeader = response.headers.get('payment-response');
  if (!settlementHeader) throw new Error('Paid response is missing the payment-response settlement header');
  const settlement = decodePaymentResponseHeader(settlementHeader);
  if (!settlement.success) throw new Error(`Facilitator reported an unsuccessful settlement: ${JSON.stringify(settlement)}`);
  if (!settlement.transaction || !/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction)) throw new Error(`Settlement header has no transaction hash: ${JSON.stringify(settlement)}`);
  const feedbackEnabled = process.env.X402_FEEDBACK === 'true' || process.env.X402_FEEDBACK === '1';
  const feedback = feedbackEnabled
    ? await leaveFeedback({
        account,
        rpcUrl,
        endpoint: `${process.env.X402_PUBLIC_BASE_URL ?? process.env.API_PUBLIC_URL ?? baseUrl}${paidPath}`,
        amountAtomic: String(settlement.amount ?? maxAmountPerPayment),
        settlementTxHash: settlement.transaction as Hex,
      })
    : undefined;
  console.log(JSON.stringify({ ok: true, payer: account.address, path: paidPath, network, assetSymbol: X402_ASSET_SYMBOL, asset, status: response.status, settlementTxHash: settlement.transaction, ...(feedback ? { feedback } : {}), body: JSON.parse(body) }, null, 2));
}

main().catch(console.error);
