'use client';

import type { CSSProperties } from 'react';
import { useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { Doodle, DOODLE_HUES } from '@/components/doodles';
import { setBrandSession, type BrandDnaProfile } from '@/lib/brand-session';
import { addBrandToRoster } from '@/lib/agency-session';
import { useAgencyAccount } from '@/lib/use-agency-account';

const inp =
  'w-full px-3.5 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all';

// Hand-drawn doodles scattered around the login card so the page feels alive
// (float via .ii-floatr, auto-disabled under prefers-reduced-motion).
const LOGIN_DOODLES: { pos: CSSProperties; size: number; shape: number; hue: number; op: number; rot: string; delay: string }[] = [
  { pos: { top: '14%', left: '12%' }, size: 42, shape: 0, hue: 0, op: 0.5, rot: '-12deg', delay: '0s' },
  { pos: { top: '24%', right: '14%' }, size: 34, shape: 4, hue: 1, op: 0.45, rot: '10deg', delay: '1.1s' },
  { pos: { top: '62%', left: '9%' }, size: 46, shape: 6, hue: 3, op: 0.4, rot: '8deg', delay: '.6s' },
  { pos: { bottom: '12%', right: '12%' }, size: 38, shape: 2, hue: 5, op: 0.42, rot: '-8deg', delay: '1.8s' },
  { pos: { bottom: '18%', left: '18%' }, size: 30, shape: 7, hue: 6, op: 0.38, rot: '14deg', delay: '.9s' },
  { pos: { top: '8%', right: '30%' }, size: 26, shape: 5, hue: 8, op: 0.35, rot: '6deg', delay: '2.2s' },
];

// Staggered entrance — fades/lifts each block into place on load.
const enter = (delay: string): CSSProperties => ({ animationDelay: delay, animationFillMode: 'both' });

export default function BrandLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const { account, loading: accountLoading, logout } = useAgencyAccount();

  async function handleLogout() {
    await logout();
    // Back to the role chooser (Brand / Agency / Influencer / Admin), not this
    // brand-only form — that's where a signed-out user should land.
    window.location.href = '/login';
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
    <div className="relative min-h-screen overflow-hidden bg-[#fafafc] font-sans">
      {/* Soft colour glows behind the card */}
      <div aria-hidden className="pointer-events-none absolute -top-40 -left-32 h-[32rem] w-[32rem] rounded-full opacity-60 blur-3xl" style={{ background: 'radial-gradient(circle, rgba(108,77,246,.22), transparent 65%)' }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full opacity-50 blur-3xl" style={{ background: 'radial-gradient(circle, rgba(236,72,153,.18), transparent 65%)' }} />

      {/* Floating hand-drawn doodles */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {LOGIN_DOODLES.map((d, i) => (
          <Doodle
            key={i}
            shape={d.shape}
            color={DOODLE_HUES[d.hue]}
            className="ii-floatr absolute"
            style={{ ...d.pos, width: d.size, height: d.size, opacity: d.op, ['--r' as string]: d.rot, animationDelay: d.delay }}
          />
        ))}
      </div>

      {/* Log out — only when signed in; kept minimal in the top corner. */}
      {account && (
        <div className="absolute top-5 right-6 z-10">
          <button onClick={() => void handleLogout()} className="text-[13px] font-semibold text-ink-400 hover:text-ink-600 underline">
            Log out
          </button>
        </div>
      )}

      <div className="relative z-[1] min-h-screen flex items-center justify-center px-6 py-16">
        {accountLoading ? (
          <p className="text-center text-[14px] text-ink-500">Loading…</p>
        ) : (
          // Brand sign-in form — always shown so you can sign in fresh, even
          // when a session already exists (per product decision).
          <div className="w-full max-w-md">
            <header className="mb-7 text-center ii-fadeup" style={enter('0s')}>
              <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                Brand login
              </span>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink-900">Welcome back</h1>
              <p className="mt-2 text-[14.5px] text-ink-600">Sign in to your brand workspace.</p>
            </header>
            <form
              onSubmit={doLogin}
              className="ii-fadeup rounded-2xl bg-white/90 backdrop-blur-sm border border-border shadow-card p-7 space-y-4 transition-shadow hover:shadow-lg"
              style={enter('.08s')}
            >
              <label className="block">
                <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">Work email</span>
                <input className={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" autoComplete="email" />
              </label>
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-ink-500">Password</span>
                  <a href="/brand/reset" className="text-[12px] font-medium text-ink-400 hover:text-ink-600">Forgot password?</a>
                </span>
                <input className={inp} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" />
              </label>
              <button
                type="submit"
                disabled={loggingIn}
                className="w-full px-5 py-3 rounded-xl text-white text-[14px] font-semibold disabled:opacity-70 flex items-center justify-center gap-2 transition-transform active:scale-[.98] hover:brightness-105"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
              >
                {loggingIn && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {loggingIn ? 'Signing in…' : 'Sign in'}
              </button>
              {error && <p className="text-[13px] text-rose-600 text-center">{error}</p>}
            </form>
            <div className="ii-fadeup" style={enter('.16s')}>
              <p className="mt-5 text-center text-[13px] text-ink-500">
                New here? <a href="/brand/signup" className="font-semibold" style={{ color: ACCENT }}>Create a brand account</a>
              </p>
              <p className="mt-1.5 text-center text-[12.5px] text-ink-400">
                Managing brands for clients? <a href="/agency/login" className="font-semibold text-ink-500 hover:text-ink-700">Agency login →</a>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
