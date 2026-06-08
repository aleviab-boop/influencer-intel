'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MarketingNav, ACCENT } from '@/components/marketing';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [plan, setPlan] = useState<string | null>(null);

  useEffect(() => {
    setPlan(new URLSearchParams(window.location.search).get('plan'));
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    const params = new URLSearchParams(window.location.search);
    const plan = params.get('plan');
    const next = params.get('next');
    if (next) router.push(next);
    else if (plan) router.push(`/checkout?plan=${encodeURIComponent(plan)}`);
    else router.push('/lander');
  }

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1 grid place-items-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-4 text-white text-lg font-bold" style={{ background: ACCENT }}>i</div>
            <h1 className="text-2xl font-bold text-ink-900">Log in to Influencer Intel</h1>
            <p className="mt-2 text-[14px] text-ink-600">{plan ? <>Log in to continue to checkout for the <span className="font-semibold capitalize" style={{ color: ACCENT }}>{plan}</span> plan.</> : 'Welcome back — pick up where you left off.'}</p>
          </div>

          <form onSubmit={submit} className="rounded-2xl bg-white border border-border shadow-card p-6 space-y-4">
            <label className="block">
              <span className="text-[12px] text-ink-500 mb-1 block">Work email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" className={inp} />
            </label>
            <label className="block">
              <span className="flex items-center justify-between text-[12px] text-ink-500 mb-1">
                <span>Password</span>
                <a href="#" className="hover:underline" style={{ color: ACCENT }}>Forgot?</a>
              </span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={inp} />
            </label>
            <button type="submit" className="w-full px-4 py-2.5 rounded-xl text-white text-[14px] font-semibold bg-ink-900 hover:bg-ink-800 transition-colors">Log in</button>

            <div className="flex items-center gap-3 text-[12px] text-ink-400"><span className="flex-1 h-px bg-border" />or<span className="flex-1 h-px bg-border" /></div>

            <Link href="/creator" className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-[14px] font-medium border border-border hover:bg-[#faf9ff] transition-colors" style={{ color: ACCENT, borderColor: '#e3def9' }}>
              I’m a creator → creator login
            </Link>
          </form>

          <p className="mt-6 text-center text-[13px] text-ink-500">
            New to Influencer Intel? <Link href="/book-demo" className="font-semibold" style={{ color: ACCENT }}>Book a demo</Link>
          </p>
          <p className="mt-2 text-center text-[11px] text-ink-400">Demo login — any email gets you in.</p>
        </div>
      </main>
    </div>
  );
}

const inp = 'w-full px-3 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';
