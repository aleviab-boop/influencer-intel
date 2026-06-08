'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

type Role = 'agency' | 'influencer';

export default function SignupPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('agency');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // honour ?role= from the entry cards
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('role');
    if (r === 'influencer' || r === 'agency') setRole(r);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !/.+@.+\..+/.test(email)) return;
    // demo auth — remember the chosen role; for now both roles land on /lander
    try { localStorage.setItem('ii_role', role); } catch { /* ignore */ }
    router.push('/lander');
  }

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1 grid place-items-center px-6 py-14 relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
        <div className="relative w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-4 text-white text-lg font-bold" style={{ background: ACCENT }}>i</div>
            <h1 className="text-2xl font-bold text-ink-900">Create your account</h1>
            <p className="mt-2 text-[14px] text-ink-600">Join Influencer Intel — pick how you’ll use it.</p>
          </div>

          {/* role selector */}
          <div className="grid grid-cols-2 gap-2 mb-5">
            <RoleTab active={role === 'agency'} onClick={() => setRole('agency')} title="I’m an Agency" sub="Brand / marketer" />
            <RoleTab active={role === 'influencer'} onClick={() => setRole('influencer')} title="I’m an Influencer" sub="Creator" />
          </div>

          <form onSubmit={submit} className="rounded-2xl bg-white border border-border shadow-card p-6 space-y-4">
            <label className="block"><span className="text-[12px] text-ink-500 mb-1 block">{role === 'agency' ? 'Your name' : 'Creator name'}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={role === 'agency' ? 'Aisha Kapoor' : '@yourhandle'} className={inp} /></label>
            <label className="block"><span className="text-[12px] text-ink-500 mb-1 block">{role === 'agency' ? 'Work email' : 'Email'}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className={inp} /></label>
            <label className="block"><span className="text-[12px] text-ink-500 mb-1 block">Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={inp} /></label>
            <button type="submit" className="w-full px-4 py-2.5 rounded-xl text-white text-[14px] font-semibold bg-ink-900 hover:bg-ink-800 transition-colors">
              Create {role === 'influencer' ? 'creator' : 'agency'} account
            </button>
          </form>

          <p className="mt-5 text-center text-[13px] text-ink-500">Already have an account? <Link href={`/login?role=${role}`} className="font-semibold" style={{ color: ACCENT }}>Log in</Link></p>
          <p className="mt-1 text-center text-[11px] text-ink-400">Demo sign-up — any details get you in.</p>
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
