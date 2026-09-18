import { z } from 'zod';

/**
 * Every asset the hosted Celo x402 facilitator can settle, with the exact
 * EIP-712 domain its `transferWithAuthorization` implementation expects.
 *
 * Source: https://x402.celo.org/api/config (paymentAssets, verified live).
 * USDT and USAT are mainnet-only; Sepolia settles USDC only. Do not add an
 * asset here without confirming it against the live config endpoint first.
 *
 * Fee-currency adapters are the Celo fee-abstraction contracts: USDC and USDT
 * are 6-decimal tokens, so they need an adapter that normalises to 18 decimals
 * before they can be used in the `feeCurrency` field. Source:
 * celopedia-skill/references/builder-guide.md -> Allowed Fee Currencies.
 */
export type X402AssetSymbol = 'USDC' | 'USDT' | 'USAT';

export interface X402AssetDefinition {
  symbol: X402AssetSymbol;
  decimals: 6;
  mainnet: `0x${string}`;
  testnet?: `0x${string}`;
  extra: { name: string; version: string; assetTransferMethod: 'eip3009' };
  feeCurrencyAdapter?: `0x${string}`;
}

export const CELO_X402_ASSETS: Record<X402AssetSymbol, X402AssetDefinition> = {
  USDC: {
    symbol: 'USDC',
    decimals: 6,
    mainnet: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    testnet: '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
    extra: { name: 'USDC', version: '2', assetTransferMethod: 'eip3009' },
    feeCurrencyAdapter: '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B',
  },
  USDT: {
    symbol: 'USDT',
    decimals: 6,
    mainnet: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    extra: { name: 'Tether USD', version: '1', assetTransferMethod: 'eip3009' },
    feeCurrencyAdapter: '0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72',
  },
  USAT: {
    symbol: 'USAT',
    decimals: 6,
    mainnet: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771',
    extra: { name: 'Tether America USD', version: '1', assetTransferMethod: 'eip3009' },
    feeCurrencyAdapter: '0x0357EE22278c922e1D36cFe6b899269b161880C4',
  },
};

export interface ResolvedX402Asset {
  symbol: X402AssetSymbol;
  address: `0x${string}`;
  decimals: 6;
  extra: { name: string; version: string; assetTransferMethod: 'eip3009' };
}

/** Resolves one asset for one network, failing closed on any mismatch. */
export function resolveX402Asset(
  network: 'testnet' | 'mainnet',
  symbol: X402AssetSymbol,
  addressOverride?: string,
): ResolvedX402Asset {
  const definition = CELO_X402_ASSETS[symbol];
  const canonical = network === 'mainnet' ? definition.mainnet : definition.testnet;
  if (!canonical) {
    throw new Error(
      `${symbol} is not settled on Celo ${network}. The hosted facilitator settles USDC on Sepolia and USDC/USDT/USAT on mainnet.`,
    );
  }
  const address = (addressOverride ?? canonical) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`X402 asset address is not a valid EVM address: ${address}`);
  if (address.toLowerCase() !== canonical.toLowerCase()) {
    throw new Error(`${symbol} on Celo ${network} must use the canonical address ${canonical}, received ${address}`);
  }
  return { symbol, address: canonical, decimals: definition.decimals, extra: definition.extra };
}

const TAG_PATTERN = /^[a-z0-9_]{1,32}$/;

/**
 * An env var that exists but is blank (`X402_ATTRIBUTION_TAG=`) means the same
 * as an absent one. Treating the blank as a value made the API refuse to boot,
 * which is what happens between copying .env.example and registering a tag.
 */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = z.preprocess(blankToUndefined, z.string().trim().optional());
const optionalNumber = z.preprocess(blankToUndefined, z.coerce.number().int().optional());

export const x402Env = z.object({
  X402_ENABLED: z.string().default('false').transform((v) => v === 'true' || v === '1'),
  X402_NETWORK: z.preprocess(blankToUndefined, z.enum(['testnet', 'mainnet']).default('testnet')),
  X402_API_KEY: optionalText,
  X402_PAY_TO: optionalText,
  /** Canonical settlement asset. USDT/USAT are mainnet-only. */
  X402_SETTLEMENT_ASSET: z.preprocess(
    blankToUndefined,
    z.enum(['USDC', 'USDT', 'USAT']).default('USDC'),
  ),
  /** Optional explicit asset address; must match the canonical address for asset + network. */
  X402_ASSET_ADDRESS: optionalText,
  /** Deprecated alias kept for existing deployments; only valid for USDC. */
  X402_USDC_ADDRESS: optionalText,
  X402_CHAIN_ID: optionalNumber,
  X402_ASSET_DECIMALS: z.preprocess(blankToUndefined, z.coerce.number().int().default(6)),
  X402_PING_PRICE_ATOMIC: z.preprocess(
    blankToUndefined,
    z.string().regex(/^\d+$/).default('10000'),
  ),
  /**
   * ERC-8021 attribution. `X402_ATTRIBUTION_TAG` is the code issued by a
   * programme (for example the Agents at Work hackathon); `X402_ATTRIBUTION_CODES`
   * holds codes the project already uses. The issued tag is always encoded last:
   * programme leaderboards credit only that code.
   */
  X402_ATTRIBUTION_TAG: z.preprocess(
    blankToUndefined,
    z.string().trim().regex(TAG_PATTERN).optional(),
  ),
  X402_ATTRIBUTION_CODES: optionalText,
  /**
   * Local-only: lets payout routes mark a creator KYC-verified without a Busha
   * customer. x402/kyc.ts refuses to honour it in a production-configured
   * process, so it cannot reach a live deployment even if left in an env file.
   */
  X402_LOCAL_KYC_OVERRIDE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /** `auto` resolves the fee-abstraction adapter for the settlement asset. */
  X402_FEE_CURRENCY: optionalText,
});

