/**
 * Wiring for the development-only KYC switch: flag, environment and the write.
 * The rule itself lives in `kyc.ts`, which keeps it testable without a database.
 * Production pays out against the provider status and never through here.
 */
import type { KycStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
import { X402_LOCAL_KYC_OVERRIDE } from './config.js';
import { localKycOverrideAllowed } from './kyc.js';

/** The local override is switched on and this process is not production-configured. */
export function localKycOverrideEnabled(): boolean {
  return localKycOverrideAllowed({
    flagEnabled: X402_LOCAL_KYC_OVERRIDE,
    isProd: config.isProd,
    rampProvider: config.ramp.provider,
    bushaEnv: config.ramp.busha.env,
  });
}

export class LocalKycOverrideDisabledError extends Error {
  constructor() {
    super(
      'Local KYC override is disabled. Set X402_LOCAL_KYC_OVERRIDE=true in a non-production environment, or complete Busha verification and refresh the status from the provider.',
    );
    this.name = 'LocalKycOverrideDisabledError';
  }
}

/**
 * Mark a creator VERIFIED without a provider check. Local testing only; the
 * caller is responsible for the audit entry and for saying so in its output.
 * Returns the previous status so the caller can report the transition.
 */
export async function markLocalKycVerified(userId: string): Promise<{ previous: KycStatus; current: KycStatus }> {
  if (!localKycOverrideEnabled()) throw new LocalKycOverrideDisabledError();
  const previous = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
  if (!previous) throw new Error(`No user with id ${userId}`);
  const updated = await prisma.user.update({ where: { id: userId }, data: { kycStatus: 'VERIFIED' }, select: { kycStatus: true } });
  return { previous: previous.kycStatus, current: updated.kycStatus };
}
