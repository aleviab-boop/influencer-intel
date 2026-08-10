'use client';

import { useEffect, useState } from 'react';
import { PageHeader, LiveBadge, StatCard } from '@/components/admin-ui';

type Health = 'active' | 'expiring' | 'expired' | 'error' | 'inactive';

interface Account {
  id: string;
  ig_username: string | null;
  handle: string | null;
  creator_id: string | null;
  follower_count: number;
  connection_status: string | null;
  last_sync_status: string | null;
  last_sync_at: string | null;
  posts_synced_count: number;
  token_expires_at: string | null;
  connected_at: string | null;
  health: Health;
  days_until_expiry: number | null;
}
interface Summary { total: number; active: number; expiring: number; expired: number; error: number; inactive: number }
interface Data { summary: Summary; accounts: Account[] }

const HEALTH_META: Record<Health, { label: string; bg: string; fg: string }> = {
  active: { label: 'Live', bg: '#ecfdf5', fg: '#059669' },
  expiring: { label: 'Expiring', bg: '#fffbeb', fg: '#b45309' },
  expired: { label: 'Expired', bg: '#fff1f2', fg: '#e11d48' },
  error: { label: 'Sync error', bg: '#fef2f2', fg: '#dc2626' },
  inactive: { label: 'Inactive', bg: '#f4f4f6', fg: '#888' },
};

const fmt = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);

function ago(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function expiryLabel(a: Account): string {
  if (!a.token_expires_at) return '—';
  const d = a.days_until_expiry;
  if (d == null) return '—';
  if (d < 0) return `${Math.abs(d)}d ago`;
  if (d === 0) return 'today';
  return `in ${d}d`;
}

export default function ConnectionsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/admin/connections')
        .then((r) => r.json())
        .then((d) => { if (alive) { setData(d as Data); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    load();
    const t = setInterval(load, 30_000); // refresh health every 30s
    return () => { alive = false; clearInterval(t); };
  }, []);

  const s = data?.summary;

  return (
    <div className="px-8 py-7">
      <PageHeader
        title="Connections"
        subtitle="Every creator that connected Instagram, and the health of their token. Reconnect accounts before live insights silently stop."
        badge={<LiveBadge live={!!data} label={['Loaded', 'Loading']} />}
      />

      {loading && !data && <div className="text-[14px] text-[#888]">Loading connections…</div>}

      {s && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-7">
            <StatCard label="Connected" value={s.total} sub="Total accounts" />
            <StatCard label="Live" value={s.active} color="#10b981" sub="Healthy tokens" />
            <StatCard label="Expiring" value={s.expiring} color="#f59e0b" sub="Within 7 days" />
            <StatCard label="Expired" value={s.expired} color="#f43f5e" sub="Need reconnect" />
            <StatCard label="Sync errors" value={s.error} color="#dc2626" sub="Last sync failed" />
          </div>

          {data && data.accounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#e5e5ea] bg-white py-16 text-center text-[14px] text-[#999]">
              No creators have connected Instagram yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-[#ececf3] bg-white shadow-[0_10px_40px_rgba(108,77,246,0.06)]">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[#faf9ff] text-left text-[#777]">
                    <th className="px-4 py-3 font-semibold border-b border-[#f0f0f5]">Account</th>
                    <th className="px-4 py-3 font-medium border-b border-[#f0f0f5]">Health</th>
                    <th className="px-4 py-3 font-medium border-b border-[#f0f0f5] text-right">Followers</th>
                    <th className="px-4 py-3 font-medium border-b border-[#f0f0f5] text-right">Posts synced</th>
                    <th className="px-4 py-3 font-medium border-b border-[#f0f0f5]">Last sync</th>
                    <th className="px-4 py-3 font-medium border-b border-[#f0f0f5]">Token expires</th>
                    <th className="px-4 py-3 font-medium border-b border-[#f0f0f5]">Connected</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.accounts.map((a) => {
                    const m = HEALTH_META[a.health];
                    const uname = a.ig_username || a.handle;
                    return (
                      <tr key={a.id} className="border-b border-[#f6f6fa] hover:bg-[#faf9ff] transition-colors">
                        <td className="px-4 py-3 font-medium text-[#111] whitespace-nowrap">
                          {uname ? `@${uname}` : <span className="text-[#aaa]">unknown</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold" style={{ background: m.bg, color: m.fg }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.fg }} />{m.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#444]">{fmt(a.follower_count)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#444]">{a.posts_synced_count.toLocaleString()}</td>
                        <td className="px-4 py-3 text-[#666] whitespace-nowrap">{ago(a.last_sync_at)}</td>
                        <td className="px-4 py-3 whitespace-nowrap" style={a.health === 'expired' ? { color: '#e11d48', fontWeight: 600 } : a.health === 'expiring' ? { color: '#b45309', fontWeight: 600 } : { color: '#666' }}>
                          {expiryLabel(a)}
                        </td>
                        <td className="px-4 py-3 text-[#999] whitespace-nowrap">{ago(a.connected_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[12px] text-[#999]">Auto-refreshes every 30s. Long-lived Instagram tokens last ~60 days — reconnect before they expire to avoid a gap in live insights.</p>
        </>
      )}
    </div>
  );
}
