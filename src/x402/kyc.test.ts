import { describe, expect, it } from 'vitest';
import {
  isPayoutEligible,
  kycSource,
  localKycOverrideAllowed,
  payoutBlockers,
  type CreatorPayoutState,
} from './kyc.js';

const eligible: CreatorPayoutState = {
  kycStatus: 'VERIFIED',
  fraudRiskScore: 0,
  isFraudSuspended: false,
  hasPrimaryCeloWallet: true,
  bushaCustomerId: 'busha_cust_1',
};

describe('payoutBlockers', () => {
  it('passes a verified creator with a wallet and no fraud flags', () => {
    expect(payoutBlockers(eligible)).toEqual([]);
    expect(isPayoutEligible(eligible)).toBe(true);
  });

  it('reports every blocker, not just the first one', () => {
    expect(
      payoutBlockers({
        kycStatus: 'PENDING',
        fraudRiskScore: 80,
        isFraudSuspended: true,
        hasPrimaryCeloWallet: false,
      }),
    ).toEqual(['FRAUD_SUSPENDED', 'FRAUD_RISK_SCORE', 'KYC_NOT_VERIFIED', 'NO_PRIMARY_CELO_WALLET']);
  });

  it('treats the fraud threshold as 80 and above', () => {
    expect(payoutBlockers({ ...eligible, fraudRiskScore: 79.9 })).toEqual([]);
    expect(payoutBlockers({ ...eligible, fraudRiskScore: 80 })).toEqual(['FRAUD_RISK_SCORE']);
  });

  it('blocks a verified creator who never linked a Celo wallet', () => {
    expect(payoutBlockers({ ...eligible, hasPrimaryCeloWallet: false })).toEqual(['NO_PRIMARY_CELO_WALLET']);
  });
});

describe('kycSource', () => {
  it('attributes the status to Busha when a customer exists', () => {
    expect(kycSource({ kycStatus: 'VERIFIED', bushaCustomerId: 'busha_cust_1' })).toBe('busha');
    expect(kycSource({ kycStatus: 'NONE', bushaCustomerId: 'busha_cust_1' })).toBe('busha');
  });

  it('flags a verified status with no Busha customer as a local override', () => {
    expect(kycSource({ kycStatus: 'VERIFIED', bushaCustomerId: null })).toBe('local-override');
    expect(kycSource({ kycStatus: 'NONE', bushaCustomerId: null })).toBe('none');
  });
});

describe('localKycOverrideAllowed', () => {
  const local = { flagEnabled: true, isProd: false, rampProvider: 'busha', bushaEnv: 'sandbox' };

  it('is off unless the flag is set', () => {
    expect(localKycOverrideAllowed({ ...local, flagEnabled: false })).toBe(false);
  });

  it('allows a local sandbox process', () => {
    expect(localKycOverrideAllowed(local)).toBe(true);
    expect(localKycOverrideAllowed({ ...local, rampProvider: 'mock' })).toBe(true);
  });

  it('refuses NODE_ENV=production even with the flag set', () => {
    expect(localKycOverrideAllowed({ ...local, isProd: true })).toBe(false);
  });

  it('refuses a live Busha environment even when NODE_ENV is not production', () => {
    expect(localKycOverrideAllowed({ ...local, bushaEnv: 'production' })).toBe(false);
  });
});
