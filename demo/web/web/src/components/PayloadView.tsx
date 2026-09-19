'use client';

import { useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { Avatar, Mono } from './ui';
import { formatCount } from '@/lib/format';

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
}

interface TrackRow {
  id?: string;
  title?: string;
  artist?: string;
  isrc?: string | null;
  externalId?: string | null;
  creatorIds?: string[];
}

function CreatorCard({ creator }: { creator: CreatorRow }) {
  const name = creator.displayName ?? creator.username ?? 'Unnamed creator';
  return (
    <div className="flex items-start gap-3.5 py-3 first:pt-0 last:pb-0">
      <Avatar src={creator.avatarUrl} name={name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-semibold text-white">{name}</p>
          {creator.isVerified && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
              <span className="h-1 w-1 rounded-full bg-emerald-400" />
              Verified
            </span>
          )}
          {creator.countryCode && (
            <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-400">
              {creator.countryCode}
            </span>
          )}
        </div>
        {creator.username && <p className="text-[12px] text-slate-400">@{creator.username}</p>}
        {creator.bio && <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-slate-300">{creator.bio}</p>}
      </div>
      {typeof creator.followerCount === 'number' && (
        <div className="shrink-0 text-right">
          <p className="font-mono text-[12px] font-medium text-slate-200">{formatCount(creator.followerCount)}</p>
          <p className="text-[10px] text-slate-500">followers</p>
        </div>
      )}
    </div>
  );
}

function MusicTrackAssetCard({ track }: { track: TrackRow }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const title = track.title ?? 'Solaris Echoes · VIP Master Stems';
  const artist = track.artist ?? 'Elena Vance';

  return (
    <div className="space-y-3.5 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#161a25]/95 to-[#11141e]/95 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all hover:border-white/[0.14] sm:p-5">
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3.5">
          {/* Stylized Vinyl/Artwork Thumbnail */}
          <div className="group relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-cyan-500/20 via-indigo-600/30 to-amber-500/20 shadow-inner">
            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-cyan-300/60">
              <div className="h-2 w-2 rounded-full bg-cyan-300" />
            </div>
            <div className="absolute inset-0 bg-cyan-400/10 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <div>
            <h4 className="text-sm font-semibold tracking-tight text-white sm:text-[15px]">{title}</h4>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
              <span className="font-medium text-slate-300">{artist}</span>
              <span className="text-slate-600">•</span>
              <span>4 lossless stems</span>
              <span className="text-slate-600">•</span>
              <span>24-bit / 48kHz WAV</span>
            </p>
          </div>
        </div>
        {/* Verified Asset Pill */}
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-mono font-medium text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Verified Asset
        </span>
      </div>

      {/* Interactive Audio Waveform & Player Controls */}
      <div className="flex items-center gap-3 rounded-xl border border-white/[0.04] bg-[#0c0f17]/80 p-3 sm:p-3.5">
        <button
          type="button"
          onClick={() => setIsPlaying(!isPlaying)}
          aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-400 text-slate-950 shadow-[0_0_14px_rgba(0,218,248,0.35)] transition-all hover:scale-105 hover:bg-cyan-300 active:scale-95"
        >
          {isPlaying ? (
            <Pause size={15} className="fill-current" />
          ) : (
            <Play size={15} className="translate-x-0.5 fill-current" />
          )}
        </button>

        {/* Waveform bars */}
        <div className="flex h-7 flex-1 items-center gap-1">
          <span className="h-2.5 w-1 rounded-full bg-cyan-400/60" />
          <span className="h-4 w-1 rounded-full bg-cyan-400" />
          <span className="h-6 w-1 rounded-full bg-cyan-300" />
          <span className="h-3.5 w-1 rounded-full bg-cyan-400/70" />
          <span className="h-5 w-1 rounded-full bg-cyan-400" />
          <span className="h-7 w-1 rounded-full bg-cyan-300" />
          <span className="h-5 w-1 rounded-full bg-cyan-400" />
          <span className="h-3 w-1 rounded-full bg-cyan-400/50" />
          <span className="h-5 w-1 rounded-full bg-slate-600 transition-colors hover:bg-cyan-400" />
          <span className="h-3.5 w-1 rounded-full bg-slate-700 transition-colors hover:bg-cyan-400" />
          <span className="h-6 w-1 rounded-full bg-slate-700 transition-colors hover:bg-cyan-400" />
          <span className="h-3 w-1 rounded-full bg-slate-700 transition-colors hover:bg-cyan-400" />
          <span className="h-4.5 w-1 rounded-full bg-slate-700 transition-colors hover:bg-cyan-400" />
          <span className="h-2 w-1 rounded-full bg-slate-700 transition-colors hover:bg-cyan-400" />
          <span className="h-4 w-1 rounded-full bg-slate-700 transition-colors hover:bg-cyan-400" />
          <span className="h-5.5 w-1 rounded-full bg-slate-700 transition-colors hover:bg-cyan-400" />
          <span className="h-3 w-1 rounded-full bg-slate-700 transition-colors hover:bg-cyan-400" />
        </div>
        <span className="shrink-0 font-mono text-[11px] text-slate-400">
          {isPlaying ? '0:24 / 3:12' : '0:00 / 3:12'}
        </span>
      </div>

      {/* Card Footer: Stems & Download Pill */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs text-slate-400">
        <div className="flex items-center gap-1.5 text-slate-300">
          <span className="text-cyan-400">✦</span>
          <span>Includes Drums, Bass, Lead Synths & Vocal FX</span>
          {track.isrc && (
            <>
              <span className="text-slate-600">•</span>
              <Mono className="text-[11px] text-slate-400">{track.isrc}</Mono>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsPlaying(!isPlaying)}
          className="flex items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-cyan-300 transition-all hover:border-transparent hover:bg-cyan-400 hover:text-slate-950 active:scale-95"
        >
          <span>{isPlaying ? 'Pause preview' : 'Preview track'}</span>
        </button>
      </div>
    </div>
  );
}

function KeyValueGrid({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-slate-400">{key.replace(/([A-Z])/g, ' $1').trim()}</dt>
          <dd className="mt-0.5 break-words text-[13px] text-slate-200">
            {Array.isArray(value) ? (
              <ol className="flex flex-col gap-1.5">
                {value.map((item, index) => (
                  <li key={index} className="flex gap-2 text-[12.5px] leading-relaxed text-slate-300">
                    <span className="shrink-0 text-slate-500">{index + 1}.</span>
                    <span>{String(item)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              String(value ?? 'N/A')
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PayloadView({ shape, data }: { shape: string; data: unknown }) {
  if (!data || typeof data !== 'object') {
    return <p className="p-4 text-[13px] text-slate-300">{String(data ?? 'No content')}</p>;
  }
  const record = data as Record<string, unknown>;

  if (shape === 'creators') {
    const creators = (record.creators as CreatorRow[] | undefined) ?? [];
    if (!creators.length) {
      return (
        <div className="p-4">
          <p className="text-[13px] text-slate-400">
            No creator has opted in to listings yet. Discovery consent is per artist and off by default.
          </p>
        </div>
      );
    }
    return (
      <div className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-[#10131a]/80 p-4 shadow-sm backdrop-blur-md">
        {creators.map((creator, index) => (
          <CreatorCard key={creator.id ?? index} creator={creator} />
        ))}
      </div>
    );
  }

  if (shape === 'tracks') {
    const tracks = (record.tracks as TrackRow[] | undefined) ?? [];
    if (!tracks.length) {
      return (
        <div className="p-4">
          <p className="text-[13px] text-slate-400">
            The catalog is empty: no track belongs to a creator with catalog consent switched on.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {tracks.slice(0, 3).map((track, index) => (
          <MusicTrackAssetCard key={track.id ?? index} track={track} />
        ))}
      </div>
    );
  }

  if (shape === 'profile') {
    const creator = record as CreatorRow;
    const name = creator.displayName ?? creator.username ?? 'Creator';
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#10131a]/80 p-5 shadow-sm backdrop-blur-md">
        <div className="flex items-start gap-4">
          <Avatar src={creator.avatarUrl} name={name} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[16px] font-semibold text-white">{name}</p>
              {creator.isVerified && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-mono text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Verified
                </span>
              )}
            </div>
            {creator.username && <p className="text-[13px] text-slate-400">@{creator.username}</p>}
            {creator.bio && <p className="mt-2 text-[13.5px] leading-relaxed text-slate-300">{creator.bio}</p>}
            <div className="mt-3 flex gap-6">
              {typeof creator.followerCount === 'number' && (
                <div>
                  <p className="font-mono text-[14px] font-semibold text-white">{formatCount(creator.followerCount)}</p>
                  <p className="text-[11px] text-slate-500">followers</p>
                </div>
              )}
              {typeof creator.followingCount === 'number' && (
                <div>
                  <p className="font-mono text-[14px] font-semibold text-white">{formatCount(creator.followingCount)}</p>
                  <p className="text-[11px] text-slate-500">following</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (shape === 'ping') {
    const entries = Object.entries(record).filter(([, value]) => typeof value !== 'object');
    return (
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/[0.08] bg-[#10131a]/80 p-4 shadow-sm backdrop-blur-md sm:grid-cols-4">
        {entries.map(([key, value]) => (
          <div key={key}>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{key}</p>
            <p className="mt-0.5 break-all font-mono text-[13px] text-white">{String(value)}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#10131a]/80 p-4 shadow-sm backdrop-blur-md">
      <KeyValueGrid data={record} />
    </div>
  );
}
