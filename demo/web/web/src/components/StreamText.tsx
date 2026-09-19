'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Reveal for agent copy: the answer arrives word by word with a pulsing block
 * cursor at the end until it is complete.
 *
 * The whole reveal is budgeted rather than run at a fixed rate. A one-line
 * confirmation lands in under a second, and a paragraph takes about two and a
 * half seconds no matter how many words it holds, so a long answer never holds
 * the queue noticeably longer than a short one. Under `prefers-reduced-motion`
 * the text is simply present.
 */
export function StreamText({ text, onDone }: { text: string; onDone?: () => void }) {
  const [revealed, setRevealed] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || text.length === 0) {
      setRevealed(text.length);
      doneRef.current?.();
      return;
    }

    // Word boundaries carry the spaces, so the reveal can stop mid-sentence
    // without dropping a character.
    const boundaries: number[] = [];
    const pattern = /\S+\s*/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) boundaries.push(match.index + match[0].length);
    const total = boundaries.at(-1) ?? text.length;

    const duration = Math.min(2600, Math.max(700, text.length * 12));
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const target = progress * total;
      let next = 0;
      for (const boundary of boundaries) {
        if (boundary <= target) next = boundary;
        else break;
      }
      setRevealed(next);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setRevealed(total);
        doneRef.current?.();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  const streaming = revealed < text.length;
  return (
    <p className="text-[15px] leading-[22px] text-text-primary">
      {text.slice(0, revealed)}
      {streaming && <span className="cursor-block">█</span>}
    </p>
  );
}
