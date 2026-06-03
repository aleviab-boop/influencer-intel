'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';

interface PredictionResult {
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

interface PostAnalysis {
  found: boolean;
  shortcode: string;
  source?: string;
  post?: {
    code: string;
    permalink: string;
    posted_at: string | null;
    media_type: string | null;
    caption: string | null;
    location: string | null;
    metrics: {
      likes: number;
      comments: number;
      views: number | null;
      saves: number | null;
      shares: number | null;
      reach: number | null;
    };
    engagement_rate: number;
    performance_bucket: string;
  };
  creator?: {
    handle: string;
    display_name: string | null;
    follower_count: number;
    baseline_er: number | null;
    avg_likes: number | null;
    avg_comments: number | null;
    avg_views: number | null;
  };
  comparison?: {
    er_vs_baseline: number | null;
    likes_vs_avg: number | null;
    comments_vs_avg: number | null;
    views_vs_avg: number | null;
  };
  all_posts?: Array<{
    code: string;
    permalink: string;
    posted_at: string | null;
    likes: number;
    comments: number;
    views: number | null;
    engagement_rate: number;
    performance_bucket: string;
  }>;
  message?: string;
  note?: string;
}

interface CreatorMatch {
  id: string;
  handle: string;
  display_name: string | null;
  profile_photo_url: string | null;
  follower_count: number | null;
  engagement_rate: number | null;
}

export default function PredictPageWrapper() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-white"><AppHeader /><div className="text-[#ccc] text-sm py-20 text-center">Loading...</div></main>}>
      <PredictPage />
    </Suspense>
  );
}

