'use client';

// REVIEWER-FACING POST-CONNECT LANDING.
//
// This is the page the Instagram OAuth callback lands a just-connected creator
// on (flow=creator). It exists specifically to make the Meta App Review
// screencast unambiguous: after the reviewer completes the Instagram login and
// grants the two permissions, they arrive here and immediately see BOTH
// permissions exercised end-to-end, each block explicitly labelled with the
// permission that supplies it:
//
//   • instagram_business_basic          → profile identity + follower/media counts
//   • instagram_business_manage_insights → reach, plays/views, saves, engagement,
//                                          and audience demographics
//
// It polls /api/creator/analytics until the live Graph-API pull is ready, showing
// a "syncing your live insights" state in the meantime — so a reviewer landing
// seconds after granting never sees zeros or an empty state (the exact thing that
// reads as "screencast not aligned with use case").

import { Suspense, useEffect, useRef, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { PageDoodles } from '@/components/page-doodles';

interface Analytics {
  connected: boolean;
  source?: 'live' | 'synced' | 'db';
  reason?: string;
  account?: { ig_username: string; connected_at: string };
  profile?: {
    username: string; name: string | null; biography: string | null;
    followers_count: number | null; follows_count: number | null;
    media_count: number | null; profile_picture_url: string | null;
  };
  stats?: {
    posts_analyzed: number;
    avg_likes: number | null; avg_comments: number | null; avg_er: number | null;
    avg_reel_plays: number | null; avg_reach: number | null;
  };
  demographics?: {
    gender_age: Record<string, number>;
    cities: Record<string, number>;
    countries: Record<string, number>;
  } | null;
}

const fmt = (v: number | null | undefined): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
};
const pct = (v: number | null | undefined): string => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? (n * 100).toFixed(2) + '%' : '—';
};

const ACCENT = '#8134AF';

export default function ConnectedPage() {
  return (
    <Suspense fallback={null}>
      <ConnectedContent />
    </Suspense>
  );
}

