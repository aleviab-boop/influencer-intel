'use client';

// Internal-only admin login. Deliberately UNLINKED from the public /login role
// chooser (Brand / Agency / Influencer) — platform staff reach it by knowing
// the URL, and the /admin middleware redirects unauthenticated staff here. It
// posts to the same /api/admin/auth gate the old inline Admin tab used, then
// lands on the /admin control panel.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ACCENT, ACCENT_SOFT, BrandMark } from '@/components/marketing';
import { BackButton } from '@/components/back-button';

const inp =
  'w-full px-3.5 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl hover:border-[#c9bdfb] focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all duration-200';

export default function StaffLoginPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (!email.trim() || !password) { setError('Enter the admin email and password.'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'Login failed.'); setLoading(false); return; }
    } catch {
      setError('Could not reach the server. Try again.'); setLoading(false); return;
    }
    try { localStorage.setItem('ii_role', 'admin'); } catch { /* ignore */ }
    // Honour a ?next= set by the /admin middleware, but never the deleted
    // /admin/login — otherwise land on the panel.
    const next = new URLSearchParams(window.location.search).get('next');
    const dest = next && next.startsWith('/admin') && next !== '/admin/login' ? next : '/admin';
    router.push(dest);
  }

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <main className="flex-1 grid place-items-center px-4 sm:px-6 py-10 relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 50% at 88% 8%, rgba(108,77,246,.12), transparent 60%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
        <div className="absolute top-5 left-5 z-20"><BackButton /></div>

        <div
          className="relative z-10 w-full max-w-md rounded-3xl border border-border bg-white shadow-[0_30px_80px_rgba(108,77,246,0.18)] p-7 sm:p-9 transition-all duration-700"
          style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(24px)' }}
        >
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: ACCENT_SOFT }}><BrandMark size={26} /></span>
            <span className="text-[15px] font-bold text-ink-900">Influencer Intel</span>
          </div>

          <div className="mt-6 mb-1 inline-flex items-center gap-2">
            <span className="grid place-items-center w-9 h-9 rounded-full text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
            </span>
            <h1 className="text-2xl font-bold text-ink-900">Staff sign-in</h1>
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-600">Platform control center — restricted to Influencer Intel staff.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="flex items-center justify-between text-[12px] font-medium text-ink-500 mb-1.5">
                <span>Your name</span>
                <span className="font-normal text-ink-400">optional</span>
              </span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alevia" className={inp} />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">Admin email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@influencerintel.com" className={inp} autoFocus />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">Password</span>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className={`${inp} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 p-1"
                >
                  {showPw ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 002.8 2.8" /><path d="M9.4 5.1A9.5 9.5 0 0112 5c5 0 9 4 9 7a12 12 0 01-2.2 3.2M6.2 6.2A12 12 0 003 12c0 3 4 7 9 7a9.7 9.7 0 003.6-.7" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </label>

            {error && (
              <div className="text-[13px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group w-full px-4 py-3 rounded-xl text-white text-[14px] font-semibold transition-all duration-300 hover:brightness-105 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(108,77,246,0.35)] active:translate-y-0 disabled:opacity-70 disabled:hover:translate-y-0 flex items-center justify-center gap-2"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              {loading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
              {loading ? 'Logging in…' : 'Enter admin panel'}
              {!loading && (
                <svg className="transition-transform duration-300 group-hover:translate-x-1" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-[11px] text-ink-400">Restricted — platform staff only.</p>
        </div>
      </main>
    </div>
  );
}
