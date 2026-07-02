'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BrandMark } from '@/components/marketing';

const ACCENT = '#6C4DF6';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (r.ok) {
        router.replace(next);
        router.refresh();
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Incorrect password');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex font-sans">
      {/* LEFT — sign-in form, left-aligned */}
      <div className="relative w-full lg:w-[46%] flex flex-col justify-center px-8 sm:px-14 lg:px-20 py-12 overflow-hidden" style={{ background: 'radial-gradient(720px 420px at 15% 0%, #f3efff, #ffffff 62%)' }}>
        <div className="absolute -left-20 top-16 w-72 h-72 rounded-full opacity-50 blur-3xl" style={{ background: 'radial-gradient(circle, #e9e0fd, transparent 70%)' }} />
        <div className="absolute right-6 bottom-10 w-40 h-40 rounded-full opacity-40 blur-2xl" style={{ background: 'radial-gradient(circle, #dce6ff, transparent 65%)' }} />

        <div className="relative w-full max-w-md">
          <div className="flex items-center gap-3 mb-9">
            <BrandMark size={44} />
            <span className="text-[28px] font-semibold tracking-tight leading-none">Influencer Intel</span>
          </div>

          <form onSubmit={submit} className="w-full rounded-3xl border border-[#ececf3] bg-white/90 backdrop-blur p-9 shadow-[0_24px_70px_rgba(108,77,246,0.14)]">
            <div className="relative -mt-9 -mx-9 mb-7 h-1.5 rounded-t-3xl" style={{ background: `linear-gradient(90deg, ${ACCENT}, #9b7bff, #d9c9ff)` }} />
            <h1 className="text-2xl font-semibold tracking-tight bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(115deg, #17172b 40%, ${ACCENT})` }}>Admin sign-in</h1>
            <p className="mt-1.5 text-[14px] text-[#888]">Sign in with your superadmin credentials.</p>
            <label className="block mt-6 text-[13px] font-medium text-[#666]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              placeholder="you@company.com"
              autoComplete="username"
              className="mt-1.5 w-full px-4 py-3 rounded-xl border border-[#e3def9] text-[15px] focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all"
            />
            <label className="block mt-4 text-[13px] font-medium text-[#666]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="mt-1.5 w-full px-4 py-3 rounded-xl border border-[#e3def9] text-[15px] focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all"
            />
            {error && <div className="mt-3 text-[13px] text-rose-600">{error}</div>}
            <button
              type="submit"
              disabled={loading || email.length === 0 || password.length === 0}
              className="mt-6 w-full py-3 rounded-xl text-white text-[15px] font-semibold disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              {loading ? 'Checking…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-[12px] text-[#aab]">Superadmin access · Influencer Intel</p>
        </div>
      </div>

      {/* RIGHT — decorative gradient panel */}
      <div className="hidden lg:flex relative flex-1 items-center justify-center overflow-hidden" style={{ background: 'linear-gradient(135deg, #6C4DF6 0%, #7d5cf0 42%, #b79bff 100%)' }}>
        {/* floating gradient orbs */}
        <div className="absolute -top-28 -right-16 w-[26rem] h-[26rem] rounded-full opacity-30 blur-2xl" style={{ background: 'radial-gradient(circle, #ffffff, transparent 66%)' }} />
        <div className="absolute -bottom-28 -left-16 w-[28rem] h-[28rem] rounded-full opacity-25 blur-2xl" style={{ background: 'radial-gradient(circle, #d9c9ff, transparent 62%)' }} />
        <div className="absolute top-1/3 left-1/4 w-44 h-44 rounded-full opacity-30 blur-xl" style={{ background: 'radial-gradient(circle, #ffd6f0, transparent 62%)' }} />
        {/* subtle grid texture */}
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '46px 46px' }} />

        <div className="relative z-10 px-16 max-w-lg text-white">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[12px] font-semibold mb-6 border border-white/20" style={{ background: 'rgba(255,255,255,0.14)' }}>
            <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" /> Live scraper control
          </div>
          <h2 className="text-[38px] font-semibold leading-[1.15] tracking-tight">Influencer intelligence,<br />in real time.</h2>
          <p className="mt-4 text-[15px] text-white/80 leading-relaxed">Crawl niches, rotate accounts, and surface the right creators — all from one dashboard.</p>
          <div className="mt-9 grid grid-cols-3 gap-3">
            {([['Niches', '20+'], ['Cities', '15'], ['Uptime', '24/7']] as const).map(([k, v]) => (
              <div key={k} className="rounded-2xl px-4 py-3.5 border border-white/15" style={{ background: 'rgba(255,255,255,0.10)' }}>
                <div className="text-[22px] font-semibold leading-none">{v}</div>
                <div className="mt-1 text-[12px] text-white/70">{k}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
