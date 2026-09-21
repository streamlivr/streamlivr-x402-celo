'use client';

import { useState } from 'react';
import { BadgeCheck, Disc3, ExternalLink, Music2, Play } from 'lucide-react';
import { Avatar } from './ui';
import { explorerTx, networkForCaip2, shortAddress, type NetworkKey } from '@/lib/config';
import { formatAmount, formatCount, formatUsd } from '@/lib/format';
import type { CreatorsResponse } from '@/lib/api';

interface CreatorRow {
  id?: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  countryCode?: string | null;
  isVerified?: boolean;
  followerCount?: number;
  followingCount?: number;
  createdAt?: string | null;
  stats?: {
    publishedVideos?: number;
    catalogTracks?: number | null;
    /** `revoked` means the creator opted out of every paid route. */
    agentAccess?: 'public' | 'revoked';
  };
}

/** The page metadata every paid list route returns. */
interface PageMeta {
  total?: number;
  limit?: number;
  returned?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
  truncated?: boolean;
}

/**
 * "Showing 50 of 2,431, 2,381 more behind the cursor", above a list.
 *
 * The dataset is thousands of rows, so a card that quietly showed fifty of them
 * would read as "that is all there is". The cursor is named, because it is the
 * thing the next chip pays for.
 */
function PageNote({ page, noun, q }: { page?: PageMeta; noun: string; q?: string | null }) {
  if (!page || typeof page.total !== 'number' || page.total === 0) return null;
  const returned = page.returned ?? 0;
  const remaining = Math.max(page.total - returned, 0);
  return (
    <p className="px-1 text-[12px] text-slate-500">
      Showing <span className="tabular text-slate-400">{formatCount(returned)}</span> of{' '}
      <span className="tabular text-slate-400">{formatCount(page.total)}</span> {noun}
      {q ? <> matching “{q}”</> : null}
      {page.hasMore && remaining > 0 ? (
        <>
          , <span className="tabular">{formatCount(remaining)}</span> more behind the cursor, one cent a page.
        </>
      ) : (
        ', and that is the whole result.'
      )}
    </p>
  );
}

interface PostRow {
  id?: string;
  creatorId?: string;
  title?: string | null;
  description?: string | null;
  hashtags?: string[];
  mediaType?: string;
  mediaCount?: number;
  durationSeconds?: number;
  thumbnailUrl?: string | null;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  createdAt?: string | null;
}

