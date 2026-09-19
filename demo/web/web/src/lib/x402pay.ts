'use client';

import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { API_BASE_URL, MAX_ATOMIC_PER_SESSION, NETWORKS, type NetworkKey } from './config';

export interface PaymentTerms {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface PaymentChallenge {
  x402Version?: number;
  error?: string;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts: PaymentTerms[];
}

export interface SettlementReceipt {
  success: boolean;
  payer?: string;
  transaction?: string;
  network?: string;
  errorReason?: string;
  [key: string]: unknown;
}

export interface RequestTrace {
  ok: boolean;
  paid: boolean;
  url: string;
  path: string;
  durationMs: number;
  status: number;
  challenge: PaymentChallenge | null;
  terms: PaymentTerms | null;
  receipt: SettlementReceipt | null;
  body: unknown;
  raw: {
    challengeHeader: string | null;
    signatureHeader: string | null;
    responseHeader: string | null;
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
  };
  error?: string;
}

/** Session spend, in atomic units (USDC has 6 decimals, so 10000 = $0.01). */
let sessionSpentAtomic = 0;

export function getSessionSpentAtomic(): number {
  return sessionSpentAtomic;
}

export function resetSessionSpend(): void {
  sessionSpentAtomic = 0;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    // Never surface an authorization header in the inspector.
    out[key] = /authorization|api-key|cookie/i.test(key) ? '<redacted>' : value;
  });
  return out;
}

function blankTrace(path: string, started: number, error: string): RequestTrace {
  return {
    ok: false,
    paid: false,
    url: `${API_BASE_URL}${path}`,
    path,
    durationMs: Date.now() - started,
    status: 0,
    challenge: null,
    terms: null,
    receipt: null,
    body: null,
    raw: {
      challengeHeader: null,
      signatureHeader: null,
      responseHeader: null,
      requestHeaders: {},
      responseHeaders: {},
    },
    error,
  };
}

/**
 * Ask for the resource without paying. This is the step a buyer agent takes
 * first, and it is what produces the invoice the rest of the flow consumes.
 */
export async function probeResource(path: string): Promise<RequestTrace> {
  const started = Date.now();
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { headers: { accept: 'application/json' } });
    const challengeHeader = response.headers.get('payment-required');
    let challenge: PaymentChallenge | null = null;
    if (challengeHeader) {
      try {
        challenge = decodePaymentRequiredHeader(challengeHeader) as unknown as PaymentChallenge;
      } catch {
        challenge = null;
      }
    }
    return {
      ok: response.status < 400,
      paid: false,
      url: `${API_BASE_URL}${path}`,
      path,
      durationMs: Date.now() - started,
      status: response.status,
      challenge,
      terms: challenge?.accepts?.[0] ?? null,
      receipt: null,
      body: await readBody(response),
      raw: {
        challengeHeader,
        signatureHeader: null,
        responseHeader: response.headers.get('payment-response'),
        requestHeaders: {},
        responseHeaders: headerRecord(response.headers),
      },
    };
  } catch (error) {
    return blankTrace(path, started, error instanceof Error ? error.message : 'Request failed');
  }
}

export interface PaidRequestOptions {
  path: string;
  network: NetworkKey;
  burnerKey: string;
  /** Hard ceiling for this single payment, in atomic units. */
  maxAtomicPerRequest: number;
  /**
   * Terms already read from a discovery request. Passing them lets the caller
   * show the invoice before anything is signed, which is the whole point of the
   * chat flow: quote, then pay.
   */
  terms?: PaymentTerms | null;
  challenge?: PaymentChallenge | null;
  challengeHeader?: string | null;
}

/**
 * The full buyer flow: sign an EIP-3009 authorization for the quoted terms,
 * retry the request, and hand back both the data and the settlement receipt.
 *
 * Every step is captured so the UI can show the raw headers next to the
 * human-readable version. If the invoice is priced above the cap, the x402
 * client refuses before anything is signed.
 */
