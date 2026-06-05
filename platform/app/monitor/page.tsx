'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';

interface CreatorRow {
  id: string;
  handle: string;
  display_name: string | null;
  follower_count: number | string | null;
  engagement_rate: number | string | null;
  avg_views: number | string | null;
  primary_category: string | null;
  vision_niche: string | null;
}

interface Prediction {
  predicted_er_median: number;
  predicted_er_range: [number, number];
  bucket: string;
  confidence: string;
  creator_baseline_er: number;
  optimal_post_window: { start: string; end: string } | null;
}

interface ContentBrief {
  concept: string;
  format: string;
  hook: string;
  rationale: string;
  cta: string;
}

interface Outcome {
  id: string;
  post_url: string | null;
  predicted_likes: number | null;
  predicted_views: number | null;
  actual_likes: number | null;
  actual_views: number | null;
  note: string | null;
  created_at: string;
}

const n = (v: number | string | null): number | null => {
  if (v === null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

export default function MonitorPage() {
  const [selected, setSelected] = useState<CreatorRow | null>(null);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Monitor &amp; Predict</div>
        <h1 className="text-2xl font-semibold text-ink-900 mb-6">
          Predict performance, brief content, track predicted vs. real
        </h1>

        <CreatorSearch onSelect={setSelected} selected={selected} />

        {selected && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PredictPanel creator={selected} />
            <BriefPanel creator={selected} />
            <OutcomesPanel creator={selected} />
          </div>
        )}
      </main>
    </div>
  );
}

function CreatorSearch({
  onSelect,
  selected,
}: {
  onSelect: (c: CreatorRow) => void;
  selected: CreatorRow | null;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CreatorRow[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRows([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/creators?q=${encodeURIComponent(q.trim())}&limit=8`);
        const d = await r.json();
        setRows(d.creators ?? []);
        setOpen(true);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative max-w-xl">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => rows.length && setOpen(true)}
        placeholder="Search a creator by handle or name…"
        className="w-full px-4 py-3 border border-border bg-surface text-base text-ink-900 rounded-lg focus:outline-none focus:border-ink-900"
      />
      {selected && (
        <div className="mt-2 text-sm text-ink-600">
          Selected: <span className="text-ink-900 font-medium">@{selected.handle}</span>
          {selected.display_name && ` · ${selected.display_name}`} ·{' '}
          {fmt(n(selected.follower_count))} followers
        </div>
      )}
      {open && rows.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-border rounded-lg shadow-hover max-h-72 overflow-auto">
          {rows.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c);
                setOpen(false);
                setQ('');
              }}
              className="w-full text-left px-4 py-2.5 hover:bg-canvas border-b border-border-soft last:border-0"
            >
              <div className="text-sm font-medium text-ink-900">
                @{c.handle}
                {c.display_name && <span className="text-ink-500 font-normal"> · {c.display_name}</span>}
              </div>
              <div className="text-[12px] text-ink-400">
                {fmt(n(c.follower_count))} followers · {c.vision_niche ?? c.primary_category ?? '—'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PredictPanel({ creator }: { creator: CreatorRow }) {
  const [pred, setPred] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPred(null);
    setError(null);
  }, [creator.id]);

  const followers = n(creator.follower_count) ?? 0;
  const predictedLikes = pred ? Math.round(pred.predicted_er_median * followers) : null;
  const predictedViews = pred
    ? n(creator.avg_views) ?? Math.round(followers * 1.2)
    : null;

  async function predict() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/predict/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: creator.id }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? 'Prediction failed');
      else setPred(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Predicted performance">
      <button
        onClick={predict}
        disabled={loading}
        className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50"
      >
        {loading ? 'Predicting…' : pred ? 'Re-predict' : 'Predict next post'}
      </button>
      {error && <div className="mt-3 text-sm text-rose-700">{error}</div>}
      {pred && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-4">
            <Metric label="Predicted likes" value={fmt(predictedLikes)} />
            <Metric label="Predicted views" value={fmt(predictedViews)} />
            <Metric label="Predicted ER" value={`${(pred.predicted_er_median * 100).toFixed(2)}%`} />
          </div>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="px-2 py-0.5 rounded-md bg-canvas border border-border text-ink-700 capitalize">
              {pred.bucket.replace(/_/g, ' ')}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-canvas border border-border text-ink-700">
              {pred.confidence} confidence
            </span>
          </div>
          <div className="text-[12px] text-ink-400">
            ER range {(pred.predicted_er_range[0] * 100).toFixed(2)}%–
            {(pred.predicted_er_range[1] * 100).toFixed(2)}% · baseline{' '}
            {(pred.creator_baseline_er * 100).toFixed(2)}%
          </div>
        </div>
      )}
    </Card>
  );
}

function BriefPanel({ creator }: { creator: CreatorRow }) {
  const [campaign, setCampaign] = useState('');
  const [brief, setBrief] = useState<ContentBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBrief(null);
    setError(null);
  }, [creator.id]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/monitor/content-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: creator.id, campaign: campaign.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? 'Brief failed');
      else setBrief(d.brief);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="AI content brief — what to ask them to make">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          placeholder="Campaign (e.g. Diwali ethnic launch)"
          className="flex-1 px-3 py-2 border border-border bg-canvas text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900"
        />
        <button
          onClick={generate}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? 'Writing…' : 'Generate'}
        </button>
      </div>
      {error && <div className="mt-3 text-sm text-rose-700">{error}</div>}
      {brief && (
        <div className="mt-4 space-y-2 text-sm">
          <Field k="Concept" v={brief.concept} />
          <Field k="Format" v={brief.format} />
          <Field k="Hook" v={brief.hook} />
          <Field k="Why it fits" v={brief.rationale} />
          <Field k="CTA" v={brief.cta} />
        </div>
      )}
    </Card>
  );
}

function OutcomesPanel({ creator }: { creator: CreatorRow }) {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [postUrl, setPostUrl] = useState('');
  const [likes, setLikes] = useState('');
  const [comments, setComments] = useState('');
  const [views, setViews] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/monitor/outcomes?creator_id=${creator.id}`);
      const d = await r.json();
      if (Array.isArray(d.outcomes)) setOutcomes(d.outcomes);
    } catch {
      /* ignore */
    }
  }, [creator.id]);

  useEffect(() => {
    setOutcomes([]);
    void load();
  }, [load]);

  const followers = n(creator.follower_count) ?? 0;
  const baselineEr = n(creator.engagement_rate) ?? 0.02;
  const predictedLikes = Math.round(baselineEr * followers);

  async function record() {
    if (!likes.trim()) {
      setError('Enter actual likes');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/monitor/outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: creator.id,
          post_url: postUrl.trim() || undefined,
          predicted_er: baselineEr,
          predicted_likes: predictedLikes,
          predicted_views: n(creator.avg_views) ?? Math.round(followers * 1.2),
          actual_likes: Number(likes),
          actual_comments: comments ? Number(comments) : undefined,
          actual_views: views ? Number(views) : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? 'Record failed');
      } else {
        setPostUrl('');
        setLikes('');
        setComments('');
        setViews('');
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Predicted vs. real" full>
      <PvRChart outcomes={outcomes} />

      <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
        <LabeledInput label="Post URL" value={postUrl} onChange={setPostUrl} placeholder="optional" />
        <LabeledInput label="Actual likes" value={likes} onChange={setLikes} placeholder="0" />
        <LabeledInput label="Comments" value={comments} onChange={setComments} placeholder="0" />
        <LabeledInput label="Views" value={views} onChange={setViews} placeholder="0" />
        <button
          onClick={record}
          disabled={busy}
          className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50 h-[38px]"
        >
          {busy ? 'Saving…' : 'Record'}
        </button>
      </div>
      <div className="mt-1 text-[12px] text-ink-400">
        Prediction snapshot used: {fmt(predictedLikes)} likes (baseline ER {(baselineEr * 100).toFixed(2)}%)
      </div>
      {error && <div className="mt-2 text-sm text-rose-700">{error}</div>}
    </Card>
  );
}

