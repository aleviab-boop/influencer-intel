'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';

interface CreatorRow {
  id: string;
  handle: string;
  display_name: string | null;
  profile_photo_url: string | null;
  follower_count: number | string | null;
  engagement_rate: number | string | null;
  avg_likes: number | string | null;
  avg_comments: number | string | null;
  avg_views: number | string | null;
  primary_category: string | null;
  primary_city: string | null;
  primary_state: string | null;
  is_verified: boolean | null;
  bio: string | null;
  cred_score: string | null;
  cred_badge: string | null;
  vision_niche: string | null;
  vibe_tags: string[] | null;
  last_scraped_at: string | null;
}

type Tier = '' | 'mega' | 'macro' | 'micro' | 'nano';
type Sort = 'followers' | 'recent' | 'credibility';

export default function CreatorsPage() {
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [tier, setTier] = useState<Tier>('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('followers');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (location.trim()) params.set('location', location.trim());
    if (category) params.set('category', category);
    if (tier) params.set('tier', tier);
    if (verifiedOnly) params.set('verified', '1');
    params.set('sort', sort);
    params.set('limit', '60');

    const ctrl = new AbortController();
    fetch(`/api/creators?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        setCreators(d.creators ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [q, location, category, tier, verifiedOnly, sort]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    creators.forEach((c) => c.primary_category && set.add(c.primary_category));
    return Array.from(set).sort();
  }, [creators]);

  return (
    <main className="min-h-screen bg-white">
      <AppHeader />

      <section className="max-w-5xl mx-auto px-6 pt-10 pb-4">
        <h1 className="text-2xl font-light text-[#111] mb-1">Discover</h1>
        <p className="text-[13px] text-[#999]">
          {total.toLocaleString()} creators
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by handle or name"
            className="flex-1 px-4 py-2.5 border border-[#e5e5e5] text-[14px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#111] transition-colors"
          />
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or state"
            className="w-48 px-4 py-2.5 border border-[#e5e5e5] text-[14px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#111] transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Pill active={!tier} onClick={() => setTier('')}>All</Pill>
          <Pill active={tier === 'mega'} onClick={() => setTier('mega')}>1M+</Pill>
          <Pill active={tier === 'macro'} onClick={() => setTier('macro')}>100K+</Pill>
          <Pill active={tier === 'micro'} onClick={() => setTier('micro')}>10K+</Pill>
          <Pill active={tier === 'nano'} onClick={() => setTier('nano')}>5K+</Pill>
          <span className="w-px h-4 bg-[#e5e5e5] mx-1" />
          <Pill active={verifiedOnly} onClick={() => setVerifiedOnly((v) => !v)}>Verified</Pill>
          <span className="ml-auto" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="px-3 py-1.5 border border-[#e5e5e5] text-[13px] text-[#6b6b6b] bg-white focus:outline-none focus:border-[#111]"
          >
            <option value="followers">Followers</option>
            <option value="recent">Recent</option>
            <option value="credibility">Credibility</option>
          </select>
        </div>

        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Pill active={!category} onClick={() => setCategory('')}>Any</Pill>
            {categories.map((c) => (
              <Pill key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Pill>
            ))}
          </div>
        )}
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-16">
        {loading ? (
          <div className="text-[#ccc] text-sm py-10 text-center">Loading...</div>
        ) : creators.length === 0 ? (
          <div className="border border-[#e5e5e5] p-10 text-center text-[#999] text-sm">
            No creators match these filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-[#e5e5e5] border border-[#e5e5e5]">
            {creators.map((c) => (
              <CreatorTile key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[12px] tracking-wide transition-colors ${
        active
          ? 'bg-[#111] text-white'
          : 'bg-white border border-[#e5e5e5] text-[#999] hover:text-[#111] hover:border-[#ccc]'
      }`}
    >
      {children}
    </button>
  );
}

function CreatorTile({ c }: { c: CreatorRow }) {
  const followers = Number(c.follower_count ?? 0);
  const er = c.engagement_rate != null ? Number(c.engagement_rate) : null;
  const avgViews = c.avg_views != null ? Number(c.avg_views) : null;

  return (
    <Link
      href={`/insights/${encodeURIComponent(c.handle)}`}
      className="bg-white p-5 hover:bg-[#fafafa] transition-colors block group"
    >
      <div className="flex items-start gap-3 mb-3">
        <Avatar src={c.profile_photo_url} handle={c.handle} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-medium text-[#111] truncate">@{c.handle}</span>
            {c.is_verified && <VerifiedDot />}
          </div>
          {c.display_name && <div className="text-[12px] text-[#999] truncate">{c.display_name}</div>}
        </div>
        {c.cred_score && (
          <span className="text-[11px] tabular-nums text-[#999]">{c.cred_score}</span>
        )}
      </div>

      <div className="flex items-baseline gap-4 text-[13px] mb-2">
        <span className="text-[#111] tabular-nums">{formatK(followers)}</span>
        {er != null && <span className="text-[#999] tabular-nums">{(er * 100).toFixed(1)}% ER</span>}
        {avgViews != null && <span className="text-[#ccc] tabular-nums">{formatK(avgViews)} views</span>}
      </div>

      {c.bio && <p className="text-[12px] text-[#999] line-clamp-1 mb-2">{c.bio}</p>}

      <div className="flex items-center gap-1.5">
        {c.primary_category && (
          <span className="text-[11px] text-[#999] uppercase tracking-[0.06em]">{c.primary_category}</span>
        )}
        {c.primary_city && (
          <span className="text-[11px] text-[#ccc]">{c.primary_city}</span>
        )}
        {!c.last_scraped_at && (
          <span className="text-[10px] text-[#cc8800] tracking-wide">PENDING</span>
        )}
        <span className="ml-auto text-[11px] text-[#ccc] opacity-0 group-hover:opacity-100 transition-opacity">
          View &rarr;
        </span>
      </div>
    </Link>
  );
}

function Avatar({ src, handle }: { src: string | null; handle: string }) {
  const [error, setError] = useState(false);
  if (src && !error) {
    return (
      <img
        src={src}
        alt={handle}
        referrerPolicy="no-referrer"
        onError={() => setError(true)}
        className="w-9 h-9 rounded-full object-cover grayscale"
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-[#f0f0f0] flex items-center justify-center text-[#999] text-[12px] font-medium shrink-0">
      {handle[0]?.toUpperCase()}
    </div>
  );
}

function VerifiedDot() {
  return <span className="w-1.5 h-1.5 rounded-full bg-[#111] shrink-0" title="Verified" />;
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
