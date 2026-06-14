'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppHeader } from '@/components/app-header';

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
    <div className="min-h-screen bg-canvas">
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

            <div className="mt-6">
              <button
                disabled={!config?.configured}
                onClick={() => {
                  window.location.href = '/api/oauth/instagram';
                }}
                className="px-5 py-2.5 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Connect Instagram account
              </button>
              {!config?.configured && (
                <span className="ml-3 text-[12px] text-ink-400">
                  Set IG_APP_ID, IG_APP_SECRET, IG_REDIRECT_URI to enable.
                </span>
              )}
            </div>

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
