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
    <div className="min-h-screen grid place-items-center px-6" style={{ background: 'radial-gradient(900px 500px at 50% -10%, #f2ecff, #fafafc 60%)' }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3.5 justify-center mb-8">
          <BrandMark size={56} />
          <span className="text-[40px] font-semibold tracking-tight leading-none">Influencer Intel</span>
        </div>
        <form onSubmit={submit} className="rounded-3xl border border-[#ececf3] bg-white p-9 shadow-[0_24px_70px_rgba(108,77,246,0.12)]">
          <div className="relative -mt-9 -mx-9 mb-7 h-1.5 rounded-t-3xl" style={{ background: `linear-gradient(90deg, ${ACCENT}, #9b7bff)` }} />
          <h1 className="text-2xl font-semibold tracking-tight">Admin sign-in</h1>
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