function PvRChart({ outcomes }: { outcomes: Outcome[] }) {
  if (outcomes.length === 0) {
    return (
      <div className="text-sm text-ink-400 py-10 text-center border border-dashed border-border rounded-lg">
        No recorded posts yet. Record an actual result below to start the predicted-vs-real chart.
      </div>
    );
  }
  const W = 640;
  const H = 200;
  const pad = { l: 40, r: 12, t: 12, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const maxVal = Math.max(
    1,
    ...outcomes.flatMap((o) => [o.predicted_likes ?? 0, o.actual_likes ?? 0]),
  );
  const groupW = innerW / outcomes.length;
  const barW = Math.min(22, groupW / 3);
  const y = (v: number) => pad.t + innerH - (v / maxVal) * innerH;

  return (
    <div>
      <div className="flex items-center gap-4 mb-2 text-[12px] text-ink-600">
        <Legend color="#111111" label="Predicted likes" />
        <Legend color="#10b981" label="Actual likes" />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* y gridlines */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={pad.t + innerH * (1 - f)}
              y2={pad.t + innerH * (1 - f)}
              stroke="#e5e5e5"
              strokeWidth={1}
            />
            <text x={4} y={pad.t + innerH * (1 - f) + 4} fontSize={10} fill="#999">
              {fmt(Math.round(maxVal * f))}
            </text>
          </g>
        ))}
        {outcomes.map((o, i) => {
          const gx = pad.l + i * groupW + groupW / 2;
          const p = o.predicted_likes ?? 0;
          const a = o.actual_likes ?? 0;
          return (
            <g key={o.id}>
              <rect x={gx - barW - 1} y={y(p)} width={barW} height={pad.t + innerH - y(p)} fill="#111111" rx={2} />
              <rect x={gx + 1} y={y(a)} width={barW} height={pad.t + innerH - y(a)} fill="#10b981" rx={2} />
              <text x={gx} y={H - 10} fontSize={10} fill="#999" textAnchor="middle">
                #{i + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// --- small presentational helpers --------------------------------------
function Card({ title, children, full }: { title: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`p-5 rounded-xl bg-surface border border-border ${full ? 'lg:col-span-2' : ''}`}>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-3">{title}</div>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tabular-nums text-ink-900">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-wider text-ink-400">{k}: </span>
      <span className="text-ink-900">{v}</span>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-ink-400">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-2 py-2 border border-border bg-canvas text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900"
      />
    </label>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function fmt(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}
