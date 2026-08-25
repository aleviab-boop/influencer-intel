'use client';

import { useEffect, useMemo, useState } from 'react';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

interface EmailRow {
  id: string;
  kind: string;
  recipient: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: string;
  creator_handle: string | null;
  creator_name: string | null;
  program_name: string | null;
}

// Human labels + accent colours for each transactional email type.
const KIND_META: Record<string, { label: string; color: string; bg: string }> = {
  invite: { label: 'Invite', color: '#6C4DF6', bg: '#f1eefe' },
  invite_accepted: { label: 'Accepted', color: '#047857', bg: '#ecfdf5' },
  invite_declined: { label: 'Declined', color: '#64748b', bg: '#f1f5f9' },
  payment: { label: 'Payment', color: '#047857', bg: '#ecfdf5' },
  review_approved: { label: 'Approved', color: '#047857', bg: '#ecfdf5' },
  review_changes: { label: 'Changes', color: '#b45309', bg: '#fef3c7' },
  deadline: { label: 'Deadline', color: '#0369a1', bg: '#e0f2fe' },
};
const kindMeta = (k: string) => KIND_META[k] ?? { label: k, color: '#6b7280', bg: '#f1f0f7' };

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function EmailActivityFeature() {
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetch('/api/emails')
      .then((r) => r.json())
      .then((d) => {
        setRows(d.emails ?? []);
        setEnabled(d.enabled !== false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sent = rows.filter((r) => r.status === 'sent').length;
  const failed = rows.filter((r) => r.status === 'failed').length;

  const kinds = useMemo(() => {
    const set = new Set(rows.map((r) => r.kind));
    return ['all', ...Array.from(set)];
  }, [rows]);

  const shown = filter === 'all' ? rows : rows.filter((r) => r.kind === filter);

  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-white font-sans">
      <PageDoodles className="-z-10" />
      <MarketingNav />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="absolute inset-0" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.15), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.12), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="relative max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
            <span className="inline-block px-3 py-1 rounded-full bg-white border border-border shadow-sm text-[12px] font-semibold" style={{ color: ACCENT }}>Email Activity</span>
            <h1 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-ink-900 leading-tight">Every email your campaigns sent</h1>
            <p className="mt-3 text-[15px] text-ink-600 max-w-xl mx-auto">Invites, payment receipts, review verdicts and deadline reminders — delivered to creators automatically, logged here for you.</p>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-10">
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="w-9 h-9 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
          ) : (
            <>
              {!enabled && (
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
                  Email delivery isn’t configured yet — set <code className="font-mono">RESEND_API_KEY</code> to start sending. Past activity still shows below.
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 mb-6">
                <Stat label="Total sent" value={String(sent)} />
                <Stat label="Failed" value={String(failed)} tone={failed > 0 ? 'red' : undefined} />
                <Stat label="Logged" value={String(rows.length)} accent />
              </div>

              {kinds.length > 2 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {kinds.map((k) => {
                    const active = filter === k;
                    const label = k === 'all' ? 'All' : kindMeta(k).label;
                    return (
                      <button
                        key={k}
                        onClick={() => setFilter(k)}
                        className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold border transition-colors"
                        style={active
                          ? { background: ACCENT, color: '#fff', borderColor: ACCENT }
                          : { background: '#fff', color: '#555', borderColor: '#e5e5ef' }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
                <div className="hidden sm:grid grid-cols-[0.7fr_1.5fr_1.3fr_0.7fr_0.6fr] px-4 py-2.5 bg-[#f7f7fb] text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
                  <span>Type</span><span>Recipient</span><span>Campaign</span><span className="text-right">Status</span><span className="text-right">When</span>
                </div>
                {shown.map((r) => {
                  const m = kindMeta(r.kind);
                  const ok = r.status === 'sent';
                  return (
                    <div key={r.id} className="grid grid-cols-2 sm:grid-cols-[0.7fr_1.5fr_1.3fr_0.7fr_0.6fr] gap-y-1 px-4 py-3 items-center border-t border-border-soft text-[13px]">
                      <span className="col-span-2 sm:col-span-1">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: m.bg, color: m.color }}>{m.label}</span>
                      </span>
                      <span className="min-w-0 col-span-2 sm:col-span-1">
                        <span className="block font-medium text-ink-900 truncate">{r.creator_name || (r.creator_handle ? `@${r.creator_handle}` : r.recipient)}</span>
                        <span className="block text-[12px] text-ink-400 truncate">{r.subject}</span>
                      </span>
                      <span className="text-ink-600 truncate">{r.program_name || '—'}</span>
                      <span className="sm:text-right">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: ok ? '#ecfdf5' : '#fef2f2', color: ok ? '#047857' : '#b91c1c' }} title={r.error || undefined}>{ok ? 'Sent' : 'Failed'}</span>
                      </span>
                      <span className="text-ink-400 sm:text-right tabular-nums text-[12px]">{timeAgo(r.created_at)}</span>
                    </div>
                  );
                })}
                {shown.length === 0 && (
                  <div className="px-4 py-12 text-center text-sm text-ink-400">
                    No emails sent yet. Invite a creator to a campaign or mark a payment — they’ll show up here.
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: 'red' }) {
  const color = tone === 'red' ? 'text-red-600' : accent ? 'text-[#6C4DF6]' : 'text-ink-900';
  return (
    <div className="rounded-2xl bg-white border border-border p-4 shadow-card">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}
