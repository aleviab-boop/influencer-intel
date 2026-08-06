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
interface AudienceQuality {
  available: boolean;
  score: number | null;
  grade: string | null;
  sample: number;
  signals: { key: string; label: string; score: number; status: 'healthy' | 'watch' | 'concern'; detail: string }[];
}
interface Recommendation {
  id: string; kind: 'content' | 'timing' | 'growth' | 'money' | 'quality';
  title: string; body: string; priority: number;
}
interface GroupStat { count: number; avg_er: number | null; avg_reach: number | null }
interface ContentAnalysis {
  hashtags: { tag: string; count: number; avg_er: number | null }[];
  total_unique_hashtags: number;
  avg_hashtags_per_post: number | null;
  sponsored: GroupStat;
  organic: GroupStat;
  sponsored_er_delta_pct: number | null;
}
interface CaptionSplit {
  with_count: number; without_count: number;
  with_er: number | null; without_er: number | null; lift_pct: number | null;
}
interface CaptionAnalysis {
  available: boolean;
  sample_size: number;
  avg_caption_chars: number | null;
  emoji_usage_pct: number | null;
  question_usage_pct: number | null;
  cta_usage_pct: number | null;
  length_buckets: { key: 'short' | 'medium' | 'long'; label: string; count: number; avg_er: number | null }[];
  best_length: 'short' | 'medium' | 'long' | null;
  emoji_split: CaptionSplit | null;
  cta_split: CaptionSplit | null;
  headline: string | null;
}
interface PeerBenchmark {
  available: boolean;
  cohort_size: number;
  cohort_label: string;
  scope: 'niche' | 'tier';
  your_er: number | null;
  cohort_median_er: number | null;
  cohort_p25_er: number | null;
  cohort_p75_er: number | null;
  percentile: number | null;
  verdict: 'top' | 'above' | 'typical' | 'below' | null;
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
  recommendations?: Recommendation[];
  reel_forecast?: ReelForecast;
  content_breakdown?: ContentBreakdown;
  audience_quality?: AudienceQuality;
  content_analysis?: ContentAnalysis;
  caption_analysis?: CaptionAnalysis;
  benchmark?: PeerBenchmark | null;
  media_value?: MediaValue | null;
  pitch_coach?: PitchCoach | null;
  pitch_draft?: PitchDraft | null;
  posting_time?: PostingTimeAnalysis | null;
  content_playbook?: ContentPlaybook | null;
  engagement_trend?: EngagementTrend | null;
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
const money = (v: number | null | undefined): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '₹0';
  return '₹' + Math.round(n).toLocaleString('en-IN');
};

// Per-post performance band vs the creator's own median engagement.
type Band = 'breakout' | 'strong' | 'average' | 'soft';
const BAND_META: Record<Band, { label: string; color: string }> = {
  breakout: { label: 'Breakout', color: '#8134AF' },
  strong: { label: 'Strong', color: '#16a34a' },
  average: { label: 'Average', color: '#6b7280' },
  soft: { label: 'Soft', color: '#d97706' },
};
const bandOf = (ratio: number): Band =>
  ratio >= 1.5 ? 'breakout' : ratio >= 1.15 ? 'strong' : ratio >= 0.85 ? 'average' : 'soft';
const medianOf = (nums: number[]): number | null => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

interface BrandMatch {
  program_id: string;
  brand_name: string;
  program_name: string;
  score: number;
  fit: 'strong' | 'good' | 'possible';
  reason: string;
}
interface BrandMatches {
  available: boolean;
  reason?: string;
  niche?: string | null;
  matches: BrandMatch[];
}
interface EngagementTrend {
  available: boolean;
  sample_size: number;
  series: { t: string; er: number }[];
  recent_avg: number | null;
  older_avg: number | null;
  momentum_pct: number | null;
  trend: 'rising' | 'steady' | 'cooling' | null;
  best: { t: string; er: number } | null;
  headline: string | null;
}
interface DayStat { day: number; label: string; count: number; avg_er: number | null }
interface PartStat { key: string; label: string; range: string; count: number; avg_er: number | null }
interface PostingTimeAnalysis {
  available: boolean;
  sample_size: number;
  timezone: string;
  by_day: DayStat[];
  by_part: PartStat[];
  best_day: DayStat | null;
  best_part: PartStat | null;
  headline: string | null;
}
interface PostBrief {
  n: number; format: string; window: string | null;
  hook: string; caption_tip: string; hashtag: string | null; why: string;
}
interface ContentPlaybook { available: boolean; briefs: PostBrief[] }
interface PitchCoach {
  available: boolean;
  headline: string;
  suggested_ask: { low: number; high: number; deliverable: string } | null;
  talking_points: string[];
  readiness: { score: number; label: 'strong' | 'solid' | 'building'; gaps: string[] };
}
interface PitchDraft {
  available: boolean;
  subject: string;
  body: string;
}
interface MediaValue {
  available: boolean;
  currency: 'INR';
  tier: string;
  per_post_low: number; per_post_mid: number; per_post_high: number;
  monthly_mid: number | null; posts_per_month: number | null;
  reach_value: number; engagement_value: number;
  avg_impressions: number; avg_engagements: number; cpm: number;
  note: string;
}
interface Earnings {
  available: boolean;
  reason?: string;
  currency?: string;
  summary?: {
    total_earned: number; pending: number; lifetime: number;
    deals_count: number; brands_count: number; next_due: string | null;
  };
  deals?: {
    id: string; brand: string; program: string; rate: number; paid: boolean;
    paid_at: string | null; status: string; deliverables: string | null; due_date: string | null;
  }[];
}

export default function AnalyticsPreviewPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsPreview />
    </Suspense>
  );
}

