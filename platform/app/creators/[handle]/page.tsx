'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import type { Creator, ShortlistCreatorView } from '@influencer-intel/shared/types';
import { CreatorCard } from '@/components/creator-card';

interface SimilarCreator {
  id: string;
  handle: string;
  display_name: string | null;
  follower_count: number | string | null;
  primary_category: string | null;
  is_verified: boolean | null;
  similarity: number;
}

export default function CreatorDetailPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<SimilarCreator[]>([]);

  useEffect(() => {
    fetch(`/api/creators/${encodeURIComponent(handle)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Not found');
        return r.json();
      })
      .then((d) => setCreator(d.creator))
      .catch((e) => setError(e.message));
    fetch(`/api/creators/${encodeURIComponent(handle)}/similar?limit=12`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setSimilar(d.similar ?? []))
      .catch(() => {});
  }, [handle]);

  return (
    <main className="min-h-screen bg-canvas">
      <AppHeader />
      <section className="max-w-6xl mx-auto px-6 pt-8 pb-16">
        <Link
          href="/creators"
          className="text-sm text-ink-600 hover:text-ink-900 inline-flex items-center gap-1.5 mb-6"
        >
          <span>←</span> All creators
        </Link>

        {error && (
          <div className="rounded-[14px] border border-danger/30 bg-surface p-6 text-danger">
            {error}
          </div>
        )}

        {!creator && !error && (
          <div className="text-ink-400 py-10 text-center">Loading…</div>
        )}

        {creator && <CreatorCard creator={creatorToView(creator)} />}

        {similar.length > 0 && (
          <div className="mt-10">
            <h2 className="text-base font-medium text-ink-900 mb-3">
              Similar creators
              <span className="text-ink-400 font-normal ml-2 text-sm">
                · vector-similarity to @{handle}
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {similar.map((s) => (
                <Link
                  key={s.id}
                  href={`/creators/${encodeURIComponent(s.handle)}`}
                  className="rounded-[14px] border border-border bg-surface p-4 hover:border-ink-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium text-ink-900 truncate">@{s.handle}</span>
                      {s.is_verified && <span title="Verified" className="text-[10px] text-blue-500">●</span>}
                    </div>
                    <span className="text-[11px] text-ink-400 tabular-nums shrink-0">
                      {Math.round(s.similarity * 100)}%
                    </span>
                  </div>
                  {s.display_name && (
                    <div className="text-[12px] text-ink-600 truncate mb-2">{s.display_name}</div>
                  )}
                  <div className="flex items-center gap-2 text-[12px] text-ink-600">
                    <span className="font-medium text-ink-900 tabular-nums">
                      {fmtFollowers(s.follower_count)}
                    </span>
                    <span className="text-ink-400">followers</span>
                    {s.primary_category && (
                      <>
                        <span className="text-ink-300">·</span>
                        <span>{s.primary_category}</span>
                      </>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function fmtFollowers(v: number | string | null | undefined): string {
  const n = typeof v === 'number' ? v : v ? Number(v) : NaN;
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function creatorToView(c: Creator): ShortlistCreatorView {
  return {
    brief_creator_id: c.id, // dummy — we're not in a brief context
    creator: {
      id: c.id,
      handle: c.handle,
      platform: c.platform,
      display_name: c.display_name,
      profile_photo_url: c.profile_photo_url,
      follower_count: c.follower_count,
      following_count: c.following_count,
      posts_count: c.posts_count,
      engagement_rate: c.engagement_rate,
      primary_city: c.primary_city,
      primary_category: c.primary_category,
      content_languages: c.content_languages,
      data_tier: c.data_tier,
      is_verified: c.is_verified,
      is_indian: c.is_indian,
      bio: c.bio,
    },
    match_score: 0,
    rank: 0,
    reasoning: 'Direct lookup — not ranked against any brief.',
    freshness: 'fresh',
    raw_metadata: c.raw_metadata,
    credibility: c.credibility
      ? {
          overall_score: c.credibility.overall_score,
          badge: c.credibility.badge,
          signals: c.credibility.signals,
          flags: c.credibility.flags,
        }
      : undefined,
    audience: c.audience_demographics
      ? {
          confidence: c.audience_demographics.confidence,
          gender_female_pct: c.audience_demographics.gender.female_pct,
          top_cities: c.audience_demographics.top_cities,
        }
      : undefined,
  };
}
