/**
 * Confirms an ERC-8021 attribution code actually landed on-chain.
 *
 *   npm run x402:verify-attribution -- 0x<txHash>
 *
 * Run it on the first tagged transaction. A 200 response or a successful write
 * is not proof: some relayers rewrite calldata and strip trailing bytes, and the
 * only way to know is to decode the transaction back off the chain.
 */
import 'dotenv/config';
import { createPublicClient, http } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { verifyTx } from '../x402/attribution.js';
import { X402_ATTRIBUTION_TAG, X402_NETWORK } from '../x402/config.js';

async function main() {
  const hash = process.argv[2] as `0x${string}` | undefined;
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Usage: npm run x402:verify-attribution -- 0x<32-byte tx hash>');
  const chain = X402_NETWORK === 'eip155:42220' ? celo : celoSepolia;
  const client = createPublicClient({
    chain,
    transport: http(process.env.CELO_RPC_URL ?? (chain === celo ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org')),
  });
  const decoded = await verifyTx({ client, hash });
  if (!decoded) {
    console.log(JSON.stringify({ ok: false, hash, reason: 'No ERC-8021 suffix on this transaction' }, null, 2));
    process.exitCode = 1;
    return;
  }
  const credited = X402_ATTRIBUTION_TAG ? decoded.codes.includes(X402_ATTRIBUTION_TAG) : null;
  console.log(
    JSON.stringify(
      {
        ok: credited !== false,
        hash,
        codes: decoded.codes,
        schemaId: decoded.schemaId,
        assignedTag: X402_ATTRIBUTION_TAG ?? null,
        assignedTagPresent: credited,
      },
      null,
      2,
    ),
  );
  if (credited === false) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
