'use client';

import { Suspense, useEffect, useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { suggestRateCard } from '@/lib/media-kit';

/* -------------------------------------------------------------------------
 * Creator media kit — a shareable, brand-pitch-ready one-pager auto-built
 * from live Instagram data (via /api/creator/analytics). Print-friendly
 * (Cmd/Ctrl+P → Save as PDF). Standalone; share the URL with ?handle= or
 * ?account=. Not wired into platform nav yet.
 * ---------------------------------------------------------------------- */

interface MKPost {
  id: string; permalink: string; media_type: string;
  thumbnail_url: string | null; media_url: string | null;
  like_count: number; comments_count: number; er: number | null; plays: number | null;
}
interface MK {
  connected: boolean;
  profile?: {
    username: string; name: string | null; biography: string | null;
    followers_count: number | null; follows_count: number | null;
    media_count: number | null; profile_picture_url: string | null;
  };
  stats?: { avg_er: number | null; avg_reach: number | null; avg_reel_plays: number | null; avg_likes: number | null };
  cadence?: { posts_per_week: number | null };
  posts?: MKPost[];
  demographics?: { gender_age: Record<string, number>; cities: Record<string, number> } | null;
  audience_quality?: { available: boolean; score: number | null; grade: string | null };
}

const fmt = (v: number | null | undefined): string => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
};
const pct = (v: number | null | undefined): string => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? (n * 100).toFixed(2) + '%' : '—';
};
const money = (v: number): string => '₹' + Math.round(v).toLocaleString('en-IN');
const isReel = (t: string): boolean => t === 'VIDEO' || t === 'REELS';

export default function MediaKitPage() {
  return (
    <Suspense fallback={null}>
      <MediaKit />
    </Suspense>
  );
}

