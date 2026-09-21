'use client';

import { useEffect, useState } from 'react';
import { fetchStats } from './api';

/**
 * The chips on the empty state.
 *
 * They are read from the seller's free inventory route rather than hard-coded,
 * because the catalogue holds thousands of rows and changes: a chip that names
 * a track the catalogue does not have is worse than no chip at all. When the
 * inventory route is unavailable (an older deployment, or the API is down) the
 * defaults below still work. They are searches, not assertions about data.
 */
export interface Suggestion {
  /** The text a reader would type. The chat interprets it like any other query. */
  label: string;
  /** Small print explaining why this is worth asking. */
  hint?: string;
}

const FALLBACK: Suggestion[] = [
  { label: 'lagos', hint: 'Search every public creator for a city or country.' },
  { label: 'amapiano posts', hint: 'Search public posts by tag, caption or creator.' },
  { label: 'Lagos Nights in the catalog', hint: 'Search the catalog by track title, credited creator or ISRC.' },
  { label: 'What does each route cost?', hint: 'Read every 402 invoice. Nothing is signed.' },
];

function countOf(row: { creators?: number; count?: number; posts?: number }): number {
  return row.creators ?? row.posts ?? row.count ?? 0;
}

export function buildSuggestions(stats: {
  totals: { creators: number; posts: number; tracks: number };
  top: {
    countries: { code: string; creators?: number; count?: number }[];
    hashtags: { tag: string; posts?: number; count?: number }[];
  };
}): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const tag = stats.top.hashtags[0];
  const secondTag = stats.top.hashtags[1];
  const country = stats.top.countries[0];

  if (tag) {
    suggestions.push({
      label: `${tag.tag} posts`,
      hint: `${countOf(tag).toLocaleString('en-US')} public posts are tagged #${tag.tag}.`,
    });
  }
  if (secondTag) {
    suggestions.push({
      label: `${secondTag.tag} creators`,
      hint: `Creators whose work shows up under #${secondTag.tag}.`,
    });
  }
  if (country) {
    suggestions.push({
      label: `creators in ${country.code}`,
      hint: `${countOf(country).toLocaleString('en-US')} public creators in ${country.code}.`,
    });
  }
  suggestions.push({
    // A browse rather than a search: there is no track title in the inventory
    // to search for, and a chip naming a track the catalog does not have costs
    // a cent to disprove.
    label: 'browse the catalog',
    hint: `List ${stats.totals.tracks.toLocaleString('en-US')} catalogued tracks a page at a time.`,
  });
  suggestions.push({
    label: 'What does each route cost?',
    hint: 'Read every 402 invoice. Nothing is signed, so it is free.',
  });

  return suggestions.slice(0, 5);
}

export function useSuggestions(enabled: boolean): { suggestions: Suggestion[]; live: boolean } {
  const [suggestions, setSuggestions] = useState<Suggestion[]>(FALLBACK);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const stats = await fetchStats(controller.signal);
        setSuggestions(buildSuggestions(stats));
        setLive(true);
      } catch {
        // Keep the defaults. An unreachable API is already reported by the header.
      }
    })();
    return () => controller.abort();
  }, [enabled]);

  return { suggestions, live };
}
