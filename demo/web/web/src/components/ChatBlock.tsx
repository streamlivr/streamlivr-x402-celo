'use client';

import { ArrowUpRight, AlertCircle } from 'lucide-react';
import { PayloadView } from './PayloadView';
import { RawInspector } from './RawInspector';
import { StreamText } from './StreamText';
import { networkForCaip2, shortAddress, type NetworkKey } from '@/lib/config';
import { formatUsd } from '@/lib/format';
import type { Block } from '@/lib/intents';

function InvoicePill({ block }: { block: Extract<Block, { kind: 'invoice' }> }) {
  const { terms } = block;

  return (
    <div className="flex items-center gap-2 pt-0.5">
      <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-xs text-slate-300 shadow-sm">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-cyan-400" />
        <span>
          Micro-payment terms:{' '}
          <strong className="font-mono font-medium text-cyan-300">{formatUsd(terms.amount)}</strong> to{' '}
          <span className="font-mono text-slate-200">{shortAddress(terms.payTo, 6)}</span>
        </span>
        <span className="text-slate-600">•</span>
        <span className="font-light text-slate-400">gas covered on Celo</span>
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

  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-xs text-slate-300 shadow-sm">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span>
          Paid <strong className="font-mono font-medium text-cyan-300">{formatUsd(block.amountAtomic)}</strong> to creator
        </span>
        <span className="text-slate-600">•</span>
        <span className="font-mono text-[11px] text-emerald-400">auto-settled in {block.durationMs}ms</span>
        {explorerUrl && (
          <>
            <span className="text-slate-600">•</span>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-cyan-300 underline-offset-2 hover:underline"
            >
              view tx <ArrowUpRight size={10} />
            </a>
          </>
        )}
      </div>
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

export function ChatBlock({ block, onStreamDone }: { block: Block; onStreamDone: () => void }) {
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
    return <PayloadView shape={block.shape} data={block.data} />;
  }
  if (block.kind === 'raw') return <RawInspector trace={block.trace} label={block.label} />;
  return <ErrorCard block={block} />;
}

export function ThinkingBubble() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3.5 py-1.5 text-xs text-slate-300 shadow-sm">
      <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-cyan-400" />
      <span>Connecting with creator catalog on Celo...</span>
    </div>
  );
}
