import { describe, expect, it } from 'vitest';
import {
  asCountryCode,
  containsInsensitive,
  searchTokens,
  PUBLIC_CONTENT_WHERE,
  PUBLIC_CREATOR_WHERE,
  PUBLIC_TRACK_WHERE,
} from './access.js';

describe('public data access policy', () => {
  it('does not require a consent flag to sell a public creator', () => {
    expect(JSON.stringify(PUBLIC_CREATOR_WHERE)).not.toContain('listings');
    expect(PUBLIC_CREATOR_WHERE.isPrivate).toBe(false);
    expect(PUBLIC_CREATOR_WHERE.isFraudSuspended).toBe(false);
  });

  it('still honours an explicit revocation, including creators with no consent row', () => {
    // `is: null` is what makes default-on work: a creator who never touched the
    // consent route has no row, and must still be sellable.
    expect(PUBLIC_CREATOR_WHERE.OR).toEqual([
      { agentConsent: { is: null } },
      { agentConsent: { is: { revokedAt: null } } },
    ]);
  });

  it('only sells published, public content', () => {
    expect(PUBLIC_CONTENT_WHERE).toEqual({ status: 'READY', privacy: 'PUBLIC' });
  });

  it('sells a track only when a public post draws on it', () => {
    expect(PUBLIC_TRACK_WHERE.OR).toHaveLength(2);
    expect(JSON.stringify(PUBLIC_TRACK_WHERE)).toContain('"isPrivate":false');
  });

  it('turns a sentence into the tokens a paid route searches on', () => {
    expect(searchTokens('Music & Me by Nate Dogg')).toEqual(['music', '&', 'me', 'by', 'nate', 'dogg']);
    expect(searchTokens('  lagos, LAGOS  ')).toEqual(['lagos']);
    expect(searchTokens('')).toEqual([]);
    expect(searchTokens('one two three four five six seven')).toHaveLength(6);
  });

  it('matches text case-insensitively and only treats real country codes as codes', () => {
    expect(containsInsensitive('Lagos')).toEqual({ contains: 'Lagos', mode: 'insensitive' });
    expect(asCountryCode('ng')).toBe('NG');
    expect(asCountryCode('Lag os')).toBeNull();
    expect(asCountryCode('N1')).toBeNull();
  });
});
