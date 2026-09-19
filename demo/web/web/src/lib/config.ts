/**
 * Demo configuration.
 *
 * The demo pays real x402 invoices from a single shared burner wallet. That key
 * ships in the browser bundle by design: it is a burner, it should only ever
 * hold a few dollars, and the spend caps below are the actual protection. Treat
 * anything in here as public.
 */

export type NetworkKey = 'sepolia' | 'mainnet';

export interface NetworkProfile {
  key: NetworkKey;
  label: string;
  chainId: number;
  /** CAIP-2 identifier, the value x402 puts in `accepts[].network`. */
  caip2: string;
  rpcUrl: string;
  explorer: string;
  /** Canonical Celo USDC address; the demo reads the real asset from the invoice anyway. */
  usdc: `0x${string}`;
  isTestnet: boolean;
  faucet?: string;
}

export const NETWORKS: Record<NetworkKey, NetworkProfile> = {
  sepolia: {
    key: 'sepolia',
    label: 'Celo Sepolia',
    chainId: 11142220,
    caip2: 'eip155:11142220',
    rpcUrl: 'https://forno.celo-sepolia.celo-testnet.org',
    explorer: 'https://celo-sepolia.blockscout.com',
    usdc: '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
    isTestnet: true,
    faucet: 'https://faucet.circle.com',
  },
  mainnet: {
    key: 'mainnet',
    label: 'Celo',
    chainId: 42220,
    caip2: 'eip155:42220',
    rpcUrl: 'https://forno.celo.org',
    explorer: 'https://celo.blockscout.com',
    usdc: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    isTestnet: false,
  },
};

/** The backend the demo talks to. Prod by default; override for local work. */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.streamlivr.com').replace(/\/$/, '');

/**
 * Burner key. Set NEXT_PUBLIC_BURNER_PRIVATE_KEY to rotate it; the fallback is
 * the committed demo burner, which is why the caps matter.
 */
export const BURNER_PRIVATE_KEY = (process.env.NEXT_PUBLIC_BURNER_PRIVATE_KEY ?? '').trim() as
  | `0x${string}`
  | '';

export const BURNER_LABEL = process.env.NEXT_PUBLIC_BURNER_LABEL ?? 'demo burner';

/** Hard ceiling on a single payment, in atomic units of the settlement asset. */
export const MAX_ATOMIC_PER_REQUEST = Number(process.env.NEXT_PUBLIC_MAX_ATOMIC_PER_REQUEST ?? '10000');

/** Ceiling for one browser session, so a loop cannot drain the burner. */
export const MAX_ATOMIC_PER_SESSION = Number(process.env.NEXT_PUBLIC_MAX_ATOMIC_PER_SESSION ?? '200000');

/** Mainnet stays off unless it is explicitly enabled at build time. */
export const MAINNET_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MAINNET === 'true';

export const NETWORK_ORDER: NetworkKey[] = MAINNET_ENABLED ? ['sepolia', 'mainnet'] : ['sepolia'];

export const SETTLEMENT_DECIMALS = 6;

/** Truncated address for display; never render a full key anywhere. */
export function shortAddress(address: string, size = 4): string {
  if (!address || address.length < size * 2 + 2) return address;
  return `${address.slice(0, size + 2)}…${address.slice(-size)}`;
}

/** Resolve the profile an invoice is talking about, falling back to the selection. */
export function networkForCaip2(caip2: string | undefined, fallback: NetworkKey): NetworkKey {
  if (!caip2) return fallback;
  const match = Object.values(NETWORKS).find((candidate) => candidate.caip2 === caip2);
  return match ? match.key : fallback;
}

export function explorerTx(network: NetworkKey, hash: string): string {
  return `${NETWORKS[network].explorer}/tx/${hash}`;
}

export function explorerAddress(network: NetworkKey, address: string): string {
  return `${NETWORKS[network].explorer}/address/${address}`;
}
