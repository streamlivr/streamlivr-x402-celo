'use client';

import { useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ReactNode } from 'react';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('streamlivr-card rounded-2xl transition-all duration-200', className)}>{children}</div>;
}

export function Pill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  const tones = {
    neutral: 'border-white/[0.08] text-text-secondary bg-white/[0.03]',
    brand: 'border-brand-primary/40 text-brand-primary bg-brand-primary/[0.08] shadow-[0_0_12px_-3px_rgba(0,209,255,0.2)]',
    success: 'border-success/35 text-success bg-success/[0.08]',
    warning: 'border-warning/35 text-warning bg-warning/[0.08]',
    danger: 'border-danger/35 text-danger bg-danger/[0.08]',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none tracking-tight',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-3 w-full', className)} />;
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{children}</span>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12px] tabular text-text-secondary', className)}>{children}</span>;
}

/**
 * Initials fallback rather than a remote <img>: creator avatars come from
 * arbitrary hosts, and a broken image would read as a broken demo.
 */
export function Avatar({
  src,
  name,
  size = 32,
}: {
  src?: string | null;
  name: string;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  // A remote avatar that 404s should fall back to initials, not a broken icon.
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover outline outline-1 outline-black/10 dark:outline-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-bg-elevated text-[11px] font-semibold text-text-secondary outline outline-1 outline-black/[0.06] dark:outline-white/[0.08]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initials || '·'}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-xl border border-dashed border-border bg-bg-subtle/60 px-4 py-5">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="max-w-prose text-[13px] leading-relaxed text-text-secondary">{description}</p>
      {action}
    </div>
  );
}
