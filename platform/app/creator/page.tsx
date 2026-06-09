'use client';

import { useEffect, useState, useCallback } from 'react';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Profile {
  handle: string;
  display_name: string | null;
  profile_photo_url: string | null;
  follower_count: number | string | null;
  engagement_rate: number | string | null;
  primary_category: string | null;
  primary_city: string | null;
  is_verified: boolean | null;
  cred_score: string | null;
}
interface Campaign { id: string; name: string; description: string | null; budget: number | string | null; recruit_count: number }
interface Application { program_id: string; program_name: string; description: string | null; status: string; created_at: string }

const fmt = (v: number | string | null): string => {
  const n = Number(v) || 0;
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
};
const erPct = (v: number | string | null): string => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? (n * 100).toFixed(1) + '%' : '—';
};
const STATUS_META: Record<string, { t: string; c: string; b: string }> = {
  applied: { t: 'Applied', c: '#6C4DF6', b: '#f6f4ff' },
  invited: { t: 'Invited', c: '#64748b', b: '#f1f5f9' },
  contacted: { t: 'In conversation', c: '#0ea5e9', b: '#f0f9ff' },
  recruited: { t: 'Recruited 🎉', c: '#10b981', b: '#f0fdf4' },
  declined: { t: 'Not selected', c: '#f43f5e', b: '#fff1f2' },
};

