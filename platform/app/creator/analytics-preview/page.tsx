'use client';

import { Suspense, useEffect, useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';

/* -------------------------------------------------------------------------
 * Creator "My Analytics" dashboard — PREVIEW (not wired into platform yet).
 * Renders live Instagram Graph data for a connected creator account via
 * /api/creator/analytics. Standalone route; not linked from nav or login.
 * ---------------------------------------------------------------------- */

interface Post {
  id: string; shortcode: string; permalink: string; media_type: string;
  thumbnail_url: string | null; media_url: string | null; caption: string | null;
  timestamp: string; like_count: number; comments_count: number;
  er: number | null; reach: number | null; plays: number | null;
  saved: number | null; shares: number | null;
}
interface Analytics {
  connected: boolean;
  reason?: string;
  error?: string;
  account?: { id: string; ig_username: string; connected_at: string; token_expires_at: string | null; connection_status: string };
  profile?: {
    username: string; name: string | null; biography: string | null;
    followers_count: number | null; follows_count: number | null;
    media_count: number | null; profile_picture_url: string | null; website: string | null;
  };
  stats?: {
    posts_analyzed: number; total_media: number;
    avg_likes: number | null; avg_comments: number | null; avg_er: number | null;
    reels_count: number; images_count: number;
    avg_reel_plays: number | null; avg_reach: number | null;
  };
  cadence?: { posts_per_week: number | null; avg_days_between_posts: number | null };
  posts?: Post[];
  demographics?: {
    gender_age: Record<string, number>;
    cities: Record<string, number>;
    countries: Record<string, number>;
  } | null;
}

const fmt = (v: number | null | undefined): string => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return v === 0 ? '0' : '—';
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
};
const pct = (v: number | null | undefined): string => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? (n * 100).toFixed(2) + '%' : '—';
};
const isReel = (t: string): boolean => t === 'VIDEO' || t === 'REELS';
const dateStr = (s: string): string => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function AnalyticsPreviewPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsPreview />
    </Suspense>
  );
}

