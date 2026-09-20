/**
 * Who and what the paid agent routes are allowed to serve.
 *
 * Streamlivr sells the same data a logged-out visitor can already see in the
 * app. That single rule lives here instead of being re-typed per route, so a
 * new paid endpoint cannot invent a looser one:
 *
 *   - an account is sellable when it is public (`isPrivate: false`), not
 *     suspended for fraud, and has not explicitly revoked agent access;
 *   - content is sellable when it is published (`READY`) and public
 *     (`privacy: PUBLIC`) *and* its creator is sellable.
 *
 * Consent is no longer a gate. Every public account and every public post is
 * available because it is already visible to anyone, which is what makes the
 * dataset worth buying. The revoke switch on `PATCH /api/v1/agent/consent`
 * stays honoured: a person saying "stop selling my data" is respected even
 * though the default flipped to on.
 *
 * Fields that never leave the API, whatever a buyer pays: email, phone,
 * password hash, wallet addresses, KYC state, fraud signals, device ids,
 * push/email preferences, and anything private, followers-only or unpublished.
 * Every `select` in `server.ts` is the second half of this rule; adding a route
 * means adding a `select`, never `include`.
 *
 * This module deliberately imports nothing: it is copied verbatim into the
 * public reference repo, which has no Prisma client. The where clauses are
 * still type-checked where they are used, against the generated Prisma types.
 */

/** A user whose public profile, content and counts may be sold. */
export const PUBLIC_CREATOR_WHERE = {
  isPrivate: false,
  isFraudSuspended: false,
  // A missing consent row means "no one has ever opted out", which is the
  // default-on state. `is: null` is the only way to express that, because
  // `is: { revokedAt: null }` does not match a relation that is absent.
  OR: [{ agentConsent: { is: null } }, { agentConsent: { is: { revokedAt: null } } }],
};

/**
 * The same rule, used where a user is joined onto content. The shape Prisma
 * expects for a nullable to-one relation, so it spreads into both
 * `UserWhereInput` and `VideoWhereInput` joins.
 */
export const PUBLIC_CREATOR_RELATION = { is: PUBLIC_CREATOR_WHERE };

/** Published, public content owned by a sellable creator. */
export const PUBLIC_CONTENT_WHERE = {
  status: 'READY',
  privacy: 'PUBLIC',
} as const;

/**
 * A track is sellable when at least one public post draws on it, either as the
 * track the creator picked or as the one detection matched. That keeps the
 * catalog to music that is actually behind public content rather than every row
 * a provider ever returned.
 */
export const PUBLIC_TRACK_WHERE = {
  OR: [
    { videos: { some: { ...PUBLIC_CONTENT_WHERE, creator: PUBLIC_CREATOR_RELATION } } },
    { detectedInVideos: { some: { ...PUBLIC_CONTENT_WHERE, creator: PUBLIC_CREATOR_RELATION } } },
  ],
};

/**
 * Public profile fields, in one place so the listings and profile routes cannot
 * disagree about what a creator looks like. Nothing here identifies a person
 * beyond what their public profile already shows.
 */
export const CREATOR_PUBLIC_SELECT = {
  id: true,
  username: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  countryCode: true,
  isVerified: true,
  followerCount: true,
  followingCount: true,
} as const;

/** The profile route adds the join date, which the listings route does not need. */
export const CREATOR_PROFILE_SELECT = {
  ...CREATOR_PUBLIC_SELECT,
  createdAt: true,
} as const;

/**
 * Splits a `q` into search tokens.
 *
 * An agent or a chat box sends a sentence, not a keyword: "music & me by nate
 * dogg" has to find a track called "Music & Me" by an artist called "Nate Dogg".
 * Each token then has to match *some* field (see the search builders), which is
 * stricter than matching any token and far more useful than matching the whole
 * phrase as one substring.
 */
export function searchTokens(q: string | null, maxTokens = 6): string[] {
  if (!q) return [];
  const tokens = q
    .toLowerCase()
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return [...new Set(tokens)].slice(0, maxTokens);
}

/** Case-insensitive substring match, used for every text search on a paid route. */
export function containsInsensitive(value: string): { contains: string; mode: 'insensitive' } {
  return { contains: value, mode: 'insensitive' };
}

/** True when the caller's `q` looks like a country code rather than a name. */
export function asCountryCode(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}