function AnalyticsPreview() {
  const [data, setData] = useState<Analytics | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [brandMatches, setBrandMatches] = useState<BrandMatches | null>(null);
  const [loading, setLoading] = useState(true);
  const [kitHref, setKitHref] = useState('/creator/media-kit');
  const [tab, setTab] = useState<'all' | 'reels' | 'posts'>('all');
  const [sort, setSort] = useState<'recent' | 'top'>('recent');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = new URLSearchParams();
    const account = params.get('account');
    const handle = params.get('handle');
    if (account) q.set('account', account);
    else if (handle) q.set('handle', handle);
    const qs = q.toString() ? `?${q}` : '';
    setKitHref(`/creator/media-kit${qs}`);

    fetch(`/api/creator/analytics${qs}`)
      .then((r) => r.json())
      .then((d: Analytics) => setData(d))
      .catch(() => setData({ connected: false, reason: 'network' }))
      .finally(() => setLoading(false));

    // Earnings is DB-only (no IG token) — fetch in parallel so it renders even
    // when the Instagram connection is stale.
    fetch(`/api/creator/earnings${qs}`)
      .then((r) => r.json())
      .then((e: Earnings) => setEarnings(e))
      .catch(() => setEarnings({ available: false, reason: 'network' }));

    // Brand matches — also DB-only, fetched in parallel.
    fetch(`/api/creator/brand-matches${qs}`)
      .then((r) => r.json())
      .then((m: BrandMatches) => setBrandMatches(m))
      .catch(() => setBrandMatches({ available: false, matches: [] }));
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
        {/* Earnings works without a live IG token, so surface it here too. */}
        {earnings?.available && (earnings.summary?.deals_count ?? 0) > 0 && (
          <div className="mt-4">
            <EarningsSection e={earnings} />
          </div>
        )}
      </Shell>
    );
  }

  const { profile, stats, cadence, demographics } = data;
  const growth = data.growth ?? [];
  const allPosts = data.posts ?? [];
  const medEr = medianOf(allPosts.map((p) => p.er).filter((v): v is number => v != null && v > 0));
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
        <div className="sm:ml-auto flex flex-col items-stretch sm:items-end gap-3 shrink-0">
          <div className="grid grid-cols-3 gap-6 text-center">
            <HeaderStat label="followers" value={fmt(profile?.followers_count)} />
            <HeaderStat label="following" value={fmt(profile?.follows_count)} />
            <HeaderStat label="posts" value={fmt(profile?.media_count)} />
          </div>
          <a href={kitHref}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-semibold text-white hover:brightness-105 hover:-translate-y-0.5 transition-all"
            style={{ background: ACCENT }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v12H4z" /><path d="M8 20h8M12 16v4" /></svg>
            Media kit
          </a>
        </div>
      </div>

      {/* Recommended focus — synthesised from all the signals below */}
      {(data.recommendations?.length ?? 0) > 0 && (
        <div className="mt-4">
          <RecommendationsCard recs={data.recommendations!} />
        </div>
      )}

      <SectionLabel>Performance</SectionLabel>

      {/* Stat cards */}
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
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

      {/* Peer benchmark */}
      {data.benchmark?.available && (
        <div className="mt-3">
          <BenchmarkCard b={data.benchmark} />
        </div>
      )}

      {/* Engagement composition */}
      <div className="mt-3">
        <InteractionMix posts={allPosts} />
      </div>

      <SectionLabel>Earnings</SectionLabel>

      {/* Earnings */}
      <div className="mt-3">
        <EarningsSection e={earnings} />
      </div>

      {/* Earned media value */}
      {data.media_value?.available && (
        <div className="mt-3">
          <MediaValueCard v={data.media_value} />
        </div>
      )}

      {/* Pitch coach */}
      {data.pitch_coach?.available && (
        <div className="mt-3">
          <PitchCoachCard c={data.pitch_coach} kitHref={kitHref} />
        </div>
      )}

      {/* Copy-ready pitch message */}
      {data.pitch_draft?.available && (
        <div className="mt-3">
          <PitchDraftCard d={data.pitch_draft} />
        </div>
      )}

      {/* Brands to pitch */}
      {brandMatches?.available && brandMatches.matches.length > 0 && (
        <div className="mt-3">
          <BrandMatchCard m={brandMatches} kitHref={kitHref} />
        </div>
      )}

      <SectionLabel>Growth &amp; predictions</SectionLabel>

      {/* Engagement trend over time */}
      {data.engagement_trend?.available && (
        <div className="mt-3">
          <EngagementTrendCard t={data.engagement_trend} />
        </div>
      )}

      {/* Follower growth */}
      <div className="mt-3">
        <GrowthChart data={growth} current={profile?.followers_count ?? null} />
      </div>

      {/* Reel forecast (prediction) + content-format depth */}
      <div className="mt-3 grid lg:grid-cols-2 gap-3">
        <ReelForecastCard f={data.reel_forecast} />
        <ContentBreakdownCard b={data.content_breakdown} />
      </div>

      <SectionLabel>Audience &amp; timing</SectionLabel>

      {/* Audience quality / authenticity */}
      {data.audience_quality?.available && (
        <div className="mt-3">
          <AudienceQualityCard q={data.audience_quality} />
        </div>
      )}

      {/* Audience demographics */}
      {demographics && (Object.keys(demographics.gender_age).length > 0 || Object.keys(demographics.cities).length > 0) && (
        <div className="mt-3 grid md:grid-cols-2 gap-3">
          <Panel title="Audience — top cities">
            <BreakdownList data={demographics.cities} />
          </Panel>
          <Panel title="Audience — age & gender">
            <BreakdownList data={demographics.gender_age} />
          </Panel>
        </div>
      )}

      {/* Best time to post */}
      <div className="mt-4 grid lg:grid-cols-2 gap-3">
        <PostingHeatmap posts={allPosts} />
        {data.posting_time?.available && <PostingWindowCard t={data.posting_time} />}
      </div>

      {((data.content_analysis && (data.content_analysis.hashtags.length > 0 || data.content_analysis.sponsored.count > 0)) || data.caption_analysis?.available) && (
        <>
          <SectionLabel>Content strategy</SectionLabel>
          {data.content_analysis && (data.content_analysis.hashtags.length > 0 || data.content_analysis.sponsored.count > 0) && (
            <div className="mt-3 grid lg:grid-cols-2 gap-3">
              <HashtagCard c={data.content_analysis} />
              <SponsoredCard c={data.content_analysis} />
            </div>
          )}
          {data.caption_analysis?.available && (
            <div className="mt-3">
              <CaptionCard c={data.caption_analysis} />
            </div>
          )}
        </>
      )}

      {data.content_playbook?.available && (
        <>
          <SectionLabel>Your next posts</SectionLabel>
          <div className="mt-3">
            <ContentPlaybookCard p={data.content_playbook} />
          </div>
        </>
      )}

      <SectionLabel>Your posts</SectionLabel>

      {/* Posts / reels grid */}
      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
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

      {medEr != null && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-400">
          <span>Badges rank each post vs your median engagement ({pct(medEr)}):</span>
          {(Object.keys(BAND_META) as Band[]).map((b) => (
            <span key={b} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: BAND_META[b].color }} />
              {BAND_META[b].label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shown.map((p) => {
          const band = p.er != null && medEr && medEr > 0 ? bandOf(p.er / medEr) : null;
          const bm = band ? BAND_META[band] : null;
          return (
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
              {bm && (
                <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md text-[9.5px] font-bold text-white"
                  style={{ background: bm.color }} title={`${bm.label} vs your median engagement`}>
                  {bm.label}
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
          );
        })}
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-7 mb-1 flex items-center gap-2.5">
      <span className="h-3.5 w-1 rounded-full" style={{ background: ACCENT }} />
      <span className="text-[12px] font-bold uppercase tracking-wider text-ink-500">{children}</span>
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

function EngagementTrendCard({ t }: { t: EngagementTrend }) {
  const pts = t.series;
  const color = t.trend === 'rising' ? '#16a34a' : t.trend === 'cooling' ? '#dc2626' : ACCENT;
  const trendLabel = t.trend === 'rising' ? 'Trending up' : t.trend === 'cooling' ? 'Cooling off' : 'Holding steady';
  const arrow = t.trend === 'rising' ? '▲' : t.trend === 'cooling' ? '▼' : '▬';

  const W = 640, H = 120, padX = 8, padTop = 12, padBot = 12;
  const ys = pts.map((p) => p.er);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const x = (i: number) => padX + (i / Math.max(1, pts.length - 1)) * (W - padX * 2);
  const y = (v: number) => padTop + (1 - (v - min) / span) * (H - padTop - padBot);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.er).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${(H - padBot).toFixed(1)} L${x(0).toFixed(1)},${(H - padBot).toFixed(1)} Z`;

  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="text-[13px] font-semibold text-ink-900">Engagement trend</div>
        <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color }}>
          <span>{arrow}</span>
          <span>{trendLabel}</span>
          {t.momentum_pct != null && (
            <span className="text-ink-400 font-medium tabular-nums">({t.momentum_pct > 0 ? '+' : ''}{t.momentum_pct}%)</span>
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
        <defs>
          <linearGradient id="erTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.20" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#erTrendFill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1]!.er)} r="3.5" fill={color} />
      </svg>
      <div className="flex justify-between text-[11px] text-ink-400 mt-1">
        <span>Older avg {pct(t.older_avg)}</span>
        <span>{t.sample_size} posts</span>
        <span>Recent avg {pct(t.recent_avg)}</span>
      </div>
      {t.headline && <p className="mt-2 text-[12px] text-ink-500 leading-relaxed">{t.headline}</p>}
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

function PostingWindowCard({ t }: { t: PostingTimeAnalysis }) {
  const parts = t.by_part.filter((p) => p.count > 0);
  const days = t.by_day.filter((d) => d.count > 0);
  const maxPartEr = Math.max(...parts.map((p) => p.avg_er ?? 0), 0.0001);
  const maxDayEr = Math.max(...days.map((d) => d.avg_er ?? 0), 0.0001);

  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <div className="text-[13px] font-semibold text-ink-900">Your best windows</div>
        <span className="text-[11px] text-ink-400">{t.sample_size} posts · {t.timezone}</span>
      </div>
      {t.headline && (
        <div className="mb-3 rounded-lg px-3 py-2 text-[12.5px] text-ink-800" style={{ background: ACCENT_SOFT }}>
          {t.headline}
        </div>
      )}

      <div className="text-[11.5px] font-semibold text-ink-500 uppercase tracking-wide mb-2">Time of day</div>
      <div className="space-y-2 mb-4">
        {parts.map((p) => (
          <div key={p.key}>
            <div className="flex justify-between text-[12px] mb-0.5">
              <span className="text-ink-700 font-medium">
                {p.label} <span className="text-ink-400 font-normal">· {p.range}</span>
                {t.best_part?.key === p.key && <span className="ml-1 text-[10px] font-semibold" style={{ color: ACCENT }}>BEST</span>}
              </span>
              <span className="text-ink-500 tabular-nums">{pct(p.avg_er)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#f0eefb] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${((p.avg_er ?? 0) / maxPartEr) * 100}%`, background: t.best_part?.key === p.key ? ACCENT : '#c9c2f0' }} />
            </div>
          </div>
        ))}
      </div>

      <div className="text-[11.5px] font-semibold text-ink-500 uppercase tracking-wide mb-2">Day of week</div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const h = d.avg_er != null ? Math.max(0.15, (d.avg_er / maxDayEr)) : 0.1;
          const isBest = t.best_day?.day === d.day;
          return (
            <div key={d.day} className="flex flex-col items-center gap-1">
              <div className="w-full h-14 rounded-md bg-[#f0eefb] flex items-end overflow-hidden" title={`${d.label}: ${pct(d.avg_er)} (${d.count})`}>
                <div className="w-full rounded-md" style={{ height: `${h * 100}%`, background: isBest ? ACCENT : '#c9c2f0' }} />
              </div>
              <span className="text-[9.5px]" style={{ color: isBest ? ACCENT : '#9ca3af', fontWeight: isBest ? 700 : 400 }}>
                {d.label.slice(0, 1)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10.5px] text-ink-400">Aggregated from your posts&apos; engagement by IST day &amp; time. Directional — test and confirm.</p>
    </div>
  );
}