function PredictPage() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'predict' | 'monitor'>('predict');
  const [handle, setHandle] = useState('');
  const [creator, setCreator] = useState<CreatorMatch | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [postUrl, setPostUrl] = useState('');
  const [analysis, setAnalysis] = useState<PostAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    const qHandle = searchParams.get('handle');
    const qMode = searchParams.get('mode');
    if (qMode === 'monitor') setMode('monitor');
    if (qHandle) {
      setHandle(qHandle);
      setLookupBusy(true);
      setLookupError(null);
      fetch(`/api/creators/${encodeURIComponent(qHandle)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setCreator(d); else setLookupError('Creator not found'); })
        .catch(() => setLookupError('Lookup failed'))
        .finally(() => setLookupBusy(false));
    }
  }, [searchParams]);

  async function lookupCreator(e: React.FormEvent) {
    e.preventDefault();
    const h = handle.trim().replace('@', '');
    if (!h) return;
    setLookupBusy(true);
    setLookupError(null);
    setCreator(null);
    setPrediction(null);
    setAnalysis(null);
    try {
      const res = await fetch(`/api/creators/${encodeURIComponent(h)}`);
      if (!res.ok) { setLookupError('Creator not found'); return; }
      setCreator(await res.json());
    } catch {
      setLookupError('Lookup failed');
    } finally {
      setLookupBusy(false);
    }
  }

  async function runPrediction() {
    if (!creator) return;
    setPredicting(true);
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
    setPredicting(false);
  }

  async function analyzePost() {
    if (!creator || !postUrl.trim()) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/predict/post-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: creator.handle, post_url: postUrl.trim() }),
      });
      if (res.ok) setAnalysis(await res.json());
    } catch (err) {
      console.error(err);
    }
    setAnalyzing(false);
  }

  return (
    <main className="min-h-screen bg-white">
      <AppHeader />

      <div className="max-w-2xl mx-auto px-6 pt-10 pb-20">
        <h1 className="text-2xl font-light text-[#111] mb-1">Predict</h1>
        <p className="text-[13px] text-[#999] mb-8">
          Score content or track live posts.
        </p>

        <div className="flex gap-0 mb-8 border border-[#e5e5e5] w-fit">
          <button
            onClick={() => setMode('predict')}
            className={`px-4 py-2 text-[13px] transition-colors ${
              mode === 'predict' ? 'bg-[#111] text-white' : 'text-[#999] hover:text-[#111]'
            }`}
          >
            Performance
          </button>
          <button
            onClick={() => setMode('monitor')}
            className={`px-4 py-2 text-[13px] border-l border-[#e5e5e5] transition-colors ${
              mode === 'monitor' ? 'bg-[#111] text-white' : 'text-[#999] hover:text-[#111]'
            }`}
          >
            Monitor
          </button>
        </div>

        {/* Step 1 */}
        <div className="border border-[#e5e5e5] p-6 mb-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-3">Step 1 &mdash; Creator</div>
          <form onSubmit={lookupCreator} className="flex gap-2">
            <input
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="Instagram handle"
              className="flex-1 px-3 py-2 border border-[#e5e5e5] text-[14px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#111]"
            />
            <button
              type="submit"
              disabled={lookupBusy || !handle.trim()}
              className="px-4 py-2 bg-[#111] text-white text-[13px] hover:bg-[#333] disabled:opacity-30"
            >
              {lookupBusy ? '...' : 'Find'}
            </button>
          </form>
          {lookupError && <p className="text-[13px] text-[#cc0000] mt-2">{lookupError}</p>}
          {creator && (
            <div className="mt-4 flex items-center gap-3 py-3 border-t border-[#f0f0f0]">
              {creator.profile_photo_url ? (
                <img src={creator.profile_photo_url} alt="" className="w-8 h-8 rounded-full grayscale" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[#f0f0f0] flex items-center justify-center text-[#999] text-[12px]">
                  {creator.handle[0]?.toUpperCase()}
                </div>
              )}
              <div className="flex-1">
                <span className="text-[14px] font-medium text-[#111]">@{creator.handle}</span>
                <span className="text-[13px] text-[#999] ml-2">
                  {creator.follower_count != null ? formatK(Number(creator.follower_count)) : '—'} followers
                </span>
              </div>
              <Link href={`/insights/${creator.handle}`} className="text-[12px] text-[#999] hover:text-[#111]">
                Insights &rarr;
              </Link>
            </div>
          )}
        </div>

        {/* Step 2 */}
        {creator && mode === 'predict' && (
          <div className="border border-[#e5e5e5] p-6 mb-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-3">Step 2 &mdash; Predict</div>
            <p className="text-[13px] text-[#6b6b6b] mb-4">
              Predict engagement for @{creator.handle} based on history, timing, and trends.
            </p>
            <button
              onClick={runPrediction}
              disabled={predicting}
              className="px-5 py-2 bg-[#111] text-white text-[13px] hover:bg-[#333] disabled:opacity-50"
            >
              {predicting ? 'Analyzing...' : 'Run Prediction'}
            </button>
          </div>
        )}

        {creator && mode === 'monitor' && (
          <div className="border border-[#e5e5e5] p-6 mb-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-3">Step 2 &mdash; Analyze Post</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                placeholder="Instagram post URL (e.g. instagram.com/p/ABC123)"
                className="flex-1 px-3 py-2 border border-[#e5e5e5] text-[14px] placeholder:text-[#ccc] focus:outline-none focus:border-[#111]"
              />
              <button
                onClick={analyzePost}
                disabled={analyzing || !postUrl.trim()}
                className="px-4 py-2 bg-[#111] text-white text-[13px] hover:bg-[#333] disabled:opacity-50"
              >
                {analyzing ? '...' : 'Analyze'}
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {prediction && mode === 'predict' && (
          <div className="border border-[#e5e5e5] p-6 space-y-6">
            <div className="flex items-baseline gap-4">
              <span className="text-xl font-medium text-[#111] capitalize">{prediction.bucket.replace('_', ' ')}</span>
              <span className="text-[13px] text-[#999]">{(prediction.bucket_probability * 100).toFixed(0)}% probability</span>
              <span className="text-[13px] text-[#ccc]">{prediction.confidence} confidence</span>
            </div>

            <div className="grid grid-cols-3 gap-4 py-4 border-y border-[#f0f0f0]">
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc]">Predicted ER</div>
                <div className="text-lg font-medium text-[#111] tabular-nums">{(prediction.predicted_er_median * 100).toFixed(2)}%</div>
                <div className="text-[11px] text-[#ccc] tabular-nums">
                  {(prediction.predicted_er_range[0] * 100).toFixed(2)}% &ndash; {(prediction.predicted_er_range[1] * 100).toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc]">Trend alignment</div>
                <div className="text-lg font-medium text-[#111] tabular-nums">{(prediction.trend_alignment_score * 100).toFixed(0)}%</div>
              </div>
              {prediction.optimal_post_window && (
                <div>
                  <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc]">Best window</div>
                  <div className="text-[14px] font-medium text-[#111]">
                    {new Date(prediction.optimal_post_window.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' – '}
                    {new Date(prediction.optimal_post_window.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-2">Factors</div>
              <Factor label="Baseline" value={`${(prediction.creator_baseline_er * 100).toFixed(2)}%`} pct={prediction.creator_baseline_er * 500} />
              <Factor label="Content" value={`${prediction.content_multiplier.toFixed(2)}x`} pct={((prediction.content_multiplier - 0.5) / 1.5) * 100} />
              <Factor label="Timing" value={`${prediction.temporal_multiplier.toFixed(2)}x`} pct={((prediction.temporal_multiplier - 0.5) / 1.5) * 100} />
              <Factor label="Trend" value={`${prediction.trend_multiplier.toFixed(2)}x`} pct={((prediction.trend_multiplier - 0.5) / 1.5) * 100} />
              <Factor label="Competition" value={`${prediction.competition_multiplier.toFixed(2)}x`} pct={((prediction.competition_multiplier - 0.5) / 1.5) * 100} />
            </div>

            {prediction.improvement_suggestions.length > 0 && (
              <div className="pt-4 border-t border-[#f0f0f0]">
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-2">Suggestions</div>
                {prediction.improvement_suggestions.map((s, i) => (
                  <p key={i} className="text-[13px] text-[#6b6b6b] mb-1">&ndash; {s}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {analysis && mode === 'monitor' && analysis.found && analysis.post && (
          <div className="border border-[#e5e5e5] p-6 space-y-6">
            <div className="flex items-baseline gap-4">
              <span className="text-xl font-medium text-[#111] capitalize">
                {analysis.post.performance_bucket.replace('_', ' ')}
              </span>
              <span className="text-[13px] text-[#999]">
                {(analysis.post.engagement_rate * 100).toFixed(2)}% ER
              </span>
              {analysis.post.posted_at && (
                <span className="text-[12px] text-[#ccc]">
                  {new Date(analysis.post.posted_at).toLocaleDateString()}
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 py-4 border-y border-[#f0f0f0]">
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc]">Likes</div>
                <div className="text-lg font-medium text-[#111] tabular-nums">
                  {formatK(analysis.post.metrics.likes)}
                </div>
                {analysis.comparison?.likes_vs_avg != null && (
                  <ComparisonTag value={analysis.comparison.likes_vs_avg} label="vs avg" />
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc]">Comments</div>
                <div className="text-lg font-medium text-[#111] tabular-nums">
                  {formatK(analysis.post.metrics.comments)}
                </div>
                {analysis.comparison?.comments_vs_avg != null && (
                  <ComparisonTag value={analysis.comparison.comments_vs_avg} label="vs avg" />
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc]">Views</div>
                <div className="text-lg font-medium text-[#111] tabular-nums">
                  {analysis.post.metrics.views != null ? formatK(analysis.post.metrics.views) : '—'}
                </div>
                {analysis.comparison?.views_vs_avg != null && (
                  <ComparisonTag value={analysis.comparison.views_vs_avg} label="vs avg" />
                )}
              </div>
            </div>

            {analysis.comparison?.er_vs_baseline != null && (
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-2">
                  Performance vs baseline
                </div>
                <Factor
                  label="ER vs Baseline"
                  value={`${analysis.comparison.er_vs_baseline.toFixed(2)}x`}
                  pct={((analysis.comparison.er_vs_baseline - 0.5) / 2.0) * 100}
                />
                {analysis.creator?.baseline_er != null && (
                  <Factor
                    label="Creator Avg ER"
                    value={`${(analysis.creator.baseline_er * 100).toFixed(2)}%`}
                    pct={analysis.creator.baseline_er * 500}
                  />
                )}
              </div>
            )}

            {analysis.post.caption && (
              <div className="pt-4 border-t border-[#f0f0f0]">
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-2">Caption</div>
                <p className="text-[13px] text-[#6b6b6b] leading-relaxed">{analysis.post.caption}</p>
              </div>
            )}

            {analysis.note && (
              <p className="text-[11px] text-[#ccc] pt-2 border-t border-[#f0f0f0]">{analysis.note}</p>
            )}
          </div>
        )}

        {analysis && mode === 'monitor' && !analysis.found && (
          <div className="border border-[#e5e5e5] p-6">
            <p className="text-[13px] text-[#999] mb-4">{analysis.message}</p>
            {analysis.all_posts && analysis.all_posts.length > 0 && (
              <>
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-3">
                  Available posts ({analysis.all_posts.length})
                </div>
                <div className="space-y-2">
                  {analysis.all_posts.slice(0, 6).map((p) => (
                    <button
                      key={p.code}
                      onClick={() => { setPostUrl(p.permalink); }}
                      className="w-full flex items-center gap-4 py-2 px-3 border border-[#f0f0f0] hover:border-[#e5e5e5] text-left transition-colors"
                    >
                      <span className="text-[13px] text-[#111] font-mono w-28 truncate">{p.code}</span>
                      <span className="text-[12px] text-[#999] w-20">{formatK(p.likes)} likes</span>
                      <span className="text-[12px] text-[#ccc] flex-1 tabular-nums">
                        {(p.engagement_rate * 100).toFixed(2)}% ER
                      </span>
                      <span className="text-[11px] text-[#ccc] capitalize">{p.performance_bucket.replace('_', ' ')}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {mode === 'monitor' && !analysis && (
          <div className="border border-[#e5e5e5] p-6">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-4">How it works</div>
            <div className="space-y-3">
              {[
                { step: '1', desc: 'Enter a post URL to analyze engagement metrics from scraped data' },
                { step: '2', desc: 'See likes, comments, views compared to creator baseline' },
                { step: '3', desc: 'Performance bucket: breakout, above average, average, below average' },
                { step: '—', desc: 'Connect Instagram account to unlock real-time 30m/2h/6h/24h checkpoints' },
              ].map((cp) => (
                <div key={cp.step} className="flex items-baseline gap-4">
                  <span className="text-[13px] font-medium text-[#111] w-8 tabular-nums">{cp.step}</span>
                  <span className="text-[13px] text-[#6b6b6b] flex-1">{cp.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function ComparisonTag({ value, label }: { value: number; label: string }) {
  const pct = ((value - 1) * 100).toFixed(0);
  const positive = value >= 1;
  return (
    <span className={`text-[11px] tabular-nums ${positive ? 'text-[#111]' : 'text-[#cc0000]'}`}>
      {positive ? '+' : ''}{pct}% {label}
    </span>
  );
}

function Factor({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-[#999] w-24">{label}</span>
      <div className="flex-1 h-1 bg-[#f0f0f0]">
        <div className="h-1 bg-[#111] transition-all" style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} />
      </div>
      <span className="text-[13px] font-medium text-[#111] w-20 text-right tabular-nums">{value}</span>
    </div>
  );
}
