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
    <div className="min-h-screen relative flex items-center justify-start pl-8 sm:pl-16 lg:pl-28 pr-6 py-12 overflow-hidden font-sans" style={{ background: 'linear-gradient(135deg, #6C4DF6 0%, #7d5cf0 42%, #b79bff 100%)' }}>
      {/* grid texture */}
      <div className="absolute inset-0 opacity-[0.10]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '46px 46px' }} />
      {/* floating gradient orbs */}
      <div className="absolute -top-32 -right-24 w-[32rem] h-[32rem] rounded-full opacity-30 blur-3xl" style={{ background: 'radial-gradient(circle, #ffffff, transparent 66%)' }} />
      <div className="absolute -bottom-36 -left-24 w-[34rem] h-[34rem] rounded-full opacity-25 blur-3xl" style={{ background: 'radial-gradient(circle, #d9c9ff, transparent 62%)' }} />
      <div className="absolute top-1/4 left-[30%] w-56 h-56 rounded-full opacity-25 blur-2xl" style={{ background: 'radial-gradient(circle, #ffd6f0, transparent 62%)' }} />

      {/* card on top of the gradient */}
      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 pl-1">
          <BrandMark size={44} />
          <span className="text-[28px] font-semibold tracking-tight leading-none text-white drop-shadow-sm">Influencer Intel</span>
        </div>

        <form onSubmit={submit} className="w-full rounded-3xl border border-white/40 bg-white/95 backdrop-blur-xl p-9 shadow-[0_30px_80px_rgba(40,20,90,0.35)]">
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

        <p className="mt-6 text-center text-[12px] text-white/70">Superadmin access · Influencer Intel</p>
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
