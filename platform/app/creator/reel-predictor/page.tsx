'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

type Format = 'reel' | 'photo' | 'carousel';
type Bucket = 'breakout' | 'above_average' | 'average' | 'below_average';
type Confidence = 'high' | 'medium' | 'low' | 'very_low';

interface ScheduleSlot {
  day: number | null;
  day_label: string;
  part_key: string;
  part_label: string;
  range: string;
  avg_er: number | null;
  count: number;
  lift_pct: number | null;
}
interface PostingSchedule {
  available: boolean;
  slots: ScheduleSlot[];
  headline: string | null;
  tip: string | null;
}

interface LoggedPrediction {
  id: string;
  format: string | null;
  predicted_likes: number | null;
  predicted_views: number | null;
  bucket: string | null;
  confidence: string | null;
  caption_preview: string | null;
  created_at: string;
  scored: boolean;
  actual_likes: number | null;
  actual_views: number | null;
  likes_ape: number | null;
}
interface ForecastHistory {
  available: boolean;
  predictions: LoggedPrediction[];
  total: number;
  scored: number;
  median_likes_ape: number | null;
}

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
  content?: {
    scored: boolean;
    vision: boolean;
    overall: number;
    multiplier: number;
    top_dimensions: Array<{ name: string; score: number }>;
    weak_dimensions: Array<{ name: string; score: number }>;
    suggestions: string[];
  } | null;
  trend_score: number;
  matched_trends: MatchedTrend[];
  posts_analyzed: number;
  notes: string[];
}

const prettyDim = (s: string): string => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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

// Slot start hour in IST, mirroring the PARTS table in lib/posting-schedule.
const PART_LO: Record<string, number> = { morning: 6, midday: 11, afternoon: 15, evening: 18, night: 21, latenight: 0 };
const IST_OFFSET_MIN = 5 * 60 + 30;
const pad2 = (n: number): string => String(n).padStart(2, '0');

