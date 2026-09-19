'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Check, Copy, Plus } from 'lucide-react';
import { Logo } from './Logo';
import { cn } from './ui';

interface PageHeaderProps {
  onReset?: () => void;
  burnerBalance?: string;
  burnerAddress?: string;
}

export function PageHeader({
  onReset,
  burnerBalance = '0.05 CELO',
  burnerAddress = '0xb8Bb86b2649eF45C1514AAacAEd389E8164B04Ef',
}: PageHeaderProps) {
  const pathname = usePathname();
  const isLedger = pathname === '/settlements';
  const isChat = !isLedger;
  const [copied, setCopied] = useState(false);

  const handleCopyWallet = () => {
    if (!burnerAddress) return;
    navigator.clipboard.writeText(burnerAddress).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-[#0b0e14]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
        {/* Brand Identity */}
        <Link href="/" className="group flex items-center gap-2.5" aria-label="Streamlivr Home">
          <div className="flex flex-col">
            <Logo height={22} />
          </div>
        </Link>

        {/* Center/Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Clean Navigation Toggle (Demo / Payout ledger) */}
          <nav className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
            <Link
              href="/"
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                isChat
                  ? 'bg-white/[0.09] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]',
              )}
            >
              Demo
            </Link>
            <Link
              href="/settlements"
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                isLedger
                  ? 'bg-white/[0.09] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]',
              )}
            >
              Payout ledger
            </Link>
          </nav>

          {/* Clean Burner Balance Badge */}
          <button
            type="button"
            onClick={handleCopyWallet}
            title={copied ? 'Copied address!' : `Demo burner: ${burnerAddress} (click to copy)`}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs shadow-sm transition-all hover:border-white/[0.14] active:scale-95"
          >
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="font-medium text-slate-300">Celo Mainnet</span>
            <span className="text-slate-600">•</span>
            <span className="font-mono font-medium text-cyan-300">{burnerBalance}</span>
            <span className="hidden text-[11px] font-light text-slate-400 sm:inline">
              {copied ? 'copied!' : ''}
            </span>
            {copied ? (
              <Check size={11} className="text-emerald-400" />
            ) : (
              <Copy size={11} className="hidden text-slate-500 hover:text-slate-300 sm:inline" />
            )}
          </button>

          {/* New Chat Button */}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="rounded-xl border border-white/5 p-2 text-slate-400 transition-colors hover:border-white/10 hover:bg-white/[0.06] hover:text-white"
              title="New chat"
            >
              New chat
              <Plus size={16} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
