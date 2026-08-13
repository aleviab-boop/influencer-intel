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
interface Application { program_id: string; program_name: string; description: string | null; status: string; created_at: string }
interface Connection {
  connected: boolean;
  ig_username?: string | null;
  connection_status?: string | null;
  token_expires_at?: string | null;
  expiring_soon?: boolean;
  expired?: boolean;
  days_until_expiry?: number | null;
}
interface Overview {
  available: boolean;
  notifications: { action_count: number; total: number };
  deals: { active: number; awaiting_payment: number; overdue: number; next_due: string | null };
  applications: { total: number; counts: { pending: number; advanced: number; accepted: number; closed: number } };
  calendar: { next_due: string | null; overdue: number };
  goal: { has_goal: boolean; progress_pct: number; status: string };
  statement: { fy_earned: number };
  rate_card: { set: boolean };
  payout: { set: boolean };
  analytics: { followers: number; engagement_rate: number | null };
  media_kit: { ready: boolean };
}

const fmt = (v: number | string | null): string => {
  const n = Number(v) || 0;
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
};
const erPct = (v: number | string | null): string => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? (n * 100).toFixed(1) + '%' : '—';
};
// "2026-08-12" -> "12 Aug"
const shortDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const parts = iso.slice(0, 10).split('-');
  const y = Number(parts[0]); const m = Number(parts[1]); const d = Number(parts[2]);
  if (!y || !m || !d) return null;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${MON[m - 1]}`;
};
const inr = (n: number): string => n >= 1e5 ? '₹' + (n / 1e5).toFixed(n % 1e5 === 0 ? 0 : 1) + 'L' : n >= 1e3 ? '₹' + (n / 1e3).toFixed(0) + 'K' : '₹' + n;
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
  const [applications, setApplications] = useState<Application[]>([]);
  const [igConfigured, setIgConfigured] = useState<boolean | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ score: number; done_count: number; total_count: number; next: { label: string; href: string } | null } | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);

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

  const loadConnection = useCallback(async (h: string) => {
    try {
      const d: Connection = await fetch(`/api/creator/connection?handle=${encodeURIComponent(h.replace(/^@/, ''))}`).then((x) => x.json());
      setConnection(d);
    } catch { /* ignore */ }
  }, []);

  const disconnectIg = useCallback(async () => {
    if (!handle) return;
    if (!window.confirm('Disconnect Instagram? We’ll stop pulling live insights and delete the stored access token. Your saved profile stays.')) return;
    await fetch(`/api/creator/connection?handle=${encodeURIComponent(handle.replace(/^@/, ''))}`, { method: 'DELETE' }).catch(() => {});
    await loadConnection(handle);
  }, [handle, loadConnection]);

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
        await loadApplications(handle);
        fetch(`/api/creator/setup?handle=${encodeURIComponent(handle.replace(/^@/, ''))}`)
          .then((x) => x.json())
          .then((d) => { if (d?.available) setSetup(d); })
          .catch(() => {});
        fetch(`/api/creator/overview?handle=${encodeURIComponent(handle.replace(/^@/, ''))}`)
          .then((x) => x.json())
          .then((d) => { if (d?.available) setOverview(d); })
          .catch(() => {});
        void loadConnection(handle);
      } finally {
        setLoading(false);
      }
    })();
  }, [handle, loadApplications, loadConnection]);

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
              <div className="relative z-10 px-5 sm:px-7 pb-6 -mt-9">
                <div className="flex items-end gap-4">
                  <Avatar p={profile} />
                  <div className="min-w-0 flex-1 pb-0.5">
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

            {/* Instagram connection status — live insights vs connect CTA */}
            {connection && <ConnectionCard c={connection} onDisconnect={disconnectIg} />}

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
              <QuickLink href={`/creator/notifications?handle=${encodeURIComponent(profile.handle)}`} label="Notifications" desc="What needs you" icon={ICONS.notifications}
                badge={overview && overview.notifications.action_count > 0 ? String(overview.notifications.action_count) : null} alert />
              <QuickLink href={`/creator/deals?handle=${encodeURIComponent(profile.handle)}`} label="Your deals" desc="Deliverables & payments" icon={ICONS.deals}
                badge={overview && overview.deals.active > 0 ? `${overview.deals.active} active` : null} />
              <QuickLink href={`/creator/applications?handle=${encodeURIComponent(profile.handle)}`} label="Applications" desc="Campaigns you applied to" icon={ICONS.applications}
                badge={overview && overview.applications.total > 0 ? String(overview.applications.total) : null} />
              <QuickLink href={`/creator/calendar?handle=${encodeURIComponent(profile.handle)}`} label="Calendar" desc="Deadlines by month" icon={ICONS.calendar}
                badge={overview?.calendar.next_due ? shortDate(overview.calendar.next_due) : null} alert={!!overview && overview.calendar.overdue > 0} />
              <QuickLink href={`/creator/goal?handle=${encodeURIComponent(profile.handle)}`} label="Monthly goal" desc="Track your target" icon={ICONS.goal}
                badge={overview ? (overview.goal.has_goal ? `${overview.goal.progress_pct}%` : 'Set') : null} />
              <QuickLink href={`/creator/statement?handle=${encodeURIComponent(profile.handle)}`} label="Earnings statement" desc="FY totals & TDS" icon={ICONS.statement}
                badge={overview && overview.statement.fy_earned > 0 ? inr(overview.statement.fy_earned) : null} />
              <QuickLink href={`/creator/rate-card?handle=${encodeURIComponent(profile.handle)}`} label="Rate card" desc="Set your prices" icon={ICONS.rate}
                badge={overview ? (overview.rate_card.set ? 'Set' : 'Add') : null} />
              <QuickLink href={`/creator/payout?handle=${encodeURIComponent(profile.handle)}`} label="Payout details" desc="Where you get paid" icon={ICONS.payout}
                badge={overview ? (overview.payout.set ? 'Added' : 'Add') : null} />
              <QuickLink href={`/creator/analytics-preview?handle=${encodeURIComponent(profile.handle)}`} label="Analytics" desc="Your growth & content" icon={ICONS.analytics}
                badge={overview && overview.analytics.followers > 0 ? fmt(overview.analytics.followers) : null} />
              <QuickLink href={`/creator/media-kit?handle=${encodeURIComponent(profile.handle)}`} label="Media kit" desc="Rates & audience" icon={ICONS.mediakit}
                badge={overview ? (overview.media_kit.ready ? 'Ready' : 'Finish') : null} />
              <QuickLink href={`/creator/settings?handle=${encodeURIComponent(profile.handle)}`} label="Settings" desc="Edit your profile" icon={ICONS.settings} />
              <QuickLink href={`/creator/campaigns?handle=${encodeURIComponent(profile.handle)}`} label="Campaigns" desc="Browse & apply" icon={ICONS.campaigns} />
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

            {/* Browse open campaigns — lives on its own page now */}
            <Link href={`/creator/campaigns?handle=${encodeURIComponent(profile.handle)}`}
              className="group flex items-center gap-4 rounded-2xl bg-white border border-border shadow-card px-5 py-4 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]">
              <span className="shrink-0 grid place-items-center w-10 h-10 rounded-xl" style={{ background: ACCENT_SOFT, color: ACCENT }}>{ICONS.campaigns}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-ink-900">Open campaigns</div>
                <div className="text-[12.5px] text-ink-500">Browse brand campaigns and apply.</div>
              </div>
              <span className="shrink-0 text-[13px] font-semibold inline-flex items-center gap-1" style={{ color: ACCENT }}>
                Browse<span className="transition-transform duration-300 ease-out group-hover:translate-x-1" aria-hidden>→</span>
              </span>
            </Link>
          </>
        ) : null}
      </main>
    </div>
  );
}

const IG_GRADIENT = 'linear-gradient(90deg,#F58529,#DD2A7B,#8134AF)';
const IgGlyph = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

function ConnectionCard({ c, onDisconnect }: { c: Connection; onDisconnect: () => void }) {
  // Connected & healthy — quiet confirmation that live insights are on.
  if (c.connected && !c.expiring_soon) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-5 py-3.5 mb-4">
        <span className="shrink-0 grid place-items-center w-9 h-9 rounded-xl bg-white text-emerald-600 shadow-sm"><IgGlyph /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-emerald-900">
            Instagram connected{c.ig_username ? <> — <span className="font-bold">@{c.ig_username}</span></> : ''}
          </div>
          <div className="text-[12.5px] text-emerald-700/90">Live insights are on. Your analytics update from Instagram automatically.</div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />Live
          </span>
          <button onClick={onDisconnect} className="text-[12px] font-medium text-emerald-700/70 hover:text-emerald-900 hover:underline">Disconnect</button>
        </div>
      </div>
    );
  }

  // Connected but the token is about to lapse — nudge a reconnect.
  if (c.connected && c.expiring_soon) {
    const days = c.days_until_expiry;
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 mb-4">
        <span className="shrink-0 grid place-items-center w-9 h-9 rounded-xl bg-white text-amber-600 shadow-sm"><IgGlyph /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-amber-900">Reconnect Instagram soon</div>
          <div className="text-[12.5px] text-amber-700">
            Your connection {days != null && days > 0 ? `expires in ${days} day${days === 1 ? '' : 's'}` : 'is about to expire'}. Reconnect to keep live insights flowing.
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <a href="/api/oauth/instagram?flow=creator" className="group text-[13px] font-semibold text-amber-700 inline-flex items-center gap-1">
            Reconnect<span className="transition-transform duration-300 ease-out group-hover:translate-x-1" aria-hidden>→</span>
          </a>
          <button onClick={onDisconnect} className="text-[12px] font-medium text-amber-700/70 hover:text-amber-900 hover:underline">Disconnect</button>
        </div>
      </div>
    );
  }

  // Not connected (or expired) — the primary CTA to log in with Instagram.
  return (
    <div className="rounded-2xl border shadow-card px-5 py-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-4" style={{ borderColor: '#e7e1fb', background: ACCENT_SOFT }}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink-900">
          {c.expired ? 'Instagram connection expired' : 'Connect Instagram for live insights'}
        </div>
        <div className="text-[12.5px] text-ink-500 mt-0.5">
          {c.expired
            ? 'Reconnect to resume live reach, reel plays and audience data. Until then, analytics show your saved profile.'
            : 'See your real reel performance, reach and audience demographics — straight from Instagram.'}
        </div>
      </div>
      <a href="/api/oauth/instagram?flow=creator"
        className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold shadow-sm hover:brightness-105 hover:-translate-y-0.5 transition-all"
        style={{ background: IG_GRADIENT }}>
        <IgGlyph size={17} />{c.expired ? 'Reconnect' : 'Connect Instagram'}
      </a>
    </div>
  );
}

function QuickLink({ href, label, desc, icon, badge, alert }: {
  href: string; label: string; desc: string; icon?: ReactNode; badge?: string | null; alert?: boolean;
}) {
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
      {badge && (
        <span
          className={`shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${alert ? 'text-white' : ''}`}
          style={alert ? { background: '#f43f5e' } : { background: ACCENT_SOFT, color: ACCENT }}
        >
          {badge}
        </span>
      )}
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