// Next future date-time (as a datetime-local string) that lands in a slot's IST
// window. Product is IST-first, so we build the value directly in IST.
function nextSlotLocal(slot: ScheduleSlot): string {
  const hour = PART_LO[slot.part_key] ?? 18;
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  for (let add = 0; add < 14; add++) {
    const d = new Date(nowIst);
    d.setUTCDate(d.getUTCDate() + add);
    d.setUTCHours(hour, 0, 0, 0);
    const dayOk = slot.day == null || d.getUTCDay() === slot.day;
    const future = d.getTime() > nowIst.getTime();
    if (dayOk && future) {
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(hour)}:00`;
    }
  }
  return '';
}

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
  const [mediaUrl, setMediaUrl] = useState('');
  const [postTime, setPostTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Prediction | null>(null);
  const [schedule, setSchedule] = useState<PostingSchedule | null>(null);
  const [history, setHistory] = useState<ForecastHistory | null>(null);

  const loadHistory = (h: string) => {
    fetch(`/api/creator/forecast-history?handle=${encodeURIComponent(h)}`)
      .then((r) => r.json())
      .then((d: ForecastHistory) => setHistory(d?.available ? d : null))
      .catch(() => setHistory(null));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    const clean = h ? h.replace(/^@/, '') : null;
    setHandle(clean);
    if (clean) {
      const qs = `?handle=${encodeURIComponent(clean)}`;
      fetch(`/api/creator/analytics${qs}`)
        .then((r) => r.json())
        .then((d) => setSchedule(d?.posting_schedule ?? null))
        .catch(() => setSchedule(null));
      loadHistory(clean);
    }
  }, []);

  const backHref = handle ? `/creator?handle=${encodeURIComponent(handle)}` : '/creator';

  const predict = async () => {
    if (busy || !handle) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { handle, format, caption: caption.trim() };
      if (mediaUrl.trim()) body[format === 'reel' ? 'thumbnail_url' : 'media_url'] = mediaUrl.trim();
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
        if (handle) loadHistory(handle);
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

              <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">{isVideo ? 'Cover-frame' : 'Draft image'} URL <span className="normal-case font-normal text-ink-400">(optional — we’ll score the visual)</span></div>
              <input type="url" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://… link to your draft cover or image"
                className="w-full text-[13.5px] text-ink-800 rounded-xl border border-[#eee9fb] p-2.5 outline-none focus:border-[#c9bcfb] transition-colors" />

              <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-400 mt-4 mb-2">Planned post time <span className="normal-case font-normal text-ink-400">(optional)</span></div>
              <input type="datetime-local" value={postTime} onChange={(e) => setPostTime(e.target.value)}
                className="w-full text-[13.5px] text-ink-800 rounded-xl border border-[#eee9fb] p-2.5 outline-none focus:border-[#c9bcfb] transition-colors" />

              {schedule?.available && schedule.slots.length > 0 && (
                <div className="mt-2.5">
                  <div className="text-[12px] text-ink-500 mb-1.5">{schedule.headline ? schedule.headline : 'Your best posting windows'} — tap to use:</div>
                  <div className="flex flex-wrap gap-2">
                    {schedule.slots.slice(0, 3).map((s, i) => (
                      <button key={i} type="button" onClick={() => setPostTime(nextSlotLocal(s))}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-full border border-[#e3def9] bg-[#faf9ff] transition-all duration-200 hover:-translate-y-0.5"
                        style={{ color: ACCENT }}>
                        {s.day_label !== 'Most days' ? `${s.day_label} ` : ''}{s.range}
                        {s.lift_pct != null && s.lift_pct > 0 && <span className="text-[#16a34a] font-semibold">+{Math.round(s.lift_pct)}%</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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

                {/* Content quality (vision) */}
                {result.content?.scored && (
                  <div className="mt-5 pt-5 border-t border-[#f0edfa]">
                    <div className="flex items-center justify-between gap-3 mb-2.5">
                      <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">
                        Visual quality {result.content.vision ? '' : <span className="normal-case font-normal">(heuristic)</span>}
                      </div>
                      <span className="text-[13px] font-bold tabular-nums" style={{ color: ACCENT }}>{Math.round(result.content.overall * 100)}/100</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#eee9fb] overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round(result.content.overall * 100)}%`, background: `linear-gradient(90deg, ${ACCENT}, #9b7bff)` }} />
                    </div>
                    {(result.content.top_dimensions.length > 0 || result.content.weak_dimensions.length > 0) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {result.content.top_dimensions.slice(0, 3).map((d, i) => (
                          <span key={`t${i}`} className="text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: '#ecfdf3', color: '#16a34a' }}>↑ {prettyDim(d.name)}</span>
                        ))}
                        {result.content.weak_dimensions.slice(0, 3).map((d, i) => (
                          <span key={`w${i}`} className="text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: '#fff4ed', color: '#c2410c' }}>↓ {prettyDim(d.name)}</span>
                        ))}
                      </div>
                    )}
                    {result.content.suggestions.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {result.content.suggestions.slice(0, 4).map((s, i) => (
                          <li key={i} className="flex gap-2 text-[13px] text-ink-600 leading-relaxed">
                            <span className="mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full" style={{ background: '#9b7bff' }} />
                            {s}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

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

            {/* Forecast track record */}
            {history && history.total > 0 && (
              <div className="mt-5 rounded-2xl bg-white border border-border shadow-card p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-[14px] font-bold text-ink-900">Your forecast track record</div>
                  <div className="flex items-center gap-4 text-[12px] text-ink-500">
                    <span><span className="font-semibold text-ink-800 tabular-nums">{history.total}</span> forecast{history.total === 1 ? '' : 's'}</span>
                    <span><span className="font-semibold text-ink-800 tabular-nums">{history.scored}</span> with results</span>
                    {history.median_likes_ape != null && (
                      <span>~<span className="font-semibold text-ink-800 tabular-nums">{Math.round((1 - history.median_likes_ape) * 100)}%</span> accurate on likes</span>
                    )}
                  </div>
                </div>

                <div className="mt-3 divide-y divide-[#f2f0fb]">
                  {history.predictions.map((p) => (
                    <ForecastRow key={p.id} p={p} onRecorded={() => handle && loadHistory(handle)} />
                  ))}
                </div>
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

function ForecastRow({ p, onRecorded }: { p: LoggedPrediction; onRecorded: () => void }) {
  const [open, setOpen] = useState(false);
  const [likes, setLikes] = useState('');
  const [views, setViews] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isVideo = p.format === 'reel' || p.format === 'video';

  const save = async () => {
    const l = Number(likes);
    if (!Number.isFinite(l) || l < 0) { setErr('Enter the actual likes.'); return; }
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { prediction_id: p.id, actual_likes: l };
      const v = Number(views);
      if (isVideo && Number.isFinite(v) && v > 0) body.actual_views = v;
      const r = await fetch('/api/creator/forecast-history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((res) => res.json());
      if (r?.ok) onRecorded();
      else setErr('Couldn’t save that — please try again.');
    } catch {
      setErr('Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 capitalize" style={{ background: ACCENT_SOFT, color: ACCENT }}>{p.format ?? 'post'}</span>
        <span className="min-w-0 flex-1 text-[12.5px] text-ink-600 truncate">{p.caption_preview || 'No caption'}</span>
        <span className="shrink-0 text-right tabular-nums">
          {p.scored ? (
            <>
              <span className="block text-[12.5px] text-ink-800">{fmtNum(p.predicted_likes)} <span className="text-ink-400">→</span> {fmtNum(p.actual_likes)} likes</span>
              {p.likes_ape != null && (
                <span className="block text-[11px] font-semibold" style={{ color: p.likes_ape <= 0.25 ? '#16a34a' : p.likes_ape <= 0.5 ? '#d97706' : '#dc2626' }}>
                  {Math.round((1 - Math.min(p.likes_ape, 1)) * 100)}% accurate
                </span>
              )}
            </>
          ) : (
            <button type="button" onClick={() => setOpen((o) => !o)} className="text-[12px] font-semibold" style={{ color: ACCENT }}>
              {open ? 'Cancel' : 'Add result'}
            </button>
          )}
        </span>
      </div>

      {!p.scored && open && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-1">
          <span className="text-[11.5px] text-ink-400">predicted {fmtNum(p.predicted_likes)} likes — actuals:</span>
          <input type="number" inputMode="numeric" value={likes} onChange={(e) => setLikes(e.target.value)} placeholder="Likes"
            className="w-24 text-[12.5px] text-ink-800 rounded-lg border border-[#eee9fb] px-2.5 py-1.5 outline-none focus:border-[#c9bcfb]" />
          {isVideo && (
            <input type="number" inputMode="numeric" value={views} onChange={(e) => setViews(e.target.value)} placeholder="Views"
              className="w-24 text-[12.5px] text-ink-800 rounded-lg border border-[#eee9fb] px-2.5 py-1.5 outline-none focus:border-[#c9bcfb]" />
          )}
          <button type="button" onClick={save} disabled={saving}
            className="text-[12.5px] font-semibold text-white rounded-lg px-3 py-1.5 disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {err && <span className="text-[11.5px] text-[#dc2626]">{err}</span>}
        </div>
      )}
    </div>
  );
}
