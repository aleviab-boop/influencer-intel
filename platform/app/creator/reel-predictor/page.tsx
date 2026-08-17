'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

type Format = 'reel' | 'photo' | 'carousel';
type Bucket = 'breakout' | 'above_average' | 'average' | 'below_average';
type Confidence = 'high' | 'medium' | 'low' | 'very_low';

interface MatchedTrend {
  trend_type: 'audio' | 'format' | 'hashtag' | 'topic';
  display_name: string;
  phase: 'emerging' | 'growing' | 'peak' | 'saturated' | 'declining';
  velocity: number;
  matched_on: string;
  boost_pct: number;
}

interface Prediction {
  format: Format;
  predicted_views: number | null;
  predicted_views_range: [number, number] | null;
  predicted_likes: number;
  predicted_likes_range: [number, number];
  predicted_comments: number;
  predicted_er: number;
  bucket: Bucket;
  confidence: Confidence;
  baseline_views: number | null;
  baseline_likes: number;
  baseline_er: number;
  factors: { trend: number; timing: number; format: number; content?: number };
  trend_score: number;
  matched_trends: MatchedTrend[];
  posts_analyzed: number;
  notes: string[];
}

const FORMATS: { key: Format; label: string; icon: string }[] = [
  { key: 'reel', label: 'Reel', icon: 'M8 5v14l11-7z' },
  { key: 'photo', label: 'Photo', icon: 'M4 5h16v14H4z M8 11l2.5 3 3.5-4.5 4 5.5' },
  { key: 'carousel', label: 'Carousel', icon: 'M7 5h10v14H7z M4 8v8 M20 8v8' },
];

const BUCKET_COPY: Record<Bucket, { label: string; color: string; bg: string }> = {
  breakout: { label: 'Breakout potential', color: '#16a34a', bg: '#ecfdf3' },
  above_average: { label: 'Above your average', color: '#16a34a', bg: '#ecfdf3' },
  average: { label: 'Around your average', color: ACCENT, bg: ACCENT_SOFT },
  below_average: { label: 'Below your average', color: '#c2410c', bg: '#fff4ed' },
};
const CONF_COPY: Record<Confidence, string> = {
  high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence', very_low: 'Early estimate',
};
const PHASE_COPY: Record<MatchedTrend['phase'], string> = {
  emerging: 'Emerging', growing: 'Growing', peak: 'Peaking', saturated: 'Saturated', declining: 'Declining',
};

const fmtNum = (n: number | null): string => (n == null ? '—' : Math.round(n).toLocaleString('en-IN'));
const factorPct = (m: number): string => {
  const pct = Math.round((m - 1) * 100);
  return pct === 0 ? 'neutral' : pct > 0 ? `+${pct}%` : `${pct}%`;
};

export default function ReelPredictorPage() {
  return (
    <Suspense fallback={null}>
      <ReelPredictor />
    </Suspense>
  );
}

