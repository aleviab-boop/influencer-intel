'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

type Tab = 'signup' | 'login';

export default function CreatorJoinPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const url = tab === 'signup' ? '/api/creator/auth/signup' : '/api/creator/auth/login';
      const payload =
        tab === 'signup'
          ? { email, password, handle: handle.trim().replace(/^@/, '') }
          : { email, password };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? 'Something went wrong — please try again.');
      }
      router.push('/creator');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'w-full px-3.5 py-2.5 text-sm rounded-lg border border-[#e5e2f0] bg-white outline-none focus:border-[#6C4DF6] transition-colors';

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      <MarketingNav />
      <main className="max-w-md mx-auto px-6 py-14">
        <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: ACCENT }}>
          Creator portal
        </div>
        <h1 className="text-2xl font-semibold text-[#1a1626] mb-1.5">
          {tab === 'signup' ? 'Claim your profile' : 'Welcome back'}
        </h1>
        <p className="text-sm text-[#6b6580] mb-6">
          {tab === 'signup'
            ? 'Sign up to claim the profile we already track for your handle — no Instagram login required. See your analytics, deals, and applications in one place.'
            : 'Log in to your creator dashboard.'}
        </p>

        <div
          className="inline-flex p-1 rounded-lg mb-6"
          style={{ background: ACCENT_SOFT }}
        >
          {(['signup', 'login'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              className="px-4 py-1.5 text-sm font-medium rounded-md transition-colors"
              style={
                tab === t
                  ? { background: '#fff', color: ACCENT, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }
                  : { background: 'transparent', color: '#6b6580' }
              }
            >
              {t === 'signup' ? 'Sign up' : 'Log in'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3.5">
          {tab === 'signup' && (
            <div>
              <label className="block text-[12px] font-medium text-[#4a4560] mb-1.5">
                Instagram handle
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#a29db5]">@</span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="yourhandle"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className={inputCls + ' pl-7'}
                  required
                />
              </div>
            </div>
          )}
          <div>
            <label className="block text-[12px] font-medium text-[#4a4560] mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoCapitalize="none"
              className={inputCls}
              required
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#4a4560] mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tab === 'signup' ? 'Choose a password' : 'Your password'}
              className={inputCls}
              required
            />
          </div>

          {error && (
            <div className="px-3.5 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-[13px] text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full px-5 py-2.5 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-opacity"
            style={{ background: ACCENT }}
          >
            {busy
              ? 'Please wait…'
              : tab === 'signup'
              ? 'Claim my profile'
              : 'Log in'}
          </button>
        </form>

        <p className="mt-5 text-[12px] text-[#8a849c]">
          {tab === 'signup' ? (
            <>
              Already claimed your profile?{' '}
              <button onClick={() => setTab('login')} className="font-medium" style={{ color: ACCENT }}>
                Log in
              </button>
            </>
          ) : (
            <>
              New here?{' '}
              <button onClick={() => setTab('signup')} className="font-medium" style={{ color: ACCENT }}>
                Claim your profile
              </button>
            </>
          )}
        </p>
      </main>
    </div>
  );
}
