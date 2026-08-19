'use client';

import { useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';

// Agency account auth — real email + password. Signing in owns your roster of
// brands server-side (brand_dna.account_id), so "your brands" follows you across
// devices instead of living only in this browser.
export default function AgencyLoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const endpoint = mode === 'signup' ? '/api/agency/signup' : '/api/agency/login';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: mode === 'signup' ? name.trim() || undefined : undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || 'Something went wrong. Try again.');
        setLoading(false);
        return;
      }
      // Signed in — send them to the brand picker (roster hydrates from server).
      window.location.href = '/brand/login';
    } catch {
      setError('Could not reach the server. Try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafc] font-sans grid place-items-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
            Agency account
          </span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink-900">
            {mode === 'signup' ? 'Create your agency account' : 'Sign in to your agency'}
          </h1>
          <p className="mt-2 text-[14px] text-ink-600">
            One account for all the brands you handle — your roster follows you across devices.
          </p>
        </div>

        <form onSubmit={submit} className="rounded-2xl bg-white border border-border shadow-card p-6 space-y-4">
          {mode === 'signup' && (
            <label className="block">
              <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">Agency / your name</span>
              <input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northlight Media" />
            </label>
          )}
          <label className="block">
            <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">Email</span>
            <input className={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@agency.com" />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">Password</span>
            <input className={inp} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'} />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-70 flex items-center justify-center gap-2"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
          >
            {loading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
            {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          {error && <p className="text-[13px] text-rose-600 text-center">{error}</p>}
        </form>

        <p className="mt-4 text-center text-[13px] text-ink-500">
          {mode === 'signup' ? 'Already have an account?' : 'New here?'}{' '}
          <button
            onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); }}
            className="font-semibold"
            style={{ color: ACCENT }}
          >
            {mode === 'signup' ? 'Sign in' : 'Create an agency account'}
          </button>
        </p>
      </div>
    </div>
  );
}

const inp =
  'w-full px-3.5 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all';
