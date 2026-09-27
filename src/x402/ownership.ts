/**
 * Who a sold row pays.
 *
 * A row is not automatically the property of the account that published it. A
 * post that borrows another creator's sound is that creator's work on the audio
 * side, and a commercial recording that happens to be in a post belongs to an
 * artist who may not be on Streamlivr at all. Crediting the poster in either
 * case pays the wrong person, which is the kind of mistake that turns a payout
 * ledger into a dispute.
 *
 * The rule this module implements:
 *
 *   1. Original audio pays the creator who made it. A post with no borrowed
 *      audio, or with the author's own sound on it, credits the author.
 *   2. Borrowed audio pays the artist who owns the sound, not the account that
 *      used it. If that artist is on Streamlivr, they are credited.
 *   3. Audio nobody on Streamlivr owns is not credited to anyone. The amount
 *      stays with the platform, which is where the app's own share already
 *      goes, and the row says so.
 *
 * Nothing here reads the database: the caller resolves an ISRC to a sound
 * author and an artist name to a Streamlivr account, and this module decides
 * from those facts. That keeps the policy unit testable and in one place,
 * instead of spread across three route handlers.
 */

/** Why a row credits who it credits. Stable strings: the ledger records them. */
export type OwnershipBasis =
  /** The post carries the author's own audio. */
  | 'own-audio'
  /** The post carries a sound the author owns. */
  | 'own-sound'
  /** The post carries another creator's sound, so that creator is paid. */
  | 'original-sound-owner'
  /** A catalogued recording whose artist is a Streamlivr creator. */
  | 'track-artist'
  /** Commercial or library audio with no Streamlivr owner. */
  | 'commercial-audio'
  /** A row the seller could not tie to a creator at all. */
  | 'unattributable';

export interface RowOwnership {
  /** The Streamlivr account to credit, or null when the platform retains it. */
  creatorId: string | null;
  basis: OwnershipBasis;
  /** One short sentence a buyer can read on the row itself. */
  note: string;
}

/**
 * What the seller was able to find out about the audio on a row.
 *
 * `soundAuthorByIsrc` maps a recording code to the Streamlivr account whose
 * original audio carries it. Commercial detections are deliberately left out by
 * the caller: a Sound row of kind MUSIC records who uploaded the detection, not
 * who made the recording, and treating those as the artist is exactly the
 * mistake this module exists to prevent.
 *
 * `userByArtist` maps a normalised artist name to a Streamlivr account, which is
 * how a library track is tied back to an artist who is on the platform.
 */
export interface OwnershipLookup {
  soundAuthorByIsrc: Map<string, string>;
  userByArtist: Map<string, string>;
}

export const EMPTY_OWNERSHIP_LOOKUP: OwnershipLookup = {
  soundAuthorByIsrc: new Map(),
  userByArtist: new Map(),
};

/**
 * Artist names arrive from a music provider, so they carry punctuation, accents
 * and features that an account name does not. Lowercasing and collapsing
 * whitespace is enough to match "Burna  Boy" to "burna boy"; anything cleverer
 * starts guessing, and a guess here moves money.
 */
