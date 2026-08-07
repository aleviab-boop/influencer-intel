'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

type Kind = 'applications' | 'review' | 'pay' | 'overdue';

interface InboxItem {
  id: string;
  kind: Kind;
  severity: 'action' | 'info';
  title: string;
  body: string;
  program_id: string;
  program_name: string;
  count: number;
  href: string;
}
interface Inbox {
  available: boolean;
  action_count: number;
  total: number;
  counts: { applications: number; review: number; ready_to_pay: number; overdue: number };
  headline: string | null;
  items: InboxItem[];
}

const KIND: Record<Kind, { label: string; c: string; icon: ReactNode }> = {
  review: {
    label: 'Review', c: ACCENT,
    icon: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  },
  applications: {
    label: 'Application', c: '#d97706',
    icon: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>,
  },
  pay: {
    label: 'Payout', c: '#16a34a',
    icon: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  },
  overdue: {
    label: 'Overdue', c: '#dc2626',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  },
};

export default function BrandInboxPage() {
  const [data, setData] = useState<Inbox | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/brand/inbox')
      .then((r) => r.json())
      .then((d: Inbox) => setData(d))
      .catch(() => setData({ available: false } as Inbox))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to campaigns
        </Link>

        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-ink-900">Action inbox</h1>
          {data?.available && data.action_count > 0 && (
            <span className="text-[12px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: '#dc2626' }}>{data.action_count}</span>
          )}
        </div>
        {data?.headline && <p className="mt-1.5 text-[14px] text-ink-600">{data.headline}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data?.available ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-4" style={{ background: ACCENT_SOFT, color: ACCENT }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
            </div>
            <h2 className="text-[16px] font-semibold text-ink-900">Nothing needs you right now</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500 max-w-sm mx-auto">New applications, submitted deliverables and ready-to-pay creators will collect here as your campaigns run.</p>
            <Link href="/campaigns" className="inline-block mt-5 px-5 py-2.5 text-sm font-semibold text-white rounded-xl" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>Go to campaigns</Link>
          </div>
        ) : (
          <>
            <div className="mt-5 flex flex-wrap gap-2">
              <Chip label="To review" value={data.counts.review} c={KIND.review.c} />
              <Chip label="Applications" value={data.counts.applications} c={KIND.applications.c} />
              <Chip label="Ready to pay" value={data.counts.ready_to_pay} c={KIND.pay.c} />
              <Chip label="Overdue" value={data.counts.overdue} c={KIND.overdue.c} />
            </div>

            <div className="mt-6 space-y-2.5">
              {data.items.map((n) => (
                <InboxRow key={n.id} n={n} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function InboxRow({ n }: { n: InboxItem }) {
  const k = KIND[n.kind];
  const isAction = n.severity === 'action';
  return (
    <Link href={n.href} className="flex items-start gap-3.5 rounded-2xl bg-white border border-border shadow-card p-4 hover:border-[#d9d4f5] transition-colors">
      <div className="mt-0.5 w-9 h-9 shrink-0 rounded-xl grid place-items-center" style={{ background: `${k.c}14`, color: k.c }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{k.icon}</svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-ink-900 truncate">{n.title}</span>
          {isAction && <span className="w-1.5 h-1.5 shrink-0 rounded-full" style={{ background: '#dc2626' }} />}
        </div>
        <p className="mt-0.5 text-[13px] text-ink-600 leading-snug">{n.body}</p>
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          <span className="font-semibold px-1.5 py-0.5 rounded-md" style={{ color: k.c, background: `${k.c}12` }}>{k.label}</span>
          <span className="text-ink-400 truncate">{n.program_name}</span>
        </div>
      </div>
      <svg className="mt-2 shrink-0 text-ink-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
    </Link>
  );
}

function Chip({ label, value, c }: { label: string; value: number; c: string }) {
  return (
    <div className="rounded-full border border-border bg-white px-3.5 py-1.5 text-[12.5px] flex items-center gap-1.5">
      <span className="text-ink-500">{label}</span>
      <span className="font-bold tabular-nums" style={value > 0 ? { color: c } : undefined}>{value}</span>
    </div>
  );
}
