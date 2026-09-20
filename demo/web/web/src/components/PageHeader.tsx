'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, Copy, Plus } from 'lucide-react';
import { privateKeyToAccount } from 'viem/accounts';
import { Logo } from './Logo';
import { cn } from './ui';
import { BURNER_PRIVATE_KEY, MAINNET_ENABLED, NETWORKS, type NetworkKey } from '@/lib/config';
import { formatTokenBalance } from '@/lib/format';
import { fetchAssetBalance } from '@/lib/x402pay';

interface PageHeaderProps {
  onReset?: () => void;
  /** Bumped when a settled payment lands, so the balance re-reads at that moment. */
  refreshKey?: number;
  networkKey?: NetworkKey;
}

const DEFAULT_NETWORK: NetworkKey = MAINNET_ENABLED ? 'mainnet' : 'sepolia';

/**
 * The Demo / Payout ledger switch. Rendered twice: inline on wide screens, and
 * on its own row below the brand on phones, where the header has no room for
 * brand, nav, balance and the reset button on one line.
 */
function NavToggle({ isChat, isLedger, className }: { isChat: boolean; isLedger: boolean; className?: string }) {
  const item = (active: boolean) =>
    cn(
      'flex-1 rounded-lg px-3 py-1.5 text-center text-xs font-medium transition-all sm:flex-none',
      active ? 'bg-white/[0.09] text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]',
    );

  return (
    <nav className={cn('flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1', className)}>
      <Link href="/" className={item(isChat)}>
        Demo
      </Link>
      <Link href="/settlements" className={item(isLedger)}>
        Payout ledger
      </Link>
    </nav>
  );
}

export function PageHeader({
  onReset,
  refreshKey = 0,
  networkKey = DEFAULT_NETWORK,
}: PageHeaderProps) {
  const pathname = usePathname();
  const isLedger = pathname === '/settlements';
  const isChat = !isLedger;
  const [copied, setCopied] = useState(false);
  const [balanceAtomic, setBalanceAtomic] = useState<string | null>(null);

  // The address is derived from the key the demo actually signs with, so the
  // pill can never point at a different wallet than the one spending.
  const burnerAddress = useMemo(() => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(BURNER_PRIVATE_KEY)) return '';
    return privateKeyToAccount(BURNER_PRIVATE_KEY as `0x${string}`).address;
  }, []);

  const readBalance = useCallback(async () => {
    if (!burnerAddress) return;
    try {
      const balance = await fetchAssetBalance(networkKey, burnerAddress, NETWORKS[networkKey].usdc);
      setBalanceAtomic(balance);
    } catch {
      // Keep the last confirmed figure. The pill shows a placeholder until the
      // first read lands, and never invents a number.
    }
  }, [burnerAddress, networkKey]);

  useEffect(() => {
    void readBalance();
  }, [readBalance, refreshKey]);

  // A slow poll keeps the pill honest when a payment settles in another tab.
  useEffect(() => {
    const timer = setInterval(() => void readBalance(), 30_000);
    return () => clearInterval(timer);
  }, [readBalance]);

  const handleCopyWallet = () => {
    if (!burnerAddress) return;
    navigator.clipboard.writeText(burnerAddress).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-[#0b0e14]/85 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-4xl px-3 sm:px-6">
        <div className="flex h-14 items-center justify-between gap-2 sm:h-16 sm:gap-3">
          {/* Brand Identity */}
          <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label="Streamlivr Home">
            <div className="flex flex-col">
              <Logo height={20} className="sm:h-[22px]" />
            </div>
          </Link>

          {/* Center/Right Actions */}
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
            <NavToggle isChat={isChat} isLedger={isLedger} className="hidden sm:flex" />

            {/* Burner Balance Badge */}
            <button
              type="button"
              onClick={handleCopyWallet}
              title={copied ? 'Copied address!' : `Demo burner: ${burnerAddress || 'not configured'} (click to copy)`}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs shadow-sm transition-all hover:border-white/[0.14] active:scale-95 sm:gap-2 sm:px-3"
            >
              <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <span className="hidden font-medium text-slate-300 sm:inline">{NETWORKS[networkKey].label}</span>
              <span className="hidden text-slate-600 sm:inline">•</span>
              <span className="truncate font-mono font-medium text-cyan-300">
                {formatTokenBalance(balanceAtomic)} USDC
              </span>
              <span className="hidden text-[11px] font-light text-slate-400 sm:inline">
                {copied ? 'copied!' : ''}
              </span>
              {copied ? (
                <Check size={11} className="shrink-0 text-emerald-400" />
              ) : (
                <Copy size={11} className="hidden shrink-0 text-slate-500 hover:text-slate-300 sm:inline" />
              )}
            </button>

            {/* New Chat Button */}
            {onReset && (
              <button
                type="button"
                onClick={onReset}
                className="shrink-0 rounded-xl border border-white/5 p-2 text-slate-400 transition-colors hover:border-white/10 hover:bg-white/[0.06] hover:text-white"
                title="New chat"
              >
                <Plus size={16} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>

        {/* Phones keep the same switch, one row down, where both labels fit. */}
        <NavToggle isChat={isChat} isLedger={isLedger} className="mb-2.5 sm:hidden" />
      </div>
    </header>
  );
}
