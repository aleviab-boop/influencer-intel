'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
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

// Shared stroke styling for the quick-link glyphs.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="19" height="19" viewBox="0 0 24 24" {...S}>{children}</svg>
);
const ICONS: Record<string, ReactNode> = {
  notifications: <Svg><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></Svg>,
  deals: <Svg><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></Svg>,
  applications: <Svg><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" /></Svg>,
  calendar: <Svg><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>,
  goal: <Svg><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></Svg>,
  statement: <Svg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h4" /></Svg>,
  rate: <Svg><path d="M20.6 13.4 11 3.8A2 2 0 0 0 9.6 3H4a1 1 0 0 0-1 1v5.6A2 2 0 0 0 3.6 11l9.6 9.6a2 2 0 0 0 2.8 0l4.6-4.6a2 2 0 0 0 0-2.6z" /><circle cx="7" cy="7" r="1" /></Svg>,
  payout: <Svg><path d="M20 12V7H5a2 2 0 0 1 0-4h13v4" /><path d="M3 5v14a2 2 0 0 0 2 2h15v-4" /><path d="M18 12a2 2 0 0 0 0 4h3v-4z" /></Svg>,
  analytics: <Svg><path d="M3 3v18h18" /><path d="M7 15l3-3 3 2 4-5" /></Svg>,
  mediakit: <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8" cy="12" r="2" /><path d="M13 10h5M13 14h3" /></Svg>,
  settings: <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-1.1 2.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></Svg>,
  campaigns: <Svg><path d="m3 11 18-5v12L3 14z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></Svg>,
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
  const [setup, setSetup] = useState<{ score: number; done_count: number; total_count: number; next: { label: string; href: string } | null } | null>(null);

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

    // The signed ii_creator cookie (minted on Instagram OAuth) is authoritative.
    // Recognise a logged-in creator even with no ?handle and empty localStorage,
    // and hydrate localStorage so every sub-page (which reads it) works too.
    fetch('/api/creator/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.authenticated && d.handle) {
          const clean = String(d.handle).replace(/^@/, '');
          try { localStorage.setItem('creator_handle', clean); } catch { /* ignore */ }
          setHandle(clean); // session wins over any stray ?handle
        }
      })
      .catch(() => { /* not signed in as a creator */ });

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
        fetch(`/api/creator/setup?handle=${encodeURIComponent(handle.replace(/^@/, ''))}`)
          .then((x) => x.json())
          .then((d) => { if (d?.available) setSetup(d); })
          .catch(() => {});
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
    // Clear the cookie session too, else the next load re-authenticates.
    void fetch('/api/creator/session', { method: 'DELETE' }).catch(() => { /* ignore */ });
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
              <div className="relative h-24" style={{ background: `linear-gradient(120deg, ${ACCENT} 0%, #8f6cff 55%, #b199ff 100%)` }}>
                {/* soft light sheen */}
                <div className="absolute inset-0" style={{ background: 'radial-gradient(130% 160% at 90% -40%, rgba(255,255,255,0.4), transparent 55%)' }} />
                <button
                  onClick={signOut}
                  className="absolute top-4 right-4 z-10 rounded-full border border-white/30 bg-white/10 px-3.5 py-1.5 text-[12px] font-semibold text-white/90 backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/20 hover:text-white"
                >
                  Sign out
                </button>
              </div>
              <div className="px-5 sm:px-7 pb-6 -mt-11">
                <div className="flex items-end gap-4">
                  <Avatar p={profile} />
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex items-center gap-2 text-[21px] font-bold leading-tight text-ink-900">
                      <span className="truncate">{profile.display_name?.trim() || `@${profile.handle}`}</span>
                      {profile.is_verified && (
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[12px] leading-none text-white" style={{ background: ACCENT }}>✓</span>
                      )}
                    </div>
                    <div className="mt-1 text-[13px] text-ink-400">
                      {[profile.display_name?.trim() ? `@${profile.handle}` : null, profile.primary_category, profile.primary_city]
                        .filter(Boolean)
                        .join('  ·  ')}
                    </div>
                  </div>
                </div>

                {/* Stats — visible on every screen size */}
                <div className="mt-5 grid grid-cols-3 gap-2.5 sm:gap-3">
                  <StatCard label="Followers" value={fmt(profile.follower_count)} />
                  <StatCard label="Engagement" value={erPct(profile.engagement_rate)} />
                  <StatCard label="Quality" value={profile.cred_score ?? '—'} accent />
                </div>
              </div>
            </div>

            {/* Setup nudge — only while the profile is incomplete */}
            {setup && setup.score < 100 && (
              <Link href={`/creator/setup?handle=${encodeURIComponent(profile.handle)}`}
                className="group flex items-center gap-4 rounded-2xl border shadow-card px-5 py-4 mb-4 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_16px_44px_rgba(108,77,246,0.18)]"
                style={{ borderColor: ACCENT, background: ACCENT_SOFT }}>
                <div className="relative shrink-0" style={{ width: 44, height: 44 }}>
                  <svg width="44" height="44" viewBox="0 0 44 44">
                    <circle cx="22" cy="22" r="18" fill="none" stroke="#ffffff" strokeWidth="5" />
                    <circle cx="22" cy="22" r="18" fill="none" stroke={ACCENT} strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={`${(setup.score / 100) * 2 * Math.PI * 18} ${2 * Math.PI * 18}`} transform="rotate(-90 22 22)" />
                  </svg>
                  <div className="absolute inset-0 grid place-items-center text-[11px] font-bold tabular-nums" style={{ color: ACCENT }}>{setup.score}%</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink-900">Get brand-ready</div>
                  <div className="text-[12.5px] text-ink-500 truncate">
                    {setup.next ? `Next: ${setup.next.label}` : `${setup.done_count} of ${setup.total_count} steps done`}
                  </div>
                </div>
                <span className="shrink-0 text-[13px] font-semibold inline-flex items-center gap-1" style={{ color: ACCENT }}>
                  Finish
                  <span className="transition-transform duration-300 ease-out group-hover:translate-x-1" aria-hidden>→</span>
                </span>
              </Link>
            )}

            {/* Quick links to the creator's own workspaces */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-8">
              <QuickLink href={`/creator/notifications?handle=${encodeURIComponent(profile.handle)}`} label="Notifications" desc="What needs you" icon={ICONS.notifications} />
              <QuickLink href={`/creator/deals?handle=${encodeURIComponent(profile.handle)}`} label="Your deals" desc="Deliverables & payments" icon={ICONS.deals} />
              <QuickLink href={`/creator/applications?handle=${encodeURIComponent(profile.handle)}`} label="Applications" desc="Campaigns you applied to" icon={ICONS.applications} />
              <QuickLink href={`/creator/calendar?handle=${encodeURIComponent(profile.handle)}`} label="Calendar" desc="Deadlines by month" icon={ICONS.calendar} />
              <QuickLink href={`/creator/goal?handle=${encodeURIComponent(profile.handle)}`} label="Monthly goal" desc="Track your target" icon={ICONS.goal} />
              <QuickLink href={`/creator/statement?handle=${encodeURIComponent(profile.handle)}`} label="Earnings statement" desc="FY totals & TDS" icon={ICONS.statement} />
              <QuickLink href={`/creator/rate-card?handle=${encodeURIComponent(profile.handle)}`} label="Rate card" desc="Set your prices" icon={ICONS.rate} />
              <QuickLink href={`/creator/payout?handle=${encodeURIComponent(profile.handle)}`} label="Payout details" desc="Where you get paid" icon={ICONS.payout} />
              <QuickLink href={`/creator/analytics-preview?handle=${encodeURIComponent(profile.handle)}`} label="Analytics" desc="Your growth & content" icon={ICONS.analytics} />
              <QuickLink href={`/creator/media-kit?handle=${encodeURIComponent(profile.handle)}`} label="Media kit" desc="Rates & audience" icon={ICONS.mediakit} />
              <QuickLink href={`/creator/settings?handle=${encodeURIComponent(profile.handle)}`} label="Settings" desc="Edit your profile" icon={ICONS.settings} />
              <QuickLink href="/creator" label="Campaigns" desc="Browse & apply" icon={ICONS.campaigns} />
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
                      <div key={c.id} className="group rounded-2xl bg-white border border-border shadow-card p-5 flex flex-col transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_48px_rgba(108,77,246,0.16)]">
                        <Link href={`/creator/campaigns/${c.id}`} className="font-semibold text-ink-900 text-[15px] hover:underline" style={{ textDecorationColor: ACCENT }}>{c.name}</Link>
                        <p className="mt-1 text-[13px] text-ink-500 leading-relaxed line-clamp-3 flex-1">{c.description || 'A brand campaign looking for creators like you.'}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                          {hasBudget && (
                            <span className="px-2 py-1 rounded-md font-medium" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                              ₹{Number(c.budget).toLocaleString('en-IN')}
                            </span>
                          )}
                          <span className="px-2 py-1 rounded-md bg-[#f4f4f6] text-ink-500">{c.recruit_count} creators</span>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                          <button
                            onClick={() => apply(c.id)}
                            disabled={applied || applying === c.id}
                            className={`flex-1 px-4 py-2.5 rounded-xl text-[14px] font-semibold transition-all ${applied ? 'bg-emerald-50 text-emerald-700 cursor-default' : 'text-white hover:brightness-105'}`}
                            style={applied ? undefined : { background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
                          >
                            {applied ? 'Applied ✓' : applying === c.id ? 'Applying…' : 'Apply now'}
                          </button>
                          <Link href={`/creator/campaigns/${c.id}`} className="px-4 py-2.5 rounded-xl text-[14px] font-semibold border border-border hover:bg-[#faf9ff]" style={{ color: ACCENT }}>
                            Details
                          </Link>
                        </div>
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

function QuickLink({ href, label, desc, icon }: { href: string; label: string; desc: string; icon?: ReactNode }) {
  return (
    <Link
      href={href}
      className="group relative flex items-start gap-3 rounded-2xl border border-border bg-white shadow-card px-4 py-3.5 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#d9d1fb] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]"
    >
      {icon && (
        <span
          className="shrink-0 grid place-items-center w-9 h-9 rounded-xl transition-all duration-300 ease-out group-hover:scale-110 group-hover:-rotate-3"
          style={{ background: ACCENT_SOFT, color: ACCENT }}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[14px] font-semibold text-ink-900">
          <span className="truncate transition-colors duration-300 group-hover:text-[#6C4DF6]">{label}</span>
          <span
            className="opacity-0 -translate-x-1 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0"
            style={{ color: ACCENT }}
            aria-hidden
          >
            →
          </span>
        </div>
        <div className="text-[11.5px] text-ink-400 mt-0.5 truncate">{desc}</div>
      </div>
    </Link>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`group rounded-2xl border px-3 py-3.5 text-center transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-white hover:border-[#e3def9] hover:shadow-[0_10px_30px_rgba(108,77,246,0.10)] ${accent ? 'border-[#e7e1fb]' : 'border-border bg-[#fafafc]'}`}
      style={accent ? { background: ACCENT_SOFT } : undefined}
    >
      <div className="text-[22px] font-bold tabular-nums leading-none transition-transform duration-300 group-hover:scale-105" style={accent ? { color: ACCENT } : undefined}>{value}</div>
      <div className="mt-2 text-[10.5px] font-medium uppercase tracking-wider text-ink-400">{label}</div>
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
        className="h-[84px] w-[84px] shrink-0 rounded-full object-cover bg-[#eee] ring-4 ring-white shadow-[0_8px_22px_rgba(20,20,40,0.16)]"
      />
    );
  }
  return (
    <div className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-full text-[27px] font-semibold text-white ring-4 ring-white shadow-[0_8px_22px_rgba(20,20,40,0.16)]" style={{ background: `linear-gradient(135deg, hsl(${h % 360} 55% 62%), hsl(${(h + 50) % 360} 55% 50%))` }}>
      {(p.display_name || p.handle).charAt(0).toUpperCase()}
    </div>
  );
}
