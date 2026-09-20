'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, RefreshCw, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Avatar, Card, EmptyState, Label, Mono, Pill, Skeleton, cn } from '@/components/ui';
import { fetchCreators, fetchSettlements, type CreatorsResponse, type SettlementsResponse } from '@/lib/api';
import { API_BASE_URL, explorerTx, networkForCaip2, type NetworkKey } from '@/lib/config';
import { clockTime, formatAmount, formatCount, formatUsd, timeAgo } from '@/lib/format';

const POLL_MS = 15_000;

function StatTile({ label, value, sub, brand }: { label: string; value: string; sub?: string; brand?: boolean }) {
  return (
    <Card className="p-4">
      <Label>{label}</Label>
      <p className={cn('tabular mt-1 text-[20px] font-semibold tracking-[-0.01em]', brand ? 'text-brand-primary' : 'text-text-primary')}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11.5px] text-text-muted">{sub}</p>}
    </Card>
  );
}

function LivePill({ updatedAt, error }: { updatedAt: number | null; error: string | null }) {
  if (error) {
    return (
      <Pill tone="danger">
        <TriangleAlert size={10} strokeWidth={2.2} />
        API unreachable
      </Pill>
    );
  }
  if (!updatedAt) return <Pill>loading…</Pill>;
  return (
    <Pill tone="success">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
      </span>
      live · {new Date(updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </Pill>
  );
}

function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export default function SettlementsPage() {
  const [settlements, setSettlements] = useState<SettlementsResponse | null>(null);
  const [creators, setCreators] = useState<CreatorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const [settlementData, creatorData] = await Promise.all([fetchSettlements(), fetchCreators()]);
      setSettlements(settlementData);
      setCreators(creatorData);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed');
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const totals = settlements?.totals;
  const creatorTotals = creators?.totals;
  const split = settlements?.split;

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-14 pt-5 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-text-primary">Creator payout ledger</h1>
            <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-text-secondary">
              Live record of micropayments delivered to creators on Celo. Read straight from the live database: nothing here is replayed or simulated.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <LivePill updatedAt={updatedAt} error={error} />
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1.5 text-[11.5px] text-text-secondary transition-colors duration-150 ease-out-quart hover:border-border-strong hover:text-text-primary"
            >
              <RefreshCw size={11} strokeWidth={2} className={cn(refreshing && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <Card className="mt-4 border-danger/30 p-4">
            <p className="text-[13px] font-medium text-text-primary">Could not read the ledger</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
              {error}. The demo is pointed at <Mono>{API_BASE_URL}</Mono>. On a fresh deployment the public demo routes
              may not be enabled yet.
            </p>
          </Card>
        )}

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Gross settled"
            value={totals ? formatUsd(totals.grossAtomic) : '$0.00'}
            sub={totals ? `${formatCount(Number(totals.count))} payments` : undefined}
          />
          <StatTile
            brand
            label={`Creator share${split ? ` · ${split.creatorBps / 100}%` : ''}`}
            value={totals ? formatUsd(totals.creatorShareAtomic) : '$0.00'}
            sub={creatorTotals ? `${formatCount(creatorTotals.creators)} creators` : undefined}
          />
          <StatTile
            label={`Platform share${split ? ` · ${split.platformBps / 100}%` : ''}`}
            value={totals ? formatUsd(totals.platformShareAtomic) : '$0.00'}
            sub="retained by Streamlivr"
          />
          <StatTile
            label="Paid out to creators"
            value={creatorTotals ? formatUsd(creatorTotals.paidOutAtomic) : '$0.00'}
            sub={creatorTotals ? `${formatUsd(creatorTotals.outstandingAtomic)} outstanding` : undefined}
          />
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-text-primary">Payments</h2>
              <p className="text-[12.5px] text-text-secondary">
                Newest first. Each row is one settled request with its creator split beside it.
              </p>
            </div>
            {settlements && (
              <Pill>
                {settlements.asset.symbol} · {settlements.network}
              </Pill>
            )}
          </div>

          <Card className="overflow-hidden">
            {!settlements && !error ? (
              <LoadingRows />
            ) : settlements && settlements.settlements.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No settlements yet"
                  description="Nothing has been bought through this API so far. Run the agent on the checkout page and the first payment shows up here within a few seconds."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {settlements?.settlements.map((settlement, index) => {
                  const network: NetworkKey = networkForCaip2(settlement.network, 'sepolia');
                  return (
                    <li
                      key={settlement.id}
                      className="row-in flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5"
                      style={{ animationDelay: `${Math.min(index, 8) * 22}ms` }}
                    >
                      <div className="w-20 shrink-0">
                        <p className="tabular text-[12.5px] font-medium text-text-primary">
                          {formatUsd(settlement.amountAtomic, settlement.assetDecimals)}
                        </p>
                        <p className="text-[11px] text-text-muted">{clockTime(settlement.createdAt)}</p>
                      </div>

                      <div className="min-w-[160px] flex-1">
                        <Mono className="block text-[12px] text-text-primary">{settlement.endpoint}</Mono>
                        <p className="text-[11px] text-text-muted">
                          from <Mono>{settlement.payer}</Mono> · {timeAgo(settlement.createdAt)}
                        </p>
                      </div>

                      <div className="flex min-w-[170px] flex-1 flex-wrap items-center gap-1.5">
                        {settlement.attributions.length ? (
                          settlement.attributions.slice(0, 3).map((attribution) => (
                            <span
                              key={`${settlement.id}-${attribution.creatorId ?? attribution.username}`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle py-[2px] pl-[3px] pr-2"
                            >
                              <Avatar
                                src={attribution.avatarUrl}
                                name={attribution.displayName ?? attribution.username ?? '?'}
                                size={16}
                              />
                              <span className="text-[11px] text-text-secondary">
                                {attribution.displayName ?? attribution.username ?? 'unknown'}
                              </span>
                              <span className="tabular text-[10.5px] text-text-muted">
                                {formatAmount(attribution.shareAtomic)}
                              </span>
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-text-muted">no creator attribution</span>
                        )}
                        {settlement.attributions.length > 3 && (
                          <span className="text-[11px] text-text-muted">+{settlement.attributions.length - 3}</span>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <a
                          href={explorerTx(network, settlement.settlementTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[11.5px] text-brand-primary underline-offset-2 hover:underline"
                        >
                          {settlement.settlementTxHash.slice(0, 10)}…
                          <ArrowUpRight size={11} strokeWidth={2.2} />
                        </a>
                        <p className="text-[11px] text-text-muted">explorer</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>

        <section className="mt-9">
          <div className="mb-3">
            <h2 className="text-[15px] font-semibold text-text-primary">Creators and earnings</h2>
            <p className="text-[12.5px] text-text-secondary">
              Everyone x402 has paid, and what is still owed. Public data is for sale by default, so the row to look
              for is the one a creator revoked: it stays listed with its settled history, because a payment that
              already happened is not undone by a later opt-out.
            </p>
          </div>

          <Card className="overflow-hidden">
            {!creators && !error ? (
              <LoadingRows rows={3} />
            ) : creators && creators.creators.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No creator has been paid yet"
                  description="Every public account is available to agents, so this list fills the moment the first page is bought. Nothing is hidden behind a consent gate."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {creators?.creators.map((creator, index) => (
                  <li
                    key={creator.creatorId}
                    className="row-in flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5"
                    style={{ animationDelay: `${Math.min(index, 8) * 22}ms` }}
                  >
                    <span className="tabular w-5 shrink-0 text-right text-[11px] text-text-muted">{index + 1}</span>
                    <Avatar src={creator.avatarUrl} name={creator.displayName ?? creator.username ?? '?'} size={30} />
                    <div className="min-w-[130px] flex-1">
                      <p className="truncate text-[13px] font-medium text-text-primary">
                        {creator.displayName ?? creator.username ?? 'Unknown'}
                      </p>
                      <p className="text-[11px] text-text-muted">
                        @{creator.username ?? 'anonymous'} · {formatCount(creator.followerCount)} followers
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      {creator.agentAccess === 'revoked' ? (
                        <Pill>revoked</Pill>
                      ) : (
                        <Pill>public</Pill>
                      )}
                    </div>

                    <div className="w-24 shrink-0 text-right">
                      <p className="tabular text-[13px] font-semibold text-brand-primary">
                        {formatUsd(creator.earnedAtomic)}
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {creator.salesCount === 1 ? '1 sale' : `${creator.salesCount} sales`}
                      </p>
                    </div>

                    <div className="w-28 shrink-0 text-right">
                      <p className="tabular text-[12.5px] text-text-primary">{formatUsd(creator.outstandingAtomic)}</p>
                      <p className="text-[11px] text-text-muted">outstanding</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <p className="mt-6 text-center text-[11.5px] leading-relaxed text-text-muted">
          Every settled payment splits {split ? `${split.creatorBps / 100}% to creators and ${split.platformBps / 100}% to the platform` : '60% to creators and 40% to the platform'}.
          Attribution follows the rows an endpoint actually returned, so a buyer cannot claim a creator they did not pay
          for.
        </p>
      </main>
    </div>
  );
}
