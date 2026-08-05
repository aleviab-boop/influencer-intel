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
interface ReelForecast {
  sample_size: number;
  median_plays: number | null;
  median_er: number | null;
  trend: 'rising' | 'steady' | 'cooling' | null;
  momentum_pct: number | null;
  consistency: number | null;
  next_reel: { plays_expected: number | null; plays_low: number | null; plays_high: number | null; er_expected: number | null } | null;
  scorecard: { breakout: number; strong: number; average: number; soft: number };
  last_reel_band: 'breakout' | 'strong' | 'average' | 'soft' | null;
  top_reel: { plays: number; er: number | null; permalink: string; thumbnail: string | null } | null;
}
interface ContentBreakdown {
  by_type: { type: 'reels' | 'photos' | 'carousels'; count: number; avg_er: number | null; avg_reach: number | null; avg_plays: number | null }[];
  best_type: 'reels' | 'photos' | 'carousels' | null;
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
  growth?: { date: string; followers: number }[];
  reel_forecast?: ReelForecast;
  content_breakdown?: ContentBreakdown;
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
        <EmptyState reason={data?.reason} />
      </Shell>
    );
  }

  const { profile, stats, cadence, demographics } = data;
  const growth = data.growth ?? [];
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

      {/* Follower growth */}
      <div className="mt-4">
        <GrowthChart data={growth} current={profile?.followers_count ?? null} />
      </div>

      {/* Reel forecast (prediction) + content-format depth */}
      <div className="mt-4 grid lg:grid-cols-2 gap-3">
        <ReelForecastCard f={data.reel_forecast} />
        <ContentBreakdownCard b={data.content_breakdown} />
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