function ConnectedContent() {
  const [data, setData] = useState<Analytics | null>(null);
  const [phase, setPhase] = useState<'syncing' | 'ready' | 'partial'>('syncing');
  const tries = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = new URLSearchParams();
    const account = params.get('account');
    const handle = params.get('handle');
    if (account) q.set('account', account);
    else if (handle) q.set('handle', handle);
    const qs = q.toString() ? `?${q}` : '';

    let stopped = false;
    const MAX_TRIES = 15; // ~45s of polling before we render whatever we have.

    const hasInsights = (d: Analytics): boolean =>
      d.stats?.avg_reach != null ||
      d.stats?.avg_reel_plays != null ||
      (d.demographics != null &&
        (Object.keys(d.demographics.gender_age || {}).length > 0 ||
          Object.keys(d.demographics.cities || {}).length > 0));

    const poll = async () => {
      if (stopped) return;
      tries.current += 1;
      try {
        const d: Analytics = await fetch(`/api/creator/analytics${qs}`).then((r) => r.json());
        if (stopped) return;
        setData(d);
        if (d.connected && hasInsights(d)) {
          setPhase('ready');
          return; // rich insights arrived — stop polling.
        }
        if (tries.current >= MAX_TRIES) {
          // Connected, but the insights sync is still catching up. Render what we
          // have (profile + any available metrics) rather than spinning forever.
          setPhase(d.connected ? 'partial' : 'partial');
          return;
        }
      } catch {
        if (tries.current >= MAX_TRIES) { setPhase('partial'); return; }
      }
      if (!stopped) setTimeout(poll, 3000);
    };
    void poll();
    return () => { stopped = true; };
  }, []);

  const profile = data?.profile;
  const stats = data?.stats;
  const demo = data?.demographics;
  const username = profile?.username || data?.account?.ig_username || '';

  return (
    <div className="relative isolate overflow-hidden min-h-screen bg-canvas">
      <PageDoodles className="-z-10" />
      <AppHeader />
      <main className="max-w-3xl mx-auto px-6 py-10">
        {/* Connected confirmation banner */}
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-emerald-900">
              Instagram account connected{username ? <> — @{username}</> : ''}
            </div>
            <p className="text-[12.5px] text-emerald-700/90">
              You granted <span className="font-mono">instagram_business_basic</span> and{' '}
              <span className="font-mono">instagram_business_manage_insights</span>. Your live data is shown below.
            </p>
          </div>
        </div>

        {/* Syncing state — shown until the live insight pull is ready, so the
            screen is never empty / zeroed while data loads. */}
        {phase === 'syncing' && (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4 text-[13.5px] text-ink-600">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-ink-200 border-t-transparent animate-spin" />
            Syncing your live Instagram insights (reach, plays, saves, demographics)…
          </div>
        )}

        {phase === 'partial' && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13px] text-amber-800">
            Your account is connected. Some insights are still syncing from Instagram and will appear on your{' '}
            <a href={`/creator${username ? `?handle=${encodeURIComponent(username)}` : ''}`} className="underline underline-offset-2">dashboard</a>{' '}
            shortly.
          </div>
        )}

        {/* SECTION A — instagram_business_basic */}
        <PermissionSection
          title="Profile"
          perm="instagram_business_basic"
          caption="Read from your account to identify you and build your dashboard and media kit: username, name, and follower / following / media counts."
        >
          <div className="flex items-center gap-4">
            {profile?.profile_picture_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.profile_picture_url} alt={username} className="h-16 w-16 rounded-full object-cover border border-border" />
            ) : (
              <div className="h-16 w-16 rounded-full bg-surface border border-border" />
            )}
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-ink-900 truncate">{profile?.name || (username ? `@${username}` : '—')}</div>
              {username && <div className="text-[13px] text-ink-500">@{username}</div>}
              {profile?.biography && <div className="mt-1 text-[12.5px] text-ink-500 line-clamp-2">{profile.biography}</div>}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="Followers" value={fmt(profile?.followers_count)} hint="Total accounts following you" />
            <Stat label="Following" value={fmt(profile?.follows_count)} hint="Accounts you follow" />
            <Stat label="Posts" value={fmt(profile?.media_count)} hint="Total media on your account" />
          </div>
        </PermissionSection>

        {/* SECTION B — instagram_business_manage_insights */}
        <PermissionSection
          title="Insights"
          perm="instagram_business_manage_insights"
          caption="Read insights for your own account and posts to power your analytics and let you share verified performance with brands: reach, plays / views, saves, engagement, and audience demographics."
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Avg reach" value={fmt(stats?.avg_reach)} hint="Average accounts reached per post" />
            <Stat label="Avg reel plays" value={fmt(stats?.avg_reel_plays)} hint="Average plays per reel" />
            <Stat label="Avg engagement" value={pct(stats?.avg_er)} hint="Average engagement rate per post" />
            <Stat label="Posts analysed" value={fmt(stats?.posts_analyzed)} hint="Recent posts included in these numbers" />
          </div>

          {/* Audience demographics — insights-only data */}
          {demo && (Object.keys(demo.gender_age || {}).length > 0 || Object.keys(demo.cities || {}).length > 0) && (
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
              {Object.keys(demo.gender_age || {}).length > 0 && (
                <Breakdown title="Audience by gender & age" data={demo.gender_age} />
              )}
              {Object.keys(demo.cities || {}).length > 0 && (
                <Breakdown title="Top cities" data={demo.cities} />
              )}
            </div>
          )}
        </PermissionSection>

        <div className="mt-8 flex items-center gap-3">
          <a href={`/creator/analytics-preview${username ? `?handle=${encodeURIComponent(username)}` : ''}`}
            className="px-5 py-2.5 text-sm font-medium text-white rounded-lg" style={{ background: ACCENT }}>
            Open full analytics
          </a>
          <a href={`/creator${username ? `?handle=${encodeURIComponent(username)}` : ''}`}
            className="px-5 py-2.5 text-sm font-medium text-ink-900 border border-border rounded-lg hover:bg-surface">
            Go to dashboard
          </a>
        </div>

        <p className="mt-6 text-[12px] text-ink-400">
          Read-only, and only your own account. We never post, and never read or send comments or DMs. You can
          disconnect anytime from your dashboard or Instagram → Settings → Apps and websites.{' '}
          <a href="/privacy" className="underline underline-offset-2">Privacy</a>{' · '}
          <a href="/data-deletion" className="underline underline-offset-2">Data deletion</a>
        </p>
      </main>
    </div>
  );
}

function PermissionSection({
  title, perm, caption, children,
}: { title: string; perm: string; caption: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 p-5 rounded-2xl bg-surface border border-border">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        <span className="font-mono text-[11px] px-2 py-0.5 rounded-md border border-border text-ink-500 bg-canvas">{perm}</span>
      </div>
      <p className="text-[12.5px] text-ink-500 mb-4">{caption}</p>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-canvas border border-border px-3 py-3" title={hint}>
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = rows.length > 0 ? Math.max(...rows.map((r) => r[1])) : 0;
  return (
    <div>
      <div className="text-[12px] font-medium text-ink-700 mb-2">{title}</div>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[12px] text-ink-600 truncate" title={k}>{k}</span>
            <span className="flex-1 h-2 rounded-full bg-canvas overflow-hidden border border-border">
              <span className="block h-full rounded-full" style={{ width: max > 0 ? `${(v / max) * 100}%` : '0%', background: ACCENT }} />
            </span>
            <span className="w-10 shrink-0 text-right text-[11px] text-ink-500">{fmt(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
