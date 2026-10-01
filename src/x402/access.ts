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
 * This module imports no Prisma client and no app service, so it is copied
 * verbatim into the public reference repo. Its only import is the country table,
 * which is pure data. The where clauses are still type-checked where they are
 * used, against the generated Prisma types.
 */

import { toIso2 } from '../utils/countries.js';

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
  createdAt: true,
  followingCount: true,
} as const;

/** The profile route adds the join date, which the listings route does not need. */
export const CREATOR_PROFILE_SELECT = {
  ...CREATOR_PUBLIC_SELECT,
  createdAt: true,
} as const;

/** Punctuation a word can carry without the punctuation being the word. */
const EDGE_PUNCTUATION = /^[^a-z0-9&]+|[^a-z0-9&]+$/g;

/**
 * Splits a `q` into search tokens.
 *
 * An agent or a chat box sends a sentence, not a keyword: "music & me by nate
 * dogg" has to find a track called "Music & Me" by an artist called "Nate Dogg".
 * Each token then has to match *some* field (see the search builders), which is
 * stricter than matching any token and far more useful than matching the whole
 * phrase as one substring. Surrounding punctuation is dropped because a chat
 * box sends "#amapiano", "@grant" and "Nigeria?" with the mark still attached,
 * and none of those marks are stored.
 */
export function searchTokens(q: string | null, maxTokens = 6): string[] {
  if (!q) return [];
  const tokens = q
    .toLowerCase()
    .split(/[\s,]+/)
    .map((token) => token.trim().replace(EDGE_PUNCTUATION, ''))
    .filter((token) => token.length > 0);
  return [...new Set(tokens)].slice(0, maxTokens);
}

/**
 * Words that say what the caller wants done rather than what they are looking
 * for. "show me creators in Nigeria" holds one word that matches a column and
 * five that only look like filters, and ANDing all six is why a clear question
 * used to come back empty.
 *
 * Removing them has one exception, and it is the reason they are safe to drop:
 * a query built entirely from them ("the song") has nothing left to search
 * with, so `searchReadings` falls back to the words as typed rather than
 * turning a search for a track called "Me" into a listing of everything.
 */
const FILLER_WORDS = new Set([
  'a', 'all', 'an', 'and', 'any', 'are', 'at', 'be', 'by', 'can', 'do', 'does',
  'called', 'find', 'for', 'from', 'get', 'give', 'i', 'in', 'is', 'it', 'its', 'list',
  'look', 'looking', 'me', 'named', 'need', 'of', 'on', 'or', 'please', 'show', 'some',
  'that', 'the', 'their', 'them', 'these', 'this', 'those', 'to', 'want', 'was',
  'were', 'what', 'when', 'where', 'which', 'who', 'whose', 'why', 'will',
  'with', 'you', 'your',
]);

/**
 * The same idea, one level down: words that name the shelf rather than the
 * record. "creators in nigeria" spends a word on the shelf and a word on
 * grammar, so the noun is dropped and the country is what is left.
 */
const ENTITY_WORDS: Record<'creator' | 'post' | 'track', string[]> = {
  creator: ['creator', 'creators', 'artist', 'artists', 'brand', 'brands', 'influencer', 'influencers', 'user', 'users', 'account', 'accounts', 'profile', 'profiles', 'people', 'person', 'singer', 'singers', 'musician', 'musicians'],
  post: ['post', 'posts', 'video', 'videos', 'clip', 'clips', 'reel', 'reels'],
  // "music" is deliberately absent: it is a word in real titles ("Music & Me"),
  // and dropping it would turn a track search into a search for "&".
  track: ['track', 'tracks', 'song', 'songs', 'tune', 'tunes', 'audio'],
};

/** Filler plus the noun for the thing being asked about. */
export const CREATOR_QUERY_WORDS: ReadonlySet<string> = new Set([...FILLER_WORDS, ...ENTITY_WORDS.creator]);
export const POST_QUERY_WORDS: ReadonlySet<string> = new Set([...FILLER_WORDS, ...ENTITY_WORDS.post]);
export const TRACK_QUERY_WORDS: ReadonlySet<string> = new Set([...FILLER_WORDS, ...ENTITY_WORDS.track]);

/** How a reading combines its tokens: every one has to match, or one is enough. */
export interface SearchReading {
  tokens: string[];
  match: 'all' | 'any';
}

/**
 * The readings of a `q`, most specific first.
 *
 * A search box sends prose and a directory sends keywords, and one rule cannot
 * serve both: "lagos producer" should narrow, while "show me creators in
 * nigeria" should not be asked to match "show", "me" and "creators" against a
 * username. So a query gets at most two readings. The first drops the filler
 * words and ANDs the rest. The second keeps the same words and ORs them, which
 * rescues a long question whose remaining words name a category rather than
 * one person.
 *
 * The looser reading is only offered when the query actually carried filler
 * words. That is what separates a sentence from a keyword pair: "lagos
 * producer" asked for both words and gets both or nothing, while "creators in
 * lagos with house music" is a question and is allowed to answer with what it
 * can.
 *
 * The caller walks the list and stops at the first reading that returns rows.
 * A page that matches nothing is never charged, so an empty reading is free.
 */
export function searchReadings(
  q: string | null,
  drop: ReadonlySet<string> = FILLER_WORDS,
  maxTokens = 6,
): SearchReading[] {
  let tokens = searchTokens(q, Number.POSITIVE_INFINITY);
  if (drop === CREATOR_QUERY_WORDS) {
    const joined: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      let consumed = 1;
      for (let size = Math.min(7, tokens.length - index); size >= 2; size -= 1) {
        const phrase = tokens.slice(index, index + size).join(' ');
        if (asCountryCode(phrase)) {
          joined.push(phrase);
          consumed = size;
          break;
        }
      }
      if (consumed === 1) joined.push(tokens[index]!);
      index += consumed - 1;
    }
    tokens = joined;
  }
  if (tokens.length === 0) return [{ tokens: [], match: 'all' }];
  const meaningful = tokens.filter((token) => !drop.has(token));
  const content = meaningful.slice(0, maxTokens);
  // A query that is nothing but filler ("the song") still has to search for
  // something, so the words are kept rather than thrown away.
  if (content.length === 0) return [{ tokens: tokens.slice(0, maxTokens), match: 'all' }];
  const readings: SearchReading[] = [{ tokens: content, match: 'all' }];
  const wasSentence = meaningful.length !== tokens.length;
  if (wasSentence && content.length > 1) readings.push({ tokens: content, match: 'any' });
  return readings;
}

/** Case-insensitive substring match, used for every text search on a paid route. */
export function containsInsensitive(value: string): { contains: string; mode: 'insensitive' } {
  return { contains: value, mode: 'insensitive' };
}

/**
 * The country a `q` names, as an ISO 3166 alpha-2 code, or null.
 *
 * Both forms have to work: "creators in NG" is what an agent sends because the
 * API stores `NG`, and "creators in Nigeria" is what a person types. The name
 * side is the same table the rest of the app normalises geo data with, so a
 * name that reaches a profile from a provider reaches this search too.
 */
export function asCountryCode(value: string): string | null {
  return toIso2(value);
}