function GrowthChart({ data, current }: { data: { date: string; followers: number }[]; current: number | null }) {
  const points = data.filter((d) => Number.isFinite(d.followers));

  // Nothing tracked yet, or only today's snapshot — show a "building" state
  // rather than a misleading flat line.
  if (points.length < 2) {
    return (
      <div className="rounded-xl bg-white border border-border shadow-card p-4">
        <div className="text-[13px] font-semibold text-ink-900 mb-1">Follower growth</div>
        <div className="flex items-end gap-2">
          <div className="text-[24px] font-bold tabular-nums" style={{ color: ACCENT }}>{fmt(current)}</div>
          <div className="text-[12px] text-ink-400 pb-1.5">followers today</div>
        </div>
        <p className="mt-2 text-[12px] text-ink-400">
          We just started tracking this account. Your growth curve builds up as you check back over the coming days.
        </p>
      </div>
    );
  }

  const W = 640, H = 160, padX = 8, padTop = 12, padBot = 22;
  const ys = points.map((p) => p.followers);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const x = (i: number) => padX + (i / (points.length - 1)) * (W - padX * 2);
  const y = (v: number) => padTop + (1 - (v - min) / span) * (H - padTop - padBot);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.followers).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(H - padBot).toFixed(1)} L${x(0).toFixed(1)},${(H - padBot).toFixed(1)} Z`;

  const first = points[0]!.followers;
  const last = points[points.length - 1]!.followers;
  const delta = last - first;
  const deltaPct = first > 0 ? (delta / first) * 100 : 0;
  const up = delta >= 0;
  const fmtDay = (s: string): string => {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="text-[13px] font-semibold text-ink-900">Follower growth</div>
        <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: up ? '#16a34a' : '#dc2626' }}>
          <span>{up ? '▲' : '▼'}</span>
          <span className="tabular-nums">{up ? '+' : ''}{delta.toLocaleString('en-IN')}</span>
          <span className="text-ink-400 font-medium">({up ? '+' : ''}{deltaPct.toFixed(2)}% over {points.length} days)</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
        <defs>
          <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.22" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#growthFill)" />
        <path d={line} fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(last)} r="3.5" fill={ACCENT} />
      </svg>
      <div className="flex justify-between text-[11px] text-ink-400 mt-1">
        <span>{fmtDay(points[0]!.date)} · {fmt(first)}</span>
        <span>{fmtDay(points[points.length - 1]!.date)} · {fmt(last)}</span>
      </div>
    </div>
  );
}

function ReelForecastCard({ f }: { f?: ReelForecast }) {
  if (!f || f.sample_size < 3 || !f.next_reel) {
    return (
      <div className="rounded-xl bg-white border border-border shadow-card p-4">
        <div className="text-[13px] font-semibold text-ink-900 mb-1">Reel forecast</div>
        <p className="text-[12.5px] text-ink-400">
          Post a few more reels{f ? ` (${f.sample_size} so far` : ''}{f ? ', need 3+)' : ''} and we’ll predict how your next one is likely to perform.
        </p>
      </div>
    );
  }
  const trendColor = f.trend === 'rising' ? '#16a34a' : f.trend === 'cooling' ? '#dc2626' : '#6b7280';
  const trendLabel = f.trend === 'rising' ? 'Trending up' : f.trend === 'cooling' ? 'Cooling off' : 'Steady';
  const trendIcon = f.trend === 'rising' ? '▲' : f.trend === 'cooling' ? '▼' : '▬';
  const bandColor: Record<string, string> = { breakout: '#8134AF', strong: '#16a34a', average: '#6b7280', soft: '#d97706' };
  const sc = f.scorecard;
  const scTotal = sc.breakout + sc.strong + sc.average + sc.soft || 1;
  const bands: [keyof typeof sc, string][] = [['breakout', 'Breakout'], ['strong', 'Strong'], ['average', 'Average'], ['soft', 'Soft']];

  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[13px] font-semibold text-ink-900">Reel forecast</div>
        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-0.5 rounded-full"
          style={{ color: trendColor, background: `${trendColor}14` }}>
          {trendIcon} {trendLabel}{f.momentum_pct != null ? ` ${f.momentum_pct > 0 ? '+' : ''}${f.momentum_pct}%` : ''}
        </span>
      </div>

      {/* Prediction — next reel */}
      <div className="rounded-lg p-3 mb-3" style={{ background: ACCENT_SOFT }}>
        <div className="text-[11px] uppercase tracking-wide text-ink-400">Your next reel is projected to get</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-[26px] font-bold tabular-nums" style={{ color: ACCENT }}>{fmt(f.next_reel.plays_expected)}</span>
          <span className="text-[12.5px] text-ink-500">plays</span>
        </div>
        <div className="text-[11.5px] text-ink-400">
          likely range {fmt(f.next_reel.plays_low)}–{fmt(f.next_reel.plays_high)}
          {f.next_reel.er_expected != null ? ` · ~${pct(f.next_reel.er_expected)} engagement` : ''}
        </div>
      </div>

      {/* Recent reel scorecard */}
      <div className="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Recent reels vs your median ({fmt(f.median_plays)} plays)</div>
      <div className="flex h-2 rounded-full overflow-hidden mb-1.5">
        {bands.map(([k]) => sc[k] > 0 && (
          <div key={k} style={{ width: `${(sc[k] / scTotal) * 100}%`, background: bandColor[k] }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {bands.map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1 text-ink-500">
            <span className="h-2 w-2 rounded-full" style={{ background: bandColor[k] }} />
            {label} <span className="tabular-nums text-ink-700 font-medium">{sc[k]}</span>
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11.5px] text-ink-500">
        <span>Consistency <span className="font-semibold text-ink-800">{f.consistency != null ? Math.round(f.consistency * 100) + '%' : '—'}</span></span>
        {f.last_reel_band && (
          <span>Last reel: <span className="font-semibold capitalize" style={{ color: bandColor[f.last_reel_band] }}>{f.last_reel_band}</span></span>
        )}
      </div>
    </div>
  );
}

function ContentBreakdownCard({ b }: { b?: ContentBreakdown }) {
  const rows = (b?.by_type ?? []).filter((r) => r.count > 0);
  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-white border border-border shadow-card p-4">
        <div className="text-[13px] font-semibold text-ink-900 mb-1">Performance by format</div>
        <p className="text-[12.5px] text-ink-400">Not enough posts yet to compare formats.</p>
      </div>
    );
  }
  const maxEr = Math.max(...rows.map((r) => r.avg_er ?? 0), 0.0001);
  const nice: Record<string, string> = { reels: 'Reels', photos: 'Photos', carousels: 'Carousels' };
  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold text-ink-900">Performance by format</div>
        {b?.best_type && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: ACCENT, background: ACCENT_SOFT }}>
            {nice[b.best_type]} win for engagement
          </span>
        )}
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.type}>
            <div className="flex justify-between text-[12px] mb-1">
              <span className="text-ink-700 font-medium">{nice[r.type]} <span className="text-ink-400 font-normal">· {r.count}</span></span>
              <span className="text-ink-500 tabular-nums">
                {pct(r.avg_er)}
                {r.type === 'reels' && r.avg_plays ? ` · ${fmt(r.avg_plays)} plays` : r.avg_reach ? ` · ${fmt(r.avg_reach)} reach` : ''}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[#f0eefb] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${((r.avg_er ?? 0) / maxEr) * 100}%`, background: r.type === b?.best_type ? ACCENT : '#c4b5fd' }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10.5px] text-ink-400">Bars compare average engagement rate across your recent posts by format.</p>
    </div>
  );
}

function EmptyState({ reason }: { reason?: string }) {
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
  // db_error is a server issue, not an auth one — a connect button wouldn't help there.
  const showConnect = reason !== 'db_error';
  const btnLabel = reason === 'fetch_error' ? 'Reconnect Instagram' : 'Connect Instagram';
  return (
    <div className="rounded-2xl bg-white border border-border shadow-card p-10 text-center">
      <div className="mx-auto h-14 w-14 rounded-2xl grid place-items-center mb-4" style={{ background: ACCENT_SOFT, color: ACCENT }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 20V10M12 20V4M18 20v-6" /></svg>
      </div>
      <div className="text-[17px] font-bold text-ink-900">{c.t}</div>
      <p className="mt-2 text-[13.5px] text-ink-500 max-w-md mx-auto">{c.d}</p>
      {showConnect && (
        <a href="/api/oauth/instagram?flow=creator"
          className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold hover:brightness-105 hover:-translate-y-0.5 transition-all"
          style={{ background: 'linear-gradient(90deg,#F58529,#DD2A7B,#8134AF)' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" /></svg>
          {btnLabel}
        </a>
      )}
      {reason === 'fetch_error' && (
        <p className="mt-3 text-[11.5px] text-ink-400 max-w-md mx-auto">
          Make sure your Instagram is a Business/Creator account and added as a tester in the Meta app.
        </p>
      )}
    </div>
  );
}
