import 'dotenv/config';
import { decodePaymentResponseHeader, x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { X402_ASSET_ADDRESS, X402_ASSET_SYMBOL, X402_NETWORK } from '../x402/config.js';

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
  console.log(JSON.stringify({ ok: true, payer: account.address, path: paidPath, network, assetSymbol: X402_ASSET_SYMBOL, asset, status: response.status, settlementTxHash: settlement.transaction, body: JSON.parse(body) }, null, 2));
}

main().catch(console.error);