function PostingHeatmap({ posts }: { posts: Post[] }) {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const BINS = ['12–4a', '4–8a', '8a–12p', '12–4p', '4–8p', '8p–12a'];

  // Bucket each post into day-of-week × 4-hour slot, in the VIEWER's local
  // timezone (posts carry IG's UTC-offset timestamps; new Date() localizes).
  const cells: { count: number; erSum: number; erN: number }[][] =
    DAYS.map(() => BINS.map(() => ({ count: 0, erSum: 0, erN: 0 })));
  let usable = 0;
  for (const p of posts) {
    const d = new Date(p.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    usable++;
    const cell = cells[d.getDay()]![Math.floor(d.getHours() / 4)]!;
    cell.count++;
    if (p.er != null) { cell.erSum += p.er; cell.erN++; }
  }

  if (usable < 4) {
    return (
      <div className="rounded-xl bg-white border border-border shadow-card p-4">
        <div className="text-[13px] font-semibold text-ink-900 mb-1">Best time to post</div>
        <p className="text-[12.5px] text-ink-400">Once you’ve posted a bit more, we’ll map out which days and times land best for you.</p>
      </div>
    );
  }

  // Score each populated cell by average ER (falls back to raw count when no
  // ER anywhere). Track the max for colour scaling + the best slot.
  const anyEr = cells.some((row) => row.some((c) => c.erN > 0));
  const score = (c: { count: number; erSum: number; erN: number }): number =>
    c.count === 0 ? -1 : anyEr ? (c.erN ? c.erSum / c.erN : 0) : c.count;
  let maxScore = 0;
  let best: { day: number; bin: number; s: number } | null = null;
  cells.forEach((row, di) => row.forEach((c, bi) => {
    const s = score(c);
    if (c.count > 0 && s > maxScore) maxScore = s;
    if (c.count > 0 && (!best || s > best.s)) best = { day: di, bin: bi, s };
  }));

  const bestCell = best as { day: number; bin: number; s: number } | null;
  const bestLabel = bestCell ? `${DAYS[bestCell.day]} · ${BINS[bestCell.bin]}` : null;

  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="text-[13px] font-semibold text-ink-900">Best time to post</div>
        {bestLabel && (
          <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: ACCENT, background: ACCENT_SOFT }}>
            Sweet spot: {bestLabel}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[380px]">
          {/* Column headers */}
          <div className="grid" style={{ gridTemplateColumns: `34px repeat(${BINS.length}, 1fr)` }}>
            <div />
            {BINS.map((b) => (
              <div key={b} className="text-[9.5px] text-ink-400 text-center pb-1">{b}</div>
            ))}
          </div>
          {/* Rows */}
          {cells.map((row, di) => (
            <div key={di} className="grid items-center" style={{ gridTemplateColumns: `34px repeat(${BINS.length}, 1fr)` }}>
              <div className="text-[10.5px] text-ink-500 font-medium pr-1">{DAYS[di]}</div>
              {row.map((c, bi) => {
                const s = score(c);
                const intensity = c.count === 0 ? 0 : maxScore > 0 ? 0.12 + 0.88 * (s / maxScore) : 0.4;
                const isBest = bestCell != null && bestCell.day === di && bestCell.bin === bi;
                const title = c.count === 0
                  ? `${DAYS[di]} ${BINS[bi]} · no posts`
                  : `${DAYS[di]} ${BINS[bi]} · ${c.count} post${c.count > 1 ? 's' : ''}${c.erN ? ` · ${pct(c.erSum / c.erN)} avg ER` : ''}`;
                return (
                  <div key={bi} className="p-[3px]">
                    <div title={title}
                      className="aspect-square rounded-[5px] grid place-items-center text-[9px] font-bold tabular-nums transition-transform hover:scale-105"
                      style={{
                        background: c.count === 0 ? '#f4f3f9' : ACCENT,
                        opacity: c.count === 0 ? 1 : intensity,
                        color: intensity > 0.55 ? '#fff' : ACCENT,
                        boxShadow: isBest ? `0 0 0 2px ${ACCENT}` : undefined,
                      }}>
                      {c.count > 0 ? c.count : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[10.5px] text-ink-400">
        Darker = higher average engagement. Numbers show how many posts landed in each slot · your local time.
      </p>
    </div>
  );
}

function EarningsSection({ e }: { e?: Earnings | null }) {
  if (!e) return null; // still loading — analytics content already fills the view

  const deals = e.deals ?? [];
  const s = e.summary;

  // No campaigns for this creator yet — encouraging empty state.
  if (!e.available || !s || s.deals_count === 0) {
    return (
      <div className="rounded-2xl bg-white border border-border shadow-card p-5">
        <div className="text-[15px] font-bold text-ink-900">Earnings</div>
        <p className="mt-1.5 text-[12.5px] text-ink-400 max-w-md">
          No brand campaigns yet. When a brand recruits you into a campaign, everything you’re
          owed and paid shows up here — with deliverables and due dates.
        </p>
      </div>
    );
  }

  const statusPill = (d: NonNullable<Earnings['deals']>[number]): { label: string; color: string } => {
    if (d.paid) return { label: 'Paid', color: '#16a34a' };
    if (d.status === 'recruited') return { label: 'In progress', color: ACCENT };
    if (d.status === 'contacted') return { label: 'Contacted', color: '#d97706' };
    return { label: 'Invited', color: '#6b7280' };
  };

  return (
    <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
      {/* Summary strip */}
      <div className="p-5" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[15px] font-bold text-ink-900">Earnings</div>
          {s.next_due && (
            <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-white border border-border text-ink-600">
              Next due · {dateStr(s.next_due)}
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MoneyTile label="Lifetime" value={money(s.lifetime)} />
          <MoneyTile label="Paid out" value={money(s.total_earned)} color="#16a34a" />
          <MoneyTile label="Pending" value={money(s.pending)} color={ACCENT} accent />
          <MoneyTile label="Deals" value={`${s.deals_count}`} sub={`${s.brands_count} brand${s.brands_count === 1 ? '' : 's'}`} />
        </div>
      </div>

      {/* Deals list */}
      <div className="divide-y divide-border">
        {deals.map((d) => {
          const pill = statusPill(d);
          return (
            <div key={d.id} className="flex items-center gap-3 px-5 py-3">
              <div className="h-9 w-9 rounded-lg grid place-items-center text-[13px] font-bold shrink-0"
                style={{ background: ACCENT_SOFT, color: ACCENT }}>
                {d.brand?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-ink-900 truncate">{d.brand}</div>
                <div className="text-[11.5px] text-ink-400 truncate">
                  {d.program}{d.due_date ? ` · due ${dateStr(d.due_date)}` : ''}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[14px] font-bold text-ink-900 tabular-nums">{money(d.rate)}</div>
                <span className="inline-block mt-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ color: pill.color, background: `${pill.color}14` }}>
                  {pill.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MoneyTile({ label, value, sub, color, accent }: { label: string; value: string; sub?: string; color?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl bg-white p-3 ${accent ? 'border-2' : 'border border-border'}`}
      style={accent ? { borderColor: ACCENT } : undefined}>
      <div className="text-[10.5px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 text-[19px] font-bold tabular-nums" style={{ color: color ?? '#1a1a2e' }}>{value}</div>
      {sub && <div className="text-[10.5px] text-ink-400">{sub}</div>}
    </div>
  );
}

function MediaValueCard({ v }: { v: MediaValue }) {
  const reachShare = v.reach_value + v.engagement_value > 0
    ? Math.round((v.reach_value / (v.reach_value + v.engagement_value)) * 100) : 0;
  return (
    <div className="rounded-xl bg-white border border-border shadow-card overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ background: `linear-gradient(90deg, ${ACCENT_SOFT}, #ffffff)` }}>
        <div>
          <div className="text-[13px] font-semibold text-ink-900">Earned media value</div>
          <div className="text-[11.5px] text-ink-400">What your organic output is worth as equivalent ad spend</div>
        </div>
        <div className="text-right">
          <div className="text-[22px] font-bold leading-none tabular-nums" style={{ color: ACCENT }}>
            {money(v.per_post_mid)}
          </div>
          <div className="text-[10.5px] text-ink-400">per post · {money(v.per_post_low)}–{money(v.per_post_high)}</div>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MoneyTile label="Per post" value={money(v.per_post_mid)} sub="mid estimate" accent />
          <MoneyTile label="Monthly" value={v.monthly_mid != null ? money(v.monthly_mid) : '—'}
            sub={v.posts_per_month != null ? `~${v.posts_per_month} posts/mo` : 'set a cadence'} />
          <MoneyTile label="Reach value" value={money(v.reach_value)} sub={`${fmt(v.avg_impressions)} reach @ ₹${v.cpm} CPM`} />
          <MoneyTile label="Engagement value" value={money(v.engagement_value)} sub={`${fmt(v.avg_engagements)} actions/post`} />
        </div>

        {/* Value composition bar */}
        <div className="mt-3">
          <div className="flex h-2 rounded-full overflow-hidden bg-[#f0eefb]">
            <div className="h-full" style={{ width: `${reachShare}%`, background: ACCENT }} />
            <div className="h-full" style={{ width: `${100 - reachShare}%`, background: '#d97706' }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-ink-500">
            <span><span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: ACCENT }} />Reach {reachShare}%</span>
            <span><span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: '#d97706' }} />Engagement {100 - reachShare}%</span>
          </div>
        </div>

        <p className="mt-3 text-[10.5px] text-ink-400">{v.note}</p>
      </div>
    </div>
  );
}

function PitchCoachCard({ c, kitHref }: { c: PitchCoach; kitHref: string }) {
  const R: Record<PitchCoach['readiness']['label'], { label: string; color: string }> = {
    strong: { label: 'Pitch-ready', color: '#16a34a' },
    solid: { label: 'Solid', color: ACCENT },
    building: { label: 'Building', color: '#d97706' },
  };
  const r = R[c.readiness.label];
  const score = c.readiness.score;
  return (
    <div className="rounded-xl bg-white border border-border shadow-card overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ background: `linear-gradient(90deg, ${ACCENT_SOFT}, #ffffff)` }}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-900">Pitch coach</div>
          <div className="text-[11.5px] text-ink-500 leading-snug max-w-lg">{c.headline}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <div className="text-[18px] font-bold leading-none tabular-nums" style={{ color: r.color }}>{score}</div>
            <div className="text-[9.5px] text-ink-400 uppercase tracking-wide">readiness</div>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{ color: r.color, background: `${r.color}14` }}>{r.label}</span>
        </div>
      </div>

      <div className="p-4">
        {c.suggested_ask && (
          <div className="mb-3 rounded-xl p-3 flex items-center justify-between gap-2" style={{ background: ACCENT_SOFT }}>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: ACCENT }}>Suggested ask</div>
              <div className="text-[11px] text-ink-500">Lead deliverable · {c.suggested_ask.deliverable}</div>
            </div>
            <div className="text-[16px] font-bold tabular-nums text-right shrink-0" style={{ color: ACCENT }}>
              {money(c.suggested_ask.low)} – {money(c.suggested_ask.high)}
            </div>
          </div>
        )}

        <div className="text-[11.5px] font-semibold text-ink-500 uppercase tracking-wide mb-2">Your talking points</div>
        <ul className="space-y-2">
          {c.talking_points.map((p, i) => (
            <li key={i} className="flex gap-2.5">
              <svg className="w-4 h-4 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="none">
                <path d="M5 10.5l3.5 3.5L15 6.5" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[12.5px] text-ink-700 leading-relaxed">{p}</span>
            </li>
          ))}
        </ul>

        {c.readiness.gaps.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#f0eefb]">
            <div className="text-[11.5px] font-semibold text-ink-500 uppercase tracking-wide mb-1.5">Shore up first</div>
            <ul className="space-y-1.5">
              {c.readiness.gaps.map((g, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="text-[#d97706] text-[13px] leading-relaxed shrink-0">•</span>
                  <span className="text-[12px] text-ink-500 leading-relaxed">{g}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[10.5px] text-ink-400">Talking points cite your own numbers — bring the receipts.</p>
          <a href={kitHref} className="text-[12px] font-semibold whitespace-nowrap" style={{ color: ACCENT }}>
            Open your media kit →
          </a>
        </div>
      </div>
    </div>
  );
}

function PitchDraftCard({ d }: { d: PitchDraft }) {
  const [copied, setCopied] = useState<null | 'body' | 'all'>(null);

  const copy = async (which: 'body' | 'all') => {
    const text = which === 'all' ? `Subject: ${d.subject}\n\n${d.body}` : d.body;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard blocked — the text is still selectable in the box below */
    }
  };

  return (
    <div className="rounded-xl bg-white border border-border shadow-card overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ background: `linear-gradient(90deg, ${ACCENT_SOFT}, #ffffff)` }}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-900">Ready-to-send pitch</div>
          <div className="text-[11.5px] text-ink-500 leading-snug max-w-lg">
            Copy, swap the {'{placeholders}'}, and send. Every figure is one you can defend.
          </div>
        </div>
        <button
          onClick={() => copy('all')}
          className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg shrink-0 transition-colors"
          style={{ color: '#fff', background: ACCENT }}
        >
          {copied === 'all' ? 'Copied ✓' : 'Copy email'}
        </button>
      </div>

      <div className="p-4">
        {/* Subject */}
        <div className="mb-3">
          <div className="text-[10.5px] font-semibold text-ink-400 uppercase tracking-wide mb-1">Subject</div>
          <div className="text-[12.5px] text-ink-800 font-medium rounded-lg border border-border bg-[#faf9ff] px-3 py-2">
            {d.subject}
          </div>
        </div>

        {/* Body */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="text-[10.5px] font-semibold text-ink-400 uppercase tracking-wide">Message</div>
          <button
            onClick={() => copy('body')}
            className="text-[11px] font-semibold whitespace-nowrap"
            style={{ color: ACCENT }}
          >
            {copied === 'body' ? 'Copied ✓' : 'Copy message'}
          </button>
        </div>
        <pre className="text-[12px] text-ink-700 leading-relaxed rounded-lg border border-border bg-[#faf9ff] px-3 py-3 whitespace-pre-wrap font-sans overflow-x-auto">
          {d.body}
        </pre>

        <p className="mt-3 text-[10.5px] text-ink-400">
          Personalise the {'{Brand}'} and {'{product/campaign}'} tags before you hit send.
        </p>
      </div>
    </div>
  );
}

function BrandMatchCard({ m, kitHref }: { m: BrandMatches; kitHref: string }) {
  const FIT: Record<BrandMatch['fit'], { label: string; color: string }> = {
    strong: { label: 'Strong fit', color: '#16a34a' },
    good: { label: 'Good fit', color: ACCENT },
    possible: { label: 'Possible', color: '#6b7280' },
  };
  return (
    <div className="rounded-xl bg-white border border-border shadow-card overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ background: `linear-gradient(90deg, ${ACCENT_SOFT}, #ffffff)` }}>
        <div>
          <div className="text-[13px] font-semibold text-ink-900">Brands to pitch</div>
          <div className="text-[11.5px] text-ink-400">
            Active campaigns that fit{m.niche ? ` your ${m.niche} niche` : ' your profile'}
          </div>
        </div>
        <span className="text-[11px] text-ink-400">{m.matches.length} match{m.matches.length === 1 ? '' : 'es'}</span>
      </div>

      <div className="divide-y divide-border">
        {m.matches.map((b) => {
          const f = FIT[b.fit];
          return (
            <div key={b.program_id} className="px-4 py-3 flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg grid place-items-center text-[13px] font-bold text-white shrink-0"
                style={{ background: ACCENT }}>
                {b.brand_name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-semibold text-ink-900 truncate">{b.brand_name}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                    style={{ color: f.color, background: `${f.color}14` }}>{f.label}</span>
                </div>
                <div className="text-[11.5px] text-ink-400 truncate">{b.program_name}</div>
                <p className="mt-0.5 text-[12px] text-ink-500 leading-relaxed">{b.reason}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[15px] font-bold tabular-nums" style={{ color: f.color }}>{b.score}</div>
                <div className="text-[9.5px] text-ink-400 uppercase tracking-wide">fit</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10.5px] text-ink-400">Matched by niche &amp; content topics against active campaigns in our network.</p>
        <a href={kitHref} className="text-[12px] font-semibold whitespace-nowrap" style={{ color: ACCENT }}>
          Pitch with your media kit →
        </a>
      </div>
    </div>
  );
}

function ContentPlaybookCard({ p }: { p: ContentPlaybook }) {
  const FMT_COLOR: Record<string, string> = { Reel: ACCENT, Carousel: '#0ea5e9', Photo: '#16a34a', Post: '#6b7280' };
  return (
    <div className="grid md:grid-cols-3 gap-3">
      {p.briefs.map((b) => {
        const color = FMT_COLOR[b.format] ?? ACCENT;
        return (
          <div key={b.n} className="rounded-xl bg-white border border-border shadow-card p-4 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                style={{ color, background: `${color}14` }}>{b.format}</span>
              <span className="text-[11px] text-ink-300 font-semibold tabular-nums">#{b.n}</span>
            </div>

            <p className="text-[13px] text-ink-800 leading-relaxed font-medium">{b.hook}</p>

            <div className="mt-3 space-y-1.5 text-[12px]">
              {b.window && (
                <div className="flex gap-2">
                  <span className="text-ink-400 shrink-0">When</span>
                  <span className="text-ink-700">{b.window}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-ink-400 shrink-0">Caption</span>
                <span className="text-ink-700">{b.caption_tip}</span>
              </div>
              {b.hashtag && (
                <div className="flex gap-2">
                  <span className="text-ink-400 shrink-0">Tag</span>
                  <span className="font-medium" style={{ color: ACCENT }}>{b.hashtag}</span>
                </div>
              )}
            </div>

            <div className="mt-auto pt-3 text-[11px] text-ink-400 border-t border-[#f0eefb] leading-relaxed">
              {b.why}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecommendationsCard({ recs }: { recs: Recommendation[] }) {
  const KIND: Record<Recommendation['kind'], { label: string; color: string }> = {
    content: { label: 'Content', color: ACCENT },
    timing: { label: 'Timing', color: '#0ea5e9' },
    growth: { label: 'Growth', color: '#16a34a' },
    money: { label: 'Deals', color: '#d97706' },
    quality: { label: 'Quality', color: '#dc2626' },
  };
  return (
    <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
      <div className="px-5 py-3.5 flex items-center gap-2.5" style={{ background: `linear-gradient(90deg, ${ACCENT_SOFT}, #ffffff)` }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z" />
        </svg>
        <div className="text-[15px] font-bold text-ink-900">Recommended focus</div>
        <span className="ml-auto text-[11px] text-ink-400">auto-generated from your data</span>
      </div>
      <ol className="divide-y divide-border">
        {recs.map((r, i) => {
          const k = KIND[r.kind];
          return (
            <li key={r.id} className="flex gap-3 px-5 py-3.5">
              <div className="h-6 w-6 rounded-full grid place-items-center text-[12px] font-bold shrink-0 tabular-nums"
                style={{ background: ACCENT_SOFT, color: ACCENT }}>{i + 1}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-semibold text-ink-900">{r.title}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                    style={{ color: k.color, background: `${k.color}14` }}>{k.label}</span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-ink-500 leading-relaxed">{r.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BenchmarkCard({ b }: { b: PeerBenchmark }) {
  const pctl = b.percentile ?? 0;
  const V: Record<string, { color: string; label: string; blurb: string }> = {
    top: { color: '#16a34a', label: 'Top performer', blurb: `You're in the top ${100 - pctl}% of ${b.cohort_label}.` },
    above: { color: '#16a34a', label: 'Above average', blurb: `You out-engage most ${b.cohort_label}.` },
    typical: { color: '#d97706', label: 'Right on par', blurb: `You engage about the same as ${b.cohort_label}.` },
    below: { color: '#dc2626', label: 'Room to grow', blurb: `Your engagement trails most ${b.cohort_label}.` },
  };
  const v = V[b.verdict ?? 'typical']!;

  // Position markers on a 0..max scale for the little distribution bar.
  const max = Math.max(b.cohort_p75_er ?? 0, b.your_er ?? 0, b.cohort_median_er ?? 0) * 1.15 || 0.0001;
  const posOf = (x: number | null): number => (x != null ? Math.min(100, (x / max) * 100) : 0);

  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-[13px] font-semibold text-ink-900">How you compare</div>
          <div className="text-[11.5px] text-ink-400">
            vs {b.cohort_size} {b.cohort_label}{b.scope === 'niche' ? ' in your niche' : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[22px] font-bold leading-none tabular-nums" style={{ color: v.color }}>
            {pctl}<span className="text-[13px] font-semibold">th</span>
          </div>
          <div className="text-[10.5px] text-ink-400 uppercase tracking-wide">percentile</div>
        </div>
      </div>

      <div className="rounded-lg px-3 py-2 text-[12.5px] mb-3" style={{ background: `${v.color}12`, color: v.color }}>
        <b>{v.label}.</b> <span className="text-ink-700">{v.blurb}</span>
      </div>

      {/* Distribution: p25 — median — p75 range with your marker */}
      <div className="relative h-9 mb-1">
        <div className="absolute top-1/2 -translate-y-1/2 h-1.5 w-full rounded-full bg-[#f0eefb]" />
        {b.cohort_p25_er != null && b.cohort_p75_er != null && (
          <div className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-[#d9d2f5]"
            style={{ left: `${posOf(b.cohort_p25_er)}%`, width: `${posOf(b.cohort_p75_er) - posOf(b.cohort_p25_er)}%` }} />
        )}
        {b.cohort_median_er != null && (
          <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-ink-400"
            style={{ left: `${posOf(b.cohort_median_er)}%` }} title="Cohort median" />
        )}
        {b.your_er != null && (
          <div className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: `${posOf(b.your_er)}%`, top: 0 }}>
            <div className="w-3 h-3 rounded-full border-2 border-white shadow" style={{ background: v.color }} />
            <span className="mt-0.5 text-[10px] font-semibold whitespace-nowrap" style={{ color: v.color }}>You</span>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[11px] text-ink-500 tabular-nums">
        <span>Your ER <b className="text-ink-800">{pct(b.your_er)}</b></span>
        <span>Cohort median <b className="text-ink-800">{pct(b.cohort_median_er)}</b></span>
      </div>

      <p className="mt-3 text-[10.5px] text-ink-400">
        Compared against creators within ~3× your follower count in our database. Directional benchmark, not a ranking.
      </p>
    </div>
  );
}

function InteractionMix({ posts }: { posts: Post[] }) {
  // Aggregate across posts that carry insight fields (saves/shares only exist
  // on enriched posts). Composition of how the audience interacts.
  const withInsights = posts.filter((p) => p.saved != null || p.shares != null);
  const totals = posts.reduce(
    (acc, p) => {
      acc.likes += p.like_count || 0;
      acc.comments += p.comments_count || 0;
      acc.saves += p.saved ?? 0;
      acc.shares += p.shares ?? 0;
      return acc;
    },
    { likes: 0, comments: 0, saves: 0, shares: 0 },
  );
  const total = totals.likes + totals.comments + totals.saves + totals.shares;

  if (withInsights.length === 0 || total === 0) {
    return (
      <div className="rounded-xl bg-white border border-border shadow-card p-4">
        <div className="text-[13px] font-semibold text-ink-900 mb-1">Engagement composition</div>
        <p className="text-[12.5px] text-ink-400">Saves &amp; shares appear once Instagram returns per-post insights.</p>
      </div>
    );
  }

  const parts: { key: string; label: string; value: number; color: string }[] = [
    { key: 'likes', label: 'Likes', value: totals.likes, color: ACCENT },
    { key: 'comments', label: 'Comments', value: totals.comments, color: '#8134AF' },
    { key: 'saves', label: 'Saves', value: totals.saves, color: '#16a34a' },
    { key: 'shares', label: 'Shares', value: totals.shares, color: '#d97706' },
  ];
  const valueSignal = Math.round(((totals.saves + totals.shares) / total) * 100);

  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="text-[13px] font-semibold text-ink-900">Engagement composition</div>
        <span className="text-[11px] text-ink-400">how your audience interacts</span>
      </div>

      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden mb-3">
        {parts.map((p) => p.value > 0 && (
          <div key={p.key} title={`${p.label}: ${fmt(p.value)}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {parts.map((p) => (
          <div key={p.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: p.color }} />
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-ink-900 tabular-nums leading-tight">{fmt(p.value)}</div>
              <div className="text-[10.5px] text-ink-400">{p.label} · {Math.round((p.value / total) * 100)}%</div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-ink-500">
        <b style={{ color: '#16a34a' }}>{valueSignal}%</b> of interactions are saves &amp; shares — the strongest signal that people find your content genuinely valuable.
      </p>
    </div>
  );
}

function HashtagCard({ c }: { c: ContentAnalysis }) {
  const tags = c.hashtags;
  const maxEr = Math.max(...tags.map((t) => t.avg_er ?? 0), 0.0001);
  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="text-[13px] font-semibold text-ink-900">Top hashtags</div>
        <span className="text-[11px] text-ink-400">
          {c.avg_hashtags_per_post != null ? `~${c.avg_hashtags_per_post}/post` : ''} · {c.total_unique_hashtags} unique
        </span>
      </div>
      {tags.length === 0 ? (
        <p className="text-[12.5px] text-ink-400">No hashtag used enough times yet to compare.</p>
      ) : (
        <div className="space-y-2.5">
          {tags.map((t) => (
            <div key={t.tag}>
              <div className="flex justify-between text-[12px] mb-0.5">
                <span className="text-ink-700 font-medium truncate">{t.tag} <span className="text-ink-400 font-normal">· {t.count}×</span></span>
                <span className="text-ink-500 tabular-nums">{pct(t.avg_er)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#f0eefb] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${((t.avg_er ?? 0) / maxEr) * 100}%`, background: ACCENT }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[10.5px] text-ink-400">Ranked by average engagement on posts using each tag (used 2+ times).</p>
    </div>
  );
}

function SponsoredCard({ c }: { c: ContentAnalysis }) {
  const { sponsored, organic, sponsored_er_delta_pct: delta } = c;
  const hasSponsored = sponsored.count > 0;
  const maxEr = Math.max(sponsored.avg_er ?? 0, organic.avg_er ?? 0, 0.0001);

  const Row = ({ label, g, color }: { label: string; g: GroupStat; color: string }) => (
    <div>
      <div className="flex justify-between text-[12px] mb-0.5">
        <span className="text-ink-700 font-medium">{label} <span className="text-ink-400 font-normal">· {g.count}</span></span>
        <span className="text-ink-500 tabular-nums">
          {pct(g.avg_er)}{g.avg_reach ? ` · ${fmt(g.avg_reach)} reach` : ''}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#f0eefb] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${((g.avg_er ?? 0) / maxEr) * 100}%`, background: color }} />
      </div>
    </div>
  );

  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="text-[13px] font-semibold text-ink-900 mb-3">Sponsored vs organic</div>
      {!hasSponsored ? (
        <>
          <p className="text-[12.5px] text-ink-400 mb-3">No sponsored posts detected in your recent content — here’s your organic baseline.</p>
          <Row label="Organic" g={organic} color={ACCENT} />
        </>
      ) : (
        <>
          <div className="space-y-2.5">
            <Row label="Organic" g={organic} color={ACCENT} />
            <Row label="Sponsored" g={sponsored} color="#d97706" />
          </div>
          {delta != null && (
            <div className="mt-3 text-[12px] text-ink-600">
              {delta > 3 ? (
                <>Sponsored posts see <b className="text-[#d97706]">{delta}% lower</b> engagement than your organic content.</>
              ) : delta < -3 ? (
                <>Sponsored posts actually <b style={{ color: '#16a34a' }}>outperform</b> your organic content by {Math.abs(delta)}%.</>
              ) : (
                <>Sponsored and organic content perform about the same — brand deals aren’t costing you engagement.</>
              )}
            </div>
          )}
        </>
      )}
      <p className="mt-3 text-[10.5px] text-ink-400">Detected from caption markers (#ad, paid partnership, etc.).</p>
    </div>
  );
}

function CaptionCard({ c }: { c: CaptionAnalysis }) {
  const buckets = c.length_buckets.filter((b) => b.count > 0);
  const maxEr = Math.max(...buckets.map((b) => b.avg_er ?? 0), 0.0001);

  const Split = ({ label, s }: { label: string; s: CaptionSplit | null }) => {
    if (!s || s.lift_pct == null) return null;
    const up = s.lift_pct > 0;
    const flat = Math.abs(s.lift_pct) < 5;
    const color = flat ? '#6b7280' : up ? '#16a34a' : '#d97706';
    return (
      <div className="flex items-center justify-between gap-2 py-1.5">
        <span className="text-[12.5px] text-ink-700">{label}</span>
        <span className="text-[12.5px] font-semibold tabular-nums" style={{ color }}>
          {flat ? 'about the same' : `${up ? '+' : ''}${s.lift_pct}%`}
        </span>
      </div>
    );
  };

  const usage: { label: string; v: number | null }[] = [
    { label: 'Use emojis', v: c.emoji_usage_pct },
    { label: 'Ask a question', v: c.question_usage_pct },
    { label: 'Have a call-to-action', v: c.cta_usage_pct },
  ];

  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="text-[13px] font-semibold text-ink-900">Caption & hook analysis</div>
        <span className="text-[11px] text-ink-400">
          {c.avg_caption_chars != null ? `~${c.avg_caption_chars} chars/caption` : ''} · {c.sample_size} posts
        </span>
      </div>

      {c.headline && (
        <div className="mb-3 rounded-lg px-3 py-2 text-[12.5px] text-ink-800" style={{ background: ACCENT_SOFT }}>
          {c.headline}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Length → ER */}
        <div>
          <div className="text-[11.5px] font-semibold text-ink-500 uppercase tracking-wide mb-2">Engagement by length</div>
          {buckets.length === 0 ? (
            <p className="text-[12px] text-ink-400">Not enough captions to compare.</p>
          ) : (
            <div className="space-y-2.5">
              {buckets.map((b) => (
                <div key={b.key}>
                  <div className="flex justify-between text-[12px] mb-0.5">
                    <span className="text-ink-700 font-medium">
                      {b.key === 'short' ? 'Short' : b.key === 'medium' ? 'Medium' : 'Long'}
                      <span className="text-ink-400 font-normal"> · {b.count}</span>
                      {c.best_length === b.key && <span className="ml-1 text-[10px] font-semibold" style={{ color: ACCENT }}>BEST</span>}
                    </span>
                    <span className="text-ink-500 tabular-nums">{pct(b.avg_er)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#f0eefb] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${((b.avg_er ?? 0) / maxEr) * 100}%`, background: c.best_length === b.key ? ACCENT : '#c9c2f0' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Habits + lift */}
        <div>
          <div className="text-[11.5px] font-semibold text-ink-500 uppercase tracking-wide mb-2">Your habits</div>
          <div className="space-y-1 mb-2">
            {usage.map((u) => (
              <div key={u.label} className="flex items-center justify-between text-[12.5px]">
                <span className="text-ink-600">{u.label}</span>
                <span className="text-ink-800 font-medium tabular-nums">{u.v != null ? `${u.v}%` : '—'}</span>
              </div>
            ))}
          </div>
          {(c.cta_split?.lift_pct != null || c.emoji_split?.lift_pct != null) && (
            <div className="pt-2 border-t border-[#f0eefb]">
              <div className="text-[11px] text-ink-400 mb-0.5">Engagement lift when you…</div>
              <Split label="Add a question / CTA" s={c.cta_split} />
              <Split label="Add emojis" s={c.emoji_split} />
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-[10.5px] text-ink-400">Correlations from your recent captions — directional, not causal. Test and see what sticks.</p>
    </div>
  );
}

function AudienceQualityCard({ q }: { q: AudienceQuality }) {
  const score = q.score ?? 0;
  const scoreColor = score >= 70 ? '#16a34a' : score >= 55 ? '#d97706' : '#dc2626';
  const statusColor: Record<string, string> = { healthy: '#16a34a', watch: '#d97706', concern: '#dc2626' };

  // Score ring geometry.
  const R = 34, C = 2 * Math.PI * R;
  const off = C * (1 - score / 100);

  return (
    <div className="rounded-xl bg-white border border-border shadow-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="text-[13px] font-semibold text-ink-900">Audience quality</div>
        <span className="text-[11px] text-ink-400">estimated from engagement patterns · {q.sample} posts</span>
      </div>

      <div className="flex items-center gap-5 flex-col sm:flex-row">
        {/* Score ring */}
        <div className="relative shrink-0" style={{ width: 88, height: 88 }}>
          <svg width="88" height="88" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r={R} fill="none" stroke="#f0eefb" strokeWidth="8" />
            <circle cx="44" cy="44" r={R} fill="none" stroke={scoreColor} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 44 44)" />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-[22px] font-bold tabular-nums leading-none" style={{ color: scoreColor }}>{score}</div>
              <div className="text-[9px] uppercase tracking-wide text-ink-400 mt-0.5">/ 100</div>
            </div>
          </div>
        </div>

        {/* Signals */}
        <div className="flex-1 w-full space-y-2.5">
          {q.signals.map((s) => (
            <div key={s.key}>
              <div className="flex items-center justify-between text-[12px] mb-0.5">
                <span className="inline-flex items-center gap-1.5 text-ink-700 font-medium">
                  <span className="h-2 w-2 rounded-full" style={{ background: statusColor[s.status] }} />
                  {s.label}
                </span>
                <span className="text-ink-400 tabular-nums">{s.score}</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#f0eefb] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${s.score}%`, background: statusColor[s.status] }} />
              </div>
              <div className="mt-0.5 text-[10.5px] text-ink-400">{s.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[12px] text-ink-500">
          Overall: <span className="font-semibold" style={{ color: scoreColor }}>{q.grade}</span>
        </span>
        <span className="text-[10px] text-ink-300">Signal-based estimate, not a verification.</span>
      </div>
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
