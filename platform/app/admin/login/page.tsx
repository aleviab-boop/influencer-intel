'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BrandMark } from '@/components/marketing';

const ACCENT = '#6C4DF6';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/admin';
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
        body: JSON.stringify({ password }),
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
    <div className="min-h-screen grid place-items-center bg-[#fafafc] px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <BrandMark size={30} />
          <span className="text-[16px] font-bold tracking-tight">Influencer Intel</span>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-[#ececf3] bg-white p-6 shadow-[0_12px_50px_rgba(108,77,246,0.08)]">
          <h1 className="text-lg font-bold tracking-tight">Admin sign-in</h1>
          <p className="mt-1 text-[13px] text-[#888]">Enter the admin password to access the panel.</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            placeholder="Password"
            className="mt-4 w-full px-3.5 py-2.5 rounded-xl border border-[#e3def9] text-[14px] focus:outline-none focus:border-[#6C4DF6] transition-colors"
          />
          {error && <div className="mt-2 text-[13px] text-rose-600">{error}</div>}
          <button
            type="submit"
            disabled={loading || password.length === 0}
            className="mt-4 w-full py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-50 transition-opacity"
            style={{ background: ACCENT }}
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
