/**
 * Turns a visitor's sentence into one API call.
 *
 * The demo chat is not a chatbot with a menu bolted on. A visitor types what
 * they want, a language model reads the sentence, and the model picks the route
 * and the search term. The model never invents a route: it may choose a search
 * over one of three public datasets or one of the moves the page already knows.
 * Anything outside that set is discarded, and the caller falls back to its own
 * deterministic planner.
 *
 * The module is thin on purpose. It builds the system prompt, parses the reply
 * and validates it against the move list the caller passes in. The model call
 * is injected, so parsing and validation are unit tested without a network
 * round trip, and the same code serves the production API and the public demo
 * server.
 */

/** The three public datasets the paid routes sell. */
export type ChatDataset = 'listings' | 'posts' | 'catalog';

export const CHAT_DATASETS: Record<ChatDataset, { noun: string; fields: string }> = {
  listings: {
    noun: 'creator',
    fields: 'username, display name, bio and country code',
  },
  posts: {
    noun: 'post',
    fields: 'title, caption, description and hashtags',
  },
  catalog: {
    noun: 'track',
    fields: 'track title, credited artist and ISRC',
  },
};

/** One choice the page already offers, so the model can pick it by id. */
export interface ChatMoveOption {
  id: string;
  label: string;
  hint?: string;
}

export interface ChatSearchAction {
  kind: 'search';
  dataset: ChatDataset;
  q: string | null;
}

export interface ChatMoveAction {
  kind: 'move';
  moveId: string;
}

export type ChatAction = ChatSearchAction | ChatMoveAction;

export interface ChatPlan {
  /** One short sentence the agent says before it acts, or null to stay quiet. */
  reply: string | null;
  action: ChatAction;
}

/** A message must be short. Anything longer is a paste, not a question. */
export const MAX_CHAT_MESSAGE_CHARS = 500;
/** The search term the model returns is one or two words, never a paragraph. */
export const MAX_CHAT_QUERY_CHARS = 80;
/** The spoken line is one sentence. Anything longer reads like a wall. */
export const MAX_CHAT_REPLY_CHARS = 220;

/**
 * Backstop against the model naming itself or its provider.
 *
 * The page speaks as Streamlivr's agent. A reply that mentions Gemini, OpenAI
 * or a model name breaks that, and it is the one thing a prompt cannot be
 * trusted to enforce.
 */
const MODEL_LEAK =
  /\b(gemini|openai|anthropic|claude|llama|mistral|deepseek|gpt-?\d|large language model|language model|llm|chatbot)\b/i;

/** The system prompt. Kept short so a small model follows it. */
export const CHAT_INTERPRET_SYSTEM = [
  'You route a visitor request to one call against the Streamlivr public data API.',
  'You do not answer with data. You choose the call, and the API returns the data.',
  '',
  'Datasets you may search:',
  `- listings: public creator accounts (${CHAT_DATASETS.listings.fields}).`,
  `- posts: published public posts (${CHAT_DATASETS.posts.fields}).`,
  `- catalog: the music catalog (${CHAT_DATASETS.catalog.fields}).`,
  '',
  'Answer with JSON only, in this shape:',
  '{"reply":"one short sentence","action":{"kind":"search","dataset":"listings","q":"lagos"}}',
  'or',
  '{"reply":"one short sentence","action":{"kind":"move","moveId":"quote"}}',
  '',
  'Rules:',
  '- Pick a move when the request is about price, wallet, settlement, inventory or how x402 works.',
  '- Otherwise pick the dataset the request names. "creators in Nigeria" is listings, "amapiano posts" is posts, "Lagos Nights" is catalog.',
  '- q is the search term alone. Drop filler words, the dataset word, and keep a country code if one is named.',
  '- Do not invent an id. Use only the ids in the move list.',
  '- The reply is one sentence, and it never names a model or a provider.',
].join('\n');

