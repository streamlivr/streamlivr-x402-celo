'use client';

import { API_BASE_URL } from './config';

/**
 * Asking the seller what a sentence means.
 *
 * The page cannot hold a model key: it runs in a browser and ships with a
 * throwaway burner wallet. So it sends the sentence to the seller's own
 * interpreter route, which holds the key, and gets back one call to make. The
 * page then makes that call with its own wallet, exactly as it would for a
 * clicked chip.
 *
 * Every failure path here is silent. A deployment without a model key, an
 * interpreter that times out, a reply that names a dataset the API does not
 * have: all of them return null and the caller falls back to the page's own
 * reader. The chat never stops working because a model was unavailable.
 */

export type ChatDataset = 'listings' | 'posts' | 'catalog';

export type ChatAction =
  | { kind: 'search'; dataset: ChatDataset; q: string | null; limit?: number; verified?: boolean; minFollowers?: number; sort?: 'followers' | 'newest' | 'views' | 'title' }
  | { kind: 'move'; moveId: string };

export interface ChatPlan {
  /** One short line the agent says before it acts, or null to stay quiet. */
  reply: string | null;
  action: ChatAction;
}

export interface InterpretTurn {
  role: 'user' | 'agent';
  text: string;
}

export interface InterpretMove {
  id: string;
  label: string;
  hint?: string;
}

/** How long to wait for the interpreter before reading the sentence locally. */
const INTERPRET_TIMEOUT_MS = 4_000;

const DATASETS: readonly ChatDataset[] = ['listings', 'posts', 'catalog'];

function isDataset(value: unknown): value is ChatDataset {
  return typeof value === 'string' && (DATASETS as readonly string[]).includes(value);
}

/** Validates the seller's answer before the page trusts it. */
function readPlan(value: unknown): ChatPlan | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const action = record.action;
  if (!action || typeof action !== 'object') return null;
  const kind = (action as Record<string, unknown>).kind;
  const reply = typeof record.reply === 'string' && record.reply.trim() ? record.reply.trim() : null;

  if (kind === 'search') {
    const search = action as Record<string, unknown>;
    const dataset = search.dataset;
    if (!isDataset(dataset)) return null;
    const q = search.q;
    const limit = search.limit;
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200)) return null;
    const verified = search.verified;
    if (verified !== undefined && (dataset !== 'listings' || typeof verified !== 'boolean')) return null;
    const minFollowers = search.minFollowers;
    if (minFollowers !== undefined && (dataset !== 'listings' || typeof minFollowers !== 'number' || !Number.isInteger(minFollowers) || minFollowers < 0 || minFollowers > 2_147_483_647)) return null;
    const sort = search.sort;
    const allowedSorts: Record<ChatDataset, readonly string[]> = { listings: ['followers', 'newest'], posts: ['newest', 'views'], catalog: ['title'] };
    if (sort !== undefined && (typeof sort !== 'string' || !allowedSorts[dataset].includes(sort))) return null;
    return { reply, action: { kind: 'search', dataset, q: typeof q === 'string' && q.trim() ? q.trim() : null,
      ...(limit === undefined ? {} : { limit }),
      ...(verified === undefined ? {} : { verified }),
      ...(minFollowers === undefined ? {} : { minFollowers }),
      ...(sort === undefined ? {} : { sort: sort as 'followers' | 'newest' | 'views' | 'title' }),
    } };
  }

  if (kind === 'move') {
    const moveId = (action as Record<string, unknown>).moveId;
    return typeof moveId === 'string' ? { reply, action: { kind: 'move', moveId } } : null;
  }

  return null;
}

export async function interpretWithModel(input: {
  message: string;
  moves: readonly InterpretMove[];
  history?: readonly InterpretTurn[];
  signal?: AbortSignal;
}): Promise<ChatPlan | null> {
  if (!input.message.trim()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERPRET_TIMEOUT_MS);
  const abort = () => controller.abort();
  input.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/agent/chat/interpret`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: input.message,
        moves: input.moves.slice(0, 24),
        history: (input.history ?? []).slice(-4),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { plan?: unknown };
    return readPlan(body.plan);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}
