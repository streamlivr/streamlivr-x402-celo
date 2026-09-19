'use client';

import { API_BASE_URL, API_REQUEST_HEADERS } from './config';
import { fetchReadWithRetry } from './x402pay';

/** Shapes returned by the public demo routes added to the Streamlivr API. */

export interface LedgerAttribution {
  creatorId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  shareAtomic: string;
  shareBps: number;
}

export interface LedgerSettlement {
  id: string;
  endpoint: string;
  network: string;
  assetSymbol: string;
  assetDecimals: number;
  amountAtomic: string;
  payer: string;
  payTo: string;
  settlementTxHash: string;
  createdAt: string;
  creatorShareAtomic: string;
  platformShareAtomic: string;
  attributions: LedgerAttribution[];
}

export interface LedgerTotals {
  count: number;
  grossAtomic: string;
  creatorShareAtomic: string;
  platformShareAtomic: string;
}

export interface SettlementsResponse {
  network: string;
  payTo: string;
  asset: { symbol: string; address: string; decimals: number };
  split: { creatorBps: number; platformBps: number };
  totals: LedgerTotals;
  settlements: LedgerSettlement[];
}

export interface LedgerCreator {
  creatorId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  countryCode: string | null;
  followerCount: number;
  earnedAtomic: string;
  paidOutAtomic: string;
  outstandingAtomic: string;
  salesCount: number;
  lastSaleAt: string | null;
  consent: { listings: boolean; catalog: boolean; profile: boolean };
}

export interface CreatorsResponse {
  network: string;
  asset: { symbol: string; address: string; decimals: number };
  split: { creatorBps: number; platformBps: number };
  totals: {
    creators: number;
    creatorShareAtomic: string;
    paidOutAtomic: string;
    outstandingAtomic: string;
  };
  creators: LedgerCreator[];
}

export class DemoApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetchReadWithRetry(
    `${API_BASE_URL}${path}`,
    { headers: { accept: 'application/json', ...API_REQUEST_HEADERS }, ...(signal ? { signal } : {}) },
    15_000,
  );
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `request failed with ${response.status}`;
    throw new DemoApiError(response.status, message);
  }
  return body as T;
}

export function fetchSettlements(signal?: AbortSignal): Promise<SettlementsResponse> {
  return getJson<SettlementsResponse>('/api/v1/agent/demo/settlements', signal);
}

export function fetchCreators(signal?: AbortSignal): Promise<CreatorsResponse> {
  return getJson<CreatorsResponse>('/api/v1/agent/demo/creators', signal);
}

/** Health check used by the header pill so the page can say "API unreachable". */
export async function pingApi(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetchReadWithRetry(
      `${API_BASE_URL}/health`,
      { headers: { accept: 'application/json', ...API_REQUEST_HEADERS }, ...(signal ? { signal } : {}) },
      10_000,
    );
    return response.ok;
  } catch {
    return false;
  }
}
