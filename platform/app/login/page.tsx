'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MarketingNav, ACCENT, ACCENT_SOFT, BrandMark } from '@/components/marketing';

type Role = 'agency' | 'influencer';

const PANEL: Record<Role, { headline: string; sub: string; points: string[] }> = {
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
};

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('agency');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const params = new URLSearchParams(window.location.search);
    setPlan(params.get('plan'));
    const r = params.get('role');
    if (r === 'influencer' || r === 'agency') setRole(r);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || loading) return;
    setLoading(true);
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
      `}</style>
      <MarketingNav />
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
            <div className="mt-6 grid grid-cols-2 gap-2">
              <RoleTab active={role === 'agency'} onClick={() => setRole('agency')} title="Agency" sub="Brand / marketer" />
              <RoleTab active={role === 'influencer'} onClick={() => setRole('influencer')} title="Influencer" sub="Creator" />
            </div>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">{role === 'agency' ? 'Work email' : 'Email'}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={role === 'agency' ? 'you@brand.com' : 'you@email.com'}
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
                    placeholder="••••••••"
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

              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-3 rounded-xl text-white text-[14px] font-semibold transition-all hover:brightness-105 disabled:opacity-70 flex items-center justify-center gap-2"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
              >
                {loading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {loading ? 'Logging in…' : `Log in as ${role === 'influencer' ? 'influencer' : 'agency'}`}
              </button>

              {role === 'influencer' && (
                <div style={{ animation: 'ii-rise .35s both' }}>
                  <div className="flex items-center gap-3 text-[12px] text-ink-400 my-1"><span className="flex-1 h-px bg-border" />or<span className="flex-1 h-px bg-border" /></div>
                  <a href="/api/oauth/instagram?flow=creator" className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-white text-[14px] font-semibold hover:brightness-105 transition" style={{ background: 'linear-gradient(90deg,#F58529,#DD2A7B,#8134AF)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
                    Continue with Instagram
                  </a>
                </div>
              )}
            </form>

            <p className="mt-6 text-center text-[13px] text-ink-500">New here? <Link href={`/signup?role=${role}`} className="font-semibold" style={{ color: ACCENT }}>Create an account</Link></p>
            <p className="mt-1 text-center text-[11px] text-ink-400">Demo login — any email gets you in.</p>
          </div>
        </div>
      </main>
    </div>
  );
}

function RoleTab({ active, onClick, title, sub }: { active: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border-2 px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5"
      style={active ? { borderColor: ACCENT, background: ACCENT_SOFT, boxShadow: '0 6px 20px rgba(108,77,246,0.15)' } : { borderColor: '#e5e5e5', background: '#fff' }}
    >
      <div className="text-[14px] font-semibold text-ink-900">{title}</div>
      <div className="text-[11px] text-ink-400">{sub}</div>
    </button>
  );
}

const inp = 'w-full px-3.5 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all';
