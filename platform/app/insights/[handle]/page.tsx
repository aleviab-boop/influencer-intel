'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface ScrapedData {
  source: 'scraped';
  creator_id: string;
  handle: string;
  display_name: string | null;
  follower_count: number;
  following_count: number | null;
  posts_count: number | null;
  engagement_rate: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  avg_views: number | null;
  primary_category: string | null;
  profile_photo_url: string | null;
  audience_demographics: {
    source: string;
    gender: { male_pct: number | null; female_pct: number | null };
    age_bands: Record<string, number | null>;
    top_cities: Array<{ city: string; pct: number }>;
    top_languages: Array<{ lang: string; pct: number }>;
    country_india_pct: number | null;
  } | null;
  credibility: {
    overall_score: number;
    badge: string;
    signals: Record<string, number | null>;
    flags: string[];
  } | null;
  time_series: Array<{
    post_id: string;
    post_url: string;
    post_type: string | null;
    caption: string | null;
    posted_at: string | null;
    like_count: number | null;
    comment_count: number | null;
    view_count: number | null;
    engagement_rate: number | null;
    thumbnail_url: string | null;
  }>;
  posting_frequency: { avg_days_between_posts: number | null; posts_per_week: number | null };
  engagement_trend: 'rising' | 'stable' | 'declining' | 'insufficient_data';
  confidence: string;
  brand_work: {
    brand_mentions: string[];
    has_paid_partnership: boolean;
    has_collab_tag: boolean;
    content_themes: string[];
    sponsored_posts: Array<{
      post_id: string;
      post_url: string;
      caption: string | null;
      posted_at: string | null;
      like_count: number | null;
      comment_count: number | null;
      view_count: number | null;
      detected_brands: string[];
      is_sponsored: boolean;
    }>;
  };
}

interface ConnectedData {
  source: 'connected';
  creator_id: string;
  connected_account_id: string;
  rolling_er_30d: number | null;
  rolling_er_90d: number | null;
  breakout_rate: number | null;
  consistency_score: number | null;
  posts_per_week: number | null;
  audience_demographics: {
    gender: { male_pct: number; female_pct: number };
    top_age_band: string;
    top_cities: Array<{ city: string; pct: number }>;
  } | null;
  top_posts: Array<{ ig_shortcode: string; er: number; bucket: string }>;
  worst_posts: Array<{ ig_shortcode: string; er: number; bucket: string }>;
  best_posting_hours: number[];
  best_posting_days: number[];
  confidence: string;
}

type InsightsData = ScrapedData | ConnectedData;

interface PredictionData {
  bucket: string;
  bucket_probability: number;
  predicted_er_range: [number, number];
  predicted_er_median: number;
  confidence: string;
  creator_baseline_er: number;
  content_multiplier: number;
  temporal_multiplier: number;
  trend_multiplier: number;
  competition_multiplier: number;
  optimal_post_window: { start: string; end: string } | null;
  trend_alignment_score: number;
  improvement_suggestions: string[];
}

