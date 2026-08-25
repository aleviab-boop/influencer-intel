'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

type Kind = 'needs_review' | 'ready_to_pay' | 'accepted' | 'declined' | 'awaiting_response' | 'overdue';

interface NotificationView {
  id: string;
  kind: Kind;
  severity: 'action' | 'info';
  title: string;
  body: string;
  program: string;
  when: string;
  when_label: string;
  href: string;
}
interface Feed {
  available: boolean;
  action_count: number;
  total: number;
  headline: string | null;
  items: NotificationView[];
}

// Per-kind glyph + colour (presentation only).
const KIND: Record<Kind, { label: string; c: string; icon: ReactNode }> = {
  needs_review: {
    label: 'Review', c: ACCENT,
    icon: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  },
  ready_to_pay: {
    label: 'Pay', c: '#16a34a',
    icon: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  },
  accepted: {
    label: 'Accepted', c: '#16a34a',
    icon: <><path d="M20 6L9 17l-5-5" /></>,
  },
  declined: {
    label: 'Declined', c: '#dc2626',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>,
  },
  awaiting_response: {
    label: 'Awaiting', c: '#d97706',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  },
  overdue: {
    label: 'Overdue', c: '#dc2626',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  },
};

export default function BrandNotificationsPage() {
  const [data, setData] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/brand/notifications')
      .then((r) => r.json())
      .then((d: Feed) => setData(d))
      .catch(() => setData({ available: false } as Feed))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <PageDoodles className="-z-10" />
      <MarketingNav />
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <Link href="/lander" className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-5 transition-colors duration-200">
          <svg className="transition-transform duration-300 group-hover:-translate-x-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to features
        </Link>

        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-ink-900">Notifications</h1>
          {data?.available && data.action_count > 0 && (
            <span className="text-[12px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: '#dc2626' }}>{data.action_count}</span>
          )}
        </div>
        <p className="mt-1.5 text-[14px] text-ink-600">
          {data?.headline ?? 'What needs you today across every campaign.'}
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : !data?.available ? (
          <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
            <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-4" style={{ background: ACCENT_SOFT, color: ACCENT }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
            </div>
            <h2 className="text-[16px] font-semibold text-ink-900">You&rsquo;re all caught up</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-500 max-w-sm mx-auto">Creator responses, submissions to review, and payouts to release will show up here as your campaigns move.</p>
            <Link href="/campaign-management" className="inline-block mt-5 px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>Go to campaigns</Link>
          </div>
        ) : (
          <div className="mt-6 space-y-2.5">
            {data.items.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function NotificationRow({ n }: { n: NotificationView }) {
  const k = KIND[n.kind];
  const isAction = n.severity === 'action';
  return (
    <Link
      href={n.href}
      className="group flex items-start gap-3.5 rounded-2xl bg-white border border-border shadow-card p-4 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#e3def9] hover:shadow-[0_16px_44px_rgba(108,77,246,0.16)]"
    >
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
          {n.when_label && <span className="text-ink-400">{n.when_label}</span>}
        </div>
      </div>
      <svg className="mt-2 shrink-0 text-ink-300" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
    </Link>
  );
}
