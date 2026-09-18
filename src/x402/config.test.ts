import { describe, expect, it } from 'vitest';
import { parseFeeCurrency, x402Env } from './config';

/**
 * A blank value in .env is the normal state for the attribution tag until a
 * programme issues one. These cases exist because a blank tag used to crash
 * the whole API at import time.
 */
describe('x402 environment parsing', () => {
  it('treats a blank attribution tag as unset', () => {
    expect(x402Env.parse({ X402_ATTRIBUTION_TAG: '' }).X402_ATTRIBUTION_TAG).toBeUndefined();
    expect(x402Env.parse({ X402_ATTRIBUTION_TAG: '   ' }).X402_ATTRIBUTION_TAG).toBeUndefined();
    expect(x402Env.parse({}).X402_ATTRIBUTION_TAG).toBeUndefined();
  });

  it('keeps a valid tag and rejects a malformed one', () => {
    expect(x402Env.parse({ X402_ATTRIBUTION_TAG: 'celo_abc123' }).X402_ATTRIBUTION_TAG).toBe(
      'celo_abc123',
    );
    expect(() => x402Env.parse({ X402_ATTRIBUTION_TAG: 'celo_ABC' })).toThrow();
    expect(() => x402Env.parse({ X402_ATTRIBUTION_TAG: 'celo_abc-123' })).toThrow();
  });

  it('treats blank codes as unset', () => {
    expect(x402Env.parse({ X402_ATTRIBUTION_CODES: '' }).X402_ATTRIBUTION_CODES).toBeUndefined();
  });

  it('falls back to defaults when the value is blank', () => {
    const parsed = x402Env.parse({
      X402_NETWORK: '',
      X402_SETTLEMENT_ASSET: '',
      X402_ASSET_DECIMALS: '',
      X402_PING_PRICE_ATOMIC: '',
      X402_CHAIN_ID: '',
    });
    expect(parsed.X402_NETWORK).toBe('testnet');
    expect(parsed.X402_SETTLEMENT_ASSET).toBe('USDC');
    expect(parsed.X402_ASSET_DECIMALS).toBe(6);
    expect(parsed.X402_PING_PRICE_ATOMIC).toBe('10000');
    expect(parsed.X402_CHAIN_ID).toBeUndefined();
  });

  it('never coerces a blank number to zero', () => {
    const parsed = x402Env.parse({ X402_CHAIN_ID: '', X402_ASSET_DECIMALS: '' });
    expect(parsed.X402_CHAIN_ID).not.toBe(0);
    expect(parsed.X402_ASSET_DECIMALS).toBe(6);
  });

  it('still honours values that are set', () => {
    const parsed = x402Env.parse({
      X402_NETWORK: 'mainnet',
      X402_SETTLEMENT_ASSET: 'USAT',
      X402_ASSET_DECIMALS: '6',
      X402_CHAIN_ID: '42220',
      X402_PING_PRICE_ATOMIC: '20000',
      X402_ATTRIBUTION_TAG: 'celo_streamlivr',
    });
    expect(parsed.X402_NETWORK).toBe('mainnet');
    expect(parsed.X402_SETTLEMENT_ASSET).toBe('USAT');
    expect(parsed.X402_CHAIN_ID).toBe(42220);
    expect(parsed.X402_PING_PRICE_ATOMIC).toBe('20000');
    expect(parsed.X402_ATTRIBUTION_TAG).toBe('celo_streamlivr');
  });

  it('refuses an automatic fee currency on testnet', () => {
    expect(() =>
      parseFeeCurrency({
        X402_FEE_CURRENCY: 'auto',
        X402_NETWORK: 'testnet',
        X402_SETTLEMENT_ASSET: 'USDC',
      }),
    ).toThrow(/mainnet/i);
  });

  it('resolves the documented adapter on mainnet and treats blank as unset', () => {
    expect(
      parseFeeCurrency({
        X402_FEE_CURRENCY: 'auto',
        X402_NETWORK: 'mainnet',
        X402_SETTLEMENT_ASSET: 'USDC',
      }),
    ).toBe('0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B');
    expect(
      parseFeeCurrency({
        X402_FEE_CURRENCY: '',
        X402_NETWORK: 'mainnet',
        X402_SETTLEMENT_ASSET: 'USDC',
      }),
    ).toBeUndefined();
  });
});