export async function paidRequest(options: PaidRequestOptions): Promise<RequestTrace> {
  const started = Date.now();
  const profile = NETWORKS[options.network];

  if (!/^0x[0-9a-fA-F]{64}$/.test(options.burnerKey)) {
    return blankTrace(options.path, started, 'burner wallet is not configured');
  }

  try {
    const url = `${API_BASE_URL}${options.path}`;
    let challenge = options.challenge ?? null;
    let challengeHeader = options.challengeHeader ?? null;
    let terms = options.terms ?? null;

    // No quote supplied: ask for one. This is the 402 round trip.
    if (!terms) {
      const probe = await fetch(url, { headers: { accept: 'application/json' } });
      challengeHeader = probe.headers.get('payment-required');
      const probeBody = await probe.text();
      if (probe.status !== 402) {
        let body: unknown = null;
        try {
          body = probeBody ? JSON.parse(probeBody) : null;
        } catch {
          body = probeBody;
        }
        return {
          ok: probe.status < 400,
          paid: false,
          url,
          path: options.path,
          durationMs: Date.now() - started,
          status: probe.status,
          challenge: null,
          terms: null,
          receipt: null,
          body,
          raw: {
            challengeHeader,
            signatureHeader: null,
            responseHeader: probe.headers.get('payment-response'),
            requestHeaders: {},
            responseHeaders: headerRecord(probe.headers),
          },
          error: `endpoint answered ${probe.status} without an invoice`,
        };
      }
      if (challengeHeader) {
        try {
          challenge = decodePaymentRequiredHeader(challengeHeader) as unknown as PaymentChallenge;
        } catch {
          challenge = null;
        }
      }
      terms = challenge?.accepts?.[0] ?? null;
      if (!terms) {
        return { ...blankTrace(options.path, started, 'no payable invoice in the 402 response'), status: 402 };
      }
    }

    const requested = Number(terms.amount);
    if (Number.isFinite(requested) && requested > options.maxAtomicPerRequest) {
      return {
        ...blankTrace(options.path, started, `invoice is ${terms.amount} atomic, above the ${options.maxAtomicPerRequest} cap`),
        status: 402,
        challenge,
        terms,
      };
    }
    if (sessionSpentAtomic + Number(terms.amount) > MAX_ATOMIC_PER_SESSION) {
      return {
        ...blankTrace(options.path, started, 'this session has hit its spend ceiling'),
        status: 402,
        challenge,
        terms,
      };
    }

    const account = privateKeyToAccount(options.burnerKey as `0x${string}`);
    let signedHeaders: Record<string, string> | null = null;

    // Capture the retry request so the inspector can show the authorization
    // that was actually signed, not a reconstruction of it.
    const recordingFetch: typeof fetch = async (input, init) => {
      const headers = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {};
      const response = await fetch(input, init);
      if (headers['payment-signature'] || headers['x-payment']) signedHeaders = headers;
      return response;
    };

    // The x402 client types the network as a CAIP-2 template literal; the
    // invoice carries it as a plain string.
    const caip2 = terms.network as `${string}:${string}`;
    const client = new x402Client().setSpendControls({
      allowedAssets: [
        {
          network: caip2,
          asset: terms.asset,
          maxAmountPerPayment: String(Math.min(options.maxAtomicPerRequest, MAX_ATOMIC_PER_SESSION)),
        },
      ],
    });
    // The invoice, not the UI toggle, decides which chain is being paid on.
    // Reading a nonce from the wrong chain produces a signature that will not
    // settle, so the profile is matched on the CAIP-2 id the seller quoted.
    const payingProfile =
      Object.values(NETWORKS).find((candidate) => candidate.caip2 === terms.network) ?? profile;
    client.register(caip2, new ExactEvmScheme(account, { rpcUrl: payingProfile.rpcUrl }));
    const paidFetch = wrapFetchWithPayment(recordingFetch, client);

    const response = await paidFetch(url, { headers: { accept: 'application/json' } });
    const responseHeader = response.headers.get('payment-response');
    let receipt: SettlementReceipt | null = null;
    if (responseHeader) {
      try {
        receipt = decodePaymentResponseHeader(responseHeader) as unknown as SettlementReceipt;
      } catch {
        receipt = null;
      }
    }
    const body = await readBody(response);
    if (receipt?.success) sessionSpentAtomic += Number(terms.amount);

    const paid = response.status < 400 && receipt?.success !== false;
    return {
      ok: response.status < 400,
      paid,
      url,
      path: options.path,
      durationMs: Date.now() - started,
      status: response.status,
      challenge,
      terms,
      receipt,
      body,
      raw: {
        challengeHeader,
        signatureHeader: signedHeaders?.['payment-signature'] ?? signedHeaders?.['x-payment'] ?? null,
        responseHeader,
        requestHeaders: signedHeaders ?? {},
        responseHeaders: headerRecord(response.headers),
      },
      error: response.status >= 400 ? `seller answered ${response.status}` : undefined,
    };
  } catch (error) {
    return blankTrace(options.path, started, error instanceof Error ? error.message : 'payment failed');
  }
}

/** Settlement-asset balance for an address, read straight from Celo RPC. */
export async function fetchAssetBalance(network: NetworkKey, address: string, asset: `0x${string}`): Promise<string> {
  const profile = NETWORKS[network];
  const data = `0x70a08231${address.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;
  const response = await fetch(profile.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: asset, data }, 'latest'],
    }),
  });
  const json = (await response.json()) as { result?: string; error?: { message?: string } };
  if (!json.result) throw new Error(json.error?.message ?? 'balance read failed');
  return BigInt(json.result).toString();
}

/** Native CELO balance, shown only so the demo can explain who pays gas. */
export async function fetchNativeBalance(network: NetworkKey, address: string): Promise<string> {
  const profile = NETWORKS[network];
  const response = await fetch(profile.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
  });
  const json = (await response.json()) as { result?: string };
  return json.result ? BigInt(json.result).toString() : '0';
}
