import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodePaymentResponseHeader } from '@x402/core/http';

const sdk = vi.hoisted(() => ({ sign: vi.fn(), encode: vi.fn(), process: vi.fn() }));
vi.mock('@x402/fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@x402/fetch')>();
  return {
    ...actual,
    x402Client: class {
      setSpendControls() { return this; }
      register() { return this; }
      createPaymentPayload = sdk.sign;
    },
    x402HTTPClient: class {
      encodePaymentSignatureHeader = sdk.encode;
      processPaymentResult = sdk.process;
    },
  };
});

import { getSessionSpentAtomic, paidRequest, resetSessionSpend, type PaymentChallenge } from './x402pay';

const terms = {
  scheme: 'exact', network: 'eip155:42220' as const, amount: '100000',
  asset: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
  payTo: '0x4503F32dFF9e54Ee4c0Fd9BE25bCC662abB4c4Bf',
};
const challenge: PaymentChallenge = { x402Version: 2, accepts: [terms] };
const options = {
  path: '/api/v1/agent/listings', network: 'mainnet' as const,
  burnerKey: `0x${'1'.repeat(64)}`, maxAtomicPerRequest: 1_000_000,
  terms, challenge,
};

describe('demo buyer payments', () => {
  beforeEach(() => {
    resetSessionSpend();
    sdk.sign.mockResolvedValue({ x402Version: 2, payload: {} });
    sdk.encode.mockReturnValue({ 'PAYMENT-SIGNATURE': 'signed-quote' });
    sdk.process.mockResolvedValue({});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('signs the displayed quote and sends one paid request, without another unpaid probe', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ creators: [{ id: 'a' }] }), {
      headers: { 'payment-response': encodePaymentResponseHeader({ success: true, transaction: `0x${'a'.repeat(64)}`, network: terms.network }) },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const trace = await paidRequest(options);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('payment-signature')).toBe('signed-quote');
    expect(sdk.sign.mock.calls[0][0].accepts).toEqual([terms]);
    expect(trace.receipt?.success).toBe(true);
    expect(trace.raw.signatureHeader).toBe('signed-quote');
    expect(getSessionSpentAtomic()).toBe(100000);
  });

  it('rejects an invoice above the cap before signing or fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const trace = await paidRequest({ ...options, maxAtomicPerRequest: 10000 });
    expect(trace.error).toContain('Nothing was signed');
    expect(sdk.sign).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSessionSpentAtomic()).toBe(0);
  });

  it('does not count a page served without settlement as session spend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ creators: [] }), {
      headers: { 'x-no-charge-reason': 'empty page' },
    })));
    const trace = await paidRequest(options);
    expect(trace.noChargeReason).toBe('empty page');
    expect(trace.receipt).toBeNull();
    expect(getSessionSpentAtomic()).toBe(0);
  });

  it('does not retry a paid request when the network times out', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);
    const trace = await paidRequest(options);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(trace.error).toContain('Check the ledger');
    expect(getSessionSpentAtomic()).toBe(0);
  });

  it('rejects an invalid amount before signing', async () => {
    const invalid = { ...terms, amount: 'NaN' };
    const trace = await paidRequest({ ...options, terms: invalid, challenge: { ...challenge, accepts: [invalid] } });
    expect(trace.error).toContain('invalid');
    expect(sdk.sign).not.toHaveBeenCalled();
  });
});
