import { SETTLEMENT_DECIMALS } from './config';

/**
 * Money is only ever handled as atomic-unit integer strings. A float would
 * silently round a creator's share, and those numbers end up in a ledger.
 */
export function fromAtomic(atomic: string | bigint, decimals = SETTLEMENT_DECIMALS): string {
  const value = BigInt(atomic);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const fraction = abs % divisor;
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  const text = fractionText ? `${whole}.${fractionText}` : whole.toString();
  return negative ? `-${text}` : text;
}

/**
 * Compact display for a ledger row: 12.4k, 3.5, 0.01, 0.003.
 *
 * A creator's share of a one-cent payment is 0.003, so two decimal places would
 * render most of this ledger as `0.00` and quietly misreport every artist.
 */
export function formatAmount(atomic: string | bigint, decimals = SETTLEMENT_DECIMALS): string {
  const text = fromAtomic(atomic, decimals);
  const value = Number(text);
  if (!Number.isFinite(value)) return text;
  if (value === 0) return '0';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  const places = Math.abs(value) < 0.01 ? 3 : 2;
  return value.toFixed(places).replace(/\.?0+$/, '') || '0';
}

/**
 * Currency rendering. Three decimals are only used when the third decimal
 * carries information, so a one-cent price reads `$0.01` rather than `$0.010`
 * while a half-cent price still shows as `$0.005`.
 */
export function formatUsd(atomic: string | bigint, decimals = SETTLEMENT_DECIMALS): string {
  const value = Number(fromAtomic(atomic, decimals));
  const needsThree = value > 0 && value < 0.1 && Math.round(value * 1000) % 10 !== 0;
  const places = needsThree ? 3 : 2;
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/**
 * Wallet balance for the header pill: three decimals at most, trailing zeros
 * dropped. A one-cent payment has to be visible in the number, which is why a
 * plain two-decimal currency format is not used here.
 */
export function formatTokenBalance(atomic: string | null | undefined, decimals = SETTLEMENT_DECIMALS): string {
  if (atomic === null || atomic === undefined || atomic === '') return '…';
  const value = Number(fromAtomic(atomic, decimals));
  if (!Number.isFinite(value)) return fromAtomic(atomic, decimals);
  return value.toFixed(3).replace(/\.?0+$/, '') || '0';
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'N/A';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** JSON with stable key order and a hard length cap, for the raw inspector. */
export function prettyJson(value: unknown, maxChars = 20000): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length > maxChars) return `${text.slice(0, maxChars)}\n… truncated at ${maxChars} characters`;
  return text;
}

/** Base64url decode for x402 headers, tolerant of padding. */
export function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  if (typeof atob === 'function') return atob(padded);
  return Buffer.from(padded, 'base64').toString('utf8');
}
