import { describe, expect, it } from 'vitest';
import { CELO_X402_ASSETS, resolveX402Asset } from './config.js';

describe('resolveX402Asset', () => {
  it('returns the canonical mainnet address and EIP-712 domain for every settleable asset', () => {
    expect(resolveX402Asset('mainnet', 'USDC')).toMatchObject({
      address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      decimals: 6,
      extra: { name: 'USDC', version: '2', assetTransferMethod: 'eip3009' },
    });
    // USDT does not expose version(); the facilitator documents version "1".
    expect(resolveX402Asset('mainnet', 'USDT')).toMatchObject({
      address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
      extra: { name: 'Tether USD', version: '1' },
    });
    expect(resolveX402Asset('mainnet', 'USAT')).toMatchObject({
      address: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771',
      extra: { name: 'Tether America USD', version: '1' },
    });
  });

  it('rejects USDT and USAT on testnet because the Sepolia facilitator only settles USDC', () => {
    expect(() => resolveX402Asset('testnet', 'USDT')).toThrow(/USDT is not settled on Celo testnet/);
    expect(() => resolveX402Asset('testnet', 'USAT')).toThrow(/USAT is not settled on Celo testnet/);
    expect(resolveX402Asset('testnet', 'USDC').address).toBe('0x01C5C0122039549AD1493B8220cABEdD739BC44E');
  });

  it('fails closed when an override does not match the canonical asset address', () => {
    expect(() => resolveX402Asset('mainnet', 'USDC', CELO_X402_ASSETS.USDT.mainnet)).toThrow(/must use the canonical address/);
    expect(() => resolveX402Asset('mainnet', 'USDC', 'not-an-address')).toThrow(/not a valid EVM address/);
    expect(resolveX402Asset('mainnet', 'USDC', CELO_X402_ASSETS.USDC.mainnet).address).toBe(CELO_X402_ASSETS.USDC.mainnet);
  });

  it('documents a fee-abstraction adapter for every mainnet settlement asset', () => {
    for (const asset of Object.values(CELO_X402_ASSETS)) {
      expect(asset.feeCurrencyAdapter).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});