function MediaKit() {
  const [data, setData] = useState<MK | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = new URLSearchParams();
    const account = params.get('account');
    const handle = params.get('handle');
    if (account) q.set('account', account);
    else if (handle) q.set('handle', handle);
    fetch(`/api/creator/analytics${q.toString() ? `?${q}` : ''}`)
      .then((r) => r.json())
      .then((d: MK) => setData(d))
      .catch(() => setData({ connected: false }))
      .finally(() => setLoading(false));
  }, []);

  const copyLink = (): void => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f4f8] grid place-items-center text-ink-400 text-[14px]">
        <span className="inline-block h-4 w-4 mr-3 rounded-full border-2 border-ink-200 border-t-transparent animate-spin" />
        Building media kit…
      </div>
    );
  }

  if (!data?.connected || !data.profile) {
    return (
      <div className="min-h-screen bg-[#f5f4f8] grid place-items-center px-6">
        <div className="max-w-md text-center rounded-2xl bg-white border border-border shadow-card p-8">
          <div className="text-[16px] font-bold text-ink-900">Media kit not ready yet</div>
          <p className="mt-2 text-[13px] text-ink-500">
            Connect an Instagram account to generate a shareable media kit from your live stats.
          </p>
          <a href="/creator/analytics-preview" className="mt-4 inline-block text-[13px] font-semibold" style={{ color: ACCENT }}>
            ← Back to analytics
          </a>
        </div>
      </div>
    );
  }

  const { profile, stats, cadence, demographics } = data;
  const rateCard = suggestRateCard(profile.followers_count, stats?.avg_er);
  const topPosts = [...(data.posts ?? [])]
    .filter((p) => p.er != null)
    .sort((a, b) => (b.er ?? 0) - (a.er ?? 0))
    .slice(0, 4);
  const cities = Object.entries(demographics?.cities ?? {}).sort(([, a], [, b]) => b - a).slice(0, 4);
  const ageGender = Object.entries(demographics?.gender_age ?? {}).sort(([, a], [, b]) => b - a).slice(0, 4);
  const audienceTotal = (arr: [string, number][]): number => arr.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div className="min-h-screen bg-[#f5f4f8] py-8 px-4 font-sans">
      {/* Action bar — hidden when printing */}
      <div className="max-w-3xl mx-auto mb-4 flex items-center justify-between gap-3 print:hidden">
        <a href="/creator/analytics-preview" className="text-[13px] font-semibold text-ink-500 hover:text-ink-800">← Analytics</a>
        <div className="flex gap-2">
          <button onClick={copyLink}
            className="px-3.5 py-2 rounded-lg text-[13px] font-semibold border border-border bg-white text-ink-700 hover:bg-[#faf9ff] transition-colors">
            {copied ? '✓ Link copied' : 'Copy share link'}
          </button>
          <button onClick={() => window.print()}
            className="px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white hover:brightness-105 transition-all"
            style={{ background: ACCENT }}>
            Save as PDF
          </button>
        </div>
      </div>

      {/* The kit sheet */}
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-card overflow-hidden print:shadow-none print:rounded-none">
        {/* Hero */}
        <div className="p-7" style={{ background: `linear-gradient(135deg, ${ACCENT_SOFT}, #ffffff)` }}>
          <div className="flex items-center gap-5">
            {profile.profile_picture_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.profile_picture_url} alt="" className="h-20 w-20 rounded-2xl object-cover border-2 border-white shadow-card" />
            ) : (
              <div className="h-20 w-20 rounded-2xl grid place-items-center text-white text-2xl font-bold shadow-card" style={{ background: ACCENT }}>
                {profile.username?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-[22px] font-bold text-ink-900 truncate">{profile.name ?? profile.username}</div>
              <a href={`https://instagram.com/${profile.username}`} target="_blank" rel="noreferrer"
                className="text-[14px] font-semibold" style={{ color: ACCENT }}>@{profile.username}</a>
              {profile.biography && <p className="mt-1.5 text-[13px] text-ink-600 line-clamp-2 max-w-lg">{profile.biography}</p>}
            </div>
          </div>
        </div>

        {/* Key metrics band */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border border-y border-border">
          <Metric label="Followers" value={fmt(profile.followers_count)} />
          <Metric label="Avg engagement" value={pct(stats?.avg_er)} accent />
          <Metric label="Avg reach / post" value={fmt(stats?.avg_reach)} />
          <Metric label="Avg reel plays" value={fmt(stats?.avg_reel_plays)} />
        </div>

        <div className="p-7 grid md:grid-cols-2 gap-6">
          {/* Audience */}
          <div>
            <KitHeading>Audience</KitHeading>
            {data.audience_quality?.available && data.audience_quality.score != null && (
              <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-border p-2.5">
                <div className="h-9 w-9 rounded-lg grid place-items-center text-[13px] font-bold tabular-nums text-white shrink-0"
                  style={{ background: data.audience_quality.score >= 70 ? '#16a34a' : data.audience_quality.score >= 55 ? '#d97706' : '#dc2626' }}>
                  {data.audience_quality.score}
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-ink-800">Audience quality · {data.audience_quality.grade}</div>
                  <div className="text-[10.5px] text-ink-400">Estimated from engagement patterns (0–100).</div>
                </div>
              </div>
            )}
            {cities.length > 0 ? (
              <>
                <SubLabel>Top locations</SubLabel>
                <div className="space-y-2 mb-4">
                  {cities.map(([k, v]) => <Bar key={k} label={k} pctVal={Math.round((v / audienceTotal(cities)) * 100)} />)}
                </div>
              </>
            ) : null}
            {ageGender.length > 0 ? (
              <>
                <SubLabel>Age &amp; gender</SubLabel>
                <div className="space-y-2">
                  {ageGender.map(([k, v]) => (
                    <Bar key={k} label={k.replace(/^M\./, 'Male ').replace(/^F\./, 'Female ')} pctVal={Math.round((v / audienceTotal(ageGender)) * 100)} />
                  ))}
                </div>
              </>
            ) : null}
            {cities.length === 0 && ageGender.length === 0 && (
              <p className="text-[12.5px] text-ink-400">Audience demographics available once Instagram shares them (needs 100+ followers).</p>
            )}
            {cadence?.posts_per_week != null && (
              <p className="mt-4 text-[12px] text-ink-500">Posts ~<b>{cadence.posts_per_week}×</b> per week.</p>
            )}
          </div>

          {/* Suggested rates */}
          <div>
            <KitHeading>Suggested rates</KitHeading>
            {rateCard ? (
              <>
                <div className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mb-2" style={{ color: ACCENT, background: ACCENT_SOFT }}>
                  {rateCard.tier_label} creator
                </div>
                <div className="rounded-xl border border-border overflow-hidden">
                  {rateCard.items.map((it, i) => (
                    <div key={it.label} className={`flex items-center justify-between px-3.5 py-2.5 ${i > 0 ? 'border-t border-border' : ''}`}>
                      <span className="text-[13px] text-ink-700 font-medium">{it.label}</span>
                      <span className="text-[13px] font-bold text-ink-900 tabular-nums">{money(it.low)} – {money(it.high)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10.5px] text-ink-400 leading-relaxed">{rateCard.note}</p>
              </>
            ) : (
              <p className="text-[12.5px] text-ink-400">Rate suggestions appear once follower count is available.</p>
            )}
          </div>
        </div>

        {/* Top content */}
        {topPosts.length > 0 && (
          <div className="px-7 pb-7">
            <KitHeading>Top performing content</KitHeading>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {topPosts.map((p) => (
                <a key={p.id} href={p.permalink} target="_blank" rel="noreferrer"
                  className="rounded-xl overflow-hidden border border-border bg-[#f5f5f7] group">
                  <div className="relative aspect-square">
                    {(p.thumbnail_url || p.media_url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnail_url ?? p.media_url ?? ''} alt="" className="h-full w-full object-cover" />
                    ) : <div className="h-full w-full grid place-items-center text-ink-300 text-[10px]">no preview</div>}
                    {p.er != null && (
                      <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-white/90 text-ink-900">
                        {pct(p.er)} ER
                      </span>
                    )}
                    {isReel(p.media_type) && (
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold text-white" style={{ background: 'rgba(0,0,0,.6)' }}>REEL</span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-7 py-4 border-t border-border text-center">
          <p className="text-[11px] text-ink-400">Live Instagram stats · media kit auto-generated for @{profile.username}</p>
        </div>
      </div>

      <p className="max-w-3xl mx-auto mt-3 text-center text-[11px] text-ink-300 print:hidden">
        Tip: use “Save as PDF” to export this kit, or copy the link to share it with a brand.
      </p>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="p-4 text-center">
      <div className="text-[22px] font-bold tabular-nums" style={{ color: accent ? ACCENT : '#1a1a2e' }}>{value}</div>
      <div className="text-[10.5px] uppercase tracking-wide text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}
function KitHeading({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] font-bold uppercase tracking-wider text-ink-500 mb-3">{children}</div>;
}
function SubLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold text-ink-400 mb-1.5">{children}</div>;
}
function Bar({ label, pctVal }: { label: string; pctVal: number }) {
  return (
    <div>
      <div className="flex justify-between text-[12px] mb-0.5">
        <span className="text-ink-700 font-medium truncate">{label}</span>
        <span className="text-ink-400 tabular-nums">{pctVal}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#f0eefb] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pctVal}%`, background: ACCENT }} />
      </div>
    </div>
  );
}
