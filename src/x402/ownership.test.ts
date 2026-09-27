import { describe, expect, it } from 'vitest';
import {
  creditedCreatorIds,
  normalizeArtistName,
  resolvePostOwnership,
  resolveTrackOwnership,
  type OwnershipLookup,
} from './ownership.js';

/**
 * Attribution decides who gets paid, so the policy is pinned here.
 *
 * The rule under test: original audio pays the creator who made it, borrowed
 * audio pays the artist who owns the sound rather than the account that used
 * it, and audio nobody on Streamlivr owns is retained by the platform.
 */
const lookup: OwnershipLookup = {
  soundAuthorByIsrc: new Map([
    ['NGAAA2600001', 'creator-ada'],
    ['USAT22503794', 'creator-burna'],
  ]),
  userByArtist: new Map([
    ['ada', 'creator-ada'],
    ['burna boy', 'creator-burna'],
  ]),
};

describe('artist name normalisation', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeArtistName('Burna  Boy')).toBe('burna boy');
    expect(normalizeArtistName('Beyoncé')).toBe('beyonce');
    expect(normalizeArtistName('Tems (feat. Wizkid)')).toBe('tems feat wizkid');
    expect(normalizeArtistName(null)).toBe('');
  });
});

describe('posts', () => {
  it('credits the author of a post with their own audio', () => {
    const row = resolvePostOwnership({ authorId: 'creator-zola' }, lookup);
    expect(row.basis).toBe('own-audio');
    expect(row.creatorId).toBe('creator-zola');
  });

  it('credits the author of a post that carries their own sound', () => {
    const row = resolvePostOwnership({ authorId: 'creator-ada', soundAuthorId: 'creator-ada' }, lookup);
    expect(row.basis).toBe('own-sound');
    expect(row.creatorId).toBe('creator-ada');
  });

  it('credits the sound owner, not the account that used the sound', () => {
    // The case the old rule got wrong: the poster is not the artist, and the
    // artist is on Streamlivr, so the artist is paid.
    const row = resolvePostOwnership({ authorId: 'creator-user-of-sound', soundAuthorId: 'creator-ada' }, lookup);
    expect(row.basis).toBe('original-sound-owner');
    expect(row.creatorId).toBe('creator-ada');
    expect(row.note).toContain('not the account that used it');
  });

  it('retains a post built on a commercial detection that nobody here owns', () => {
    const row = resolvePostOwnership(
      { authorId: 'creator-zola', detectedTrack: { isrc: 'GBAAA0000000', artist: 'Some Major Label Act' } },
      lookup,
    );
    expect(row.basis).toBe('commercial-audio');
    expect(row.creatorId).toBeNull();
  });

  it('retains a post whose sound belongs to an account that cannot be credited', () => {
    // The sound exists, its author is real, and that author is private. Paying
    // the poster instead would move the money to someone who did not make the
    // audio, so the amount stays with the platform.
    const row = resolvePostOwnership(
      { authorId: 'creator-zola', soundAuthorId: null, soundOwnerNotCreditable: true },
      lookup,
    );
    expect(row.basis).toBe('commercial-audio');
    expect(row.creatorId).toBeNull();
  });

  it('still credits a public sound owner on the same page', () => {
    const row = resolvePostOwnership(
      { authorId: 'creator-zola', soundAuthorId: 'creator-ada', soundOwnerNotCreditable: false },
      lookup,
    );
    expect(row.creatorId).toBe('creator-ada');
  });

  it('retains a post whose attached sound is a commercial detection with no owner', () => {
    const row = resolvePostOwnership(
      { authorId: 'creator-zola', soundIsCommercial: true, soundIsrc: 'GB0000000009' },
      lookup,
    );
    expect(row.basis).toBe('commercial-audio');
    expect(row.creatorId).toBeNull();
  });

  it('credits the artist of a detection when that artist is on Streamlivr', () => {
    const row = resolvePostOwnership(
      { authorId: 'creator-zola', detectedTrack: { isrc: 'USAT22503794', artist: 'Burna Boy' } },
      lookup,
    );
    expect(row.creatorId).toBe('creator-burna');
  });

  it('retains a post built on a library track with no Streamlivr artist', () => {
    const row = resolvePostOwnership(
      { authorId: 'creator-zola', pickedTrack: { isrc: 'FR0000000001', artist: 'Some Library Act' } },
      lookup,
    );
    expect(row.basis).toBe('commercial-audio');
    expect(row.creatorId).toBeNull();
  });
});

describe('catalog rows', () => {
  it('credits a recording to the creator whose own sound carries that ISRC', () => {
    const row = resolveTrackOwnership({ isrc: 'NGAAA2600001', artist: 'Ada' }, lookup);
    expect(row.basis).toBe('original-sound-owner');
    expect(row.creatorId).toBe('creator-ada');
  });

  it('credits the artist account when the artist is on Streamlivr', () => {
    const row = resolveTrackOwnership({ isrc: null, artist: 'Burna Boy' }, lookup);
    expect(row.basis).toBe('track-artist');
    expect(row.creatorId).toBe('creator-burna');
  });

  it('retains a commercial recording that no Streamlivr account owns', () => {
    const row = resolveTrackOwnership({ isrc: 'SE0000000002', artist: 'Some Act' }, lookup);
    expect(row.basis).toBe('commercial-audio');
    expect(row.creatorId).toBeNull();
    expect(row.note).toContain('retained by the platform');
  });
});

describe('a page of rows', () => {
  it('credits each owner once, in row order', () => {
    const ids = creditedCreatorIds([
      resolvePostOwnership({ authorId: 'creator-ada' }, lookup),
      resolvePostOwnership({ authorId: 'creator-zola', soundAuthorId: 'creator-ada' }, lookup),
      resolvePostOwnership({ authorId: 'creator-zola' }, lookup),
      resolvePostOwnership({ authorId: 'creator-zola', soundIsCommercial: true, soundIsrc: 'XX0000000001' }, lookup),
    ]);
    expect(ids).toEqual(['creator-ada', 'creator-zola']);
  });

  it('credits nobody when nothing on the page has a Streamlivr owner', () => {
    const ids = creditedCreatorIds([
      resolveTrackOwnership({ isrc: 'SE0000000002', artist: 'Some Act' }, lookup),
    ]);
    expect(ids).toEqual([]);
  });
});
