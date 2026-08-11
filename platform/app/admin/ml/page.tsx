'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader, LiveBadge, StatCard, ACCENT } from '@/components/admin-ui';

interface ModelStatus {
  id: string;
  n_samples: number;
  rmse: number | null;
  r2: number | null;
  trained_at: string;
}
interface StatusResp { trained: boolean; models: ModelStatus[] }

interface MetricAccuracy {
  n: number;
  median_ape: number | null;
  median_bias: number | null;
  within_25pct: number | null;
  within_50pct: number | null;
}
interface FormatAccuracy { likes: MetricAccuracy; views: MetricAccuracy }
interface Calibration {
  applied: boolean;
  scope: 'format' | 'global' | 'none';
  format: string | null;
  likes_correction: number;
  views_correction: number;
  n_outcomes: number;
}
interface ForecastAccuracy {
  total_outcomes: number;
  scored_outcomes: number;
  likes: MetricAccuracy;
  views: MetricAccuracy;
  er: MetricAccuracy;
  by_format: Record<string, FormatAccuracy>;
  calibrations: Calibration[];
  last_recorded_at: string | null;
}

interface TrainResp {
  ok: boolean;
  error?: string;
  creators_scanned?: number;
  trained_at?: string;
  likes?: { trained: boolean; rmse: number; r2: number; n_samples: number };
  views?: { trained: boolean; rmse: number; r2: number; n_samples: number };
}

interface LoggedPrediction {
  id: string;
  creator_handle: string | null;
  format: string | null;
  predicted_likes: number | null;
  predicted_views: number | null;
  bucket: string | null;
  created_at: string;
  scored: boolean;
  actual_likes: number | null;
  likes_ape: number | null;
}

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const pct = (r: number | null): string => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
// RMSE lives in log space; e^rmse is the typical multiplicative error band.
const errBand = (rmse: number | null): string => (rmse == null ? '—' : `±${Math.round((Math.exp(rmse) - 1) * 100)}%`);
// Accuracy formatting: median % error and hit-rate as whole percentages.
const errPct = (r: number | null): string => (r == null ? '—' : `${Math.round(r * 100)}%`);
const biasPct = (r: number | null): string => (r == null ? '—' : `${r >= 0 ? '+' : ''}${Math.round(r * 100)}%`);