function AnalyticsPreview() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'reels' | 'posts'>('all');
  const [sort, setSort] = useState<'recent' | 'top'>('recent');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = new URLSearchParams();
    const account = params.get('account');
    const handle = params.get('handle');
    if (account) q.set('account', account);
    else if (handle) q.set('handle', handle);
    fetch(`/api/creator/analytics${q.toString() ? `?${q}` : ''}`)
      .then((r) => r.json())
      .then((d: Analytics) => setData(d))
      .catch(() => setData({ connected: false, reason: 'network' }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-32 text-ink-400 text-[14px]">
          <span className="inline-block h-4 w-4 mr-3 rounded-full border-2 border-ink-200 border-t-transparent animate-spin" />
          Loading your analytics…
        </div>
      </Shell>
    );
  }

  if (!data?.connected) {
    return (
      <Shell>
        <EmptyState reason={data?.reason} error={data?.error} />
      </Shell>
    );
  }

  const { profile, stats, cadence, demographics } = data;
  const allPosts = data.posts ?? [];
  const filtered = allPosts.filter((p) =>
    tab === 'all' ? true : tab === 'reels' ? isReel(p.media_type) : !isReel(p.media_type),
  );
  const shown = [...filtered].sort((a, b) =>
    sort === 'top'
      ? (b.er ?? 0) - (a.er ?? 0)
      : new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <Shell>
      {/* Profile header */}
      <div className="rounded-2xl bg-white border border-border shadow-card p-6 flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="flex items-center gap-4 min-w-0">
          {profile?.profile_picture_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.profile_picture_url} alt="" className="h-16 w-16 rounded-2xl object-cover border border-border" />
          ) : (
            <div className="h-16 w-16 rounded-2xl grid place-items-center text-white text-xl font-bold" style={{ background: ACCENT }}>
              {profile?.username?.[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[18px] font-bold text-ink-900 truncate">{profile?.name ?? profile?.username}</div>
            <a href={`https://instagram.com/${profile?.username}`} target="_blank" rel="noreferrer"
              className="text-[13.5px] font-medium truncate hover:underline" style={{ color: ACCENT }}>
              @{profile?.username}
            </a>
            {profile?.biography && <p className="mt-1 text-[12.5px] text-ink-500 line-clamp-2 max-w-md">{profile.biography}</p>}
          </div>
        </div>
        <div className="sm:ml-auto grid grid-cols-3 gap-6 text-center shrink-0">
          <HeaderStat label="followers" value={fmt(profile?.followers_count)} />
          <HeaderStat label="following" value={fmt(profile?.follows_count)} />
          <HeaderStat label="posts" value={fmt(profile?.media_count)} />
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Avg engagement" value={pct(stats?.avg_er)} sub={`across ${stats?.posts_analyzed ?? 0} recent posts`} accent />
        <StatCard label="Avg likes" value={fmt(stats?.avg_likes)} sub="per post" />
        <StatCard label="Avg comments" value={fmt(stats?.avg_comments)} sub="per post" />
        <StatCard label="Avg reel plays" value={fmt(stats?.avg_reel_plays)} sub={`${stats?.reels_count ?? 0} reels analyzed`} />
      </div>

      {/* Secondary stats */}
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Avg reach" value={fmt(stats?.avg_reach)} sub="per post" />
        <StatCard label="Posts / week" value={cadence?.posts_per_week != null ? String(cadence.posts_per_week) : '—'} sub="posting cadence" />
        <StatCard label="Avg gap" value={cadence?.avg_days_between_posts != null ? `${cadence.avg_days_between_posts}d` : '—'} sub="between posts" />
        <StatCard label="Content mix" value={`${stats?.reels_count ?? 0}/${stats?.images_count ?? 0}`} sub="reels / photos" />
      </div>

      {/* Audience demographics */}
      {demographics && (Object.keys(demographics.gender_age).length > 0 || Object.keys(demographics.cities).length > 0) && (
        <div className="mt-4 grid md:grid-cols-2 gap-3">
          <Panel title="Audience — top cities">
            <BreakdownList data={demographics.cities} />
          </Panel>
          <Panel title="Audience — age & gender">
            <BreakdownList data={demographics.gender_age} />
          </Panel>
        </div>
      )}

      {/* Posts / reels grid */}
      <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {(['all', 'reels', 'posts'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold capitalize transition-colors ${tab === t ? 'text-white' : 'text-ink-500 hover:bg-[#faf9ff]'}`}
              style={tab === t ? { background: ACCENT } : { border: '1px solid #ece9fb' }}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['recent', 'top'] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${sort === s ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-[#f5f5f7]'}`}>
              {s === 'recent' ? 'Most recent' : 'Top performing'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shown.map((p) => (
          <a key={p.id} href={p.permalink} target="_blank" rel="noreferrer"
            className="group rounded-xl bg-white border border-border overflow-hidden hover:-translate-y-0.5 hover:shadow-card transition-all">
            <div className="relative aspect-square bg-[#f5f5f7]">
              {(p.thumbnail_url || p.media_url) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnail_url ?? p.media_url ?? ''} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full grid place-items-center text-ink-300 text-[11px]">no preview</div>
              )}
              <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white"
                style={{ background: isReel(p.media_type) ? 'rgba(0,0,0,.6)' : ACCENT }}>
                {isReel(p.media_type) ? 'REEL' : 'POST'}
              </span>
              {p.er != null && (
                <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-white/90 text-ink-900">
                  {pct(p.er)}
                </span>
              )}
            </div>
            <div className="p-2.5">
              <div className="flex items-center gap-3 text-[11.5px] text-ink-600 font-medium">
                <span title="likes">♥ {fmt(p.like_count)}</span>
                <span title="comments">💬 {fmt(p.comments_count)}</span>
                {isReel(p.media_type) && p.plays != null && <span title="plays">▶ {fmt(p.plays)}</span>}
              </div>
              <div className="mt-1 text-[10.5px] text-ink-400">{dateStr(p.timestamp)}</div>
            </div>
          </a>
        ))}
      </div>
      {shown.length === 0 && (
        <div className="py-16 text-center text-ink-400 text-[13px]">No {tab === 'all' ? 'posts' : tab} to show.</div>
      )}

      <p className="mt-8 text-center text-[11px] text-ink-300">
        Data pulled live from Instagram · {data.account?.ig_username} · connection {data.account?.connection_status}
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#fafafc] font-sans">
      {/* Preview banner — remove when wiring into the platform */}
      <div className="w-full text-center text-[12px] font-semibold text-white py-2" style={{ background: ACCENT }}>
        Creator Analytics — internal preview (not yet live on the platform)
      </div>
      <div className="max-w-5xl mx-auto px-5 py-8">
        <h1 className="text-[22px] font-bold text-ink-900 mb-1">My Analytics</h1>
        <p className="text-[13.5px] text-ink-500 mb-6">Your Instagram performance, straight from your account.</p>
        {children}
      </div>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[18px] font-bold text-ink-900 tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="text-[11.5px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 text-[24px] font-bold tabular-nums" style={{ color: accent ? ACCENT : '#1a1a2e' }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-400">{sub}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="text-[13px] font-semibold text-ink-900 mb-3">{title}</div>
      {children}
    </div>
  );
}

function BreakdownList({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a).slice(0, 6);
  const max = entries[0]?.[1] ?? 1;
  if (entries.length === 0) return <div className="text-[12px] text-ink-400">No data yet.</div>;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k}>
          <div className="flex justify-between text-[12px] mb-0.5">
            <span className="text-ink-700 font-medium truncate">{k.replace(/^[MF]\./, (m) => (m === 'M.' ? 'Male ' : 'Female '))}</span>
            <span className="text-ink-400 tabular-nums">{total ? Math.round((v / total) * 100) : 0}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#f0eefb] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: ACCENT }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ reason, error }: { reason?: string; error?: string }) {
  const copy: Record<string, { t: string; d: string }> = {
    no_account: {
      t: 'No Instagram account connected yet',
      d: 'Once a creator logs in with Instagram and approves access, their live analytics appear here. Add your Instagram account as a tester in the Meta app, then connect it to see this populate.',
    },
    fetch_error: {
      t: 'Couldn’t load Instagram data',
      d: 'The connected token may have expired, or the account is missing the insights permission. Reconnect the account to refresh access.',
    },
    db_error: { t: 'Something went wrong', d: 'We couldn’t reach the database. Try again in a moment.' },
    network: { t: 'Network error', d: 'Couldn’t reach the analytics service. Check your connection and retry.' },
  };
  const c = copy[reason ?? ''] ?? { t: 'No data available', d: 'Connect an Instagram account to see analytics here.' };
  return (
    <div className="rounded-2xl bg-white border border-border shadow-card p-10 text-center">
      <div className="mx-auto h-14 w-14 rounded-2xl grid place-items-center mb-4" style={{ background: ACCENT_SOFT, color: ACCENT }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 20V10M12 20V4M18 20v-6" /></svg>
      </div>
      <div className="text-[17px] font-bold text-ink-900">{c.t}</div>
      <p className="mt-2 text-[13.5px] text-ink-500 max-w-md mx-auto">{c.d}</p>
      {error && <p className="mt-3 text-[11px] text-ink-300 font-mono break-all max-w-lg mx-auto">{error}</p>}
    </div>
  );
}
