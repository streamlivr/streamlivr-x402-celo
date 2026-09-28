import { describe, expect, it } from 'vitest';
import {
  asCountryCode,
  containsInsensitive,
  CREATOR_QUERY_WORDS,
  searchReadings,
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

  it('drops the punctuation a chat box sends and keeps the word under it', () => {
    expect(searchTokens('#amapiano')).toEqual(['amapiano']);
    expect(searchTokens('@grant')).toEqual(['grant']);
    expect(searchTokens('creators in Nigeria?')).toEqual(['creators', 'in', 'nigeria']);
  });

  it('reads a question as the words that are actually data, strict first', () => {
    // "in" says how the words relate, which is not a field in any table.
    expect(searchReadings('lagos in Nigeria')).toEqual([
      { tokens: ['lagos', 'nigeria'], match: 'all' },
      { tokens: ['lagos', 'nigeria'], match: 'any' },
    ]);
    // The entity noun goes too once the caller says which shelf it is asking
    // about, which is what turns a sentence into a country lookup.
    expect(searchReadings('creators in Nigeria', CREATOR_QUERY_WORDS)).toEqual([
      { tokens: ['nigeria'], match: 'all' },
    ]);
    expect(searchReadings('lagos producer')).toEqual([
      { tokens: ['lagos', 'producer'], match: 'all' },
    ]);
    // A sentence also gets an either-one-is-enough reading, tried only after
    // the strict reading comes back empty. Two keywords are not a sentence, so
    // they narrow or they return nothing.
    expect(searchReadings('lagos afrobeats')).toEqual([{ tokens: ['lagos', 'afrobeats'], match: 'all' }]);
    expect(searchReadings('creators in lagos with house music', CREATOR_QUERY_WORDS)).toEqual([
      { tokens: ['lagos', 'house', 'music'], match: 'all' },
      { tokens: ['lagos', 'house', 'music'], match: 'any' },
    ]);
    // A query that is nothing but filler still searches for the words given,
    // because returning the whole directory would answer a different question.
    expect(searchReadings('show me', CREATOR_QUERY_WORDS)).toEqual([
      { tokens: ['show', 'me'], match: 'all' },
    ]);
    expect(searchReadings(null)).toEqual([{ tokens: [], match: 'all' }]);
  });

  it('matches text case-insensitively and takes a country by name or by code', () => {
    expect(containsInsensitive('Lagos')).toEqual({ contains: 'Lagos', mode: 'insensitive' });
    expect(asCountryCode('ng')).toBe('NG');
    expect(asCountryCode('Nigeria')).toBe('NG');
    expect(asCountryCode('united kingdom')).toBe('GB');
    expect(asCountryCode('Lag os')).toBeNull();
    expect(asCountryCode('N1')).toBeNull();
  });

  it('keeps the country after a long question and joins country names before dropping filler', () => {
    expect(searchReadings('Can you please show me the creators in Nigeria?', CREATOR_QUERY_WORDS)).toEqual([
      { tokens: ['nigeria'], match: 'all' },
    ]);
    expect(searchReadings('Show me creators in the United States of America', CREATOR_QUERY_WORDS)).toEqual([
      { tokens: ['united states of america'], match: 'all' },
    ]);
    expect(searchReadings('creators in South Africa', CREATOR_QUERY_WORDS)).toEqual([
      { tokens: ['south africa'], match: 'all' },
    ]);
  });
});
