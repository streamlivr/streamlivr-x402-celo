'use client';

import { useState } from 'react';
import { ChevronRight, Copy, Check } from 'lucide-react';
import { cn } from './ui';
import { prettyJson } from '@/lib/format';
import { decodeBase64Url } from '@/lib/format';
import type { RequestTrace } from '@/lib/x402pay';

type Tab = 'invoice' | 'signature' | 'response' | 'body';

function decodeHeader(value: string | null): string {
  if (!value) return '(header not present on this response)';
  try {
    return prettyJson(JSON.parse(decodeBase64Url(value)));
  } catch {
    return value;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable; the text is selectable anyway */
        }
      }}
      className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-[11px] text-text-muted transition-colors duration-150 ease-out-quart hover:text-text-primary"
    >
      {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={2} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="scrollbar-thin max-h-80 overflow-auto rounded-lg border border-border bg-bg-elevated px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-text-secondary">
      {children}
    </pre>
  );
}

/**
 * The "show me the raw endpoint return" option. Everything the browser saw,
 * including the two headers x402 puts on the wire, decoded.
 */
export function RawInspector({ trace, label }: { trace: RequestTrace; label: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('invoice');

  const tabs: { id: Tab; title: string; present: boolean }[] = [
    { id: 'invoice', title: '402 invoice', present: Boolean(trace.raw.challengeHeader) },
    { id: 'signature', title: 'payment-signature', present: Boolean(trace.raw.signatureHeader) },
    { id: 'response', title: 'payment-response', present: Boolean(trace.raw.responseHeader) },
    { id: 'body', title: 'Response body', present: true },
  ];

  const active = tabs.find((entry) => entry.id === tab) ?? tabs[0];
  const content =
    tab === 'body'
      ? prettyJson(trace.body)
      : tab === 'invoice'
        ? decodeHeader(trace.raw.challengeHeader)
        : tab === 'signature'
          ? decodeHeader(trace.raw.signatureHeader)
          : decodeHeader(trace.raw.responseHeader);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors duration-150 ease-out-quart hover:bg-bg-elevated/70"
      >
        <ChevronRight
          size={14}
          strokeWidth={2}
          className={cn('shrink-0 text-text-muted transition-transform duration-200 ease-out-quart', open && 'rotate-90')}
        />
        <span className="flex-1 truncate text-[12.5px] font-medium text-text-primary">
          Raw exchange<span className="ml-2 font-normal text-text-muted">{label}</span>
        </span>
        <span className="shrink-0 rounded-full border border-border px-2 py-[3px] text-[11px] text-text-muted">
          {trace.status || 'N/A'} · {trace.durationMs}ms
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3.5 pb-3.5 pt-3">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                disabled={!entry.present}
                className={cn(
                  'rounded-control border px-2.5 py-1 text-[11.5px] transition-colors duration-150 ease-out-quart',
                  entry.id === active.id
                    ? 'border-brand-primary/40 bg-brand-primary/[0.07] text-brand-primary'
                    : 'border-border text-text-secondary hover:border-border-strong hover:text-text-primary',
                  !entry.present && 'cursor-not-allowed opacity-40 hover:border-border hover:text-text-secondary',
                )}
              >
                {entry.title}
              </button>
            ))}
          </div>

          <div className="mt-2.5 flex items-center justify-between">
            <span className="truncate font-mono text-[11px] text-text-muted">{trace.url}</span>
            <CopyButton text={content} />
          </div>

          <div className="mt-1.5">
            <Code>{content}</Code>
          </div>

          {tab === 'invoice' && (
            <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
              The seller publishes price, asset, payee and the EIP-712 domain here. A buyer needs no prior knowledge of
              this API to pay it.
            </p>
          )}
          {tab === 'signature' && (
            <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
              An off-chain EIP-3009 authorization. No approval transaction, no gas from the buyer: the facilitator
              submits it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
