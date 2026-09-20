'use client';

import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { interpretQuery, type Move } from '@/lib/intents';

export function Composer({
  options,
  busy,
  onPick,
}: {
  options: Move[];
  busy: boolean;
  onPick: (move: Move) => void;
  onReset: () => void;
  networkLabel: string;
  sessionSpentLabel: string;
}) {
  const [typedText, setTypedText] = useState('');

  /**
   * The same interpretation the empty state and the chips use. Search terms
   * survive: "amapiano posts" searches posts, "lagos" searches creators, and
   * "Music & Me by Nate Dogg" searches the catalogue by title and creator.
   */
  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !typedText.trim()) return;
    const move = interpretQuery(typedText, options);
    if (move) {
      onPick({ ...move, label: typedText.trim() });
      setTypedText('');
    }
  };

  return (
    <footer className="sticky bottom-0 z-40 w-full border-t border-white/[0.06] bg-[#0b0e14]/90 px-4 pb-5 pt-3 backdrop-blur-xl sm:px-6">
      <div className="mx-auto max-w-2xl space-y-3">
        {/* Sleek Suggestion Chips (Minimal, NOT bulky!) */}
        {/* Four chips, not three: after a search the useful next steps are the
            next page, a profile, and the same query in another dataset. */}
        {options.length > 0 && (
          <div className="no-scrollbar flex items-center justify-center gap-2 overflow-x-auto py-0.5">
            {options.slice(0, 4).map((move) => (
              <button
                key={move.id}
                type="button"
                disabled={busy}
                title={move.hint}
                onClick={() => onPick(move)}
                className="whitespace-nowrap rounded-full border border-white/[0.07] bg-white/[0.03] px-3.5 py-1.5 text-xs text-slate-300 shadow-sm transition-all hover:border-white/[0.15] hover:bg-white/[0.07] hover:text-white active:scale-95 disabled:opacity-40"
              >
                {move.label}
              </button>
            ))}
          </div>
        )}

        {/* Warm, Floating, Beautifully Crafted Input Bar */}
        <form
          onSubmit={handleTextSubmit}
          className="relative flex items-center rounded-2xl border border-white/[0.09] bg-[#131722]/90 p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.4)] transition-all focus-within:border-cyan-400/40 focus-within:ring-1 focus-within:ring-cyan-400/30"
        >
          <input
            type="text"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            placeholder="Search creators, posts and tracks — or ask what it costs"
            disabled={busy}
            className="w-full border-none bg-transparent px-3 py-2 text-sm leading-relaxed text-white placeholder-slate-500 focus:outline-none focus:ring-0"
          />

          <button
            type="submit"
            disabled={busy || !typedText.trim()}
            aria-label="Send query"
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(0,218,248,0.3)] transition-all hover:bg-cyan-300 active:scale-95 disabled:opacity-40"
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        </form>

        {/* Frictionless Protocol Note */}
        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] font-light text-slate-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span>Autonomous x402 micropayments on Celo</span>
          <span className="text-slate-600">•</span>
          <span>Gas sponsored</span>
        </p>
      </div>
    </footer>
  );
}
