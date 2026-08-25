'use client';

import { useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { setBrandSession, type BrandDnaProfile } from '@/lib/brand-session';
import { addBrandToRoster } from '@/lib/agency-session';
import { useAgencyAccount } from '@/lib/use-agency-account';

const inp =
  'w-full px-3.5 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all';

export default function BrandLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const { account, loading: accountLoading, logout } = useAgencyAccount();

  async function handleLogout() {
    await logout();
    window.location.reload();
  }

  // Credentialed sign-in: email + password → brand account (account_type='brand')
  // or an agency account (same backend). We get the account's owned brands back;
  // a single-brand account drops straight into its workspace, and a multi-brand
  // account lands in the workspace with all brands loaded into the switcher.
  // Brands are never previewed here — switching happens inside /brand/home.
  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loggingIn) return;
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email.');
    if (!password) return setError('Enter your password.');
    setLoggingIn(true);
    try {
      const r = await fetch('/api/brand/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || 'Could not sign in.');
        setLoggingIn(false);
        return;
      }
      const owned = (Array.isArray(d.brands) ? d.brands : []) as { brand: string; category: string | null; dna: BrandDnaProfile }[];
      if (owned.length === 0) {
        window.location.href = '/brand-dna';
        return;
      }
      // Load every owned brand into the roster so the workspace switcher lists
      // them all, then open the workspace on the first (default) brand.
      for (const b of owned) addBrandToRoster({ brand: b.brand, category: b.category ?? null, dna: b.dna, ts: Date.now() });
      const first = owned[0]!;
      setBrandSession({ brand: first.brand, mode: 'barter', dna: first.dna, ts: Date.now() });
      window.location.href = '/brand/home';
    } catch {
      setError('Could not reach the server. Try again.');
      setLoggingIn(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafc] font-sans">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Account strip — only when signed in (the login card carries the links). */}
        {account && (
          <div className="mb-6 flex justify-end">
            <div className="flex items-center gap-3 text-[13px]">
              <span className="text-ink-500">
                Signed in as <span className="font-semibold text-ink-800">{account.name || account.email}</span>
              </span>
              <a href="/brand/home" className="font-semibold" style={{ color: ACCENT }}>
                Go to workspace →
              </a>
              <button onClick={() => void handleLogout()} className="font-semibold text-ink-400 hover:text-ink-600 underline">
                Log out
              </button>
            </div>
          </div>
        )}

        {accountLoading ? (
          <p className="text-center text-[14px] text-ink-500 py-16">Loading…</p>
        ) : (
          // Brand sign-in form — always shown so you can sign in fresh, even
          // when a session already exists (per product decision).
          <div className="max-w-md mx-auto">
            <header className="mb-6 text-center">
              <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                Brand login
              </span>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-900">Welcome back</h1>
              <p className="mt-2 text-[14.5px] text-ink-600">Sign in to your brand workspace.</p>
            </header>
            <form onSubmit={doLogin} className="rounded-2xl bg-white border border-border shadow-card p-6 space-y-4">
              <label className="block">
                <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">Work email</span>
                <input className={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" autoComplete="email" />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">Password</span>
                <input className={inp} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" />
              </label>
              <button
                type="submit"
                disabled={loggingIn}
                className="w-full px-5 py-3 rounded-xl text-white text-[14px] font-semibold disabled:opacity-70 flex items-center justify-center gap-2"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
              >
                {loggingIn && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {loggingIn ? 'Signing in…' : 'Sign in'}
              </button>
              {error && <p className="text-[13px] text-rose-600 text-center">{error}</p>}
            </form>
            <p className="mt-5 text-center text-[13px] text-ink-500">
              New here? <a href="/brand/signup" className="font-semibold" style={{ color: ACCENT }}>Create a brand account</a>
            </p>
            <p className="mt-1.5 text-center text-[12.5px] text-ink-400">
              Managing brands for clients? <a href="/agency/login" className="font-semibold text-ink-500 hover:text-ink-700">Agency login →</a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