export default function CreatorPortal() {
  const [handle, setHandle] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const [igConfigured, setIgConfigured] = useState<boolean | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Resolve handle from URL (?handle=) or localStorage on first load; surface
  // OAuth outcome; check whether Instagram login is set up.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('handle');
    const oauthErr = params.get('oauth_error');
    if (oauthErr) setBanner(oauthErr === 'not_configured'
      ? 'Instagram sign-in isn’t set up yet — continue with your handle below.'
      : 'Instagram sign-in didn’t complete. Try again, or use your handle below.');
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null;
    const h = (fromUrl || stored || '').trim();
    if (h) { setHandle(h); if (params.get('connected')) localStorage.setItem('creator_handle', h.replace(/^@/, '')); }
    fetch('/api/oauth/status').then((r) => r.json()).then((d) => setIgConfigured(!!d.configured)).catch(() => setIgConfigured(false));
  }, []);

  const loadApplications = useCallback(async (h: string) => {
    const r = await fetch(`/api/creator/applications?handle=${encodeURIComponent(h)}`).then((x) => x.json());
    setApplications(r.applications ?? []);
  }, []);

  useEffect(() => {
    if (!handle) return;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const p = await fetch(`/api/creators/${encodeURIComponent(handle.replace(/^@/, ''))}`).then((x) => (x.ok ? x.json() : null));
        const c = p?.creator ?? p;
        if (!c || !c.handle) { setNotFound(true); setProfile(null); return; }
        setProfile({
          handle: c.handle, display_name: c.display_name, profile_photo_url: c.profile_photo_url,
          follower_count: c.follower_count, engagement_rate: c.engagement_rate, primary_category: c.primary_category,
          primary_city: c.primary_city, is_verified: c.is_verified,
          cred_score: c.credibility?.overall_score != null ? String(c.credibility.overall_score) : (c.cred_score ?? null),
        });
        const [camps] = await Promise.all([
          fetch('/api/creator/campaigns').then((x) => x.json()),
          loadApplications(handle),
        ]);
        setCampaigns(camps.campaigns ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [handle, loadApplications]);

  function signIn() {
    const h = input.trim().replace(/^@/, '');
    if (h.length < 2) return;
    localStorage.setItem('creator_handle', h);
    window.history.replaceState(null, '', `/creator?handle=${encodeURIComponent(h)}`);
    setHandle(h);
  }
  function signOut() {
    localStorage.removeItem('creator_handle');
    window.history.replaceState(null, '', '/creator');
    setHandle(null);
    setProfile(null);
    setInput('');
  }

  async function apply(programId: string) {
    if (!handle) return;
    setApplying(programId);
    try {
      await fetch('/api/creator/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle, program_id: programId }) });
      await loadApplications(handle);
    } finally {
      setApplying(null);
    }
  }

  const appliedIds = new Set(applications.map((a) => a.program_id));

  // ---- Sign-in screen ----
  if (!handle) {
    return (
      <div className="min-h-screen flex flex-col bg-white font-sans">
        <MarketingNav />
        <main className="flex-1 grid place-items-center px-6 py-16">
          <div className="w-full max-w-md text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-5" style={{ background: ACCENT_SOFT, color: ACCENT }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0" /></svg>
            </div>
            <h1 className="text-2xl font-bold text-ink-900">Creator dashboard</h1>
            <p className="mt-2 text-[15px] text-ink-600">Sign in to see your profile and apply to brand campaigns.</p>

            {banner && <div className="mt-5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[13px] px-4 py-2.5">{banner}</div>}

            {/* Instagram OAuth (primary) */}
            <a
              href="/api/oauth/instagram?flow=creator"
              className="mt-6 flex items-center justify-center gap-2.5 w-full px-6 py-3.5 rounded-xl text-white text-[15px] font-semibold shadow-sm hover:brightness-105 transition"
              style={{ background: 'linear-gradient(90deg,#F58529,#DD2A7B,#8134AF)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
              Continue with Instagram
            </a>
            {igConfigured === false && <p className="mt-2 text-[12px] text-ink-400">Instagram login isn’t configured on this environment yet — use your handle below.</p>}

            <div className="my-5 flex items-center gap-3 text-[12px] text-ink-400"><span className="flex-1 h-px bg-border" />or<span className="flex-1 h-px bg-border" /></div>

            {/* Handle entry (fallback) */}
            <div className="rounded-2xl bg-white border-2 border-[#e3def9] focus-within:border-[#6C4DF6] shadow-[0_12px_40px_rgba(108,77,246,0.1)] transition-colors p-2 flex gap-2">
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && signIn()} placeholder="@yourhandle" className="flex-1 px-4 py-3 bg-transparent text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none" />
              <button onClick={signIn} className="px-6 py-3 text-sm font-semibold text-white bg-ink-900 rounded-xl hover:bg-ink-800">Continue</button>
            </div>
            <p className="mt-3 text-[12px] text-ink-400">We’ll match it against our creator database.</p>
          </div>
        </main>
      </div>
    );
  }

  // ---- Dashboard ----
  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        {loading && !profile ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : notFound ? (
          <div className="max-w-md mx-auto text-center py-16">
            <h1 className="text-xl font-bold text-ink-900">We couldn’t find @{handle.replace(/^@/, '')}</h1>
            <p className="mt-2 text-[14px] text-ink-600">That handle isn’t in our creator database yet. Double-check the spelling, or try another.</p>
            <button onClick={signOut} className="mt-5 px-5 py-2.5 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800">Try another handle</button>
          </div>
        ) : profile ? (
          <>
            {/* Profile header */}
            <div className="rounded-3xl bg-white border border-border shadow-card overflow-hidden mb-8">
              <div className="h-20" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }} />
              <div className="px-5 sm:px-6 pb-6 -mt-12">
                <div className="flex items-end gap-4">
                  <Avatar p={profile} />
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="text-[19px] font-bold text-ink-900 truncate flex items-center gap-1.5">
                      {profile.display_name || `@${profile.handle}`}
                      {profile.is_verified && <span style={{ color: ACCENT }}>✔</span>}
                    </div>
                    <div className="text-[13px] text-ink-400 truncate">
                      @{profile.handle}
                      {profile.primary_category ? ` · ${profile.primary_category}` : ''}
                      {profile.primary_city ? ` · ${profile.primary_city}` : ''}
                    </div>
                  </div>
                  <button onClick={signOut} className="text-[12px] font-medium text-ink-400 hover:text-ink-700 shrink-0 pb-1">Sign out</button>
                </div>

                {/* Stats — visible on every screen size */}
                <div className="mt-5 grid grid-cols-3 gap-2.5 sm:gap-3">
                  <StatCard label="Followers" value={fmt(profile.follower_count)} />
                  <StatCard label="Engagement" value={erPct(profile.engagement_rate)} />
                  <StatCard label="Quality" value={profile.cred_score ?? '—'} accent />
                </div>
              </div>
            </div>

            {/* My applications */}
            {applications.length > 0 && (
              <section className="mb-8">
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">Your applications ({applications.length})</h2>
                <div className="space-y-2">
                  {applications.map((a) => {
                    const m = STATUS_META[a.status] ?? { t: a.status, c: '#64748b', b: '#f1f5f9' };
                    return (
                      <div key={a.program_id} className="rounded-xl bg-white border border-border shadow-card px-4 py-3 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] font-medium text-ink-900 truncate">{a.program_name}</div>
                          {a.description && <div className="text-[12px] text-ink-400 truncate">{a.description}</div>}
                        </div>
                        <span className="text-[12px] font-medium px-2.5 py-1 rounded-full shrink-0" style={{ color: m.c, background: m.b }}>{m.t}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Open campaigns */}
            <section>
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">Open campaigns</h2>
              {campaigns.length === 0 ? (
                <div className="text-sm text-ink-400 py-16 text-center rounded-2xl border border-dashed border-border bg-white">No open campaigns right now. Check back soon.</div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {campaigns.map((c) => {
                    const applied = appliedIds.has(c.id);
                    const hasBudget = c.budget != null && Number(c.budget) > 0;
                    return (
                      <div key={c.id} className="rounded-2xl bg-white border border-border shadow-card p-5 flex flex-col hover:-translate-y-0.5 hover:shadow-[0_10px_40px_rgba(108,77,246,0.12)] transition-all">
                        <div className="font-semibold text-ink-900 text-[15px]">{c.name}</div>
                        <p className="mt-1 text-[13px] text-ink-500 leading-relaxed line-clamp-3 flex-1">{c.description || 'A brand campaign looking for creators like you.'}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                          {hasBudget && (
                            <span className="px-2 py-1 rounded-md font-medium" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                              ₹{Number(c.budget).toLocaleString('en-IN')}
                            </span>
                          )}
                          <span className="px-2 py-1 rounded-md bg-[#f4f4f6] text-ink-500">{c.recruit_count} creators</span>
                        </div>
                        <button
                          onClick={() => apply(c.id)}
                          disabled={applied || applying === c.id}
                          className={`mt-4 px-4 py-2.5 rounded-xl text-[14px] font-semibold transition-all ${applied ? 'bg-emerald-50 text-emerald-700 cursor-default' : 'text-white hover:brightness-105'}`}
                          style={applied ? undefined : { background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
                        >
                          {applied ? 'Applied ✓' : applying === c.id ? 'Applying…' : 'Apply now'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-[#fafafc] px-3 py-3 text-center">
      <div className="text-[20px] font-bold tabular-nums leading-none" style={accent ? { color: ACCENT } : undefined}>{value}</div>
      <div className="mt-1.5 text-[10.5px] uppercase tracking-wider text-ink-400">{label}</div>
    </div>
  );
}

function Avatar({ p }: { p: Profile }) {
  const [err, setErr] = useState(false);
  let h = 0;
  for (let i = 0; i < p.handle.length; i++) h = (h * 31 + p.handle.charCodeAt(i)) >>> 0;
  // IG CDN blocks hotlinking — route through our server-side proxy.
  const src = p.profile_photo_url ? `/api/ig-image?u=${encodeURIComponent(p.profile_photo_url)}` : null;
  if (src && !err) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={p.handle}
        onError={() => setErr(true)}
        className="w-20 h-20 rounded-full object-cover shrink-0 ring-4 ring-white bg-[#eee] shadow-sm"
      />
    );
  }
  return (
    <div className="w-20 h-20 rounded-full shrink-0 grid place-items-center text-white text-[26px] font-semibold ring-4 ring-white shadow-sm" style={{ background: `linear-gradient(135deg, hsl(${h % 360} 55% 62%), hsl(${(h + 50) % 360} 55% 50%))` }}>
      {(p.display_name || p.handle).charAt(0).toUpperCase()}
    </div>
  );
}
