'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  type ReportProfile, brandFit, authenticityReport, reelForecast, personaLine,
  competitorConflicts, authenticityFlag,
} from '@/lib/creator-report';
import { PageDoodles } from '@/components/page-doodles';
import {
  fmt, inr, expectedErFloor, engagementRate, estimatedRate, postingInsight, contentThemes, tierWord,
} from '@/lib/creator-metrics';

const ACCENT = '#6C4DF6';

export default function CreatorReportPage() {
  const params = useParams();
  const search = useSearchParams();
  const handle = String(params.handle ?? '').replace(/^@/, '');
  const brief = search.get('brief') ?? '';

  const [profile, setProfile] = useState<ReportProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!handle) return;
    let alive = true;
    setState('loading');
    fetch(`/api/ig-profile?handle=${encodeURIComponent(handle)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d && !d.error) { setProfile(d as ReportProfile); setState('ready'); }
        else setState('error');
      })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [handle]);

  if (state === 'loading') {
    return <div className="min-h-screen grid place-items-center text-[#888] text-sm">Building report for @{handle}…</div>;
  }
  if (state === 'error' || !profile) {
    return <div className="min-h-screen grid place-items-center text-[#888] text-sm">Couldn’t load @{handle}. Try again from the profile drawer.</div>;
  }

  const engagement = engagementRate(profile.recent, profile.followers) ?? profile.engagement ?? null;
  const rate = estimatedRate(profile.followers, engagement);
  const themes = contentThemes(profile.recent, 8);
  const rhythm = postingInsight(profile.recent);
  const fit = brandFit(profile, engagement, brief);
  const auth = authenticityReport(profile, engagement);
  const forecast = reelForecast(profile);
  const conflicts = competitorConflicts(profile.recent);
  const collabs = (profile.collabs ?? []).slice(0, 10);
  const persona = personaLine(profile, engagement, rate, rhythm?.cadence ?? null, themes);
  const flag = authenticityFlag(profile.followers, engagement);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const reels = profile.recent.filter((p) => p.thumbnail).slice(0, 6);

  return (
    <div className="relative isolate overflow-hidden min-h-screen bg-[#f4f2ff] py-8 px-4 print:bg-white print:p-0">
      <PageDoodles className="-z-10" />
      <style>{`@media print { .no-print { display:none !important; } @page { size: A4; margin: 12mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>

      {/* toolbar */}
      <div className="no-print max-w-[820px] mx-auto mb-4 flex items-center justify-between">
        <button onClick={() => window.close()} className="text-[13px] text-[#666] hover:text-[#111]">← Close</button>
        <button onClick={() => window.print()} className="px-4 py-2 rounded-lg text-white text-[13px] font-semibold" style={{ background: ACCENT }}>
          ⌘ Print / Save as PDF
        </button>
      </div>

      <div className="max-w-[820px] mx-auto bg-white rounded-2xl shadow-card print:shadow-none border border-[#ececec] p-8 print:border-0">
        {/* header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#eee] pb-5">
          <div className="flex items-center gap-4 min-w-0">
            <img src={`/api/ig-avatar?handle=${encodeURIComponent(handle)}`} alt="" className="w-16 h-16 rounded-full object-cover bg-[#eee] shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[20px] font-bold text-[#111] truncate">@{profile.handle}</span>
                {profile.is_verified && <span style={{ color: ACCENT }}>✔</span>}
              </div>
              <div className="text-[13px] text-[#666] truncate">{profile.full_name}{profile.category ? ` · ${profile.category}` : ''}</div>
              <div className="text-[12px] text-[#999] mt-0.5">{tierWord(profile.followers)} creator</div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[15px] font-bold" style={{ color: ACCENT }}>Influencer Intel</div>
            <div className="text-[11px] text-[#999]">Creator report · {today}</div>
          </div>
        </div>

        {/* persona */}
        <p className="mt-4 text-[13px] text-[#333] leading-relaxed">{persona}</p>

        {/* stats */}
        <div className="mt-4 grid grid-cols-5 gap-2 text-center">
          {[
            ['Followers', fmt(profile.followers)],
            ['Following', fmt(profile.following)],
            ['Posts', fmt(profile.posts)],
            ['Engagement', engagement != null ? `${engagement}%` : '—'],
            ['Est. rate', rate ? `${inr(rate.low)}–${inr(rate.high)}` : '—'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-[#eee] bg-[#fafafc] py-2.5">
              <div className="text-[14px] font-bold text-[#111] leading-none">{v}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-[#999]">{k}</div>
            </div>
          ))}
        </div>
        {engagement != null && (
          <div className="mt-2 text-[11px]" style={{ color: flag === 'low' ? '#b45309' : '#059669' }}>
            {flag === 'low' ? '⚠' : '✓'} {engagement}% engagement — {flag === 'low' ? 'low' : 'healthy'} for this tier (benchmark ≈ {expectedErFloor(profile.followers)}%)
          </div>
        )}

        {/* scores: brand fit + authenticity */}
        <div className="mt-5 grid grid-cols-2 gap-4">
          {fit && (
            <Card title="Brand fit" subtitle={brief ? `vs “${brief}”` : undefined}>
              <ScoreRow score={fit.score} color={fit.color} band={fit.band} verdict={fit.verdict} />
              <Factors items={fit.factors} />
            </Card>
          )}
          {auth && (
            <Card title="Authenticity score">
              <ScoreRow score={auth.score} color={auth.color} band={auth.band} verdict={auth.verdict} />
              <Factors items={auth.factors} />
            </Card>
          )}
        </div>

        {/* reel forecast + posting + themes */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Card title="Reel performance forecast">
            {forecast ? (
              <>
                <div className="text-[20px] font-bold text-[#111]">~{fmt(forecast.expected)} <span className="text-[12px] font-normal text-[#888]">views / next reel</span></div>
                <div className="text-[12px] text-[#999] mt-0.5">Likely range {fmt(forecast.low)}–{fmt(forecast.high)} · from {forecast.basisCount} recent reels (typically {fmt(forecast.avgLikes)} likes)</div>
              </>
            ) : <div className="text-[12px] text-[#999]">Not enough recent reels to project.</div>}
          </Card>
          <Card title="Posting rhythm">
            {rhythm ? (
              <div className="grid grid-cols-3 gap-2 text-center">
                {[['Cadence', rhythm.cadence], ['Best day', rhythm.bestDay], ['Best time', rhythm.bestWindow]].map(([k, v]) => (
                  <div key={k}><div className="text-[12px] font-semibold text-[#111]">{v}</div><div className="text-[10px] uppercase tracking-wide text-[#999] mt-0.5">{k}</div></div>
                ))}
              </div>
            ) : <div className="text-[12px] text-[#999]">Not enough dated posts to read cadence.</div>}
          </Card>
        </div>

        {/* themes + brand activity */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          {themes.length > 0 && (
            <Card title="Posts about">
              <div className="flex flex-wrap gap-1.5">
                {themes.map((t) => <span key={t} className="px-2 py-0.5 rounded-full text-[11px] border border-[#e3def9] bg-[#f6f4ff]" style={{ color: ACCENT }}>{t}</span>)}
              </div>
            </Card>
          )}
          <Card title={`Brand activity${profile.sponsored_posts ? ` · ${profile.sponsored_posts} sponsored` : ''}`}>
            {collabs.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {collabs.map((c) => (
                  <span key={c.handle} className="px-2 py-0.5 rounded-full text-[11px] bg-[#fafafc] border border-[#eee] text-[#555]">@{c.handle}{c.count > 1 ? `·${c.count}` : ''}</span>
                ))}
              </div>
            ) : <div className="text-[12px] text-[#999]">No tagged brand collaborations detected.</div>}
            {conflicts.length > 0 && (
              <div className="mt-2 text-[11px] text-rose-600">⛔ Recent competitor collab: {conflicts.map((c) => c.brand).join(', ')} (within 30d)</div>
            )}
          </Card>
        </div>

        {/* recent posts */}
        {reels.length > 0 && (
          <div className="mt-5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-2">Recent posts</div>
            <div className="grid grid-cols-6 gap-2">
              {reels.map((p, i) => (
                <div key={i} className="aspect-square rounded-lg overflow-hidden bg-[#eee] border border-[#eee]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/ig-image?u=${encodeURIComponent(p.thumbnail!)}`} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* contact + footer */}
        <div className="mt-5 pt-4 border-t border-[#eee] flex items-center justify-between gap-3 text-[12px]">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {profile.email && <span className="text-[#10b981]">✉ {profile.email}</span>}
            {profile.phone && <span className="text-[#0ea5e9]">📞 {profile.phone}</span>}
            <a href={`https://instagram.com/${profile.handle}`} className="text-[#888]">instagram.com/{profile.handle}</a>
          </div>
          <div className="text-[10px] text-[#bbb] text-right shrink-0">Generated by Influencer Intel · figures are estimates from public data</div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e3def9] bg-white p-3.5 break-inside-avoid">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-2">{title}{subtitle ? <span className="ml-1 normal-case font-normal text-[#bbb]">{subtitle}</span> : null}</div>
      {children}
    </div>
  );
}

function ScoreRow({ score, color, band, verdict }: { score: number; color: string; band: string; verdict: string }) {
  const R = 22, C = 2 * Math.PI * R, dash = (score / 100) * C;
  return (
    <div className="flex items-center gap-3 mb-3">
      <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0">
        <circle cx="28" cy="28" r={R} fill="none" stroke="#eee" strokeWidth="6" />
        <circle cx="28" cy="28" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${dash} ${C}`} transform="rotate(-90 28 28)" />
        <text x="28" y="29" textAnchor="middle" dominantBaseline="central" fontSize="16" fontWeight="700" fill="#111">{score}</text>
      </svg>
      <div className="min-w-0">
        <div className="text-[13px] font-bold" style={{ color }}>{band}</div>
        <p className="text-[11px] text-[#666] leading-snug">{verdict}</p>
      </div>
    </div>
  );
}

function Factors({ items }: { items: { key: string; label: string; value: number; detail: string }[] }) {
  const barColor = (v: number) => (v >= 70 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444');
  return (
    <div className="space-y-1.5">
      {items.map((f) => (
        <div key={f.key}>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#444] font-medium">{f.label}</span>
            <span className="tabular-nums font-semibold" style={{ color: barColor(f.value) }}>{f.value}</span>
          </div>
          <div className="mt-0.5 h-1 rounded-full bg-[#f0eefb] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${f.value}%`, background: barColor(f.value) }} /></div>
        </div>
      ))}
    </div>
  );
}
