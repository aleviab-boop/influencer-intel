'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import type { ShortlistCreatorView } from '@influencer-intel/shared/types';

interface BriefResp {
  brief: { id: string; raw_text: string };
  creators: ShortlistCreatorView[];
}

const FIELD_GROUPS: Array<{ label: string; fields: Array<{ key: string; label: string; format?: (c: ShortlistCreatorView) => React.ReactNode }> }> = [
  {
    label: 'Identity',
    fields: [
      { key: 'handle', label: 'Handle', format: (c) => `@${c.creator.handle}` },
      { key: 'display_name', label: 'Display name', format: (c) => c.creator.display_name ?? '—' },
      { key: 'verified', label: 'Verified', format: (c) => c.creator.is_verified ? '✓' : '—' },
      { key: 'rank', label: 'Match rank', format: (c) => `#${c.rank} (${c.match_score}%)` },
    ],
  },
  {
    label: 'Reach',
    fields: [
      { key: 'followers', label: 'Followers', format: (c) => fmt(c.creator.follower_count) },
      { key: 'following', label: 'Following', format: (c) => fmt(c.creator.following_count) },
      { key: 'posts', label: 'Posts', format: (c) => fmt(c.creator.posts_count) },
    ],
  },
  {
    label: 'Content',
    fields: [
      { key: 'category', label: 'Category', format: (c) => c.creator.primary_category ?? '—' },
      {
        key: 'niche',
        label: 'Niche',
        format: (c) => {
          const v = (c.raw_metadata as { vision?: { niche?: string } } | undefined)?.vision;
          return v?.niche ?? '—';
        },
      },
      {
        key: 'themes',
        label: 'Content themes',
        format: (c) => {
          const v = (c.raw_metadata as { vision?: { content_themes?: string[] } } | undefined)?.vision;
          return (v?.content_themes ?? []).join(', ') || '—';
        },
      },
      {
        key: 'vibe',
        label: 'Vibe',
        format: (c) => {
          const v = (c.raw_metadata as { vision?: { vibe_tags?: string[] } } | undefined)?.vision;
          return (v?.vibe_tags ?? []).join(', ') || '—';
        },
      },
      { key: 'languages', label: 'Languages', format: (c) => (c.creator.content_languages ?? []).join('/') || '—' },
    ],
  },
  {
    label: 'Trust',
    fields: [
      {
        key: 'cred',
        label: 'Credibility',
        format: (c) => c.credibility ? `${c.credibility.overall_score} (${c.credibility.badge})` : '—',
      },
      {
        key: 'visual_quality',
        label: 'Visual quality',
        format: (c) => {
          const v = (c.raw_metadata as { vision?: { visual_quality_score?: number } } | undefined)?.vision;
          return v?.visual_quality_score ?? '—';
        },
      },
      {
        key: 'paid_partnership',
        label: 'Paid partnerships visible',
        format: (c) => {
          const v = (c.raw_metadata as { vision?: { has_paid_partnership?: boolean } } | undefined)?.vision;
          return v?.has_paid_partnership === true ? '✓' : v?.has_paid_partnership === false ? '—' : '?';
        },
      },
    ],
  },
];

export default function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: briefId } = use(params);
  const [data, setData] = useState<BriefResp | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/briefs/${briefId}`).then((r) => r.json()).then(setData).catch(() => {});
  }, [briefId]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });

  const compare = data?.creators.filter((c) => selected.has(c.brief_creator_id)) ?? [];

  return (
    <main className="min-h-screen bg-canvas">
      <AppHeader />

      <section className="max-w-7xl mx-auto px-6 pt-8 pb-4">
        <Link
          href={`/shortlist/${briefId}`}
          className="text-sm text-ink-600 hover:text-ink-900 inline-flex items-center gap-1.5 mb-4"
        >
          <span>←</span> Shortlist
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900 mb-1">
          Compare creators
        </h1>
        <p className="text-ink-600 text-body">
          Pick up to 5 to view side-by-side. {selected.size} selected.
        </p>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-4">
        <div className="rounded-[14px] border border-border bg-surface p-3 max-h-72 overflow-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1">
            {(data?.creators ?? []).map((c) => (
              <label
                key={c.brief_creator_id}
                className="flex items-center gap-2 px-3 py-2 rounded-[8px] hover:bg-canvas cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.brief_creator_id)}
                  onChange={() => toggle(c.brief_creator_id)}
                  disabled={!selected.has(c.brief_creator_id) && selected.size >= 5}
                  className="accent-ink-900"
                />
                <span className="text-[12px] text-ink-400 tabular-nums w-5">{c.rank}</span>
                <span className="text-sm text-ink-900 truncate">@{c.creator.handle}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      {compare.length === 0 ? (
        <section className="max-w-7xl mx-auto px-6 pb-16">
          <div className="rounded-[14px] border border-border bg-surface p-10 text-center text-ink-600">
            Select 2-5 creators above to compare them side-by-side.
          </div>
        </section>
      ) : (
        <section className="max-w-7xl mx-auto px-6 pb-16 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface">
                <th className="text-left text-[11px] uppercase tracking-wider text-ink-400 px-3 py-2 border border-border w-40">
                  Field
                </th>
                {compare.map((c) => (
                  <th
                    key={c.brief_creator_id}
                    className="text-left text-sm text-ink-900 px-3 py-2 border border-border min-w-[180px]"
                  >
                    @{c.creator.handle}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIELD_GROUPS.map((group) => (
                <>
                  <tr key={group.label} className="bg-canvas">
                    <td
                      colSpan={compare.length + 1}
                      className="text-[11px] uppercase tracking-wider text-ink-600 px-3 py-1.5 border border-border font-medium"
                    >
                      {group.label}
                    </td>
                  </tr>
                  {group.fields.map((f) => (
                    <tr key={f.key}>
                      <td className="text-sm text-ink-600 px-3 py-2 border border-border">{f.label}</td>
                      {compare.map((c) => (
                        <td
                          key={c.brief_creator_id}
                          className="text-sm text-ink-900 px-3 py-2 border border-border align-top"
                        >
                          {f.format ? f.format(c) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function fmt(v: unknown): string {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