export default function MlPage() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [accuracy, setAccuracy] = useState<ForecastAccuracy | null>(null);
  const [predictions, setPredictions] = useState<LoggedPrediction[] | null>(null);
  const [training, setTraining] = useState(false);
  const [lastRun, setLastRun] = useState<TrainResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/ml/train-reach')
      .then((r) => r.json())
      .then((d) => setStatus(d as StatusResp))
      .catch(() => setStatus({ trained: false, models: [] }));
    fetch('/api/admin/ml/accuracy')
      .then((r) => r.json())
      .then((d) => setAccuracy(d as ForecastAccuracy))
      .catch(() => setAccuracy(null));
    fetch('/api/admin/ml/predictions?limit=15')
      .then((r) => r.json())
      .then((d) => setPredictions((d?.predictions ?? []) as LoggedPrediction[]))
      .catch(() => setPredictions([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const retrain = useCallback(async () => {
    setTraining(true); setErr(null); setLastRun(null);
    try {
      const r = await fetch('/api/admin/ml/train-reach', { method: 'POST' });
      const d = (await r.json()) as TrainResp;
      if (!d.ok) setErr(d.error || 'Training failed.');
      else setLastRun(d);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTraining(false);
    }
  }, [load]);

  const byId = (id: string): ModelStatus | undefined => status?.models.find((m) => m.id === id);
  const likes = byId('likes');
  const views = byId('views');

  return (
    <div className="px-8 py-7">
      <PageHeader
        title="ML Models"
        subtitle="The trained layer behind the views & likes predictor. A ridge regression fit on every creator's real post history — learning how format and caption move a post off that creator's own baseline."
        badge={<LiveBadge live={!!status?.trained} label={['Trained', 'Not trained']} />}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-7">
        <StatCard label="Likes model" value={likes ? likes.n_samples.toLocaleString() : '—'} sub="training samples" color="#6C4DF6" />
        <StatCard label="Likes fit (R²)" value={pct(likes?.r2 ?? null)} sub={`typical error ${errBand(likes?.rmse ?? null)}`} color="#8b5cf6" />
        <StatCard label="Views model" value={views ? views.n_samples.toLocaleString() : '—'} sub="training samples" color="#0ea5e9" />
        <StatCard label="Views fit (R²)" value={pct(views?.r2 ?? null)} sub={`typical error ${errBand(views?.rmse ?? null)}`} color="#06b6d4" />
      </div>

      <div className="rounded-2xl border border-[#ececf3] bg-white p-6 shadow-[0_10px_40px_rgba(108,77,246,0.06)] mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[15px] font-semibold text-[#1a1a2e]">Reach model</div>
            <div className="text-[13px] text-[#777] mt-0.5">
              Last trained {ago(status?.models[0]?.trained_at)}. Retraining scans all historical posts and upserts the weights.
            </div>
          </div>
          <button
            onClick={retrain}
            disabled={training}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)`, boxShadow: '0 8px 20px rgba(108,77,246,0.28)' }}
          >
            {training ? (
              <>
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.2-8.5" strokeLinecap="round" /></svg>
                Training…
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" /></svg>
                Retrain now
              </>
            )}
          </button>
        </div>

        {err && <div className="mt-4 rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 text-[13px] text-rose-700">{err}</div>}

        {lastRun?.ok && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-[13px] text-emerald-800">
            Retrained on {lastRun.creators_scanned?.toLocaleString()} creators —
            {' '}likes: {lastRun.likes?.trained ? `${lastRun.likes.n_samples.toLocaleString()} samples, R² ${pct(lastRun.likes.r2)}` : 'skipped (too few samples)'};
            {' '}views: {lastRun.views?.trained ? `${lastRun.views.n_samples.toLocaleString()} samples, R² ${pct(lastRun.views.r2)}` : 'skipped (too few samples)'}.
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#ececf3] bg-white p-6 shadow-[0_10px_40px_rgba(108,77,246,0.06)] mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <div className="text-[15px] font-semibold text-[#1a1a2e]">Forecast accuracy</div>
            <div className="text-[13px] text-[#777] mt-0.5">
              How the predictions actually did against real posts recorded in the outcomes log.
              {accuracy ? ` ${accuracy.scored_outcomes.toLocaleString()} of ${accuracy.total_outcomes.toLocaleString()} outcomes scored.` : ''}
              {accuracy?.last_recorded_at ? ` Last recorded ${ago(accuracy.last_recorded_at)}.` : ''}
            </div>
          </div>
        </div>

        {accuracy && accuracy.scored_outcomes === 0 ? (
          <div className="rounded-xl bg-[#faf9ff] border border-[#ececf3] px-4 py-3 text-[13px] text-[#777]">
            No scored outcomes yet. Each time a real post result is recorded against its prediction
            (<code className="text-[12px]">POST /api/monitor/outcomes</code>), it shows up here as a live measure of how
            close the forecasts land — median % error, over/under-prediction bias, and hit-rate.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Likes error" value={errPct(accuracy?.likes.median_ape ?? null)} sub={`median · n=${accuracy?.likes.n ?? 0}`} color="#6C4DF6" />
              <StatCard label="Likes within ±25%" value={pct(accuracy?.likes.within_25pct ?? null)} sub={`bias ${biasPct(accuracy?.likes.median_bias ?? null)}`} color="#8b5cf6" />
              <StatCard label="Views error" value={errPct(accuracy?.views.median_ape ?? null)} sub={`median · n=${accuracy?.views.n ?? 0}`} color="#0ea5e9" />
              <StatCard label="Views within ±25%" value={pct(accuracy?.views.within_25pct ?? null)} sub={`bias ${biasPct(accuracy?.views.median_bias ?? null)}`} color="#06b6d4" />
            </div>
            <div className="mt-3 text-[12.5px] text-[#888]">
              ER: {errPct(accuracy?.er.median_ape ?? null)} median error, {pct(accuracy?.er.within_25pct ?? null)} within ±25% (n={accuracy?.er.n ?? 0}).
              {' '}<span className="text-[#aaa]">Lower error is better; a positive bias means the model over-predicts.</span>
            </div>

            {/* Per-format accuracy & the live self-calibration correction */}
            <div className="mt-6">
              <div className="text-[13px] font-semibold text-[#1a1a2e] mb-2">By format &amp; active calibration</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px] border-collapse">
                  <thead>
                    <tr className="text-left text-[#999] border-b border-[#ececf3]">
                      <th className="py-2 pr-3 font-medium">Format</th>
                      <th className="py-2 px-3 font-medium">Outcomes</th>
                      <th className="py-2 px-3 font-medium">Likes error</th>
                      <th className="py-2 px-3 font-medium">Likes bias</th>
                      <th className="py-2 px-3 font-medium">Views error</th>
                      <th className="py-2 px-3 font-medium">Correction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['reel', 'photo', 'carousel'].map((fmt) => {
                      const fa = accuracy?.by_format?.[fmt];
                      const cal = accuracy?.calibrations?.find((c) => c.format === fmt);
                      const n = fa?.likes.n ?? 0;
                      return (
                        <tr key={fmt} className="border-b border-[#f4f4f9] text-[#333]">
                          <td className="py-2 pr-3 capitalize font-medium">{fmt}</td>
                          <td className="py-2 px-3 tabular-nums">{n}</td>
                          <td className="py-2 px-3 tabular-nums">{errPct(fa?.likes.median_ape ?? null)}</td>
                          <td className="py-2 px-3 tabular-nums">{biasPct(fa?.likes.median_bias ?? null)}</td>
                          <td className="py-2 px-3 tabular-nums">{errPct(fa?.views.median_ape ?? null)}</td>
                          <td className="py-2 px-3">
                            {cal && cal.applied ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="tabular-nums font-medium text-[#1a1a2e]">×{cal.likes_correction.toFixed(2)}</span>
                                <span
                                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                                  style={cal.scope === 'format'
                                    ? { background: '#ecfdf5', color: '#059669' }
                                    : { background: '#fef3c7', color: '#b45309' }}
                                >
                                  {cal.scope === 'format' ? 'own' : 'pooled'}
                                </span>
                              </span>
                            ) : (
                              <span className="text-[#bbb]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[12px] text-[#999]">
                Correction is applied to the next forecast for that format. <span className="text-[#059669] font-semibold">own</span> = learned from that
                format&apos;s ≥8 recorded results; <span className="text-[#b45309] font-semibold">pooled</span> = borrowed from all formats until it has enough of its own.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-[#ececf3] bg-white p-6 shadow-[0_10px_40px_rgba(108,77,246,0.06)] mb-6">
        <div className="mb-4">
          <div className="text-[15px] font-semibold text-[#1a1a2e]">Recent forecasts</div>
          <div className="text-[13px] text-[#777] mt-0.5">
            The last {predictions?.length ?? 0} forecasts logged to the ledger. A recorded actual links straight
            back to its forecast — no re-entering numbers — and shows how close it landed.
          </div>
        </div>
        {predictions && predictions.length === 0 ? (
          <div className="rounded-xl bg-[#faf9ff] border border-[#ececf3] px-4 py-3 text-[13px] text-[#777]">
            No forecasts logged yet. Each reach forecast (<code className="text-[12px]">POST /api/predict/reach</code>) is
            recorded here with its predicted likes/views, and marked <b>scored</b> once a real result is captured against it.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr className="text-left text-[#999] border-b border-[#ececf3]">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 px-3 font-medium">Creator</th>
                  <th className="py-2 px-3 font-medium">Format</th>
                  <th className="py-2 px-3 font-medium">Pred. likes</th>
                  <th className="py-2 px-3 font-medium">Pred. views</th>
                  <th className="py-2 px-3 font-medium">Actual likes</th>
                  <th className="py-2 px-3 font-medium">Likes error</th>
                </tr>
              </thead>
              <tbody>
                {(predictions ?? []).map((p) => (
                  <tr key={p.id} className="border-b border-[#f4f4f9] text-[#333]">
                    <td className="py-2 pr-3 whitespace-nowrap text-[#888]">{ago(p.created_at)}</td>
                    <td className="py-2 px-3">{p.creator_handle ? `@${p.creator_handle}` : '—'}</td>
                    <td className="py-2 px-3 capitalize">{p.format ?? '—'}</td>
                    <td className="py-2 px-3 tabular-nums">{p.predicted_likes?.toLocaleString() ?? '—'}</td>
                    <td className="py-2 px-3 tabular-nums">{p.predicted_views != null ? p.predicted_views.toLocaleString() : '—'}</td>
                    <td className="py-2 px-3 tabular-nums">
                      {p.scored ? (p.actual_likes?.toLocaleString() ?? '—') : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-[#f1f0fa] text-[#8b83b8]">pending</span>
                      )}
                    </td>
                    <td className="py-2 px-3 tabular-nums">{p.likes_ape != null ? errPct(p.likes_ape) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#ececf3] bg-white p-6 text-[13.5px] leading-relaxed text-[#555]">
        <div className="text-[14px] font-semibold text-[#1a1a2e] mb-2">How the prediction is built</div>
        <p className="mb-2">
          The predictor multiplies four factors: the creator's own <b>baseline</b> (median of their real posts),
          a live <b>trend</b> signal (caption matched against trending audio/hashtags/topics),
          the creator's best <b>timing</b> slots, and a trained <b>content</b> multiplier learned here.
        </p>
        <p className="mb-2">
          The trained model only learns what history <i>can</i> teach — how format and caption metadata (length,
          hashtags, emoji, call-to-action) nudge a post above or below the creator's baseline. It's fit on log-residuals
          so it never has to relearn each creator's scale.
        </p>
        <p className="text-[#888]">
          <b>Honest read:</b> caption/text features explain only a small slice of the variance (that's what the R² shows) —
          most of a post's performance is driven by the actual video, thumbnail and audio, which text can't see. So the
          trained layer is a small, safe calibration; the baseline + live trend + timing carry the real predictive weight.
          Feeding in visual/audio content scores is the way to lift R² meaningfully.
        </p>
      </div>
    </div>
  );
}
