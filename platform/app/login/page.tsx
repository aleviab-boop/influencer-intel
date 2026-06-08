'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

type Role = 'agency' | 'influencer';

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('agency');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [plan, setPlan] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPlan(params.get('plan'));
    const r = params.get('role');
    if (r === 'influencer' || r === 'agency') setRole(r);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    try { localStorage.setItem('ii_role', role); } catch { /* ignore */ }
    if (role === 'influencer') { router.push('/creator'); return; }
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const p = params.get('plan');
    if (next) router.push(next);
    else if (p) router.push(`/checkout?plan=${encodeURIComponent(p)}`);
    else router.push('/lander');
  }

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1 grid place-items-center px-6 py-14 relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
        <div className="relative w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-4 text-white text-lg font-bold" style={{ background: ACCENT }}>i</div>
            <h1 className="text-2xl font-bold text-ink-900">Log in to Influencer Intel</h1>
            <p className="mt-2 text-[14px] text-ink-600">{plan ? <>Log in to continue to checkout for the <span className="font-semibold capitalize" style={{ color: ACCENT }}>{plan}</span> plan.</> : 'Welcome back — log in to your account.'}</p>
          </div>

          {/* role selector */}
          <div className="grid grid-cols-2 gap-2 mb-5">
            <RoleTab active={role === 'agency'} onClick={() => setRole('agency')} title="Agency" sub="Brand / marketer" />
            <RoleTab active={role === 'influencer'} onClick={() => setRole('influencer')} title="Influencer" sub="Creator" />
          </div>

          <form onSubmit={submit} className="rounded-2xl bg-white border border-border shadow-card p-6 space-y-4">
            <label className="block">
              <span className="text-[12px] text-ink-500 mb-1 block">{role === 'agency' ? 'Work email' : 'Email'}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={role === 'agency' ? 'you@brand.com' : 'you@email.com'} className={inp} />
            </label>
            <label className="block">
              <span className="flex items-center justify-between text-[12px] text-ink-500 mb-1"><span>Password</span><a href="#" className="hover:underline" style={{ color: ACCENT }}>Forgot?</a></span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={inp} />
            </label>
            <button type="submit" className="w-full px-4 py-2.5 rounded-xl text-white text-[14px] font-semibold bg-ink-900 hover:bg-ink-800 transition-colors">Log in as {role === 'influencer' ? 'influencer' : 'agency'}</button>

            {role === 'influencer' && (
              <>
                <div className="flex items-center gap-3 text-[12px] text-ink-400"><span className="flex-1 h-px bg-border" />or<span className="flex-1 h-px bg-border" /></div>
                <a href="/api/oauth/instagram?flow=creator" className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-white text-[14px] font-semibold" style={{ background: 'linear-gradient(90deg,#F58529,#DD2A7B,#8134AF)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
                  Continue with Instagram
                </a>
              </>
            )}
          </form>

          <p className="mt-5 text-center text-[13px] text-ink-500">New to Influencer Intel? <Link href={`/signup?role=${role}`} className="font-semibold" style={{ color: ACCENT }}>Sign up</Link></p>
          <p className="mt-1 text-center text-[11px] text-ink-400">Demo login — any email gets you in.</p>
        </div>
      </main>
    </div>
  );
}

function RoleTab({ active, onClick, title, sub }: { active: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button onClick={onClick} className="rounded-xl border-2 px-4 py-3 text-left transition-colors" style={active ? { borderColor: ACCENT, background: ACCENT_SOFT } : { borderColor: '#e5e5e5', background: '#fff' }}>
      <div className="text-[14px] font-semibold text-ink-900">{title}</div>
      <div className="text-[11px] text-ink-400">{sub}</div>
    </button>
  );
}

const inp = 'w-full px-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
