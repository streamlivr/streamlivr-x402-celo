'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Typewriter reveal for agent copy, matching the mobile support chat: text
 * arrives a few characters at a time with a pulsing block cursor at the end
 * until it is complete.
 *
 * Paced by frames rather than a fixed characters-per-second rate so a long
 * paragraph does not hold the queue noticeably longer than a short one. Under
 * `prefers-reduced-motion` the text is simply present.
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

    let frame = 0;
    let raf = 0;
    const total = text.length;
    // ~34 frames is a little over half a second at 60fps.
    const step = Math.max(1, Math.ceil(total / 34));

    const tick = () => {
      frame += 1;
      const next = Math.min(total, frame * step);
      setRevealed(next);
      if (next < total) {
        raf = requestAnimationFrame(tick);
      } else {
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