function ReelPredictor() {
  const [handle, setHandle] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>('reel');
  const [caption, setCaption] = useState('');
  const [postTime, setPostTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Prediction | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h ? h.replace(/^@/, '') : null);
  }, []);

  const backHref = handle ? `/creator?handle=${encodeURIComponent(handle)}` : '/creator';

  const predict = async () => {
    if (busy || !handle) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { handle, format, caption: caption.trim() };
      if (postTime) body.post_time = new Date(postTime).toISOString();
      const res = await fetch('/api/predict/reach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok || d?.error) {
        setResult(null);
        setError(
          d?.error === 'not_enough_data'
            ? "We don't have enough of your recent reels yet. Fetch your public stats on the Get brand-ready page first."
            : 'Couldn’t run the forecast just now. Please try again.',
        );
      } else {
        setResult(d as Prediction);
      }
    } catch {
      setResult(null);
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const isVideo = format === 'reel';
  const bucket = result ? BUCKET_COPY[result.bucket] : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        <Link href={backHref} className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors duration-200 mb-5">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to dashboard
        </Link>

        <h1 className="text-2xl font-bold text-ink-900">Predict your next reel</h1>
        <p className="mt-1.5 text-[14px] text-ink-600">
          Our model forecasts how your next post will perform — from your own recent reels, how trend-aligned your idea is, and when you plan to post. No Instagram login needed.
        </p>

        {!handle ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <h2 className="text-[16px] font-semibold text-ink-900">Open with your handle</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500">Open the portal with your Instagram handle to forecast your reels.</p>
          </div>
        ) : (
          <>
            {/* Input card */}
            <div className="mt-6 rounded-2xl bg-white border border-border shadow-card p-5">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-400 mb-2">Format</div>
              <div className="flex gap-2">
                {FORMATS.map((f) => (
                  <button key={f.key} onClick={() => setFormat(f.key)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 text-[13px] font-semibold rounded-xl border transition-all duration-200"
                    style={format === f.key
                      ? { background: ACCENT_SOFT, borderColor: '#d9d0fb', color: ACCENT }
                      : { background: '#fff', borderColor: '#eee9fb', color: '#6b6880' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={f.icon} /></svg>
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-400 mt-5 mb-2">Caption idea <span className="normal-case font-normal text-ink-400">(optional)</span></div>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3}
                placeholder="Paste your caption + hashtags. We match them against what's trending right now."
                className="w-full text-[13.5px] text-ink-800 rounded-xl border border-[#eee9fb] p-3 outline-none focus:border-[#c9bcfb] transition-colors resize-none" />

              <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">Planned post time <span className="normal-case font-normal text-ink-400">(optional)</span></div>
              <input type="datetime-local" value={postTime} onChange={(e) => setPostTime(e.target.value)}
                className="w-full text-[13.5px] text-ink-800 rounded-xl border border-[#eee9fb] p-2.5 outline-none focus:border-[#c9bcfb] transition-colors" />

              <button onClick={predict} disabled={busy}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-white rounded-xl transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                {busy && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {busy ? 'Forecasting…' : `Predict this ${format}`}
              </button>

              {error && <p className="mt-3 text-[12.5px] font-medium text-[#dc2626]">{error}</p>}
            </div>

            {/* Result */}
            {result && bucket && (
              <div className="mt-5 rounded-2xl bg-white border border-border shadow-card p-6">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ background: bucket.bg, color: bucket.color }}>{bucket.label}</span>
                  <span className="text-[12px] font-medium px-2.5 py-1 rounded-full bg-[#f2f0fb] text-ink-500">{CONF_COPY[result.confidence]}</span>
                  <span className="text-[12px] text-ink-400">from {result.posts_analyzed} recent post{result.posts_analyzed === 1 ? '' : 's'}</span>
                </div>

                {/* Headline numbers */}
                <div className="mt-4 grid grid-cols-2 gap-4">
                  {isVideo && (
                    <Stat label="Predicted views" value={fmtNum(result.predicted_views)}
                      sub={result.predicted_views_range ? `${fmtNum(result.predicted_views_range[0])} – ${fmtNum(result.predicted_views_range[1])}` : null}
                      baseline={result.baseline_views != null ? `usually ${fmtNum(result.baseline_views)}` : null} big />
                  )}
                  <Stat label="Predicted likes" value={fmtNum(result.predicted_likes)}
                    sub={`${fmtNum(result.predicted_likes_range[0])} – ${fmtNum(result.predicted_likes_range[1])}`}
                    baseline={`usually ${fmtNum(result.baseline_likes)}`} big={!isVideo} />
                  <Stat label="Comments" value={fmtNum(result.predicted_comments)} sub={null} baseline={null} />
                  <Stat label="Engagement rate" value={`${result.predicted_er.toFixed(1)}%`} sub={null}
                    baseline={`usually ${result.baseline_er.toFixed(1)}%`} />
                </div>

                {/* Factors */}
                <div className="mt-5 pt-5 border-t border-[#f0edfa]">
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-400 mb-2.5">What moved the forecast</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Factor label="Trend fit" value={factorPct(result.factors.trend)} up={result.factors.trend >= 1} />
                    <Factor label="Timing" value={factorPct(result.factors.timing)} up={result.factors.timing >= 1} />
                    <Factor label="Format" value={factorPct(result.factors.format)} up={result.factors.format >= 1} />
                  </div>
                </div>

                {/* Trend match */}
                {result.matched_trends.length > 0 && (
                  <div className="mt-5">
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-400 mb-2">Trending signals your idea matches</div>
                    <div className="flex flex-wrap gap-2">
                      {result.matched_trends.map((t, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full border border-[#eee9fb] bg-[#faf9ff] text-ink-600">
                          <span className="font-semibold text-ink-800">{t.display_name}</span>
                          <span className="text-ink-400">{PHASE_COPY[t.phase]}</span>
                          {t.boost_pct > 0 && <span className="text-[#16a34a] font-semibold">+{Math.round(t.boost_pct)}%</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {result.notes.length > 0 && (
                  <ul className="mt-5 space-y-1.5">
                    {result.notes.map((n, i) => (
                      <li key={i} className="flex gap-2 text-[13px] text-ink-600 leading-relaxed">
                        <span className="mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full" style={{ background: ACCENT }} />
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, sub, baseline, big }: { label: string; value: string; sub: string | null; baseline: string | null; big?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`font-bold tabular-nums text-ink-900 ${big ? 'text-[30px] leading-tight' : 'text-[20px]'}`}>{value}</div>
      {sub && <div className="text-[12px] text-ink-500 tabular-nums">{sub}</div>}
      {baseline && <div className="text-[11.5px] text-ink-400 tabular-nums">{baseline}</div>}
    </div>
  );
}

function Factor({ label, value, up }: { label: string; value: string; up: boolean }) {
  const neutral = value === 'neutral';
  const color = neutral ? '#6b6880' : up ? '#16a34a' : '#c2410c';
  return (
    <div className="rounded-xl border border-[#f0edfa] bg-[#faf9ff] p-2.5 text-center">
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className="text-[14px] font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}
