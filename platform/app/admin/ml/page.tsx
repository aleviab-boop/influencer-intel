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

interface TrainResp {
  ok: boolean;
  error?: string;
  creators_scanned?: number;
  trained_at?: string;
  likes?: { trained: boolean; rmse: number; r2: number; n_samples: number };
  views?: { trained: boolean; rmse: number; r2: number; n_samples: number };
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

export default function MlPage() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [training, setTraining] = useState(false);
  const [lastRun, setLastRun] = useState<TrainResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/ml/train-reach')
      .then((r) => r.json())
      .then((d) => setStatus(d as StatusResp))
      .catch(() => setStatus({ trained: false, models: [] }));
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
