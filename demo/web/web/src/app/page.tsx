'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowUp } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { ChatBlock, ThinkingBubble } from '@/components/ChatBlock';
import { Composer } from '@/components/Composer';
import { useChat } from '@/lib/useChat';
import { BURNER_PRIVATE_KEY } from '@/lib/config';
import { formatUsd } from '@/lib/format';
import { getSessionSpentAtomic } from '@/lib/x402pay';
import type { Move } from '@/lib/intents';

export default function AgentCheckoutPage() {
  const { turns, options, busy, networkLabel, send, advance, reset } = useChat(BURNER_PRIVATE_KEY);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [inputQuery, setInputQuery] = useState('');

  // Scroll smoothly when new blocks reveal
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const sessionSpentAtomic = useMemo(() => getSessionSpentAtomic(), [turns]);
  const sessionSpent = useMemo(() => formatUsd(String(sessionSpentAtomic)), [sessionSpentAtomic]);

  // Find move by intent or keyword
  const findMove = (query: string): Move | undefined => {
    const q = query.toLowerCase().trim();
    if (!q) return options.find((m) => m.id === 'listings') || options[0];

    if (q.includes('artist') || q.includes('creator') || q.includes('who') || q.includes('meet') || q.includes('listing')) {
      return options.find((m) => m.id === 'listings') || options[0];
    }
    if (q.includes('music') || q.includes('catalog') || q.includes('track') || q.includes('song') || q.includes('stem') || q.includes('solaris')) {
      return options.find((m) => m.id === 'catalog') || options[0];
    }
    if (q.includes('payout') || q.includes('settle') || q.includes('test') || q.includes('ping') || q.includes('payment') || q.includes('celo')) {
      return options.find((m) => m.id === 'ping') || options[0];
    }
    if (q.includes('quote') || q.includes('price') || q.includes('terms') || q.includes('license') || q.includes('royalty')) {
      return options.find((m) => m.id === 'quote') || options[0];
    }
    if (q.includes('wallet') || q.includes('balance') || q.includes('burner') || q.includes('funds')) {
      return options.find((m) => m.id === 'wallet') || options[0];
    }
    if (q.includes('how') || q.includes('work') || q.includes('explain') || q.includes('about')) {
      return options.find((m) => m.id === 'explain') || options[0];
    }

    return options.find((m) => m.label.toLowerCase().includes(q)) || options[0];
  };

  const handlePromptSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = inputQuery.trim();
    if (busy || !query) return;

    const targetMove = findMove(query);
    if (targetMove) {
      send({ ...targetMove, label: query });
      setInputQuery('');
    }
  };

  const handlePickOption = (moveOrId: Move | string, customLabel?: string) => {
    if (busy) return;
    const move =
      typeof moveOrId === 'string'
        ? options.find((m) => m.id === moveOrId) || findMove(moveOrId)
        : moveOrId;
    if (move) {
      send(customLabel ? { ...move, label: customLabel } : move);
    }
  };

  // Suggestion prompt pills for the empty state
  const emptyStateSuggestions = [
    { label: 'Solaris Echoes discography', moveId: 'catalog' },
    { label: 'Meet verified creators on Celo', moveId: 'listings' },
    { label: 'License terms for VIP stems', moveId: 'quote' },
    { label: 'Test an instant 0.01 CELO payment', moveId: 'ping' },
  ];

  return (
    <div className="bg-ambient-gradient flex min-h-screen flex-col justify-between selection:bg-[#00daf8]/20 selection:text-[#00daf8]">
      <PageHeader onReset={turns.length > 0 ? reset : undefined} />

      {turns.length === 0 ? (
        /* BEGIN: Empty State (Minimal, Human, Not Bulk, Not Robotic) */
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">

          {/* Clean Human Headline */}
          <h1 className="text-center font-display text-3xl font-bold tracking-tight text-white sm:text-5xl sm:leading-[1.18]">
            Ask our catalog.{' '}
            <span className="block bg-gradient-to-r from-white via-slate-100 to-[#00daf8] bg-clip-text text-transparent">
              Every answer pays the artist.
            </span>
          </h1>

          {/* Conversational Subtitle */}
          <p className="mt-3.5 max-w-lg text-center text-[15px] leading-relaxed text-slate-400 sm:text-[16px]">
            Streamlivr routes micro-royalties straight to creator wallets on Celo in under 200ms with zero gas fees. Explore music rights, artist profiles, and live listings.
          </p>

          {/* Single Master Floating Input Bar */}
          <div className="mt-8 w-full">
            <form
              onSubmit={handlePromptSubmit}
              className="relative flex items-center rounded-2xl border border-white/[0.09] bg-[#131722]/90 p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.4)] transition-all focus-within:border-cyan-400/40 focus-within:ring-1 focus-within:ring-cyan-400/30"
            >
              <input
                type="text"
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                placeholder="Ask anything or search protected catalog..."
                disabled={busy}
                className="w-full border-none bg-transparent px-3 py-2.5 text-sm leading-relaxed text-white placeholder-slate-500 focus:outline-none focus:ring-0"
              />

              <button
                type="submit"
                disabled={busy || !inputQuery.trim()}
                aria-label="Send query"
                className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(0,218,248,0.3)] transition-all hover:bg-cyan-300 active:scale-95 disabled:opacity-40"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </form>

            {/* Minimal Suggestion Chips (Text-Only, Human, Clean) */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {emptyStateSuggestions.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={busy}
                  onClick={() => handlePickOption(item.moveId, item.label)}
                  className="whitespace-nowrap rounded-full border border-white/[0.07] bg-white/[0.03] px-3.5 py-1.5 text-xs text-slate-300 shadow-sm transition-all hover:border-white/[0.15] hover:bg-white/[0.07] hover:text-white active:scale-95 disabled:opacity-40"
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Reassuring Protocol Note */}
            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11.5px] font-light text-slate-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>Autonomous x402 micropayments on Celo</span>
              <span className="text-slate-600">•</span>
              <span>Gas sponsored</span>
            </p>
          </div>
        </main>
      ) : (
        /* BEGIN: Conversational Thread (Claude/ChatGPT Style) */
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col space-y-8 px-4 py-8 sm:px-6 sm:py-12">
          {/* Subtle Session Timestamp */}
          <div className="flex items-center justify-center">
            <span className="rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1 text-[11px] font-medium text-slate-400">
              Today • Direct creator query
            </span>
          </div>

          <ol className="flex flex-col space-y-7">
            {turns.map((turn) =>
              turn.role === 'user' ? (
                <li key={turn.id} className="turn-in flex justify-end items-end gap-2.5">
                  <div className="max-w-md rounded-3xl rounded-br-md border border-white/[0.09] bg-gradient-to-b from-[#1b202c] to-[#151923] px-5 py-3.5 text-[15px] leading-relaxed text-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.25)] sm:max-w-lg">
                    {turn.label}
                  </div>
                </li>
              ) : (
                <li key={turn.id} className="turn-in flex items-start gap-3.5 sm:gap-4.5">
                  {/* Warm Assistant Avatar with Real Streamlivr Icon */}
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-cyan-400/30 shadow-[0_2px_10px_rgba(0,218,248,0.15)]">
                    <Image
                      src="/streamlivr-icon.png"
                      width={32}
                      height={32}
                      alt="Streamlivr"
                      className="h-full w-full object-cover"
                    />
                  </div>

                  {/* Assistant Content */}
                  <div className="max-w-2xl flex-1 space-y-3.5">
                    {turn.blocks.length === 0 && <ThinkingBubble />}
                    {turn.blocks.slice(0, turn.revealed).map((block, index) => (
                      <div key={index} className="turn-in">
                        <ChatBlock block={block} onStreamDone={() => advance(turn.id)} />
                      </div>
                    ))}
                  </div>
                </li>
              ),
            )}
          </ol>
          <div ref={bottomRef} />
        </main>
      )}

      {/* DOCKED COMPOSER: Rendered only when turns.length > 0 */}
      {turns.length > 0 && (
        <Composer
          options={options}
          busy={busy}
          onPick={handlePickOption}
          onReset={reset}
          networkLabel={networkLabel}
          sessionSpentLabel={sessionSpent}
        />
      )}
    </div>
  );
}
