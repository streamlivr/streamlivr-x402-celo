import { describe, expect, it } from 'vitest';
import {
  buildChatInterpretPrompt,
  CHAT_INTERPRET_SYSTEM,
  createChatBudget,
  MAX_CHAT_REPLY_CHARS,
  MAX_CHAT_QUERY_CHARS,
  parseChatInterpret,
  planChatMessage,
  sanitizeChatReply,
  type ChatMoveOption,
} from './chatIntent.js';

const moves: ChatMoveOption[] = [
  { id: 'quote', label: 'What does each route cost?' },
  { id: 'wallet', label: 'Show the burner wallet' },
  { id: 'ping', label: 'Settle a ping' },
];

describe('parseChatInterpret', () => {
  it('reads a search action', () => {
    const plan = parseChatInterpret(
      '{"reply":"Searching the catalog.","action":{"kind":"search","dataset":"catalog","q":"lagos nights"}}',
      moves,
    );
    expect(plan).toEqual({
      reply: 'Searching the catalog.',
      action: { kind: 'search', dataset: 'catalog', q: 'lagos nights' },
    });
  });

  it('reads a move action', () => {
    const plan = parseChatInterpret('{"reply":"Reading the price list.","action":{"kind":"move","moveId":"quote"}}', moves);
    expect(plan?.action).toEqual({ kind: 'move', moveId: 'quote' });
  });

  it('accepts a fenced JSON reply', () => {
    const plan = parseChatInterpret(
      '```json\n{"reply":"ok","action":{"kind":"search","dataset":"posts","q":"amapiano"}}\n```',
      moves,
    );
    expect(plan?.action).toEqual({ kind: 'search', dataset: 'posts', q: 'amapiano' });
  });

  it('turns a blank query into a browse', () => {
    const plan = parseChatInterpret('{"action":{"kind":"search","dataset":"listings","q":"  "}}', moves);
    expect(plan?.action).toEqual({ kind: 'search', dataset: 'listings', q: null });
    expect(plan?.reply).toBeNull();
  });

  it('rejects a dataset that does not exist', () => {
    expect(parseChatInterpret('{"action":{"kind":"search","dataset":"wallets","q":"x"}}', moves)).toBeNull();
  });

  it('rejects a move the page does not offer', () => {
    expect(parseChatInterpret('{"action":{"kind":"move","moveId":"delete-everything"}}', moves)).toBeNull();
  });

  it('rejects prose that is not an action', () => {
    expect(parseChatInterpret('I would search the catalog for that.', moves)).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseChatInterpret('{"action":', moves)).toBeNull();
  });

  it('clips an over-long query', () => {
    const long = 'a'.repeat(MAX_CHAT_QUERY_CHARS + 40);
    const plan = parseChatInterpret(`{"action":{"kind":"search","dataset":"posts","q":"${long}"}}`, moves);
    const action = plan?.action;
    expect(action?.kind).toBe('search');
    expect(action && action.kind === 'search' ? action.q!.length : 0).toBeLessThanOrEqual(MAX_CHAT_QUERY_CHARS);
  });
});

describe('sanitizeChatReply', () => {
  it('keeps a plain sentence', () => {
    expect(sanitizeChatReply('  Pulling the   catalog. ')).toBe('Pulling the catalog.');
  });

  it('drops a reply that names the model or its provider', () => {
    expect(sanitizeChatReply('Gemini will search the catalog.')).toBeNull();
    expect(sanitizeChatReply('I am a large language model.')).toBeNull();
    expect(sanitizeChatReply('Use GPT-4 to answer.')).toBeNull();
  });

  it('drops an empty reply', () => {
    expect(sanitizeChatReply('   ')).toBeNull();
    expect(sanitizeChatReply(undefined)).toBeNull();
  });

  it('clips a reply that will not fit on one line', () => {
    const long = 'word '.repeat(200);
    const clean = sanitizeChatReply(long);
    expect(clean).not.toBeNull();
    expect(clean!.length).toBeLessThanOrEqual(MAX_CHAT_REPLY_CHARS);
  });
});

describe('buildChatInterpretPrompt', () => {
  it('states the system rules, the move list and the request', () => {
    const prompt = buildChatInterpretPrompt({
      message: 'creators in Nigeria',
      moves,
      history: [
        { role: 'user', text: 'hi' },
        { role: 'agent', text: 'What would you like?' },
      ],
    });
    expect(prompt.startsWith(CHAT_INTERPRET_SYSTEM)).toBe(true);
    expect(prompt).toContain('- quote: What does each route cost?');
    expect(prompt).toContain('visitor: hi');
    expect(prompt).toContain('agent: What would you like?');
    expect(prompt.endsWith('Visitor request: creators in Nigeria')).toBe(true);
  });

  it('keeps only the last four history turns', () => {
    const prompt = buildChatInterpretPrompt({
      message: 'go on',
      moves,
      history: Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('agent' as const),
        text: `turn-${index}`,
      })),
    });
    expect(prompt).not.toContain('turn-0');
    expect(prompt).not.toContain('turn-3');
    expect(prompt).toContain('turn-4');
    expect(prompt).toContain('turn-7');
  });
});

describe('planChatMessage', () => {
  it('passes the prompt through and validates the answer', async () => {
    let seen = '';
    const plan = await planChatMessage({
      message: 'how much is a page',
      moves,
      generate: async (prompt) => {
        seen = prompt;
        return '{"reply":"Reading the price list.","action":{"kind":"move","moveId":"quote"}}';
      },
    });
    expect(seen).toContain('Visitor request: how much is a page');
    expect(plan?.action).toEqual({ kind: 'move', moveId: 'quote' });
  });

  it('returns null when the model replies with something unusable', async () => {
    const plan = await planChatMessage({ message: 'hi', moves, generate: async () => 'no idea' });
    expect(plan).toBeNull();
  });
});

describe('createChatBudget', () => {
  it('allows up to the limit inside the window and then refuses', () => {
    let now = 1_000;
    const budget = createChatBudget({ max: 3, windowMs: 10_000, now: () => now });
    expect(budget.take('1.2.3.4')).toBe(true);
    expect(budget.take('1.2.3.4')).toBe(true);
    expect(budget.take('1.2.3.4')).toBe(true);
    expect(budget.take('1.2.3.4')).toBe(false);
  });

  it('separates callers', () => {
    const budget = createChatBudget({ max: 1, windowMs: 10_000, now: () => 1_000 });
    expect(budget.take('a')).toBe(true);
    expect(budget.take('b')).toBe(true);
    expect(budget.take('a')).toBe(false);
  });

  it('frees the caller once the window passes', () => {
    let now = 1_000;
    const budget = createChatBudget({ max: 1, windowMs: 10_000, now: () => now });
    expect(budget.take('a')).toBe(true);
    now += 10_001;
    expect(budget.take('a')).toBe(true);
  });
});