function trimmed(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}\u2026`;
}

/**
 * Strips the model's own name out of the spoken line.
 *
 * A reply that trips the backstop is dropped rather than rewritten, because a
 * rewritten sentence about a model is still a sentence about a model. The page
 * has a line for every move, so losing this one costs nothing.
 */
export function sanitizeChatReply(reply: unknown): string | null {
  if (typeof reply !== 'string') return null;
  const clean = trimmed(reply);
  if (!clean || MODEL_LEAK.test(clean)) return null;
  return clip(clean, MAX_CHAT_REPLY_CHARS);
}

/** Datasets and ids as the page names them, so the model has something to pick. */
export function buildChatMoveList(moves: readonly ChatMoveOption[]): string {
  return moves
    .map((move) => `- ${move.id}: ${move.label}${move.hint ? ` (${move.hint})` : ''}`)
    .join('\n');
}

export interface ChatInterpretInput {
  message: string;
  /** Oldest first, trimmed by the caller. Two turns are enough context. */
  history?: readonly { role: 'user' | 'agent'; text: string }[];
  moves: readonly ChatMoveOption[];
}

/** Builds the single user turn the model answers. */
export function buildChatInterpretPrompt(input: ChatInterpretInput): string {
  const lines = [CHAT_INTERPRET_SYSTEM, '', 'Move list:', buildChatMoveList(input.moves), ''];
  const history = (input.history ?? []).slice(-4);
  if (history.length) {
    lines.push('Recent turns:');
    for (const turn of history) lines.push(`${turn.role === 'user' ? 'visitor' : 'agent'}: ${clip(trimmed(turn.text), 200)}`);
    lines.push('');
  }
  lines.push(`Visitor request: ${clip(trimmed(input.message), MAX_CHAT_MESSAGE_CHARS)}`);
  return lines.join('\n');
}

/** Pulls the JSON object out of a reply that may be fenced or padded. */
function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isDataset(value: unknown): value is ChatDataset {
  return value === 'listings' || value === 'posts' || value === 'catalog';
}

/**
 * Validates one model reply into a plan, or null when it is unusable.
 *
 * Null means "fall back to the local planner". It is the answer for a reply
 * that is not JSON, names a dataset that does not exist, names a move the page
 * does not offer, or carries no action at all. Guessing here would send a
 * visitor to a route nobody chose.
 */
export function parseChatInterpret(raw: string, moves: readonly ChatMoveOption[]): ChatPlan | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const action = record.action ?? record.plan;
  if (!action || typeof action !== 'object') return null;
  const kind = (action as Record<string, unknown>).kind;

  if (kind === 'search') {
    const dataset = (action as Record<string, unknown>).dataset;
    if (!isDataset(dataset)) return null;
    const qRaw = (action as Record<string, unknown>).q;
    const q = typeof qRaw === 'string' && trimmed(qRaw) ? clip(trimmed(qRaw), MAX_CHAT_QUERY_CHARS) : null;
    return { reply: sanitizeChatReply(record.reply), action: { kind: 'search', dataset, q } };
  }

  if (kind === 'move') {
    const moveId = (action as Record<string, unknown>).moveId;
    if (typeof moveId !== 'string') return null;
    if (!moves.some((move) => move.id === moveId)) return null;
    return { reply: sanitizeChatReply(record.reply), action: { kind: 'move', moveId } };
  }

  return null;
}

export interface PlanChatInput extends ChatInterpretInput {
  /** The model call, injected so this module stays free of a network client. */
  generate: (prompt: string) => Promise<string>;
}

/**
 * Ask the model what the sentence means, and validate the answer.
 *
 * Throws only when the model call itself fails. The caller treats a throw and a
 * null the same way: use the local planner, and never leave the visitor without
 * an answer.
 */
export async function planChatMessage(input: PlanChatInput): Promise<ChatPlan | null> {
  const raw = await input.generate(buildChatInterpretPrompt(input));
  return parseChatInterpret(raw, input.moves);
}

export interface ChatBudget {
  /** True when the caller may spend one model call, false when they are over. */
  take(key: string): boolean;
}

/**
 * A per-caller budget for the one route that spends money on a model call.
 *
 * The chat route is public because the demo page is public, and every call to
 * it costs a fraction of a cent. Left open, one script can spend a budget in a
 * minute. The budget is in process rather than in Redis: a single instance
 * handles the demo traffic, and a limit that is a few percent loose is still a
 * limit. A restart forgets the counters, which is the right direction to fail.
 */
export function createChatBudget(options: { max: number; windowMs: number; now?: () => number }): ChatBudget {
  const hits = new Map<string, number[]>();
  const clock = options.now ?? Date.now;
  return {
    take(key: string): boolean {
      const now = clock();
      // The map only grows with distinct callers, and a clear at five thousand
      // entries is cheaper than a sweep on every call.
      if (hits.size > 5_000) hits.clear();
      const recent = (hits.get(key) ?? []).filter((at) => now - at < options.windowMs);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