/** One public post. Caption, tags, engagement and the creator behind it. */
function PostCard({ post, index }: { post: PostRow; index: number }) {
  const title = post.title?.trim() || 'Untitled post';
  const tags = post.hashtags ?? [];
  const carousel = post.mediaType === 'PHOTO_CAROUSEL';
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10131a]/85 shadow-[0_6px_24px_rgba(0,0,0,0.3)] backdrop-blur-md">
      <div className="flex gap-3.5 p-3.5 sm:gap-4 sm:p-4">
        <div className="relative shrink-0">
          {post.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.thumbnailUrl}
              alt={`${title} poster`}
              width={54}
              height={72}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-[72px] w-[54px] rounded-lg object-cover outline outline-1 outline-white/10"
            />
          ) : (
            <div className="flex h-[72px] w-[54px] items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 via-cyan-500/10 to-transparent outline outline-1 outline-white/10">
              <Play size={16} className="text-cyan-200/70" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="truncate text-[14.5px] font-semibold leading-tight text-white">{title}</p>
            <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10.5px] text-slate-400">
              #{String(index + 1).padStart(2, '0')}
            </span>
          </div>
          {post.description && (
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-slate-400">{post.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-slate-400">
            <span>{carousel ? `${post.mediaCount ?? 1} slides` : `${post.durationSeconds ?? 0}s video`}</span>
            <span className="text-slate-600">•</span>
            <span className="tabular">{formatCount(post.viewCount ?? 0)} views</span>
            <span className="text-slate-600">•</span>
            <span className="tabular">{formatCount(post.likeCount ?? 0)} likes</span>
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10.5px] text-slate-400">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Free inventory: what there is to buy, and the tags worth searching for. */
function StatsCard({ data }: { data: Record<string, unknown> }) {
  const totals = (data.totals ?? {}) as Record<string, number>;
  const top = (data.top ?? {}) as {
    countries?: { code: string; creators?: number; count?: number }[];
    hashtags?: { tag: string; posts?: number; count?: number }[];
  };
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3.5 rounded-2xl border border-white/[0.08] bg-[#10131a]/85 p-4 shadow-sm backdrop-blur-md sm:grid-cols-4">
        <Stat value={formatCount(totals.creators ?? 0)} label="public creators" />
        <Stat value={formatCount(totals.posts ?? 0)} label="public posts" />
        <Stat value={formatCount(totals.tracks ?? 0)} label="tracks" />
        <Stat value={formatCount(totals.countries ?? 0)} label="countries" />
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.08] bg-[#10131a]/85 p-4 shadow-sm backdrop-blur-md">
          <p className="text-[10.5px] uppercase tracking-wide text-slate-500">Busiest countries</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(top.countries ?? []).slice(0, 8).map((row) => (
              <span key={row.code} className="rounded border border-cyan-400/20 bg-cyan-400/[0.07] px-1.5 py-0.5 font-mono text-[10.5px] text-cyan-300">
                {row.code} · {formatCount(row.creators ?? row.count ?? 0)}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#10131a]/85 p-4 shadow-sm backdrop-blur-md">
          <p className="text-[10.5px] uppercase tracking-wide text-slate-500">Busiest tags</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(top.hashtags ?? []).slice(0, 8).map((row) => (
              <span key={row.tag} className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10.5px] text-slate-300">
                #{row.tag} · {formatCount(row.posts ?? row.count ?? 0)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="px-1 text-[12px] text-slate-500">
        This read is free: a buyer has to be able to see how much there is before deciding a page is worth a cent.
      </p>
    </div>
  );
}

/** One row of the live price list the quote move builds. */
interface QuoteRow {
  path: string;
  returns: string;
  /** Dollar string from the route's own 402, or null when it did not answer. */
  price: string | null;
}

interface TrackRow {
  id?: string;
  title?: string;
  artist?: string;
  isrc?: string | null;
  externalId?: string | null;
  coverUrl?: string | null;
  previewUrl?: string | null;
  creatorIds?: string[];
}

function CoverArt({ src, title, size = 64 }: { src?: string | null; title: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${title} cover art`}
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-xl object-cover shadow-[0_4px_18px_rgba(0,0,0,0.45)] outline outline-1 outline-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 via-indigo-600/25 to-amber-500/10 outline outline-1 outline-white/10"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Disc3 size={size * 0.42} className="text-cyan-200/70" />
    </div>
  );
}

function TrackCard({ track, index }: { track: TrackRow; index: number }) {
  const title = track.title ?? 'Untitled track';
  const artist = track.artist ?? 'Unknown creator';
  const creatorCount = track.creatorIds?.length ?? 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10131a]/85 shadow-[0_6px_24px_rgba(0,0,0,0.3)] backdrop-blur-md">
      <div className="flex gap-3.5 p-3.5 sm:gap-4 sm:p-4">
        <CoverArt src={track.coverUrl} title={title} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold leading-tight text-white">{title}</p>
              <p className="mt-0.5 truncate text-[13px] text-slate-300">{artist}</p>
            </div>
            <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10.5px] text-slate-400">
              #{String(index + 1).padStart(2, '0')}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-slate-400">
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <BadgeCheck size={12} />
              Paid asset
            </span>
            {track.isrc && (
              <>
                <span className="text-slate-600">•</span>
                <span className="font-mono">{track.isrc}</span>
              </>
            )}
            {creatorCount > 0 && (
              <>
                <span className="text-slate-600">•</span>
                <span>
                  {creatorCount === 1 ? 'credited to 1 creator' : `credited to ${creatorCount} creators`}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="border-t border-white/[0.05] px-3.5 py-2.5 sm:px-4">
        <span className="flex items-center gap-2 text-[11.5px] text-slate-500">
          <Music2 size={12} />
          Metadata only: artwork, ISRC, and the creators who own the recording.
        </span>
      </div>
    </div>
  );
}

function CreatorRowView({ creator }: { creator: CreatorRow }) {
  const name = creator.displayName ?? creator.username ?? 'Unnamed creator';
  return (
    <div className="flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0">
      <Avatar src={creator.avatarUrl} name={name} size={42} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[14.5px] font-semibold text-white">{name}</p>
          {creator.isVerified && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
              <span className="h-1 w-1 rounded-full bg-emerald-400" />
              verified
            </span>
          )}
          {creator.countryCode && (
            <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-400">
              {creator.countryCode}
            </span>
          )}
        </div>
        {creator.username && <p className="text-[12px] text-slate-500">@{creator.username}</p>}
        {creator.bio && (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-slate-300">{creator.bio}</p>
        )}
      </div>
      {typeof creator.followerCount === 'number' && (
        <div className="shrink-0 text-right">
          <p className="font-mono text-[12.5px] font-medium text-slate-200">{formatCount(creator.followerCount)}</p>
          <p className="text-[10px] text-slate-500">{creator.followerCount === 1 ? 'follower' : 'followers'}</p>
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-mono text-[14px] font-semibold text-white">{value}</p>
      <p className="text-[10.5px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}

/**
 * The paid profile route. Every field here is public and opted in, and the
 * point of showing the whole row is that a buyer can tell one creator from
 * another without a second lookup.
 */
function ProfileCard({ creator }: { creator: CreatorRow }) {
  const name = creator.displayName ?? creator.username ?? 'Creator';
  const memberSince = creator.createdAt ? new Date(creator.createdAt).getFullYear() : null;
  const joined = memberSince && Number.isFinite(memberSince) ? String(memberSince) : null;
  const stats = creator.stats;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10131a]/85 shadow-[0_6px_24px_rgba(0,0,0,0.3)] backdrop-blur-md">
      <div className="h-16 bg-gradient-to-r from-cyan-500/20 via-indigo-500/10 to-transparent" />
      <div className="-mt-8 px-4 pb-4 sm:px-5 sm:pb-5">
        <Avatar src={creator.avatarUrl} name={name} size={64} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-[18px] font-semibold leading-tight text-white">{name}</p>
          {creator.isVerified && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10.5px] text-emerald-300">
              <span className="h-1 w-1 rounded-full bg-emerald-400" />
              verified
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-slate-400">
          {creator.username && <span>@{creator.username}</span>}
          {creator.countryCode && (
            <>
              <span className="text-slate-600">•</span>
              <span>{creator.countryCode}</span>
            </>
          )}
          {joined && (
            <>
              <span className="text-slate-600">•</span>
              <span>on Streamlivr since {joined}</span>
            </>
          )}
        </div>
        {creator.bio ? (
          <p className="mt-3 text-[13.5px] leading-relaxed text-slate-300">{creator.bio}</p>
        ) : (
          <p className="mt-3 text-[13px] italic text-slate-500">This creator has not written a bio yet.</p>
        )}
        <div className="mt-4 flex gap-7 border-t border-white/[0.06] pt-3.5">
          <Stat value={formatCount(creator.followerCount ?? 0)} label="followers" />
          <Stat value={formatCount(creator.followingCount ?? 0)} label="following" />
          {typeof stats?.publishedVideos === 'number' && (
            <Stat value={formatCount(stats.publishedVideos)} label="public posts" />
          )}
          {typeof stats?.catalogTracks === 'number' && (
            <Stat value={formatCount(stats.catalogTracks)} label="tracks for sale" />
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/[0.06] pt-3 text-[11.5px] text-slate-500">
          <span>Agent access:</span>
          <span className="rounded border border-cyan-400/20 bg-cyan-400/[0.07] px-1.5 py-0.5 font-mono text-[10.5px] text-cyan-300">
            {stats?.agentAccess === 'revoked' ? 'revoked by creator' : 'public'}
          </span>
          <span className="text-slate-600">•</span>
          <span>public profile fields only</span>
          <span className="text-slate-600">•</span>
          <span className="font-mono text-slate-500">{creator.id ? shortAddress(creator.id, 8) : ''}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The free ledger read that runs beside a profile purchase. It answers the
 * question the paid route cannot: what has this creator actually been paid, and
 * what is still sitting in the payout queue.
 */
function LedgerCard({ ledger }: { ledger: CreatorsResponse & { focusCreatorId?: string } }) {
  const focus = ledger.focusCreatorId;
  // Biggest balance first, because that is the order a reader cares about. The
  // creator this turn was about is then pinned above them, since the rest of
  // the ledger is background.
  const rows = [...(ledger.creators ?? [])].sort((a, b) => {
    const difference = BigInt(b.earnedAtomic || '0') - BigInt(a.earnedAtomic || '0');
    if (difference !== 0n) return difference > 0n ? 1 : -1;
    return 0;
  });
  const ordered = focus
    ? [...rows].sort((a, b) => {
        if (a.creatorId === focus) return -1;
        if (b.creatorId === focus) return 1;
        return 0;
      })
    : rows;

  // One page of a paid request can credit fifty creators, and a page-wide split
  // of one cent leaves most of them with a fraction of a cent that no payout
  // run will ever move. Showing all of those rows buries the creators who have
  // actually earned something, so the list stops at ten and the rest is summed.
  const VISIBLE_ROWS = 10;
  const visible = ordered.slice(0, VISIBLE_ROWS);
  const hidden = ordered.slice(VISIBLE_ROWS);
  const hiddenOutstanding = hidden.reduce((sum, creator) => sum + BigInt(creator.outstandingAtomic || '0'), 0n);
  const minimumAtomic = ledger.totals?.payoutMinimumAtomic;
  const minimumLabel = minimumAtomic ? formatAmount(minimumAtomic) : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10131a]/85 shadow-[0_6px_24px_rgba(0,0,0,0.3)] backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <p className="text-[12px] font-medium uppercase tracking-wide text-slate-400">Creator payout ledger</p>
        <span className="font-mono text-[11px] text-slate-500">
          {ledger.split?.creatorBps ? `${ledger.split.creatorBps / 100}/${ledger.split.platformBps / 100} split` : ''}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 border-b border-white/[0.06] px-4 py-3.5 sm:grid-cols-4">
        <Stat value={formatUsd(ledger.totals?.creatorShareAtomic ?? '0')} label="earned" />
        <Stat value={formatUsd(ledger.totals?.paidOutAtomic ?? '0')} label="paid out" />
        <Stat value={formatUsd(ledger.totals?.outstandingAtomic ?? '0')} label="owed" />
        <Stat value={formatCount(ledger.totals?.creators ?? rows.length)} label="creators earned" />
      </div>
      {ordered.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-slate-400">
          No creator has earned anything yet. The first settled payment will create a row here.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-white/[0.06] px-4">
            {visible.map((creator) => {
              const name = creator.displayName ?? creator.username ?? 'Unnamed creator';
              const outstanding = BigInt(creator.outstandingAtomic || '0');
              return (
                <li
                  key={creator.creatorId}
                  className={`flex items-center gap-3 py-3 ${creator.creatorId === focus ? '-mx-2 rounded-xl bg-cyan-400/[0.06] px-2 ring-1 ring-cyan-400/20' : ''}`}
                >
                  <Avatar src={creator.avatarUrl} name={name} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-white">
                      {name}
                      {creator.creatorId === focus && (
                        <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-cyan-300">this creator</span>
                      )}
                    </p>
                    <p className="text-[11.5px] text-slate-500">
                      {creator.salesCount} {creator.salesCount === 1 ? 'sale' : 'sales'}
                      {creator.username ? ` · @${creator.username}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[12.5px] text-slate-200">{formatAmount(creator.earnedAtomic)} USDC</p>
                    <p className={`font-mono text-[11px] ${outstanding > 0n ? 'text-amber-300' : 'text-emerald-400/80'}`}>
                      {outstanding > 0n ? `${formatAmount(creator.outstandingAtomic)} owed` : 'settled'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          {hidden.length > 0 && (
            <p className="border-t border-white/[0.06] px-4 py-3 text-[12px] leading-relaxed text-slate-500">
              {formatCount(hidden.length)} more {hidden.length === 1 ? 'creator holds' : 'creators hold'}{' '}
              <span className="font-mono text-slate-400">{formatAmount(hiddenOutstanding)} USDC</span> between them
              {minimumLabel ? `, all below the ${minimumLabel} USDC payout minimum` : ''}. Their shares are recorded and
              no payment run moves an amount that small.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PingCard({ data, network }: { data: Record<string, unknown>; network: NetworkKey }) {
  const hash = typeof data.transaction === 'string' ? data.transaction : '';
  const resolved = networkForCaip2(typeof data.network === 'string' ? data.network : undefined, network);
  return (
    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 shadow-sm backdrop-blur-md">
      <p className="text-[14px] font-semibold text-emerald-200">Payment accepted on {resolved === 'mainnet' ? 'Celo' : 'Celo Sepolia'}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-emerald-100/80">
        The server answered only after the transfer settled, so this is the money moving, not a promise to move it.
      </p>
      <dl className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {typeof data.payer === 'string' && (
          <div>
            <dt className="text-[10.5px] uppercase tracking-wide text-emerald-200/60">paid by</dt>
            <dd className="font-mono text-[12.5px] text-emerald-50">{shortAddress(data.payer, 8)}</dd>
          </div>
        )}
        <div>
          <dt className="text-[10.5px] uppercase tracking-wide text-emerald-200/60">network</dt>
          <dd className="font-mono text-[12.5px] text-emerald-50">{String(data.network ?? '')}</dd>
        </div>
      </dl>
      {hash && (
        <a
          href={explorerTx(resolved, hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 font-mono text-[12px] text-cyan-300 underline-offset-2 hover:underline"
        >
          {shortAddress(hash, 10)} on the block explorer <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

/**
 * Every price, read from each route's own 402. Same table shape as the route
 * list, except the numbers are live and the footer carries the settlement
 * facts a buyer needs before signing anything.
 */
function QuotesCard({ data }: { data: Record<string, unknown> }) {
  const rows = (data.rows as QuoteRow[] | undefined) ?? [];
  const settlement = (data.settlement as Record<string, unknown> | null | undefined) ?? null;

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#10131a]/85 p-4 text-[13px] text-slate-400">
        No route returned a price.
      </div>
    );
  }

  const facts = settlement
    ? Object.entries(settlement).filter(([, value]) => value !== null && value !== undefined && value !== '')
    : [];
  /**
   * A route can answer without an invoice, which means this deployment does not
   * sell it. Naming that separately stops a blank cell from reading as a bug.
   */
  const unpriced = rows.filter((row) => !row.price).length;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10131a]/85 shadow-sm backdrop-blur-md">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-white/[0.06] text-[10.5px] uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 font-medium">Route</th>
            <th className="px-4 py-2.5 font-medium">Price</th>
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Returns</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {rows.map((row) => (
            <tr key={row.path}>
              <td className="px-4 py-2.5 font-mono text-[12px] text-slate-200">{row.path}</td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-cyan-300">
                {row.price ?? <span className="font-sans text-slate-500">not sold here</span>}
              </td>
              <td className="hidden px-4 py-2.5 text-[12px] text-slate-400 sm:table-cell">{row.returns}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unpriced > 0 && (
        <p className="border-t border-white/[0.06] px-4 py-3 text-[12px] text-slate-500">
          {unpriced === 1 ? 'One route answered without an invoice, so this deployment does not sell it.' : `${unpriced} routes answered without an invoice, so this deployment does not sell them.`}{' '}
          Every route that is sold here costs the same: one cent a request.
        </p>
      )}
      {facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-2 border-t border-white/[0.06] px-4 py-3">
          {facts.map(([key, value]) => (
            <div key={key}>
              <dt className="text-[10.5px] uppercase tracking-wide text-slate-500">{key}</dt>
              <dd className="mt-0.5 font-mono text-[12px] text-slate-300">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function RoutesCard({ routes, note }: { routes: { path: string; price: string; returns: string }[]; note?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10131a]/85 shadow-sm backdrop-blur-md">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-white/[0.06] text-[10.5px] uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 font-medium">Route</th>
            <th className="px-4 py-2.5 font-medium">Price</th>
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Returns</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {routes.map((route) => (
            <tr key={route.path}>
              <td className="px-4 py-2.5 font-mono text-[12px] text-slate-200">{route.path}</td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-cyan-300">
                {route.price === 'free' ? 'free' : `$${route.price}`}
              </td>
              <td className="hidden px-4 py-2.5 text-[12px] text-slate-400 sm:table-cell">{route.returns}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="border-t border-white/[0.06] px-4 py-2.5 text-[11.5px] text-slate-500">{note}</p>}
    </div>
  );
}

function ExplainCard({ steps, split, note }: { steps: string[]; split?: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#10131a]/85 p-4 shadow-sm backdrop-blur-md sm:p-5">
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-3 text-[13px] leading-relaxed text-slate-300">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 font-mono text-[10.5px] text-cyan-300">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {split && (
        <p className="mt-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-slate-300">
          {split}
        </p>
      )}
      {note && <p className="mt-2 text-[11.5px] text-slate-500">{note}</p>}
    </div>
  );
}

function WalletCard({ data }: { data: Record<string, unknown> }) {
  const explorer = typeof data.explorer === 'string' ? data.explorer : null;
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#10131a]/85 p-4 shadow-sm backdrop-blur-md">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">Demo buyer wallet</p>
      <p className="mt-1 break-all font-mono text-[13px] text-white">{String(data.address ?? '')}</p>
      <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          value={`${formatAmount(String(data.assetBalanceAtomic ?? '0'))} ${String(data.assetSymbol ?? 'USDC')}`}
          label="balance"
        />
        <Stat value={formatUsd(String(data.sessionSpentAtomic ?? '0'))} label="spent this session" />
        <Stat value={String(data.network ?? '')} label="network" />
      </div>
      {explorer && (
        <a
          href={explorer}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-cyan-300 underline-offset-2 hover:underline"
        >
          View the wallet on the explorer <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

function KeyValueGrid({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (entries.length === 0) {
    return <p className="text-[13px] text-slate-400">The response was empty.</p>;
  }
  return (
    <div className="grid gap-3.5 rounded-2xl border border-white/[0.08] bg-[#10131a]/85 p-4 shadow-sm backdrop-blur-md sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <p className="text-[10.5px] uppercase tracking-wide text-slate-500">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
          <div className="mt-0.5 break-words text-[13px] text-slate-200">
            {Array.isArray(value) ? (
              <ol className="flex flex-col gap-1.5">
                {value.map((item, index) => (
                  <li key={index} className="flex gap-2 text-[12.5px] leading-relaxed text-slate-300">
                    <span className="shrink-0 text-slate-500">{index + 1}.</span>
                    <span>{String(item)}</span>
                  </li>
                ))}
              </ol>
            ) : typeof value === 'object' ? (
              <span className="font-mono text-[12px] text-slate-400">{JSON.stringify(value)}</span>
            ) : (
              String(value)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PayloadView({
  shape,
  data,
  endpoint,
  network = 'mainnet',
}: {
  shape: string;
  data: unknown;
  endpoint?: string;
  network?: NetworkKey;
}) {
  if (!data || typeof data !== 'object') {
    return <p className="text-[13px] text-slate-300">{String(data ?? 'No content')}</p>;
  }
  const record = data as Record<string, unknown>;

  if (shape === 'creators') {
    const creators = (record.creators as CreatorRow[] | undefined) ?? [];
    const page = record.page as PageMeta | undefined;
    const q = (record.query as { q?: string | null } | undefined)?.q ?? null;
    if (creators.length === 0) {
      return (
        <div className="rounded-2xl border border-white/[0.08] bg-[#10131a]/85 p-4 text-[13px] leading-relaxed text-slate-400">
          {q
            ? `No public creator matches “${q}”. The dataset is every public account, so the query is the only filter.`
            : 'The paid response came back empty. Every public account is available to agents, so this should not happen at this size.'}
        </div>
      );
    }
    return (
      <div className="space-y-2.5">
        <div className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-[#10131a]/85 px-4 py-1 shadow-sm backdrop-blur-md">
          {creators.map((creator, index) => (
            <CreatorRowView key={creator.id ?? index} creator={creator} />
          ))}
        </div>
        <PageNote page={page} noun="creators" q={q} />
      </div>
    );
  }

  if (shape === 'tracks') {
    const tracks = (record.tracks as TrackRow[] | undefined) ?? [];
    const page = record.page as PageMeta | undefined;
    const q = (record.query as { q?: string | null } | undefined)?.q ?? null;
    if (tracks.length === 0) {
      return (
        <div className="rounded-2xl border border-white/[0.08] bg-[#10131a]/85 p-4 text-[13px] leading-relaxed text-slate-400">
          {q
            ? `No track matches “${q}”. Titles and creators are matched token by token, so a full song title still finds its row.`
            : 'The catalog is empty. A track appears here once a public post draws on it.'}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {/* Every row the page paid for is rendered inline. Showing four of
            fifty and pointing at the raw JSON made a full page look truncated,
            and a nested scroll box traps the scroll gesture on a phone. */}
        {tracks.map((track, index) => (
          <TrackCard key={track.id ?? index} track={track} index={index} />
        ))}
        <PageNote page={page} noun="tracks" q={q} />
      </div>
    );
  }

  if (shape === 'posts') {
    const posts = (record.posts as PostRow[] | undefined) ?? [];
    const page = record.page as PageMeta | undefined;
    const q = (record.query as { q?: string | null } | undefined)?.q ?? null;
    if (posts.length === 0) {
      return (
        <div className="rounded-2xl border border-white/[0.08] bg-[#10131a]/85 p-4 text-[13px] leading-relaxed text-slate-400">
          {q
            ? `No public post matches “${q}”. Captions, descriptions and tags are searched.`
            : 'No public posts came back from this page.'}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {posts.map((post, index) => (
          <PostCard key={post.id ?? index} post={post} index={index} />
        ))}
        <PageNote page={page} noun="posts" q={q} />
      </div>
    );
  }

  if (shape === 'stats') {
    return <StatsCard data={record} />;
  }

  if (shape === 'profile') {
    return <ProfileCard creator={record as CreatorRow} />;
  }

  if (shape === 'ledger') {
    return <LedgerCard ledger={record as unknown as CreatorsResponse} />;
  }

  if (shape === 'quotes') {
    return <QuotesCard data={record} />;
  }

  if (shape === 'ping') {
    return <PingCard data={record} network={network} />;
  }

  if (endpoint === 'wallet' || 'assetBalanceAtomic' in record) {
    return <WalletCard data={record} />;
  }
  if (Array.isArray(record.steps)) {
    return (
      <ExplainCard
        steps={record.steps.map(String)}
        split={typeof record.split === 'string' ? record.split : undefined}
        note={typeof record.note === 'string' ? record.note : undefined}
      />
    );
  }
  if (Array.isArray(record.routes)) {
    return (
      <RoutesCard
        routes={record.routes as { path: string; price: string; returns: string }[]}
        note={typeof record.note === 'string' ? record.note : undefined}
      />
    );
  }

  return <KeyValueGrid data={record} />;
}