export function normalizeArtistName(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the post row knows about its own audio. */
export interface PostAudioFacts {
  /** The account that published the post. */
  authorId: string;
  /** The creator-owned sound attached to the post, when there is one. */
  soundAuthorId?: string | null;
  /** True when the attached sound is a commercial detection, not a creator's audio. */
  soundIsCommercial?: boolean;
  /** The recording code of the attached sound, when it carries one. */
  soundIsrc?: string | null;
  /**
   * True when the post carries a creator sound whose author cannot be credited
   * here, because that account is private or has revoked agent access.
   *
   * A public row never pays a private account, and it never falls back to
   * whoever posted the row, so the amount is retained the same way audio with
   * no Streamlivr owner is.
   */
  soundOwnerNotCreditable?: boolean;
  /** A library track the creator picked to overlay. */
  pickedTrack?: { isrc?: string | null; artist?: string | null } | null;
  /** The commercial recording the fingerprint detector heard in the post. */
  detectedTrack?: { isrc?: string | null; artist?: string | null } | null;
}

/** What a catalog row knows about itself. */
export interface TrackFacts {
  isrc?: string | null;
  artist?: string | null;
}

function noteFor(basis: OwnershipBasis, creatorId: string | null): string {
  switch (basis) {
    case 'own-audio':
      return 'Original audio, credited to the creator who published it.';
    case 'own-sound':
      return 'Uses the creator\u2019s own sound, credited to that creator.';
    case 'original-sound-owner':
      return 'Credited to the artist who owns this recording, not the account that used it.';
    case 'track-artist':
      return 'Credited to the artist on this recording, who has a Streamlivr account.';
    case 'commercial-audio':
      return 'No Streamlivr creator can be credited for this audio, so the amount is retained by the platform.';
    default:
      return creatorId
        ? 'Credited to the creator who owns this row.'
        : 'No Streamlivr owner could be resolved, so the platform retains the amount.';
  }
}

function ownership(creatorId: string | null, basis: OwnershipBasis): RowOwnership {
  return { creatorId, basis, note: noteFor(basis, creatorId) };
}

/**
 * Credits a recording to its artist when that artist is on Streamlivr, and to
 * nobody when it is not.
 */
export function resolveTrackOwnership(track: TrackFacts, lookup: OwnershipLookup): RowOwnership {
  const isrc = track.isrc?.trim();
  if (isrc) {
    const soundAuthor = lookup.soundAuthorByIsrc.get(isrc);
    if (soundAuthor) return ownership(soundAuthor, 'original-sound-owner');
  }
  const artist = normalizeArtistName(track.artist);
  if (artist) {
    const artistUser = lookup.userByArtist.get(artist);
    if (artistUser) return ownership(artistUser, 'track-artist');
  }
  return ownership(null, 'commercial-audio');
}

/**
 * Credits a post to whoever made its audio.
 *
 * A post with nothing attached is the author's own recording. A post with the
 * author's own sound is the same thing. A post with someone else's sound pays
 * that someone. A post whose audio resolves to a commercial recording pays the
 * artist only if the artist is on Streamlivr.
 */
export function resolvePostOwnership(post: PostAudioFacts, lookup: OwnershipLookup): RowOwnership {
  // A sound whose owner cannot be credited is retained, not reassigned to the
  // account that happened to publish the post.
  if (post.soundOwnerNotCreditable && !post.soundAuthorId) return ownership(null, 'commercial-audio');

  const hasSound = Boolean(post.soundAuthorId) || Boolean(post.soundIsCommercial);

  if (post.soundAuthorId && !post.soundIsCommercial) {
    return post.soundAuthorId === post.authorId
      ? ownership(post.authorId, 'own-sound')
      : ownership(post.soundAuthorId, 'original-sound-owner');
  }

  // A commercial detection on the attached sound is the same situation as a
  // commercial track the creator picked: nobody on Streamlivr owns the master,
  // so the artist is credited only when they have an account here.
  const commercial = post.soundIsCommercial
    ? { isrc: post.soundIsrc ?? null, artist: null }
    : (post.pickedTrack ?? post.detectedTrack ?? null);

  if (commercial) {
    const resolved = resolveTrackOwnership(commercial, lookup);
    if (resolved.creatorId) return resolved;
    if (post.soundIsCommercial || post.pickedTrack || post.detectedTrack) {
      return ownership(null, 'commercial-audio');
    }
  }

  if (!hasSound) return ownership(post.authorId, 'own-audio');
  return ownership(null, 'unattributable');
}

/** The accounts to credit for a page, in row order, without duplicates. */
export function creditedCreatorIds(ownerships: RowOwnership[]): string[] {
  const credited = new Set<string>();
  for (const row of ownerships) if (row.creatorId) credited.add(row.creatorId);
  return [...credited];
}
