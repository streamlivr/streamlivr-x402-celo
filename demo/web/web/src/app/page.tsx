'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowUp } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { ChatBlock, ThinkingBubble, WorkingRow } from '@/components/ChatBlock';
import { Composer } from '@/components/Composer';
import { useChat } from '@/lib/useChat';
import { useSuggestions } from '@/lib/useSuggestions';
import { BURNER_PRIVATE_KEY } from '@/lib/config';
import { formatUsd } from '@/lib/format';
import { getSessionSpentAtomic } from '@/lib/x402pay';
import { interpretQuery, type Move } from '@/lib/intents';

export default function AgentCheckoutPage() {
  const { turns, options, busy, networkLabel, send, markStreamDone, settlementCount, settledNetwork, reset } =
    useChat(BURNER_PRIVATE_KEY);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const [inputQuery, setInputQuery] = useState('');

  /**
   * Follow the conversation as it grows. A smooth scroll gets cancelled by the
   * next update during the typewriter, so this scrolls instantly and stops
   * following the moment a reader scrolls up to read back.
   */
  useEffect(() => {
    const onScroll = () => {
      const distanceFromBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      pinnedRef.current = distanceFromBottom < 240;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!pinnedRef.current) return;
    // After layout, so the message that was just added is measured, not the
    // height the page had one frame earlier.
    const frame = requestAnimationFrame(() => {
      const bottom = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      window.scrollTo({ top: bottom, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  });

  /**
   * Cover art and audio load after the block renders, so the page is taller a
   * moment later. Without this the newest line drifts off screen while the
   * reader is still pinned to the bottom.
   */
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      const bottom = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      window.scrollTo({ top: bottom, behavior: 'auto' });
    });
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  const sessionSpentAtomic = useMemo(() => getSessionSpentAtomic(), [turns]);
  const sessionSpent = useMemo(() => formatUsd(String(sessionSpentAtomic)), [sessionSpentAtomic]);

  /**
   * Typed text is interpreted by the same module the chips use, so the two
   * cannot disagree about what "amapiano posts" means. A dataset word turns
   * into a search on that dataset, a question about pricing turns into the
   * price list, and anything else is treated as a search over public creators.
   */
  const findMove = (query: string): Move | undefined => interpretQuery(query, options);

  const handlePromptSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = inputQuery.trim();
    if (busy || !query) return;

    const targetMove = findMove(query);
    if (targetMove) {
      pinnedRef.current = true;
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
      pinnedRef.current = true;
      send(customLabel ? { ...move, label: customLabel } : move);
    }
  };

  // Suggestion chips for the empty state. They come from the seller's free
  // inventory route, so every label names something the catalogue actually
  // contains; when that route is unavailable the hook keeps its defaults.
  const { suggestions } = useSuggestions(turns.length === 0);

  return (
    <div className="bg-ambient-gradient flex min-h-screen flex-col justify-between selection:bg-[#00daf8]/20 selection:text-[#00daf8]">
      <PageHeader
        onReset={turns.length > 0 ? reset : undefined}
        refreshKey={settlementCount}
        networkKey={settledNetwork}
      />

      {turns.length === 0 ? (
        /* BEGIN: Empty State (Minimal, Human, Not Bulk, Not Robotic) */
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">

          {/* Clean Human Headline */}
          <h1 className="text-center font-display text-3xl font-bold tracking-tight text-white sm:text-5xl sm:leading-[1.18]">
            Ask the catalog.{' '}
            <span className="block bg-gradient-to-r from-white via-slate-100 to-[#00daf8] bg-clip-text text-transparent">
              Every answer pays the creators.
            </span>
          </h1>

          {/* Conversational Subtitle */}
          <p className="mt-3.5 max-w-lg text-center text-[15px] leading-relaxed text-slate-400 sm:text-[16px]">
            Thousands of public creators, posts and tracks, available a page at a time over x402, and every settlement
            is split with the creators behind it.
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
              {suggestions.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={busy}
                  title={item.hint}
                  onClick={() => {
                    pinnedRef.current = true;
                    setInputQuery(item.label);
                    const move = findMove(item.label);
                    if (move) {
                      send({ ...move, label: item.label });
                      setInputQuery('');
                    }
                  }}
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
              Today
            </span>
          </div>

          <ol className="flex flex-col space-y-7">
            {turns.map((turn, turnIndex) =>
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
                    {turn.blocks.length === 0 && <ThinkingBubble label="Sending the request..." />}
                    {turn.blocks.slice(0, turn.revealed).map((block, index) => (
                      <div key={index} className="turn-in">
                        <ChatBlock
                          block={block}
                          onStreamDone={() => markStreamDone(turn.id, index)}
                          live={turn.status !== 'done'}
                        />
                      </div>
                    ))}
                    {/* Keeps a live indicator on screen while the agent is
                        still working and while the blocks it queued are still
                        being revealed, so a long answer never looks finished
                        halfway through. */}
                    {turnIndex === turns.length - 1 &&
                      (busy || turn.status !== 'done') &&
                      turn.blocks[turn.revealed - 1]?.kind !== 'progress' && (
                        <WorkingRow
                          label={
                            busy
                              ? 'Working on it...'
                              : `Showing the rest of the response (${turn.revealed} of ${turn.blocks.length})...`
                          }
                        />
                      )}
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
