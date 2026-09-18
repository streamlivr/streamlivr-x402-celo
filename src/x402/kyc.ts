/**
 * Payout eligibility policy: the four gates, the blocker list and the
 * local-override rule. No database, no environment access.
 *
 * Prepare and execute both call these helpers, so the two steps can't disagree
 * about who is payable. `User.kycStatus` holds the ramp provider's answer,
 * written by its webhook and reconcile worker; the payout path reads the stored
 * answer instead of calling the provider inline.
 */
/** The creator facts both payout gates care about. */
export interface CreatorPayoutState<S extends string = string> {
  kycStatus: S;
  fraudRiskScore: number;
  isFraudSuspended: boolean;
  hasPrimaryCeloWallet: boolean;
  bushaCustomerId?: string | null;
}

export type PayoutBlocker =
  | 'ACCOUNT_MISSING'
  | 'KYC_NOT_VERIFIED'
  | 'FRAUD_SUSPENDED'
  | 'FRAUD_RISK_SCORE'
  | 'NO_PRIMARY_CELO_WALLET';

/** Sentence-case text for the admin UI, one per blocker. */
export const PAYOUT_BLOCKER_TEXT: Record<PayoutBlocker, string> = {
  ACCOUNT_MISSING: 'Creator account no longer exists',
  KYC_NOT_VERIFIED: 'KYC is not verified',
  FRAUD_SUSPENDED: 'Account is suspended for fraud review',
  FRAUD_RISK_SCORE: 'Fraud risk score is 80 or higher',
  NO_PRIMARY_CELO_WALLET: 'No verified primary Celo wallet',
};

/** Where the stored KYC answer came from, for display. */
export type KycSource = 'busha' | 'local-override' | 'none';

export function kycSource<S extends string>(state: Pick<CreatorPayoutState<S>, 'kycStatus' | 'bushaCustomerId'>): KycSource {
  if (state.bushaCustomerId) return 'busha';
  return state.kycStatus === 'VERIFIED' ? 'local-override' : 'none';
}

export function payoutBlockers<S extends string>(creator: CreatorPayoutState<S>): PayoutBlocker[] {
  const blockers: PayoutBlocker[] = [];
  if (creator.isFraudSuspended) blockers.push('FRAUD_SUSPENDED');
  if (creator.fraudRiskScore >= 80) blockers.push('FRAUD_RISK_SCORE');
  if (creator.kycStatus !== 'VERIFIED') blockers.push('KYC_NOT_VERIFIED');
  if (!creator.hasPrimaryCeloWallet) blockers.push('NO_PRIMARY_CELO_WALLET');
  return blockers;
}

export function isPayoutEligible<S extends string>(creator: CreatorPayoutState<S>): boolean {
  return payoutBlockers(creator).length === 0;
}

export interface LocalOverrideContext {
  flagEnabled: boolean;
  isProd: boolean;
  rampProvider: string;
  bushaEnv: string;
}

/**
 * `BUSHA_ENV=production` counts as production on its own: an API running with
 * dev settings against the live Busha books is still a deployment where an
 * unverified payout must not exist.
 */
export function localKycOverrideAllowed(context: LocalOverrideContext): boolean {
  if (!context.flagEnabled) return false;
  if (context.isProd) return false;
  if (context.rampProvider === 'busha' && context.bushaEnv === 'production') return false;
  return true;
}