const parsed = x402Env.parse(process.env);

export const X402_CHAIN_ID = parsed.X402_CHAIN_ID ?? (parsed.X402_NETWORK === 'mainnet' ? 42220 : 11142220);
export const X402_NETWORK = parsed.X402_NETWORK === 'mainnet' ? 'eip155:42220' : 'eip155:11142220';
export const X402_FACILITATOR_URL =
  parsed.X402_NETWORK === 'mainnet'
    ? 'https://api.x402.celo.org'
    : 'https://api.x402.sepolia.celo.org';
export const X402_ASSET_SYMBOL = parsed.X402_SETTLEMENT_ASSET;
export const X402_ASSET = resolveX402Asset(
  parsed.X402_NETWORK,
  parsed.X402_SETTLEMENT_ASSET,
  parsed.X402_ASSET_ADDRESS ?? (parsed.X402_SETTLEMENT_ASSET === 'USDC' ? parsed.X402_USDC_ADDRESS : undefined),
);
export const X402_ASSET_ADDRESS = X402_ASSET.address;
export const X402_ASSET_DECIMALS = parsed.X402_ASSET_DECIMALS;
export const X402_ASSET_EXTRA = X402_ASSET.extra;
export const X402_PAY_TO = parsed.X402_PAY_TO;
export const X402_ENABLED = parsed.X402_ENABLED;
export const X402_PING_PRICE_ATOMIC = parsed.X402_PING_PRICE_ATOMIC;
export const X402_API_KEY = parsed.X402_API_KEY;

function parseAttributionCodes(): string[] {
  const own = (parsed.X402_ATTRIBUTION_CODES ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  for (const code of [...own, ...(parsed.X402_ATTRIBUTION_TAG ? [parsed.X402_ATTRIBUTION_TAG] : [])]) {
    if (!TAG_PATTERN.test(code)) throw new Error(`Invalid ERC-8021 attribution code "${code}" (expected [a-z0-9_], 1-32 chars)`);
  }
  return parsed.X402_ATTRIBUTION_TAG
    ? [...own.filter((code) => code !== parsed.X402_ATTRIBUTION_TAG), parsed.X402_ATTRIBUTION_TAG]
    : own;
}

export const X402_ATTRIBUTION_CODES: readonly string[] = parseAttributionCodes();
export const X402_ATTRIBUTION_TAG = parsed.X402_ATTRIBUTION_TAG;
/** Raw opt-in flag; `x402/kyc.ts` adds the production refusal. */
export const X402_LOCAL_KYC_OVERRIDE = parsed.X402_LOCAL_KYC_OVERRIDE;

type ParsedX402Env = z.infer<typeof x402Env>;

export function parseFeeCurrency(
  env: Pick<ParsedX402Env, 'X402_FEE_CURRENCY' | 'X402_NETWORK' | 'X402_SETTLEMENT_ASSET'> = parsed,
): `0x${string}` | undefined {
  const raw = env.X402_FEE_CURRENCY;
  if (!raw || raw === 'none') return undefined;
  if (raw === 'auto') {
    if (env.X402_NETWORK !== 'mainnet') {
      throw new Error(
        'X402_FEE_CURRENCY=auto resolves mainnet fee-currency adapters. On Sepolia leave it unset and fund the treasury with a little testnet CELO for gas.',
      );
    }
    const adapter = CELO_X402_ASSETS[env.X402_SETTLEMENT_ASSET].feeCurrencyAdapter;
    if (!adapter) throw new Error(`No documented Celo fee-currency adapter for ${env.X402_SETTLEMENT_ASSET}; set X402_FEE_CURRENCY explicitly or leave it unset`);
    return adapter;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error('X402_FEE_CURRENCY must be an EVM address, "auto", or unset');
  return raw as `0x${string}`;
}

export const X402_FEE_CURRENCY = parseFeeCurrency();

export function assertX402Configuration(): void {
  if (!X402_ENABLED) return;
  if (!X402_API_KEY) throw new Error('X402_API_KEY is required when X402_ENABLED=true');
  if (!X402_PAY_TO || !/^0x[0-9a-fA-F]{40}$/.test(X402_PAY_TO)) {
    throw new Error('X402_PAY_TO must be a valid Celo EVM address');
  }
  if (X402_CHAIN_ID !== (X402_NETWORK === 'eip155:42220' ? 42220 : 11142220)) {
    throw new Error(`X402_CHAIN_ID does not match ${X402_NETWORK}`);
  }
  if (X402_ASSET_DECIMALS !== 6) throw new Error(`${X402_ASSET_SYMBOL} on Celo must use 6 decimals`);
}
