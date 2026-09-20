'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, AlertCircle, Check, Loader2 } from 'lucide-react';
import { PayloadView } from './PayloadView';
import { RawInspector } from './RawInspector';
import { StreamText } from './StreamText';
import { networkForCaip2, shortAddress, type NetworkKey } from '@/lib/config';
import { formatUsd } from '@/lib/format';
import type { Block } from '@/lib/intents';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Two readings of the same numbers. A payable invoice is an offer the buyer is
 * about to act on. A quoted invoice is just information: the route was read and
 * left alone. They looked identical before, which made a free read look like a
 * charge.
 */
function InvoicePill({ block }: { block: Extract<Block, { kind: 'invoice' }> }) {
  const { terms, mode } = block;
  const payable = mode === 'payable';

  return (
    <div className="flex items-center gap-2 pt-0.5">
      <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-xs text-slate-300 shadow-sm">
        <span
          className={`h-1.5 w-1.5 rounded-full ${payable ? 'pulse-dot bg-cyan-400' : 'bg-slate-500'}`}
        />
        <span>
          {payable ? 'Price' : 'Quoted at'}{' '}
          <strong className="font-mono font-medium text-cyan-300">{formatUsd(terms.amount)}</strong> USDC to{' '}
          <span className="font-mono text-slate-200">{shortAddress(terms.payTo, 6)}</span>
        </span>
        <span className="text-slate-600">•</span>
        <span className="font-light text-slate-400">
          {payable ? 'the buyer pays no gas' : 'nothing signed, nothing charged'}
        </span>
      </div>
    </div>
  );
}

function ReceiptPill({ block }: { block: Extract<Block, { kind: 'receipt' }> }) {
  const hash = block.receipt.transaction ?? '';
  const network: NetworkKey = networkForCaip2(block.receipt.network, block.network);
  const explorerUrl = hash
    ? `https://${network === 'mainnet' ? 'celo' : 'celo-sepolia'}.blockscout.com/tx/${hash}`
    : null;

  const credited =
    block.credited > 1
      ? ` to ${block.credited} creators`
      : block.credited === 1
        ? ' to 1 creator'
        : '';

  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-xs text-slate-300 shadow-sm">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span>
          Settled{' '}
          <strong className="font-mono font-medium text-cyan-300">{formatUsd(block.amountAtomic)}</strong> USDC
          {credited}
        </span>
        <span className="text-slate-600">•</span>
        <span className="font-mono text-[11px] text-emerald-400">in {formatDuration(block.durationMs)}</span>
        {explorerUrl && (
          <>
            <span className="text-slate-600">•</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-cyan-300 underline-offset-2 hover:underline"
            >
              view transaction <ArrowUpRight size={10} />
            </a>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Live status line for a request that is still in flight. Settlement on Celo
 * takes several seconds, and a silent gap that long reads as a hung page, so
 * the elapsed seconds tick while the agent waits.
 */
function ProgressRow({ block, live }: { block: Extract<Block, { kind: 'progress' }>; live: boolean }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.round((Date.now() - block.startedAt) / 1000)));

  useEffect(() => {
    // A status line belongs to a request that is still running. Once the move
    // is over the counter stops, so a failed request cannot leave a timer
    // ticking in the transcript forever.
    setSeconds(Math.max(0, Math.round((Date.now() - block.startedAt) / 1000)));
    if (!live) return;
    const timer = setInterval(() => {
      setSeconds(Math.max(0, Math.round((Date.now() - block.startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [block.startedAt, live]);

  return (
    <div className="flex items-center gap-2 pt-0.5 text-[12.5px] text-slate-400">
      {live ? (
        <Loader2 size={13} strokeWidth={2.4} className="animate-spin text-cyan-300" />
      ) : (
        <Check size={13} strokeWidth={2.4} className="text-slate-600" />
      )}
      <span>{block.label}</span>
      {live && seconds >= 2 && <span className="font-mono text-[11px] text-slate-500">{seconds}s</span>}
    </div>
  );
}

function ErrorCard({ block }: { block: Extract<Block, { kind: 'error' }> }) {
  return (
    <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-3.5 text-xs text-red-200 shadow-sm backdrop-blur-md">
      <div className="flex items-start gap-2.5">
        <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-400" />
        <div>
          <p className="font-medium text-red-100">{block.text}</p>
          {block.hint && <p className="mt-1 text-[11.5px] text-red-300/80">{block.hint}</p>}
        </div>
      </div>
    </div>
  );
}

export function ChatBlock({
  block,
  onStreamDone,
  live,
}: {
  block: Block;
  onStreamDone: () => void;
  /** False once the move that produced this block has finished. */
  live: boolean;
}) {
  if (block.kind === 'text') {
    return (
      <div className="text-[14.5px] font-normal leading-relaxed text-slate-200">
        <StreamText text={block.text} onDone={onStreamDone} />
      </div>
    );
  }
  if (block.kind === 'invoice') return <InvoicePill block={block} />;
  if (block.kind === 'receipt') return <ReceiptPill block={block} />;
  if (block.kind === 'payload') {
    return <PayloadView shape={block.shape} data={block.data} endpoint={block.endpoint} />;
  }
  if (block.kind === 'raw') return <RawInspector trace={block.trace} label={block.label} />;
  if (block.kind === 'progress') return <ProgressRow block={block} live={live} />;
  return <ErrorCard block={block} />;
}

export function ThinkingBubble({ label }: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3.5 py-1.5 text-xs text-slate-300 shadow-sm">
      <Loader2 size={12} strokeWidth={2.4} className="animate-spin text-cyan-300" />
      <span>{label ?? 'Working on it...'}</span>
    </div>
  );
}

/** Sits under a turn while the move is still running and nothing else says so. */
export function WorkingRow({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 pt-0.5 text-[12.5px] text-slate-400">
      <Loader2 size={13} strokeWidth={2.4} className="animate-spin text-cyan-300" />
      <span>{label ?? 'Still working...'}</span>
    </div>
  );
}
