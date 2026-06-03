'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';

interface SessionState {
  authenticated: boolean;
  email?: string;
  brand_name?: string;
  ig_handle?: string;
}

interface CreatorSnapshot {
  follower_count: number | null;
  engagement_rate: number | string | null;
  avg_views: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  display_name: string | null;
  profile_photo_url: string | null;
  primary_category: string | null;
}

export default function Home() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [creatorTotal, setCreatorTotal] = useState<number | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [brandSnapshot, setBrandSnapshot] = useState<CreatorSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth')
      .then((r) => r.json())
      .then((d) => setSession(d))
      .catch(() => setSession({ authenticated: false }));
  }, []);

  useEffect(() => {
    fetch('/api/creators?limit=1')
      .then((r) => r.json())
      .then((d) => setCreatorTotal(d.total ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!session?.ig_handle) return;
    setSnapshotLoading(true);
    fetch(`/api/creators/${encodeURIComponent(session.ig_handle)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBrandSnapshot(d))
      .catch(() => {})
      .finally(() => setSnapshotLoading(false));
  }, [session?.ig_handle]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const handle = search.trim().replace('@', '');
    if (handle) router.push(`/insights/${encodeURIComponent(handle)}`);
  }

  const hasBrandDashboard = session?.authenticated && session.ig_handle;

  return (
    <main className="min-h-screen bg-white">
      <AppHeader />

      {hasBrandDashboard ? (
        <BrandDashboard
          session={session!}
          snapshot={brandSnapshot}
          loading={snapshotLoading}
          creatorTotal={creatorTotal}
        />
      ) : (
        <>
          <section className="max-w-2xl mx-auto px-6 pt-24 pb-20 text-center">
            <h1 className="text-4xl font-light text-[#111] leading-tight tracking-tight mb-4">
              Find the right creator.
              <br />
              <span className="font-medium">Predict their impact.</span>
            </h1>
            <p className="text-[#999] text-base mb-12">
              {creatorTotal?.toLocaleString() ?? '...'} Indian creators, researched and scored.
            </p>

            <form onSubmit={handleSearch} className="relative max-w-md mx-auto">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by handle"
                className="w-full px-4 py-3 border border-[#e5e5e5] text-[15px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#111] transition-colors"
              />
              <button
                type="submit"
                disabled={!search.trim()}
                className="absolute right-0 top-0 h-full px-5 bg-[#111] text-white text-[13px] tracking-wide hover:bg-[#333] disabled:opacity-20 transition-all"
              >
                Analyze
              </button>
            </form>
          </section>

          <section className="border-t border-[#f0f0f0]">
            <div className="max-w-4xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-3 gap-12">
              <Feature
                title="Discover"
                description="Browse creators by size, niche, and credibility. Every profile researched with vision AI."
                href="/creators"
              />
              <Feature
                title="Predict"
                description="Score content concepts before posting. Engagement prediction using creator history and trends."
                href="/predict"
              />
              <Feature
                title="Monitor"
                description="Track live posts at 30m, 2h, 6h, 24h checkpoints. Day-1 views predict Day-30 with 96% accuracy."
                href="/predict"
              />
            </div>
          </section>

          <section className="border-t border-[#f0f0f0]">
            <div className="max-w-4xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
              <Stat label="Creators" value={creatorTotal?.toLocaleString() ?? '---'} />
              <Stat label="Posts analyzed" value={creatorTotal ? `${Math.round(creatorTotal * 12 / 1000)}K` : '---'} />
              <Stat label="Data points" value="12 / creator" />
              <Stat label="Avg ER" value="1.8%" />
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function BrandDashboard({
  session,
  snapshot,
  loading,
  creatorTotal,
}: {
  session: SessionState;
  snapshot: CreatorSnapshot | null;
  loading: boolean;
  creatorTotal: number | null;
}) {
  const er = snapshot?.engagement_rate != null ? Number(snapshot.engagement_rate) : null;
  const followers = snapshot?.follower_count ?? null;
  const avgViews = snapshot?.avg_views ?? null;
  const avgLikes = snapshot?.avg_likes ?? null;
  const avgComments = snapshot?.avg_comments ?? null;

  return (
    <>
      <section className="max-w-4xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center gap-4 mb-6">
          {snapshot?.profile_photo_url ? (
            <img
              src={snapshot.profile_photo_url}
              alt=""
              className="w-14 h-14 rounded-full object-cover grayscale"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-[#f0f0f0] flex items-center justify-center text-[#999] text-lg font-medium">
              {session.ig_handle?.[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-light text-[#111]">
              {session.brand_name ?? 'Your Brand'}
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-[14px] text-[#999]">@{session.ig_handle}</span>
              <Link
                href={`/insights/${encodeURIComponent(session.ig_handle!)}`}
                className="text-[12px] text-[#999] hover:text-[#111] transition-colors"
              >
                Full insights &rarr;
              </Link>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-[#ccc] text-sm py-8 text-center">Loading your metrics...</div>
        ) : snapshot ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-[#e5e5e5] border border-[#e5e5e5]">
            <MetricCell label="Followers" value={followers ? formatK(followers) : '—'} />
            <MetricCell label="Eng. Rate" value={er != null ? `${(er * 100).toFixed(1)}%` : '—'} />
            <MetricCell label="Avg Views" value={avgViews ? formatK(avgViews) : '—'} />
            <MetricCell label="Avg Likes" value={avgLikes ? formatK(avgLikes) : '—'} />
            <MetricCell label="Avg Comments" value={avgComments ? formatK(avgComments) : '—'} />
            <MetricCell label="Category" value={snapshot?.primary_category ?? '—'} />
          </div>
        ) : (
          <div className="border border-[#e5e5e5] p-6 text-center">
            <p className="text-[13px] text-[#999]">
              We don&apos;t have data for @{session.ig_handle} yet.
            </p>
            <p className="text-[12px] text-[#ccc] mt-1">
              Your handle will be indexed soon, or connect your account for real-time data.
            </p>
          </div>
        )}
      </section>

      <section className="max-w-4xl mx-auto px-6 py-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-4">Quick actions</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[#e5e5e5] border border-[#e5e5e5]">
          <Link
            href={`/predict?handle=${encodeURIComponent(session.ig_handle!)}`}
            className="bg-white p-6 hover:bg-[#fafafa] transition-colors block group"
          >
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-2 group-hover:text-[#111] transition-colors">
              Predict
            </div>
            <p className="text-[14px] text-[#6b6b6b] leading-relaxed">
              Score your next reel before posting. See predicted engagement rate and optimal timing.
            </p>
          </Link>
          <Link
            href={`/predict?handle=${encodeURIComponent(session.ig_handle!)}&mode=monitor`}
            className="bg-white p-6 hover:bg-[#fafafa] transition-colors block group"
          >
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-2 group-hover:text-[#111] transition-colors">
              Monitor
            </div>
            <p className="text-[14px] text-[#6b6b6b] leading-relaxed">
              Track a live post. Get velocity readings at 30m, 2h, 6h, 24h checkpoints.
            </p>
          </Link>
          <Link
            href="/creators"
            className="bg-white p-6 hover:bg-[#fafafa] transition-colors block group"
          >
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-2 group-hover:text-[#111] transition-colors">
              Discover
            </div>
            <p className="text-[14px] text-[#6b6b6b] leading-relaxed">
              Find creators for your next campaign from {creatorTotal?.toLocaleString() ?? '...'} indexed profiles.
            </p>
          </Link>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-6 pb-16">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-4">Platform</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <Stat label="Creators indexed" value={creatorTotal?.toLocaleString() ?? '---'} />
          <Stat label="Posts analyzed" value={creatorTotal ? `${Math.round(creatorTotal * 12 / 1000)}K` : '---'} />
          <Stat label="Data points" value="12 / creator" />
          <Stat label="Avg ER" value="1.8%" />
        </div>
      </section>
    </>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc] mb-1">{label}</div>
      <div className="text-lg font-light text-[#111] tabular-nums">{value}</div>
    </div>
  );
}

function Feature({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <a href={href} className="group block">
      <h3 className="text-[11px] uppercase tracking-[0.12em] text-[#999] mb-3 group-hover:text-[#111] transition-colors">
        {title}
      </h3>
      <p className="text-[14px] text-[#6b6b6b] leading-relaxed">
        {description}
      </p>
    </a>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-[#ccc] mb-1">{label}</div>
      <div className="text-xl font-light text-[#111] tabular-nums">{value}</div>
    </div>
  );
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
