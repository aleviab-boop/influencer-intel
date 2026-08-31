'use client';

import type { CSSProperties } from 'react';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { Doodle, DOODLE_HUES } from '@/components/doodles';

const inp =
  'w-full px-3.5 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all';

const RESET_DOODLES: { pos: CSSProperties; size: number; shape: number; hue: number; op: number; rot: string; delay: string }[] = [
  { pos: { top: '16%', left: '13%' }, size: 40, shape: 0, hue: 0, op: 0.5, rot: '-12deg', delay: '0s' },
  { pos: { top: '26%', right: '15%' }, size: 32, shape: 4, hue: 1, op: 0.45, rot: '10deg', delay: '1.1s' },
  { pos: { bottom: '16%', right: '13%' }, size: 36, shape: 2, hue: 5, op: 0.42, rot: '-8deg', delay: '1.8s' },
  { pos: { bottom: '20%', left: '17%' }, size: 28, shape: 7, hue: 6, op: 0.38, rot: '14deg', delay: '.9s' },
];

const enter = (delay: string): CSSProperties => ({ animationDelay: delay, animationFillMode: 'both' });

const primaryBtn =
  'w-full px-5 py-3 rounded-xl text-white text-[14px] font-semibold disabled:opacity-70 flex items-center justify-center gap-2 transition-transform active:scale-[.98] hover:brightness-105';

// ---- Mode A: request a reset link (no token in the URL) --------------------
function RequestForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email.');
    setBusy(true);
    try {
      await fetch('/api/brand/auth/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Always show the same confirmation, whether or not the email is registered.
      setSent(true);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="ii-fadeup rounded-2xl bg-white/90 backdrop-blur-sm border border-border shadow-card p-7 text-center" style={enter('.08s')}>
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full" style={{ background: ACCENT_SOFT, color: ACCENT }}>✓</div>
        <h2 className="text-[16px] font-semibold text-ink-900">Check your email</h2>
        <p className="mt-2 text-[14px] text-ink-600">
          If an account exists for <strong>{email.trim()}</strong>, we&apos;ve sent a link to reset your password. It expires in 1 hour.
        </p>
        <a href="/brand/login" className="mt-5 inline-block text-[13px] font-semibold" style={{ color: ACCENT }}>← Back to sign in</a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="ii-fadeup rounded-2xl bg-white/90 backdrop-blur-sm border border-border shadow-card p-7 space-y-4 transition-shadow hover:shadow-lg" style={enter('.08s')}>
      <label className="block">
        <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">Work email</span>
        <input className={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" autoComplete="email" />
      </label>
      <button type="submit" disabled={busy} className={primaryBtn} style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
        {busy && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
      {error && <p className="text-[13px] text-rose-600 text-center">{error}</p>}
    </form>
  );
}

// ---- Mode B: set a new password (token present) ---------------------------
function ConfirmForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const r = await fetch('/api/brand/auth/reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || 'Could not reset password.');
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError('Could not reach the server. Try again.');
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="ii-fadeup rounded-2xl bg-white/90 backdrop-blur-sm border border-border shadow-card p-7 text-center" style={enter('.08s')}>
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full" style={{ background: ACCENT_SOFT, color: ACCENT }}>✓</div>
        <h2 className="text-[16px] font-semibold text-ink-900">Password updated</h2>
        <p className="mt-2 text-[14px] text-ink-600">You can now sign in with your new password.</p>
        <a href="/brand/login" className="mt-5 inline-block px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="ii-fadeup rounded-2xl bg-white/90 backdrop-blur-sm border border-border shadow-card p-7 space-y-4 transition-shadow hover:shadow-lg" style={enter('.08s')}>
      <label className="block">
        <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">New password</span>
        <input className={inp} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
      </label>
      <label className="block">
        <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">Confirm new password</span>
        <input className={inp} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter your new password" autoComplete="new-password" />
      </label>
      <button type="submit" disabled={busy} className={primaryBtn} style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
        {busy && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
        {busy ? 'Updating…' : 'Update password'}
      </button>
      {error && <p className="text-[13px] text-rose-600 text-center">{error}</p>}
    </form>
  );
}

function ResetInner() {
  const token = useSearchParams().get('token');
  const hasToken = !!token;
  return (
    <div className="w-full max-w-md">
      <header className="mb-7 text-center ii-fadeup" style={enter('0s')}>
        <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
          Password reset
        </span>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink-900">
          {hasToken ? 'Choose a new password' : 'Reset your password'}
        </h1>
        <p className="mt-2 text-[14.5px] text-ink-600">
          {hasToken ? 'Set a new password for your brand workspace.' : "Enter your email and we'll send you a reset link."}
        </p>
      </header>
      {hasToken ? <ConfirmForm token={token} /> : <RequestForm />}
      {!hasToken && (
        <p className="mt-5 text-center text-[13px] text-ink-500 ii-fadeup" style={enter('.16s')}>
          Remembered it? <a href="/brand/login" className="font-semibold" style={{ color: ACCENT }}>Back to sign in</a>
        </p>
      )}
    </div>
  );
}

export default function BrandResetPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#fafafc] font-sans">
      <div aria-hidden className="pointer-events-none absolute -top-40 -left-32 h-[32rem] w-[32rem] rounded-full opacity-60 blur-3xl" style={{ background: 'radial-gradient(circle, rgba(108,77,246,.22), transparent 65%)' }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full opacity-50 blur-3xl" style={{ background: 'radial-gradient(circle, rgba(236,72,153,.18), transparent 65%)' }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {RESET_DOODLES.map((d, i) => (
          <Doodle
            key={i}
            shape={d.shape}
            color={DOODLE_HUES[d.hue]}
            className="ii-floatr absolute"
            style={{ ...d.pos, width: d.size, height: d.size, opacity: d.op, ['--r' as string]: d.rot, animationDelay: d.delay }}
          />
        ))}
      </div>
      <div className="relative z-[1] min-h-screen flex items-center justify-center px-6 py-16">
        <Suspense fallback={<p className="text-center text-[14px] text-ink-500">Loading…</p>}>
          <ResetInner />
        </Suspense>
      </div>
    </div>
  );
}
