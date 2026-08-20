'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ACCENT, ACCENT_SOFT, BrandMark } from '@/components/marketing';

type Role = 'brand' | 'agency' | 'influencer' | 'admin';

const PANEL: Record<Role, { headline: string; sub: string; points: string[] }> = {
  brand: {
    headline: 'Your brand, its own command center',
    sub: 'Sign in for a single brand and run it end to end.',
    points: [
      'Auto-distilled brand DNA from your site',
      'Discover & save creators to your pipeline',
      'One-click outreach, tracked to won',
    ],
  },
  agency: {
    headline: 'Run smarter influencer campaigns',
    sub: 'Discover, recruit and pay creators — all in one place.',
    points: [
      'Find creators with a plain-English brief',
      'Live Instagram search, ranked by relevance',
      'Briefs, contracts & payouts in one flow',
    ],
  },
  influencer: {
    headline: 'Turn your influence into income',
    sub: 'Get matched with real brand campaigns that fit you.',
    points: [
      'Get matched with verified brands',
      'Set your own rates, on your terms',
      'On-time payouts, tracked end to end',
    ],
  },
  admin: {
    headline: 'Platform control center',
    sub: 'Run the crawler, live-data pipeline and creator database.',
    points: [
      'Scraper & live-data pipeline health',
      'Crawl jobs, accounts & coverage',
      'Full creator database controls',
    ],
  },
};

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('agency');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const params = new URLSearchParams(window.location.search);
    setPlan(params.get('plan'));
    const r = params.get('role');
    if (r === 'brand' || r === 'influencer' || r === 'agency' || r === 'admin') setRole(r);
  }, []);

  // Clear fields/errors when switching roles — no pre-filled credentials.
  useEffect(() => {
    setError(null);
    setName('');
    setEmail('');
    setPassword('');
  }, [role]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);

    // Super-admin role authenticates against the separate admin gate and lands
    // on the /admin control panel (not the agency/influencer app).
    if (role === 'admin') {
      if (!email.trim() || !password) { setError('Enter the admin email and password.'); return; }
      setLoading(true);
      try {
        const r = await fetch('/api/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password, name: name.trim() || undefined }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setError(d.error || 'Login failed.'); setLoading(false); return; }
      } catch {
        setError('Could not reach the server. Try again.'); setLoading(false); return;
      }
      try { localStorage.setItem('ii_role', 'admin'); } catch { /* ignore */ }
      const next = new URLSearchParams(window.location.search).get('next');
      // Never bounce back to the (deleted) /admin/login — land on the panel.
      const dest = next && next.startsWith('/admin') && next !== '/admin/login' ? next : '/admin';
      router.push(dest);
      return;
    }

    // Agency role uses real email + password accounts. (Influencers never reach
    // here — the influencer tab renders the Instagram OAuth card, not this form.)
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign_in', email: email.trim(), password, brand_name: name.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'Login failed.'); setLoading(false); return; }
    } catch {
      setError('Could not reach the server. Try again.'); setLoading(false); return;
    }
    try { localStorage.setItem('ii_role', role); } catch { /* ignore */ }
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const p = params.get('plan');
    if (next) router.push(next);
    else if (p) router.push(`/checkout?plan=${encodeURIComponent(p)}`);
    else router.push('/lander');
  }

  const panel = PANEL[role];

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <style>{`
        @keyframes ii-rise { from { opacity:0; transform: translateY(14px) } to { opacity:1; transform:none } }
        @keyframes ii-blob { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(20px,-24px) scale(1.12) } }
        @keyframes ii-drift1 { 0%,100% { transform: translate(0,0) scale(1) } 33% { transform: translate(40px,30px) scale(1.1) } 66% { transform: translate(-30px,20px) scale(.95) } }
        @keyframes ii-drift2 { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(-50px,-30px) scale(1.15) } }
        @keyframes ii-drift3 { 0%,100% { transform: translate(0,0) } 50% { transform: translate(30px,-40px) } }
        @keyframes ii-spin { to { transform: rotate(360deg) } }
        @keyframes ii-float { 0%,100% { transform: translate(0,0) } 50% { transform: translate(6px,-18px) } }
        @keyframes ii-twinkle { 0%,100% { opacity:.15 } 50% { opacity:.6 } }
        @keyframes ii-shimmer { 0% { transform: translateX(-160%) } 100% { transform: translateX(360%) } }
      `}</style>
      <main className="flex-1 grid place-items-center px-4 sm:px-6 py-10 relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.15), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.12), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />

        {/* animated background orbs — pushed to the corners so they peek out
            around the centered card */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full blur-3xl opacity-70" style={{ background: 'radial-gradient(circle, #9b7bff, transparent 68%)', animation: 'ii-drift1 16s ease-in-out infinite' }} />
          <div className="absolute -bottom-28 -right-24 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-60" style={{ background: 'radial-gradient(circle, #6C4DF6, transparent 68%)', animation: 'ii-drift2 19s ease-in-out infinite' }} />
          <div className="absolute top-[18%] -right-16 w-72 h-72 rounded-full blur-3xl opacity-55" style={{ background: 'radial-gradient(circle, #b9a8ff, transparent 68%)', animation: 'ii-drift3 14s ease-in-out infinite' }} />
          <div className="absolute -bottom-20 left-[6%] w-80 h-80 rounded-full blur-3xl opacity-50" style={{ background: 'radial-gradient(circle, #c4b5ff, transparent 68%)', animation: 'ii-drift1 22s ease-in-out infinite reverse' }} />
          {/* rotating conic ring, top-centre */}
          <div className="absolute -top-56 left-1/2 -translate-x-1/2 w-[680px] h-[680px] rounded-full opacity-[0.12]" style={{ background: `conic-gradient(from 0deg, ${ACCENT}, transparent 28%, #9b7bff 55%, transparent 85%)`, animation: 'ii-spin 36s linear infinite' }} />
        </div>

        <div
          className="relative z-10 w-full max-w-5xl grid md:grid-cols-2 rounded-3xl overflow-hidden border border-border bg-white shadow-[0_30px_80px_rgba(108,77,246,0.18)] transition-all duration-700"
          style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(24px)' }}
        >
          {/* Left brand panel */}
          <div className="relative hidden md:flex flex-col justify-between p-9 text-white overflow-hidden" style={{ background: `linear-gradient(150deg, ${ACCENT}, #7c5cff 55%, #9b7bff)` }}>
            <div className="absolute -top-16 -right-10 w-64 h-64 rounded-full bg-white/15 blur-2xl" style={{ animation: 'ii-blob 9s ease-in-out infinite' }} />
            <div className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-black/10 blur-2xl" style={{ animation: 'ii-blob 11s ease-in-out infinite reverse' }} />

            {/* floating particles + light shimmer sweep behind the content */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute inset-0 rotate-12">
                <div className="absolute top-0 h-full w-1/3" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent)', animation: 'ii-shimmer 7s ease-in-out infinite' }} />
              </div>
              {[
                { l: '12%', t: '24%', s: 10, d: '0s', dur: '11s' },
                { l: '80%', t: '30%', s: 7, d: '1.5s', dur: '9s' },
                { l: '28%', t: '68%', s: 14, d: '.8s', dur: '13s' },
                { l: '64%', t: '80%', s: 6, d: '2.2s', dur: '10s' },
                { l: '86%', t: '58%', s: 9, d: '.4s', dur: '12s' },
                { l: '20%', t: '46%', s: 5, d: '3s', dur: '8s' },
                { l: '52%', t: '16%', s: 6, d: '1.1s', dur: '10s' },
              ].map((p, i) => (
                <span key={i} className="absolute rounded-full bg-white" style={{ left: p.l, top: p.t, width: p.s, height: p.s, animation: `ii-float ${p.dur} ease-in-out ${p.d} infinite, ii-twinkle ${p.dur} ease-in-out ${p.d} infinite` }} />
              ))}
            </div>

            <div className="relative flex items-center gap-2">
              <span className="w-9 h-9 rounded-xl grid place-items-center bg-white/90 backdrop-blur"><BrandMark size={26} /></span>
              <span className="text-[15px] font-bold">Influencer Intel</span>
            </div>

            <div className="relative">
              <h2 key={role} className="text-[28px] font-bold leading-tight" style={{ animation: 'ii-rise .4s both' }}>
                {panel.headline}
              </h2>
              <p className="mt-2 text-[14px] text-white/80">{panel.sub}</p>
              <ul className="mt-6 space-y-3">
                {panel.points.map((pt, i) => (
                  <li key={pt} className="flex items-center gap-2.5 text-[14px]" style={{ animation: `ii-rise .45s ${i * 90}ms both` }}>
                    <span className="w-5 h-5 rounded-full grid place-items-center bg-white/20 shrink-0">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10" /></svg>
                    </span>
                    {pt}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative flex items-center gap-3 text-[12px] text-white/70">
              <div className="flex -space-x-2">
                {['#f59e0b', '#ec4899', '#10b981'].map((c) => (
                  <span key={c} className="w-6 h-6 rounded-full ring-2 ring-white/40" style={{ background: c }} />
                ))}
              </div>
              Trusted by 12K+ creators &amp; 500+ brands
            </div>
          </div>

          {/* Right form panel */}
          <div className="p-7 sm:p-9">
            <div className="md:hidden mb-4"><BrandMark size={40} /></div>
            <h1 className="text-2xl font-bold text-ink-900">Welcome back</h1>
            <p className="mt-1.5 text-[14px] text-ink-600">
              {plan ? <>Log in to continue to the <span className="font-semibold capitalize" style={{ color: ACCENT }}>{plan}</span> plan checkout.</> : 'Log in to your account to continue.'}
            </p>

            {/* role selector */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <RoleTab active={role === 'brand'} onClick={() => setRole('brand')} title="Brand" sub="Your own brand" icon={ICONS.brand} />
              <RoleTab active={role === 'agency'} onClick={() => setRole('agency')} title="Agency" sub="Manage clients" icon={ICONS.agency} />
              <RoleTab active={role === 'influencer'} onClick={() => setRole('influencer')} title="Influencer" sub="Creator" icon={ICONS.influencer} />
              <RoleTab active={role === 'admin'} onClick={() => setRole('admin')} title="Admin" sub="Super admin" icon={ICONS.admin} />
            </div>

            {role === 'brand' ? (
              <div className="mt-6 rounded-2xl border border-border bg-ink-50/40 px-6 py-9 text-center" style={{ animation: 'ii-rise .35s both' }}>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                  {ICONS.brand}
                </div>
                <h3 className="text-[17px] font-semibold text-ink-900">Your own brand workspace</h3>
                <p className="mt-1.5 text-[13px] text-ink-500">Sign in for a single brand — we distil your brand DNA and open a workspace scoped to you: campaigns, creators, pipeline &amp; outreach.</p>

                <a href="/brand/login" className="group mt-6 flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl text-white text-[14px] font-semibold hover:brightness-105 hover:-translate-y-0.5 transition-all duration-200" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                  Sign in to your brand
                  <svg className="transition-transform duration-300 group-hover:translate-x-1" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </a>
                <a href="/brand/signup" className="mt-3 flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl text-[14px] font-semibold border border-border text-ink-700 hover:border-[#c9bdfb] hover:bg-white transition-all duration-200">
                  Create a brand account
                </a>
                <p className="mt-3 text-[11px] text-ink-400">Managing brands for clients? Use the Agency tab.</p>
              </div>
            ) : role === 'influencer' ? (
              <div className="mt-6 rounded-2xl border border-border bg-ink-50/40 px-6 py-9 text-center" style={{ animation: 'ii-rise .35s both' }}>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5" /><path d="M4 15l4-4 4 3 6-6" /><path d="M15 8h5v5" /></svg>
                </div>
                <h3 className="text-[17px] font-semibold text-ink-900">Log in with Instagram</h3>
                <p className="mt-1.5 text-[13px] text-ink-500">Connect your account to see your analytics, media kit &amp; brand matches. No password, no setup — we build your creator profile automatically.</p>

                <a href="/api/oauth/instagram?flow=creator" className="mt-6 flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl text-white text-[14px] font-semibold hover:brightness-105 hover:-translate-y-0.5 transition-all duration-200" style={{ background: 'linear-gradient(90deg,#F58529,#DD2A7B,#8134AF)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
                  Continue with Instagram
                </a>
                <p className="mt-3 text-[11px] text-ink-400">Use a Business or Creator account for full insights. We never see your password.</p>
              </div>
            ) : (
            <>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className="flex items-center justify-between text-[12px] font-medium text-ink-500 mb-1.5">
                  <span>Your name</span>
                  <span className="font-normal text-ink-400">optional</span>
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Aisha Kapoor"
                  className={inp}
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">{role === 'agency' ? 'Work email' : role === 'admin' ? 'Admin email' : 'Email'}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={role === 'agency' ? 'you@brand.com' : role === 'admin' ? 'admin@influencerintel.com' : 'you@email.com'}
                  className={inp}
                  autoFocus
                />
              </label>

              <label className="block">
                <span className="flex items-center justify-between text-[12px] font-medium text-ink-500 mb-1.5">
                  <span>Password</span>
                  <a href="#" className="hover:underline font-normal" style={{ color: ACCENT }}>Forgot?</a>
                </span>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className={`${inp} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 p-1"
                  >
                    {showPw ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 002.8 2.8" /><path d="M9.4 5.1A9.5 9.5 0 0112 5c5 0 9 4 9 7a12 12 0 01-2.2 3.2M6.2 6.2A12 12 0 003 12c0 3 4 7 9 7a9.7 9.7 0 003.6-.7" /></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                </div>
              </label>

              {error && (
                <div className="text-[13px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group w-full px-4 py-3 rounded-xl text-white text-[14px] font-semibold transition-all duration-300 hover:brightness-105 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(108,77,246,0.35)] active:translate-y-0 disabled:opacity-70 disabled:hover:translate-y-0 flex items-center justify-center gap-2"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
              >
                {loading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {loading ? 'Logging in…' : role === 'admin' ? 'Enter admin panel' : 'Log in as agency'}
                {!loading && (
                  <svg className="transition-transform duration-300 group-hover:translate-x-1" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                )}
              </button>
            </form>

            {role === 'admin' ? (
              <p className="mt-6 text-center text-[11px] text-ink-400">Restricted — platform staff only.</p>
            ) : (
              <>
                <p className="mt-6 text-center text-[13px] text-ink-500">New here? <Link href={`/signup?role=${role}`} className="font-semibold" style={{ color: ACCENT }}>Create an account</Link></p>
                <p className="mt-1 text-center text-[11px] text-ink-400">Agency demo login — agency@gmail.com / agency</p>
              </>
            )}
            </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

const ICONS = {
  brand: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16l-1.2 4.2A2 2 0 0 1 16.9 9.7L16 10" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" /><path d="M3 4l1.5 5a2.5 2.5 0 0 0 5 0L10 4M14 4l.5 5a2.5 2.5 0 0 0 5 0L21 4" /><path d="M9 20v-5h6v5" /></svg>
  ),
  agency: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></svg>
  ),
  influencer: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 5.2L20 8l-4 4 1 6-5-2.8L7 18l1-6-4-4 5.6-.8z" /></svg>
  ),
  admin: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
  ),
};

function RoleTab({ active, onClick, title, sub, icon }: { active: boolean; onClick: () => void; title: string; sub: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border-2 px-3 py-3 text-left transition-all duration-300 ease-out hover:-translate-y-1 active:translate-y-0 ${active ? '' : 'hover:border-[#c9bdfb] hover:shadow-[0_12px_28px_rgba(108,77,246,0.16)]'}`}
      style={active ? { borderColor: ACCENT, background: ACCENT_SOFT, boxShadow: '0 10px 26px rgba(108,77,246,0.18)' } : { borderColor: '#e6e6e6', background: '#fff' }}
    >
      <span
        className={`mb-2 inline-grid place-items-center w-8 h-8 rounded-lg transition-all duration-300 group-hover:scale-110 ${active ? 'text-white' : 'text-ink-400 group-hover:text-[#6C4DF6]'}`}
        style={active ? { background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)`, boxShadow: '0 6px 14px rgba(108,77,246,0.35)' } : { background: '#f3f0fd' }}
      >
        {icon}
      </span>
      <div className="text-[13.5px] font-semibold text-ink-900">{title}</div>
      <div className="text-[11px] text-ink-400 truncate">{sub}</div>
      <span className={`absolute top-2.5 right-2.5 w-2 h-2 rounded-full transition-all duration-300 ${active ? 'opacity-100 scale-100' : 'opacity-0 scale-0'}`} style={{ background: ACCENT }} />
    </button>
  );
}

const inp = 'w-full px-3.5 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl hover:border-[#c9bdfb] focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all duration-200';