interface CreatorBasic {
  id: string;
  handle: string;
  display_name: string | null;
  profile_photo_url: string | null;
  follower_count: number | null;
  engagement_rate: number | null;
  primary_category: string | null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TREND_MAP: Record<string, string> = {
  rising: 'Rising',
  stable: 'Stable',
  declining: 'Declining',
  insufficient_data: 'Insufficient data',
};

interface AuthScore {
  score: number;
  band: 'high' | 'mixed' | 'low';
  basis: 'verified' | 'per_post' | 'aggregate' | 'credibility' | 'insufficient';
  posts_analyzed: number;
  signals: { label: string; ok: boolean; detail: string }[];
}
const BAND_COLOR: Record<string, string> = { high: '#0a7d3c', mixed: '#b8860b', low: '#cc0000' };
const BASIS_NOTE: Record<string, string> = { verified: 'reach-verified', per_post: 'recent posts', aggregate: 'profile averages', credibility: 'credibility signals', insufficient: 'limited data' };

export default function InsightsPage({ params }: { params: Promise<{ handle: string }> }) {
  const [handle, setHandle] = useState('');
  const [creator, setCreator] = useState<CreatorBasic | null>(null);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [auth, setAuth] = useState<AuthScore | null>(null);
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'content' | 'brand_work' | 'predict' | 'monitor'>('overview');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => { setHandle(p.handle); loadData(p.handle); });
  }, [params]);

  async function loadData(h: string) {
    setLoading(true);
    setError(null);
    try {
      const cr = await fetch(`/api/creators/${h}`);
      if (!cr.ok) { setError('Creator not found'); setLoading(false); return; }
      const cd = await cr.json();
      setCreator(cd);
      fetch(`/api/tools/authenticity?handle=${encodeURIComponent(h)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && !d.error) setAuth(d); })
        .catch(() => {});
      const ir = await fetch(`/api/insights/${cd.id}`);
      if (ir.ok) setInsights(await ir.json());
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  async function runPrediction() {
    if (!creator) return;
    try {
      const res = await fetch('/api/predict/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: creator.id }),
      });
      if (res.ok) setPrediction(await res.json());
    } catch (err) {
      console.error(err);
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><span className="text-[#ccc] text-sm">Loading...</span></div>;
  if (error) return <div className="flex items-center justify-center min-h-screen"><span className="text-[#cc0000] text-sm">{error}</span></div>;

  const isScraped = insights?.source === 'scraped';
  const isConnected = insights?.source === 'connected';

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-[#e5e5e5] px-6 py-5">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link href="/creators" className="text-[13px] text-[#999] hover:text-[#111]">&larr; Back</Link>
          <div className="flex items-center gap-3 flex-1">
            {creator?.profile_photo_url && (
              <img src={creator.profile_photo_url} alt="" className="w-9 h-9 rounded-full grayscale" />
            )}
            <div>
              <h1 className="text-lg font-medium text-[#111]">@{handle}</h1>
              <p className="text-[12px] text-[#999]">
                {creator?.follower_count?.toLocaleString()} followers
                {creator?.primary_category && ` · ${creator.primary_category}`}
              </p>
            </div>
          </div>
          {insights && (
            <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 ${
              isScraped ? 'text-[#b8965a] border border-[#b8965a]/30' : 'text-[#111] border border-[#111]'
            }`}>
              {isScraped ? 'Scraped' : 'Connected'}
            </span>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-[#e5e5e5]">
        <div className="max-w-4xl mx-auto px-6 flex gap-0">
          {(['overview', 'content', 'brand_work', 'predict', 'monitor'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-3 text-[13px] border-b-2 transition-colors ${
                tab === t ? 'border-[#111] text-[#111] font-medium' : 'border-transparent text-[#999] hover:text-[#111]'
              }`}>
              {t === 'overview' ? 'Overview' : t === 'content' ? 'Content' : t === 'brand_work' ? 'Brand Work' : t === 'predict' ? 'Predict' : 'Monitor'}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {tab === 'overview' && isScraped && <ScrapedOverview data={insights as ScrapedData} />}
        {tab === 'overview' && isConnected && <ConnectedOverview data={insights as ConnectedData} />}
        {tab === 'overview' && auth && <AuthenticityCard auth={auth} />}
        {tab === 'overview' && !insights && <NoData handle={handle} />}
        {tab === 'content' && isScraped && <ContentTab data={insights as ScrapedData} />}
        {tab === 'content' && !isScraped && <p className="text-[#999] text-sm py-12 text-center">Connect Instagram to unlock content library</p>}
        {tab === 'brand_work' && isScraped && <BrandWorkTab data={insights as ScrapedData} />}
        {tab === 'brand_work' && !isScraped && <p className="text-[#999] text-sm py-12 text-center">Connect Instagram to unlock brand work data</p>}
        {tab === 'predict' && <PredictTab prediction={prediction} onPredict={runPrediction} creator={creator} />}
        {tab === 'monitor' && <MonitorTab creator={creator} />}
      </main>
    </div>
  );
}

function ScrapedOverview({ data }: { data: ScrapedData }) {
  return (
    <div className="space-y-8">
      {/* Upsell */}
      <div className="border border-[#e5e5e5] p-5 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-medium text-[#111] mb-0.5">Connect for deeper insights</div>
          <p className="text-[12px] text-[#999]">
            Reach, saves, impressions, audience demographics, real-time monitoring.
          </p>
        </div>
        <a href={`/api/oauth/instagram?brand_id=${encodeURIComponent(data?.creator_id ?? '')}`} className="px-4 py-2 bg-[#111] text-white text-[13px] hover:bg-[#333] shrink-0 ml-4">
          Request Connection
        </a>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-[#e5e5e5] border border-[#e5e5e5]">
        <Metric label="Engagement Rate" value={data.engagement_rate != null ? `${(data.engagement_rate * 100).toFixed(2)}%` : '---'} />
        <Metric label="Avg Likes" value={data.avg_likes != null ? formatK(data.avg_likes) : '---'} />
        <Metric label="Avg Comments" value={data.avg_comments != null ? formatK(data.avg_comments) : '---'} />
        <Metric label="Avg Views" value={data.avg_views != null ? formatK(data.avg_views) : '---'} />
        <Metric label="Trend" value={TREND_MAP[data.engagement_trend] ?? '---'} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#e5e5e5] border border-[#e5e5e5]">
        <Metric label="Total Posts" value={data.posts_count?.toLocaleString() ?? '---'} />
        <Metric label="Posts / Week" value={data.posting_frequency.posts_per_week?.toFixed(1) ?? '---'} />
        <Metric label="Avg Days Between" value={data.posting_frequency.avg_days_between_posts?.toFixed(1) ?? '---'} />
        <Metric label="Following" value={data.following_count?.toLocaleString() ?? '---'} />
      </div>

      {/* Chart */}
      {data.time_series.length > 1 && <EngagementChart posts={data.time_series} followerCount={data.follower_count} />}

      {/* Credibility */}
      {data.credibility && (
        <div className="border border-[#e5e5e5] p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999]">Credibility</div>
            <span className="text-[14px] font-medium text-[#111] tabular-nums">
              {data.credibility.overall_score >= 1 ? data.credibility.overall_score.toFixed(0) : (data.credibility.overall_score * 100).toFixed(0)}
            </span>
          </div>
          {data.credibility.flags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.credibility.flags.map((f) => (
                <span key={f} className="text-[11px] text-[#cc0000] border border-[#cc0000]/20 px-2 py-0.5">{f}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Demographics */}
      {data.audience_demographics && (
        <div className="border border-[#e5e5e5] p-6">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-1">Audience Demographics</div>
          <p className="text-[11px] text-[#ccc] mb-4">{data.audience_demographics.source} (inferred)</p>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="text-[12px] text-[#999] mb-2">Gender</div>
              <div className="space-y-2">
                <Bar label="Male" pct={data.audience_demographics.gender.male_pct ?? 0} />
                <Bar label="Female" pct={data.audience_demographics.gender.female_pct ?? 0} />
              </div>
            </div>
            <div>
              <div className="text-[12px] text-[#999] mb-2">Top Cities</div>
              <div className="space-y-1">
                {data.audience_demographics.top_cities.slice(0, 5).map((c) => (
                  <div key={c.city} className="flex justify-between text-[13px]">
                    <span className="text-[#6b6b6b]">{c.city}</span>
                    <span className="text-[#999] tabular-nums">{c.pct}%</span>
                  </div>
                ))}
                {data.audience_demographics.top_cities.length === 0 && <span className="text-[12px] text-[#ccc]">Not available</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Locked */}
      <div className="grid grid-cols-3 gap-px bg-[#e5e5e5] border border-[#e5e5e5]">
        {['Reach & Impressions', 'Saves & Shares', 'Real-time Monitoring'].map((label) => (
          <div key={label} className="bg-white p-4 text-center">
            <div className="text-[13px] text-[#ccc] mb-1">{label}</div>
            <div className="text-[11px] text-[#e5e5e5]">Connect to unlock</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EngagementChart({ posts, followerCount }: { posts: ScrapedData['time_series']; followerCount: number }) {
  const valid = posts.filter((p) => p.posted_at && (p.like_count != null || p.view_count != null));
  if (valid.length < 2) return null;

  const W = 700, H = 200, PAD = { top: 16, right: 16, bottom: 32, left: 52 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const pts = valid.map((p) => {
    const interactions = (p.like_count ?? 0) + (p.comment_count ?? 0);
    const er = followerCount > 0 ? (interactions / followerCount) * 100 : 0;
    return { date: new Date(p.posted_at!), er, type: p.post_type };
  }).sort((a, b) => a.date.getTime() - b.date.getTime());

  const minD = pts[0]!.date.getTime();
  const maxD = pts[pts.length - 1]!.date.getTime();
  const range = maxD - minD || 1;
  const maxER = Math.max(...pts.map((p) => p.er)) * 1.15;

  const x = (d: Date) => PAD.left + ((d.getTime() - minD) / range) * plotW;
  const y = (er: number) => PAD.top + plotH - (er / maxER) * plotH;

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.er).toFixed(1)}`).join(' ');
  const area = line + ` L${x(pts[pts.length - 1]!.date).toFixed(1)},${PAD.top + plotH} L${x(pts[0]!.date).toFixed(1)},${PAD.top + plotH} Z`;
  const avgER = pts.reduce((s, p) => s + p.er, 0) / pts.length;

  return (
    <div className="border border-[#e5e5e5] p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999]">Engagement over time</div>
        <span className="text-[11px] text-[#ccc] tabular-nums">{pts.length} posts &middot; avg {avgER.toFixed(2)}%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 240 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const yPos = PAD.top + plotH * (1 - pct);
          return (
            <g key={pct}>
              <line x1={PAD.left} y1={yPos} x2={W - PAD.right} y2={yPos} stroke="#f0f0f0" strokeWidth={0.5} />
              <text x={PAD.left - 6} y={yPos + 3} textAnchor="end" fill="#ccc" fontSize={9}>{(maxER * pct).toFixed(2)}%</text>
            </g>
          );
        })}
        <line x1={PAD.left} y1={y(avgER)} x2={W - PAD.right} y2={y(avgER)} stroke="#ccc" strokeWidth={0.5} strokeDasharray="4 3" />
        <path d={area} fill="url(#erFill)" />
        <path d={line} fill="none" stroke="#111" strokeWidth={1.5} />
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.date)} cy={y(p.er)} r={3} fill="#111" stroke="white" strokeWidth={1.5} />
        ))}
        {pts.filter((_, i) => i === 0 || i === pts.length - 1 || i === Math.floor(pts.length / 2)).map((p) => (
          <text key={p.date.toISOString()} x={x(p.date)} y={H - 6} textAnchor="middle" fill="#ccc" fontSize={9}>
            {p.date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
          </text>
        ))}
        <defs>
          <linearGradient id="erFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#111" stopOpacity={0.06} />
            <stop offset="100%" stopColor="#111" stopOpacity={0.01} />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

function ContentTab({ data }: { data: ScrapedData }) {
  if (data.time_series.length === 0) return <p className="text-[#999] text-sm py-12 text-center">No posts available</p>;

  const sorted = [...data.time_series].sort((a, b) => {
    const ta = a.posted_at ? new Date(a.posted_at).getTime() : 0;
    const tb = b.posted_at ? new Date(b.posted_at).getTime() : 0;
    return tb - ta;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999]">Recent posts</div>
        <span className="text-[11px] text-[#ccc]">{sorted.length} posts</span>
      </div>
      <div className="border border-[#e5e5e5] divide-y divide-[#f0f0f0]">
        {sorted.map((post) => (
          <div key={post.post_id} className="p-4 hover:bg-[#fafafa] transition-colors">
            <div className="flex justify-between items-start mb-2">
              <span className="text-[12px] text-[#999]">
                {post.posted_at ? new Date(post.posted_at).toLocaleDateString() : 'Unknown'}
              </span>
              <div className="flex items-center gap-2">
                {post.post_type && (
                  <span className="text-[11px] uppercase tracking-[0.06em] text-[#999]">{post.post_type}</span>
                )}
                {post.engagement_rate != null && (
                  <span className="text-[12px] font-medium text-[#111] tabular-nums">
                    {(post.engagement_rate * 100).toFixed(3)}%
                  </span>
                )}
              </div>
            </div>
            {post.caption && <p className="text-[13px] text-[#6b6b6b] line-clamp-1 mb-2">{post.caption}</p>}
            <div className="flex items-center gap-4 text-[12px] text-[#999] tabular-nums">
              {post.like_count != null && <span>{post.like_count.toLocaleString()} likes</span>}
              {post.comment_count != null && <span>{post.comment_count.toLocaleString()} comments</span>}
              {post.view_count != null && <span>{post.view_count.toLocaleString()} views</span>}
              <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="ml-auto text-[#999] hover:text-[#111]">
                View &rarr;
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandWorkTab({ data }: { data: ScrapedData }) {
  const bw = data.brand_work;
  const hasSignals = bw.brand_mentions.length > 0 || bw.has_paid_partnership || bw.has_collab_tag || bw.content_themes.length > 0 || bw.sponsored_posts.length > 0;

  if (!hasSignals) {
    return <p className="text-[#999] text-sm py-12 text-center">No brand collaboration signals detected</p>;
  }

  return (
    <div className="space-y-8">
      {/* Signals card */}
      <div className="border border-[#e5e5e5] p-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-4">Brand collaboration signals</div>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-[#f0f0f0]">
            <span className="text-[13px] text-[#6b6b6b] uppercase tracking-[0.06em]">Paid Partnership</span>
            <span className={`text-[13px] font-medium ${bw.has_paid_partnership ? 'text-[#111]' : 'text-[#ccc]'}`}>
              {bw.has_paid_partnership ? 'Active' : 'Not detected'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-[#f0f0f0]">
            <span className="text-[13px] text-[#6b6b6b] uppercase tracking-[0.06em]">Collab Tag</span>
            <span className={`text-[13px] font-medium ${bw.has_collab_tag ? 'text-[#111]' : 'text-[#ccc]'}`}>
              {bw.has_collab_tag ? 'Active' : 'Not detected'}
            </span>
          </div>
          {bw.brand_mentions.length > 0 && (
            <div className="flex items-start justify-between py-2 border-b border-[#f0f0f0]">
              <span className="text-[13px] text-[#6b6b6b] uppercase tracking-[0.06em]">Brands Mentioned</span>
              <span className="text-[13px] text-[#111] text-right max-w-[60%]">{bw.brand_mentions.join(', ')}</span>
            </div>
          )}
          {bw.content_themes.length > 0 && (
            <div className="flex items-start justify-between py-2">
              <span className="text-[13px] text-[#6b6b6b] uppercase tracking-[0.06em]">Content Themes</span>
              <span className="text-[13px] text-[#111] text-right max-w-[60%]">{bw.content_themes.join(', ')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Sponsored posts */}
      {bw.sponsored_posts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999]">Sponsored content</div>
            <span className="text-[11px] text-[#ccc]">{bw.sponsored_posts.length} posts</span>
          </div>
          <div className="border border-[#e5e5e5] divide-y divide-[#f0f0f0]">
            {bw.sponsored_posts.map((post) => (
              <div key={post.post_id} className="p-4 hover:bg-[#fafafa] transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[12px] text-[#999]">
                    {post.posted_at ? new Date(post.posted_at).toLocaleDateString() : 'Unknown'}
                  </span>
                </div>
                {post.caption && <p className="text-[13px] text-[#6b6b6b] line-clamp-2 mb-2">{post.caption}</p>}
                <div className="flex items-center gap-4 text-[12px] text-[#999] tabular-nums mb-2">
                  {post.like_count != null && <span>{post.like_count.toLocaleString()} likes</span>}
                  {post.comment_count != null && <span>{post.comment_count.toLocaleString()} comments</span>}
                  {post.view_count != null && <span>{post.view_count.toLocaleString()} views</span>}
                </div>
                <div className="flex items-center justify-between">
                  {post.detected_brands.length > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-[#999] uppercase tracking-[0.06em]">Brands:</span>
                      <span className="text-[12px] text-[#111]">{post.detected_brands.join(', ')}</span>
                    </div>
                  )}
                  {post.detected_brands.length === 0 && <div />}
                  <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[#999] hover:text-[#111]">
                    View &rarr;
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectedOverview({ data }: { data: ConnectedData }) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#e5e5e5] border border-[#e5e5e5]">
        <Metric label="30d ER" value={data.rolling_er_30d != null ? `${(data.rolling_er_30d * 100).toFixed(2)}%` : '---'} />
        <Metric label="Breakout Rate" value={data.breakout_rate != null ? `${(data.breakout_rate * 100).toFixed(1)}%` : '---'} />
        <Metric label="Consistency" value={data.consistency_score != null ? `${(data.consistency_score * 100).toFixed(0)}%` : '---'} />
        <Metric label="Posts / Week" value={data.posts_per_week?.toFixed(1) ?? '---'} />
      </div>

      <div className="border border-[#e5e5e5] p-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-4">Optimal posting</div>
        <div className="grid grid-cols-2 gap-8">
          <div>
            <div className="text-[12px] text-[#999] mb-2">Hours (UTC)</div>
            <div className="flex gap-2">
              {data.best_posting_hours.map((h) => (
                <span key={h} className="px-3 py-1 border border-[#e5e5e5] text-[13px] text-[#111] tabular-nums">{h}:00</span>
              ))}
              {data.best_posting_hours.length === 0 && <span className="text-[12px] text-[#ccc]">Insufficient data</span>}
            </div>
          </div>
          <div>
            <div className="text-[12px] text-[#999] mb-2">Days</div>
            <div className="flex gap-2">
              {data.best_posting_days.map((d) => (
                <span key={d} className="px-3 py-1 border border-[#e5e5e5] text-[13px] text-[#111]">{DAY_NAMES[d]}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {data.audience_demographics && (
        <div className="border border-[#e5e5e5] p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999]">Audience</div>
            <span className="text-[11px] text-[#111] border border-[#111] px-1.5 py-0.5">Verified</span>
          </div>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="text-[12px] text-[#999] mb-2">Gender</div>
              <div className="space-y-2">
                <Bar label="Male" pct={data.audience_demographics.gender.male_pct} />
                <Bar label="Female" pct={data.audience_demographics.gender.female_pct} />
              </div>
            </div>
            <div>
              <div className="text-[12px] text-[#999] mb-2">Top Cities</div>
              <div className="space-y-1">
                {data.audience_demographics.top_cities.slice(0, 5).map((c) => (
                  <div key={c.city} className="flex justify-between text-[13px]">
                    <span className="text-[#6b6b6b]">{c.city}</span>
                    <span className="text-[#999] tabular-nums">{c.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="border border-[#e5e5e5] p-5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-3">Top performing</div>
          {data.top_posts.map((p, i) => (
            <div key={p.ig_shortcode} className="flex items-center justify-between py-1.5 border-b border-[#f0f0f0] last:border-0">
              <span className="text-[13px] text-[#6b6b6b]">#{i + 1}</span>
              <span className="text-[13px] text-[#111] tabular-nums">{(p.er * 100).toFixed(2)}%</span>
            </div>
          ))}
        </div>
        <div className="border border-[#e5e5e5] p-5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-3">Lowest performing</div>
          {data.worst_posts.map((p, i) => (
            <div key={p.ig_shortcode} className="flex items-center justify-between py-1.5 border-b border-[#f0f0f0] last:border-0">
              <span className="text-[13px] text-[#6b6b6b]">#{i + 1}</span>
              <span className="text-[13px] text-[#999] tabular-nums">{(p.er * 100).toFixed(2)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PredictTab({ prediction, onPredict, creator }: { prediction: PredictionData | null; onPredict: () => void; creator: CreatorBasic | null }) {
  return (
    <div className="space-y-6">
      <div className="border border-[#e5e5e5] p-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-3">Content prediction</div>
        <p className="text-[13px] text-[#6b6b6b] mb-4">
          Predict performance for @{creator?.handle ?? '...'} based on history, timing, and trends.
        </p>
        <button onClick={onPredict} className="px-5 py-2 bg-[#111] text-white text-[13px] hover:bg-[#333]">
          Run Prediction
        </button>
      </div>

      {prediction && (
        <div className="border border-[#e5e5e5] p-6 space-y-6">
          <div className="flex items-baseline gap-4">
            <span className="text-xl font-medium text-[#111] capitalize">{prediction.bucket.replace('_', ' ')}</span>
            <span className="text-[13px] text-[#999]">{(prediction.bucket_probability * 100).toFixed(0)}%</span>
            <span className="text-[13px] text-[#ccc]">{prediction.confidence}</span>
          </div>
          <div className="grid grid-cols-3 gap-4 py-4 border-y border-[#f0f0f0]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc]">Predicted ER</div>
              <div className="text-lg font-medium tabular-nums">{(prediction.predicted_er_median * 100).toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc]">Trend alignment</div>
              <div className="text-lg font-medium tabular-nums">{(prediction.trend_alignment_score * 100).toFixed(0)}%</div>
            </div>
            {prediction.optimal_post_window && (
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc]">Best window</div>
                <div className="text-[14px] font-medium">
                  {new Date(prediction.optimal_post_window.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {' – '}
                  {new Date(prediction.optimal_post_window.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )}
          </div>
          {prediction.improvement_suggestions.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-2">Suggestions</div>
              {prediction.improvement_suggestions.map((s, i) => (
                <p key={i} className="text-[13px] text-[#6b6b6b] mb-1">&ndash; {s}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MonitorTab({ creator }: { creator: CreatorBasic | null }) {
  const [postUrl, setPostUrl] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!creator || !postUrl) return;
    setBusy(true);
    try {
      const res = await fetch('/api/predict/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: creator.id, post_url: postUrl }),
      });
      if (res.ok) setResult(await res.json());
    } catch (err) {
      console.error(err);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <div className="border border-[#e5e5e5] p-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-3">Real-time monitoring</div>
        <div className="flex gap-2">
          <input type="text" placeholder="Instagram post URL" value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            className="flex-1 px-3 py-2 border border-[#e5e5e5] text-[14px] placeholder:text-[#ccc] focus:outline-none focus:border-[#111]" />
          <button onClick={start} disabled={busy || !postUrl}
            className="px-4 py-2 bg-[#111] text-white text-[13px] hover:bg-[#333] disabled:opacity-40">
            {busy ? '...' : 'Start'}
          </button>
        </div>
      </div>

      {result && (
        <div className="border border-[#e5e5e5] p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#111] animate-pulse" />
            <span className="text-[13px] font-medium">Active</span>
          </div>
          <pre className="bg-[#fafafa] p-4 text-[12px] text-[#6b6b6b] overflow-auto border border-[#f0f0f0]">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      <div className="border border-[#e5e5e5] p-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-4">Checkpoints</div>
        <div className="space-y-3">
          {[
            { time: '30 min', desc: 'Initial velocity from follower seed', acc: '40%' },
            { time: '2 hours', desc: 'Non-follower algorithmic expansion', acc: '65%' },
            { time: '6 hours', desc: 'Explore feed distribution', acc: '80%' },
            { time: '24 hours', desc: 'Day-1 predicts Day-30 at 96% correlation', acc: '95%' },
          ].map((cp) => (
            <div key={cp.time} className="flex items-baseline gap-4">
              <span className="text-[13px] font-medium text-[#111] w-16 tabular-nums">{cp.time}</span>
              <span className="text-[13px] text-[#6b6b6b] flex-1">{cp.desc}</span>
              <span className="text-[12px] text-[#ccc] tabular-nums">{cp.acc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NoData({ handle }: { handle: string }) {
  return (
    <div className="text-center py-16">
      <h2 className="text-xl font-light text-[#111] mb-2">No data available</h2>
      <p className="text-[13px] text-[#999] mb-6">
        Connect @{handle}&apos;s Instagram or wait for the next scrape.
      </p>
      <a href="/api/oauth/instagram" className="px-5 py-2 bg-[#111] text-white text-[13px] hover:bg-[#333] inline-block">
        Connect Instagram
      </a>
    </div>
  );
}

function AuthenticityCard({ auth }: { auth: AuthScore }) {
  return (
    <div className="border border-[#e5e5e5] p-6 mt-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999]">Authenticity</div>
        <span className="text-[14px] font-medium tabular-nums" style={{ color: BAND_COLOR[auth.band] }}>{auth.score}/100</span>
        <span className="text-[11px] text-[#ccc]">{BASIS_NOTE[auth.basis]}{(auth.basis === 'per_post' || auth.basis === 'verified') ? ` · ${auth.posts_analyzed} posts` : ''}</span>
      </div>
      <div className="space-y-1.5">
        {auth.signals.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-[12px]">
            <span style={{ color: s.ok ? '#0a7d3c' : '#cc0000' }}>{s.ok ? '✓' : '!'}</span>
            <span className="text-[#6b6b6b]">{s.label}</span>
            <span className="ml-auto text-[#999] tabular-nums">{s.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4">
      <div className="text-[11px] uppercase tracking-[0.08em] text-[#999] mb-1">{label}</div>
      <div className="text-xl font-light text-[#111] tabular-nums">{value}</div>
    </div>
  );
}

function Bar({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-[12px] mb-1">
        <span className="text-[#6b6b6b]">{label}</span>
        <span className="text-[#999] tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 bg-[#f0f0f0]">
        <div className="h-1 bg-[#111]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
