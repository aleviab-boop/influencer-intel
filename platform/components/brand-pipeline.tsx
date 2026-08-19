'use client';

// ============================================================
// Brand pipeline UI — the agency-owned creator funnel for one brand.
//
// Two exports that share ONE hook instance (lifted to the page) so the
// "Saved ✓" buttons on creator cards and the funnel panel never drift:
//   - SaveCreatorButton: a compact save/saved toggle for any creator card.
//   - BrandPipelinePanel: the funnel — creators grouped by outreach stage,
//     with stage advancement and removal.
// Signed-out users see a nudge to create an agency account (the whole point:
// saving is a reason to hold an account).
// ============================================================

import { useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import {
  PIPELINE_STATUSES,
  type PipelineStatus,
  type PipelineItem,
  type SaveCreatorInput,
} from '@/lib/use-brand-pipeline';

interface PipelineApi {
  items: PipelineItem[];
  loading: boolean;
  needsAuth: boolean;
  has: (handle: string) => boolean;
  save: (input: SaveCreatorInput) => Promise<boolean>;
  updateStatus: (handle: string, status: PipelineStatus) => Promise<boolean>;
  updateNote: (handle: string, note: string) => Promise<boolean>;
  remove: (handle: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const STATUS_LABEL: Record<PipelineStatus, string> = {
  saved: 'Saved',
  contacted: 'Contacted',
  replied: 'Replied',
  negotiating: 'Negotiating',
  won: 'Won',
  passed: 'Passed',
};

const STATUS_COLOR: Record<PipelineStatus, string> = {
  saved: '#6C4DF6',
  contacted: '#0891b2',
  replied: '#0d9488',
  negotiating: '#d97706',
  won: '#16a34a',
  passed: '#9ca3af',
};

const fmt = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

const snapStr = (s: Record<string, unknown> | null, k: string): string =>
  s && typeof s[k] === 'string' ? (s[k] as string) : '';
const snapNum = (s: Record<string, unknown> | null, k: string): number =>
  s && Number.isFinite(Number(s[k])) ? Number(s[k]) : 0;

// ---- Save / Saved toggle for a creator card ------------------------------

export function SaveCreatorButton({
  pipeline,
  creator,
  compact = false,
}: {
  pipeline: PipelineApi;
  creator: { username: string; full_name?: string; followers?: number; engagement?: number; profile_pic_url?: string | null; creator_id?: string | null };
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const saved = pipeline.has(creator.username);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (saved) {
        await pipeline.remove(creator.username);
      } else {
        await pipeline.save({
          handle: creator.username,
          creator_id: creator.creator_id ?? null,
          snapshot: {
            name: creator.full_name || creator.username,
            followers: creator.followers ?? 0,
            engagement: creator.engagement ?? 0,
            profile_pic_url: creator.profile_pic_url ?? null,
          },
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={saved ? 'Remove from pipeline' : 'Save to pipeline'}
      className={`shrink-0 rounded-lg font-semibold transition-colors disabled:opacity-50 ${compact ? 'text-[11px] px-2 py-1' : 'text-[12px] px-2.5 py-1.5'}`}
      style={
        saved
          ? { background: ACCENT_SOFT, color: ACCENT }
          : { background: 'white', color: '#6b7280', border: '1px solid #e5e7eb' }
      }
    >
      {saved ? 'Saved ✓' : '+ Save'}
    </button>
  );
}

// ---- The funnel panel ----------------------------------------------------

export function BrandPipelinePanel({ pipeline, brand }: { pipeline: PipelineApi; brand: string }) {
  if (pipeline.needsAuth) {
    return (
      <div className="rounded-2xl border border-border bg-white p-6 text-center">
        <h3 className="text-[15px] font-bold text-ink-900">Save creators to your pipeline</h3>
        <p className="mt-1.5 text-[13px] text-ink-500 max-w-md mx-auto">
          Create a free agency account to build a persistent, owned funnel for {brand} — track outreach from saved to won.
        </p>
        <a
          href="/agency/login"
          className="inline-block mt-4 px-4 py-2 rounded-xl text-white text-[13px] font-semibold"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
        >
          Create agency account →
        </a>
      </div>
    );
  }

  const { items } = pipeline;
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-white/60 p-6 text-center">
        <p className="text-[13.5px] text-ink-500">
          No creators saved for {brand} yet. Tap <span className="font-semibold text-ink-700">+ Save</span> on any creator to start your pipeline.
        </p>
      </div>
    );
  }

  // Group by stage, in funnel order.
  const byStatus = new Map<PipelineStatus, PipelineItem[]>();
  for (const st of PIPELINE_STATUSES) byStatus.set(st, []);
  for (const it of items) byStatus.get(it.status)?.push(it);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {PIPELINE_STATUSES.map((st) => {
          const n = byStatus.get(st)?.length ?? 0;
          if (n === 0) return null;
          return (
            <span key={st} className="text-[11.5px] px-2.5 py-1 rounded-full font-semibold" style={{ background: `${STATUS_COLOR[st]}14`, color: STATUS_COLOR[st] }}>
              {STATUS_LABEL[st]} · {n}
            </span>
          );
        })}
      </div>

      <div className="space-y-2.5">
        {items.map((it) => (
          <PipelineRow key={it.id} item={it} pipeline={pipeline} />
        ))}
      </div>
    </div>
  );
}

function PipelineRow({ item, pipeline }: { item: PipelineItem; pipeline: PipelineApi }) {
  const [busy, setBusy] = useState(false);
  const name = snapStr(item.snapshot, 'name') || item.handle;
  const followers = snapNum(item.snapshot, 'followers');
  const engagement = snapNum(item.snapshot, 'engagement');
  const pic = snapStr(item.snapshot, 'profile_pic_url');

  async function change(status: PipelineStatus) {
    if (busy || status === item.status) return;
    setBusy(true);
    try {
      await pipeline.updateStatus(item.handle, status);
    } finally {
      setBusy(false);
    }
  }
  async function drop() {
    if (busy) return;
    setBusy(true);
    try {
      await pipeline.remove(item.handle);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white border border-border px-3 py-2.5">
      <div className="w-9 h-9 rounded-full bg-ink-100 grid place-items-center text-[13px] font-semibold text-ink-500 overflow-hidden shrink-0">
        {pic ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pic} alt="" className="w-full h-full object-cover" />
        ) : (
          item.handle.slice(0, 1).toUpperCase()
        )}
      </div>
      <a
        href={`https://instagram.com/${item.handle}`}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1"
      >
        <div className="text-[13.5px] font-semibold text-ink-900 truncate">{name}</div>
        <div className="text-[11.5px] text-ink-500">
          @{item.handle}
          {followers ? ` · ${fmt(followers)} followers` : ''}
          {engagement ? ` · ${engagement.toFixed(1)}% ER` : ''}
        </div>
      </a>

      <select
        value={item.status}
        onChange={(e) => void change(e.target.value as PipelineStatus)}
        disabled={busy}
        className="text-[12px] font-semibold rounded-lg border border-border bg-white px-2 py-1.5 disabled:opacity-50 cursor-pointer"
        style={{ color: STATUS_COLOR[item.status] }}
      >
        {PIPELINE_STATUSES.map((st) => (
          <option key={st} value={st} style={{ color: '#111' }}>
            {STATUS_LABEL[st]}
          </option>
        ))}
      </select>

      <button
        onClick={() => void drop()}
        disabled={busy}
        title="Remove"
        className="shrink-0 text-ink-300 hover:text-rose-500 text-[16px] leading-none px-1 disabled:opacity-50"
      >
        ×
      </button>
    </div>
  );
}
