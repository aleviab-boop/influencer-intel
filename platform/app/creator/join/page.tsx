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
  // After a successful signup we show an optional ownership-verification step
  // instead of redirecting immediately.
  const [claimCode, setClaimCode] = useState<string | null>(null);
  const [claimHandle, setClaimHandle] = useState('');

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
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; handle?: string; claim_code?: string }
        | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? 'Something went wrong — please try again.');
      }
      if (tab === 'signup' && data.claim_code) {
        // Session cookie is already set — show the optional verify step.
        setClaimHandle(data.handle ?? handle.trim().replace(/^@/, ''));
        setClaimCode(data.claim_code);
        return;
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

  if (claimCode) {
    return (
      <VerifyStep code={claimCode} handle={claimHandle} onDone={() => router.push('/creator')} />
    );
  }

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

/**
 * Optional ownership-verification step shown right after signup. The creator's
 * account already exists and they're signed in — this just lets them prove they
 * own the handle by putting a code in their bio. They can skip and do it later.
 */
function VerifyStep({
  code,
  handle,
  onDone,
}: {
  code: string;
  handle: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'checking' | 'verified'>('idle');
  const [copied, setCopied] = useState(false);

  async function check() {
    setBusy(true);
    try {
      const res = await fetch('/api/creator/auth/verify', { method: 'POST' });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; verified?: boolean; checking?: boolean }
        | null;
      if (data?.verified) {
        setStatus('verified');
        setTimeout(onDone, 1200);
      } else {
        setStatus('checking');
      }
    } catch {
      setStatus('checking');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      <MarketingNav />
      <main className="max-w-md mx-auto px-6 py-14">
        <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: ACCENT }}>
          Verify ownership (optional)
        </div>
        <h1 className="text-2xl font-semibold text-[#1a1626] mb-1.5">
          You&apos;re in, @{handle}
        </h1>
        <p className="text-sm text-[#6b6580] mb-6">
          Want a verified badge? Add this code to your Instagram bio, then tap Check.
          You can remove it once verified — or skip and do this later from settings.
        </p>

        <div
          className="flex items-center justify-between px-4 py-3 rounded-lg mb-4"
          style={{ background: ACCENT_SOFT }}
        >
          <code className="text-[15px] font-semibold tracking-wide" style={{ color: ACCENT }}>
            {code}
          </code>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(code).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => {},
              );
            }}
            className="text-[12px] font-medium px-2.5 py-1 rounded-md border border-[#e5e2f0] bg-white"
            style={{ color: ACCENT }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {status === 'verified' ? (
          <div className="px-3.5 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-[13px] text-emerald-700">
            Verified — you own @{handle}. Taking you to your dashboard…
          </div>
        ) : (
          <>
            {status === 'checking' && (
              <div className="px-3.5 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-[13px] text-amber-700 mb-3">
                We couldn&apos;t find the code in your bio yet. Make sure it&apos;s saved, give it a
                moment, then check again.
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={check}
                disabled={busy}
                className="px-5 py-2.5 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                {busy ? 'Checking…' : 'Check my bio'}
              </button>
              <button onClick={onDone} className="text-[13px] font-medium text-[#8a849c]">
                Skip for now
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
