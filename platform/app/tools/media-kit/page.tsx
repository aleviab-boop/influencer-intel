'use client';

import { useEffect, useRef, useState } from 'react';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import {
  fmt, inr, expectedErFloor, engagementRate, estimatedRate, postingInsight, contentThemes, tierWord,
  type RecentPost,
} from '@/lib/creator-metrics';

interface Profile {
  handle: string; full_name: string; biography: string; category: string;
  followers: number; following: number; posts: number;
  is_verified: boolean; profile_pic_url: string | null; external_url: string | null;
  email: string | null; phone: string | null;
  recent: (RecentPost & { shortcode: string; thumbnail: string | null })[];
}

const proxy = (u: string | null) => (u ? `/api/ig-image?u=${encodeURIComponent(u)}` : '');
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));

export default function MediaKit() {
  const [handle, setHandle] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoRan = useRef(false);

  async function load(h?: string) {
    const q = (h ?? handle).trim().replace(/^@/, '');
    if (!/^[a-z0-9._]{1,30}$/i.test(q) || loading) return;
    if (h) setHandle(h);
    setLoading(true);
    setErr(null);
    try {
      const d = await fetch(`/api/ig-profile?handle=${encodeURIComponent(q)}`).then((r) => r.json());
      if (d.error) setErr(d.is_private ? 'That account is private.' : 'Couldn\u2019t find that handle.');
      else setProfile(d as Profile);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (autoRan.current) return;
    const q = new URLSearchParams(window.location.search).get('handle');
    if (q) { autoRan.current = true; void load(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const er = profile ? engagementRate(profile.recent, profile.followers) : null;
  const rate = profile ? estimatedRate(profile.followers, er) : null;
  const rhythm = profile ? postingInsight(profile.recent) : null;
  const themes = profile ? contentThemes(profile.recent, 6) : [];
  const persona = profile ? personaOf(profile, er, rate, rhythm?.cadence ?? null, themes) : '';

  function downloadPdf() {
    if (!profile) return;
    const w = window.open('', '_blank', 'width=820,height=1040');
    if (!w) return;
    const origin = window.location.origin;
    const stat = (k: string, v: string) => `<div class="stat"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`;
    const thumbs = profile.recent.slice(0, 6).filter((p) => p.thumbnail)
      .map((p) => `<img class="th" src="${origin}${proxy(p.thumbnail)}" />`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(profile.full_name || profile.handle)} — Media Kit</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#161630;margin:0;padding:40px 44px}
  .top{display:flex;align-items:center;gap:8px;margin-bottom:22px}
  .dot{width:22px;height:22px;border-radius:6px;background:${ACCENT}} .brand{font-weight:700;font-size:14px}
  .hd{display:flex;gap:16px;align-items:center;margin-bottom:18px}
  .pic{width:74px;height:74px;border-radius:50%;object-fit:cover;background:#eee}
  h1{font-size:22px;margin:0} .handle{color:${ACCENT};font-weight:600;font-size:14px}
  .persona{color:#555;font-size:13px;margin-top:4px}
  .stats{display:flex;gap:10px;margin:18px 0}
  .stat{flex:1;border:1px solid #eee;border-radius:12px;padding:12px;text-align:center}
  .stat .v{font-size:18px;font-weight:700} .stat .k{font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.04em;margin-top:3px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#999;margin:20px 0 8px}
  .bio{font-size:13px;color:#444;white-space:pre-wrap;line-height:1.5}
  .pills span{display:inline-block;background:${ACCENT_SOFT};color:${ACCENT};font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;margin:0 6px 6px 0}
  .grid{display:flex;gap:8px;flex-wrap:wrap} .th{width:118px;height:118px;border-radius:10px;object-fit:cover;background:#eee}
  .row{font-size:13px;margin:3px 0} .row b{color:#161630}
  .foot{margin-top:26px;border-top:1px solid #eee;padding-top:10px;color:#aaa;font-size:11px}
</style></head><body>
  <div class="top"><span class="dot"></span><span class="brand">Influencer Intel · Media Kit</span></div>
  <div class="hd">
    ${profile.profile_pic_url ? `<img class="pic" src="${origin}${proxy(profile.profile_pic_url)}" />` : ''}
    <div><h1>${esc(profile.full_name || profile.handle)}</h1><div class="handle">@${esc(profile.handle)}${profile.is_verified ? ' ✔' : ''}</div><div class="persona">${esc(persona)}</div></div>
  </div>
  <div class="stats">
    ${stat('Followers', fmt(profile.followers))}
    ${stat('Posts', fmt(profile.posts))}
    ${stat('Engagement', er != null ? er + '%' : '—')}
    ${stat('Est. rate', rate ? inr(rate.low) + '–' + inr(rate.high) : '—')}
  </div>
  ${rhythm ? `<div class="row"><b>Best time to post:</b> ${esc(rhythm.bestDay)}, ${esc(rhythm.bestWindow)} · ${esc(rhythm.cadence)}</div>` : ''}
  ${profile.biography ? `<h2>Bio</h2><div class="bio">${esc(profile.biography)}</div>` : ''}
  ${themes.length ? `<h2>Posts about</h2><div class="pills">${themes.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
  ${thumbs ? `<h2>Recent work</h2><div class="grid">${thumbs}</div>` : ''}
  <h2>Contact</h2>
  ${profile.email ? `<div class="row">✉ ${esc(profile.email)}</div>` : ''}
  ${profile.phone ? `<div class="row">📞 ${esc(profile.phone)}</div>` : ''}
  <div class="row">🔗 instagram.com/${esc(profile.handle)}</div>
  <div class="foot">Generated with Influencer Intel</div>
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 700);
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#111]">
      <MarketingNav />
      <main className="flex-1">
        <section className={`py-12 md:py-16 flex items-center ${profile ? '' : 'min-h-[70vh]'}`} style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.15), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.12), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }}>
          <div className="max-w-2xl mx-auto px-6 text-center w-full">
            <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>Media Kit Generator</span>
            <h1 className="mt-2 text-3xl md:text-5xl font-bold tracking-tight">Your media kit in one click</h1>
            <p className="mt-3 text-[16px] text-[#555]">Enter your Instagram handle and get a clean, brand-ready stats sheet — downloadable as a PDF to send to brands.</p>
            <div className="mt-7 rounded-2xl bg-white border-2 border-[#e3def9] p-3 shadow-[0_12px_50px_rgba(108,77,246,0.12)] focus-within:border-[#6C4DF6] transition-colors flex items-center gap-2">
              <span className="pl-2 text-[#9aa]">@</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
                placeholder="yourhandle"
                className="flex-1 min-w-0 text-[16px] text-[#222] focus:outline-none bg-transparent"
                autoFocus
              />
              <button onClick={() => load()} disabled={loading || handle.trim().length < 2} className="px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold shrink-0 disabled:opacity-50 hover:brightness-105 flex items-center gap-2" style={{ background: `linear-gradient(135deg, ${ACCENT}, #F7B500)` }}>
                {loading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {loading ? 'Building…' : 'Generate'}
              </button>
            </div>
            {err && <div className="mt-4 text-[13px] text-rose-600">{err}</div>}
          </div>
        </section>

        {profile && (
          <section className="max-w-3xl mx-auto px-6 py-10">
            <div className="rounded-2xl border border-[#eaeaea] shadow-[0_8px_40px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-6 py-5 flex items-start justify-between gap-4 border-b border-[#f0f0f0]">
                <div className="flex items-center gap-4 min-w-0">
                  {profile.profile_pic_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proxy(profile.profile_pic_url)} alt="" className="w-16 h-16 rounded-full object-cover bg-[#eee]" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[18px] font-bold truncate">{profile.full_name || profile.handle} {profile.is_verified && <span style={{ color: ACCENT }}>✔</span>}</div>
                    <a href={`https://instagram.com/${profile.handle}`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold hover:underline" style={{ color: ACCENT }}>@{profile.handle}</a>
                    <div className="text-[12px] text-[#777] mt-0.5">{persona}</div>
                  </div>
                </div>
                <button onClick={downloadPdf} className="shrink-0 px-4 py-2 rounded-xl text-white text-[13px] font-semibold hover:brightness-105" style={{ background: `linear-gradient(135deg, ${ACCENT}, #F7B500)` }}>⬇ Download PDF</button>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[['Followers', fmt(profile.followers)], ['Posts', fmt(profile.posts)], ['Engagement', er != null ? `${er}%` : '—'], ['Est. rate', rate ? `${inr(rate.low)}–${inr(rate.high)}` : '—']].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-[#eee] bg-[#fafafc] py-3">
                      <div className="text-[15px] font-bold text-[#111]">{v}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-[#999]">{k}</div>
                    </div>
                  ))}
                </div>

                {rhythm && <div className="mt-4 text-[13px] text-[#444]"><span className="font-semibold">Best time to post:</span> {rhythm.bestDay}, {rhythm.bestWindow} · {rhythm.cadence}</div>}
                {profile.biography && <p className="mt-4 text-[13px] text-[#444] whitespace-pre-line leading-relaxed">{profile.biography}</p>}
                {themes.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {themes.map((t) => <span key={t} className="px-2.5 py-1 rounded-full text-[12px] font-medium border border-[#e3def9] bg-[#f6f4ff]" style={{ color: ACCENT }}>{t}</span>)}
                  </div>
                )}
                {profile.recent.length > 0 && (
                  <div className="mt-5 grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {profile.recent.slice(0, 6).map((p, i) => (
                      <a key={i} href={p.shortcode ? `https://instagram.com/p/${p.shortcode}` : '#'} target="_blank" rel="noreferrer" className="aspect-square rounded-lg overflow-hidden bg-[#eee] ring-1 ring-black/5">
                        {p.thumbnail && /* eslint-disable-next-line @next/next/no-img-element */ <img src={proxy(p.thumbnail)} alt="" className="w-full h-full object-cover" />}
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
                  {profile.email && <span className="text-[#10b981]">✉ {profile.email}</span>}
                  {profile.phone && <span className="text-[#0ea5e9]">📞 {profile.phone}</span>}
                  {profile.external_url && <a href={profile.external_url} target="_blank" rel="noreferrer" className="text-[#888] hover:underline">🔗 {profile.external_url.replace(/^https?:\/\//, '')}</a>}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}

function personaOf(
  p: { followers: number; category?: string; email?: string | null; phone?: string | null },
  er: number | null,
  rate: { low: number; high: number } | null,
  cadence: string | null,
  themes: string[],
): string {
  const tier = tierWord(p.followers);
  const niche = p.category?.trim();
  const who = niche ? `${tier} ${niche.toLowerCase()}` : themes[0] ? `${tier} ${themes[0].replace(/^#/, '')} creator` : `${tier} creator`;
  const parts = [who];
  if (er != null) parts.push(`${er}% ER ${er >= expectedErFloor(p.followers) ? '(healthy)' : '(low)'}`);
  if (rate) parts.push(`~${inr(rate.low)}–${inr(rate.high)}/post`);
  if (cadence) parts.push(cadence.toLowerCase());
  return parts.join(' · ');
}
