'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { PageDoodles } from '@/components/page-doodles';

interface ConfigStatus {
  configured: boolean;
  has_app_id: boolean;
  has_app_secret: boolean;
  redirect_uri: string;
  scopes: string;
}

interface Account {
  id: string;
  ig_username: string;
  handle: string | null;
  follower_count: number | string | null;
  connection_status: string;
  last_sync_status: string;
  last_sync_at: string | null;
  posts_synced_count: number;
  token_expires_at: string | null;
  connected_at: string;
}

export default function ConnectPage() {
  return (
    <Suspense fallback={null}>
      <ConnectContent />
    </Suspense>
  );
}

function ConnectContent() {
  const params = useSearchParams();
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const errorParam = params.get('error');

  useEffect(() => {
    fetch('/api/oauth/accounts')
      .then((r) => r.json())
      .then((d) => {
        setConfig(d.config ?? null);
        setAccounts(d.accounts ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="relative isolate overflow-hidden min-h-screen bg-canvas">
      <PageDoodles className="-z-10" />
      <AppHeader />
      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Integrations</div>
        <h1 className="text-2xl font-semibold text-ink-900 mb-6">Connect Instagram</h1>

        {errorParam === 'not_configured' && (
          <div className="mb-5 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
            Instagram OAuth isn’t configured yet — set the app credentials below first.
          </div>
        )}

        {loading ? (
          <div className="text-sm text-ink-400 py-10">Loading…</div>
        ) : (
          <>
            <ConfigCard config={config} />

            <PermissionsCard />

            <InstagramConnect
              configured={!!config?.configured}
              initialHandle={params.get('handle')}
              betaError={errorParam === 'beta'}
            />

            <h2 className="mt-10 mb-3 text-sm font-semibold text-ink-900">Connected accounts</h2>
            {accounts.length === 0 ? (
              <div className="text-sm text-ink-400 py-6 border border-dashed border-border rounded-lg text-center">
                No Instagram accounts connected yet.
              </div>
            ) : (
              <div className="space-y-2">
                {accounts.map((a) => (
                  <AccountRow key={a.id} a={a} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

interface BetaState {
  open: boolean;
  gated: boolean;
  allowed: boolean;
  on_waitlist: boolean;
}

// The connect surface, beta-gated. While the Meta app is pre-approval, Instagram
// Login only works for the handles we've added as testers — so a non-allowlisted
// creator is offered the waitlist here instead of being bounced into Instagram's
// opaque error wall. Once IG_BETA_OPEN=true (app Live), the gate lifts and this
// is just the plain Connect button.
function InstagramConnect({
  configured,
  initialHandle,
  betaError,
}: {
  configured: boolean;
  initialHandle: string | null;
  betaError: boolean;
}) {
  const [beta, setBeta] = useState<BetaState | null>(null);
  const [handle, setHandle] = useState((initialHandle ?? '').replace(/^@/, ''));
  const [checking, setChecking] = useState(false);
  const [email, setEmail] = useState('');
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  // Learn whether the gate is open, and (if a handle came in via URL) that
  // handle's access — so a bounced-back creator lands straight on the waitlist.
  useEffect(() => {
    const h = (initialHandle ?? '').replace(/^@/, '').trim();
    const qs = h ? `?handle=${encodeURIComponent(h)}` : '';
    fetch(`/api/creator/beta-access${qs}`)
      .then((r) => r.json())
      .then((d: BetaState) => setBeta(d))
      .catch(() => setBeta({ open: true, gated: false, allowed: true, on_waitlist: false }));
  }, [initialHandle]);

  const clean = handle.trim().replace(/^@/, '').toLowerCase();
  const handleValid = /^[a-z0-9._]{1,30}$/.test(clean);

  const startConnect = (withHandle?: string) => {
    const h = (withHandle ?? '').replace(/^@/, '').trim();
    // flow=creator so the callback mints the ii_creator session cookie — connecting
    // your own Instagram here IS logging in as a creator. Without it the connect
    // succeeds but leaves no session, so the nav keeps showing "Log in".
    const base = '/api/oauth/instagram?flow=creator';
    window.location.href = h ? `${base}&handle=${encodeURIComponent(h)}` : base;
  };

  const checkAccess = async () => {
    if (!handleValid || checking) return;
    setChecking(true);
    try {
      const d: BetaState = await fetch(`/api/creator/beta-access?handle=${encodeURIComponent(clean)}`).then((r) => r.json());
      setBeta(d);
      if (d.allowed) startConnect(clean); // straight through — no extra click
    } catch {
      /* leave state; user can retry */
    } finally {
      setChecking(false);
    }
  };

  const joinWaitlist = async () => {
    if (!handleValid || joining) return;
    setJoining(true);
    try {
      const d = await fetch('/api/creator/beta-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: clean, email: email.trim() || undefined }),
      }).then((r) => r.json());
      if (d?.allowed) { startConnect(clean); return; }
      if (d?.ok) { setJoined(true); setBeta((b) => (b ? { ...b, on_waitlist: true } : b)); }
    } catch {
      /* retry */
    } finally {
      setJoining(false);
    }
  };

  const inputCls = 'w-full text-sm text-ink-900 rounded-lg border border-border px-3 py-2 outline-none focus:border-ink-400 transition-colors';

  // Not configured — nothing to gate; show the disabled hint as before.
  if (!configured) {
    return (
      <div className="mt-6">
        <button disabled className="px-5 py-2.5 text-sm font-medium text-white bg-ink-900 rounded-lg opacity-40 cursor-not-allowed">
          Connect Instagram account
        </button>
        <span className="ml-3 text-[12px] text-ink-400">Set IG_APP_ID, IG_APP_SECRET, IG_REDIRECT_URI to enable.</span>
        <EmailFallback />
      </div>
    );
  }

  // Gate open (app Live) — plain connect button.
  if (beta && beta.open) {
    return (
      <div className="mt-6">
        <button onClick={() => startConnect(clean || undefined)}
          className="px-5 py-2.5 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800">
          Connect Instagram account
        </button>
        <EmailFallback />
      </div>
    );
  }

  // Already confirmed allowlisted for this handle — one-click connect.
  if (beta && beta.allowed) {
    return (
      <div className="mt-6">
        <div className="mb-3 px-4 py-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-800">
          @{clean || 'your account'} is on the beta — you can connect Instagram now.
        </div>
        <button onClick={() => startConnect(clean)}
          className="px-5 py-2.5 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800">
          Connect Instagram account
        </button>
        <EmailFallback />
      </div>
    );
  }

  // On the waitlist (just joined, or already was) — confirmation.
  if (beta && (joined || beta.on_waitlist)) {
    return (
      <div className="mt-6">
        <div className="px-4 py-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-800">
          You’re on the list{clean ? ` for @${clean}` : ''}. Instagram Connect is in limited beta — we’ll email you the moment it opens up. In the meantime you can{' '}
          <a href="/creator/setup" className="underline underline-offset-2">verify with your public profile</a> and get brand-ready today.
        </div>
        <EmailFallback />
      </div>
    );
  }

  // Gated + unknown/blocked handle — offer the beta check / waitlist.
  return (
    <div className="mt-6 p-5 rounded-xl bg-surface border border-border">
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Limited beta</div>
      <div className="text-sm font-medium text-ink-900">Instagram Connect is in early access</div>
      <p className="mt-1 text-[13px] text-ink-500">
        {betaError
          ? 'That account isn’t on the beta yet. Add your handle to the waitlist and we’ll email you when Connect opens up.'
          : 'Enter your Instagram handle to check if your account is in the beta.'}
      </p>

      <div className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-sm">@</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void checkAccess(); }}
            placeholder="yourhandle" className={inputCls + ' pl-7'} />
        </div>
        <button onClick={checkAccess} disabled={!handleValid || checking}
          className="shrink-0 px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-40 disabled:cursor-not-allowed">
          {checking ? 'Checking…' : 'Check access'}
        </button>
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <div className="text-[13px] text-ink-600 mb-2">Not in the beta yet? Join the waitlist:</div>
        <div className="flex gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
            placeholder="Email (optional — to notify you)" className={inputCls} />
          <button onClick={joinWaitlist} disabled={!handleValid || joining}
            className="shrink-0 px-4 py-2 text-sm font-medium text-ink-900 border border-border rounded-lg hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed">
            {joining ? 'Joining…' : 'Join waitlist'}
          </button>
        </div>
      </div>

      <EmailFallback />
    </div>
  );
}

function EmailFallback() {
  return (
    <div className="mt-3 text-[12px] text-ink-400">
      Prefer not to connect Instagram?{' '}
      <a href="/creator/join" className="text-ink-900 underline underline-offset-2">Claim your profile with email instead</a>.
    </div>
  );
}

// Reviewer- and creator-facing explainer of exactly what Instagram data we
// request and why. Mirrors the two permissions we ask for in App Review
// (instagram_business_basic + instagram_business_manage_insights) and the
// privacy policy — read-only, own account only, no comments/DMs.
function PermissionsCard() {
  const rows: { perm: string; use: string }[] = [
    {
      perm: 'instagram_business_basic',
      use: 'Read your own profile (username, name, follower & media counts) and your media list to build your dashboard and media kit.',
    },
    {
      perm: 'instagram_business_manage_insights',
      use: 'Read insights for your own posts and account (reach, likes, saves, views, follower demographics) to power your analytics and share verified metrics with brands you apply to.',
    },
  ];
  return (
    <div className="mt-6 p-5 rounded-xl bg-surface border border-border">
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-3">
        What we’ll access — and why
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.perm}>
            <div className="font-mono text-[12px] text-ink-900">{r.perm}</div>
            <div className="text-[13px] text-ink-500 mt-0.5">{r.use}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-border text-[12px] text-ink-400">
        Read-only, and only your own account. We never post, and never read or send comments or DMs.
        You can disconnect anytime here or from Instagram → Settings → Apps and websites.{' '}
        <a href="/privacy" className="underline underline-offset-2 text-ink-500">Privacy</a>{' · '}
        <a href="/data-deletion" className="underline underline-offset-2 text-ink-500">Data deletion</a>
      </div>
    </div>
  );
}

function ConfigCard({ config }: { config: ConfigStatus | null }) {
  if (!config) return null;
  return (
    <div className="p-5 rounded-xl bg-surface border border-border">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-wider text-ink-400">OAuth configuration</span>
        <span
          className={`text-[12px] px-2 py-0.5 rounded-md border ${
            config.configured
              ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
              : 'text-amber-700 bg-amber-50 border-amber-200'
          }`}
        >
          {config.configured ? 'configured' : 'not configured'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-1.5 text-sm">
        <KV k="IG_APP_ID" v={config.has_app_id ? 'set ✓' : 'missing'} ok={config.has_app_id} />
        <KV k="IG_APP_SECRET" v={config.has_app_secret ? 'set ✓' : 'missing'} ok={config.has_app_secret} />
        <KV k="Redirect URI" v={config.redirect_uri} ok />
        <KV k="Scopes" v={config.scopes} ok />
      </div>
    </div>
  );
}

function KV({ k, v, ok }: { k: string; v: string; ok: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[11px] uppercase tracking-wider text-ink-400 w-28 shrink-0">{k}</span>
      <span className={`font-mono text-[12px] break-all ${ok ? 'text-ink-900' : 'text-amber-700'}`}>{v}</span>
    </div>
  );
}

function AccountRow({ a }: { a: Account }) {
  const dot =
    a.connection_status === 'active'
      ? 'bg-emerald-500'
      : a.connection_status === 'expired'
      ? 'bg-amber-500'
      : 'bg-rose-500';
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border">
      <div>
        <div className="text-sm font-medium text-ink-900">@{a.ig_username}</div>
        <div className="text-[12px] text-ink-400">
          {fmt(a.follower_count)} followers · {a.posts_synced_count} posts synced · sync {a.last_sync_status}
        </div>
      </div>
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-500">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        {a.connection_status}
      </span>
    </div>
  );
}

function fmt(v: number | string | null): string {
  if (v === null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
