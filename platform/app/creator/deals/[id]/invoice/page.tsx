'use client';

import { useEffect, useState, Suspense, use } from 'react';
import Link from 'next/link';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

interface InvoiceLine { description: string; qty: number; rate: number; amount: number }
interface Invoice {
  available: boolean;
  number: string;
  issue_date: string;
  due_note: string;
  status: 'paid' | 'unpaid';
  from: { name: string; handle: string; location: string | null; email: string | null };
  to: { name: string };
  lines: InvoiceLine[];
  currency: 'INR';
  subtotal: number;
  gst_pct: number;
  gst_amount: number;
  total: number;
  tds_note: string;
  pay_to: { method: 'upi' | 'bank'; lines: { label: string; value: string }[] } | null;
  notes: string[];
}

const money = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');
const dateStr = (s: string): string => {
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <InvoiceView id={id} />
    </Suspense>
  );
}

function InvoiceView({ id }: { id: string }) {
  const [handle, setHandle] = useState<string | null>(null);
  const [gst, setGst] = useState(0);
  const [data, setData] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = (params.get('handle') || (typeof localStorage !== 'undefined' ? localStorage.getItem('creator_handle') : null) || '').trim();
    setHandle(h || null);
    load(id, gst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const load = (dealId: string, gstPct: number): void => {
    setLoading(true);
    fetch(`/api/creator/invoice?deal=${encodeURIComponent(dealId)}&gst=${gstPct}`)
      .then((r) => r.json())
      .then((d: Invoice) => setData(d))
      .catch(() => setData({ available: false } as Invoice))
      .finally(() => setLoading(false));
  };

  const toggleGst = (): void => {
    const next = gst === 18 ? 0 : 18;
    setGst(next);
    load(id, next);
  };

  const backHref = `/creator/deals/${encodeURIComponent(id)}${handle ? `?handle=${encodeURIComponent(handle.replace(/^@/, ''))}` : ''}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f4f8] grid place-items-center text-ink-400 text-[14px]">
        <span className="inline-block h-4 w-4 mr-3 rounded-full border-2 border-ink-200 border-t-transparent animate-spin" />
        Preparing invoice…
      </div>
    );
  }

  if (!data?.available) {
    return (
      <div className="min-h-screen bg-[#f5f4f8] grid place-items-center px-6">
        <div className="max-w-md text-center rounded-2xl bg-white border border-border shadow-card p-8">
          <div className="text-[16px] font-bold text-ink-900">Invoice unavailable</div>
          <p className="mt-2 text-[13px] text-ink-500">We couldn\u2019t find this deal. It may have been removed.</p>
          <Link href={backHref} className="group mt-4 inline-flex items-center gap-1 text-[13px] font-semibold transition-colors" style={{ color: ACCENT }}><span className="inline-block transition-transform duration-300 group-hover:-translate-x-0.5">←</span> Back to deal</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative isolate overflow-hidden min-h-screen bg-[#f5f4f8] py-8 px-4 font-sans">
      <PageDoodles className="-z-10" />
      {/* Action bar — hidden when printing */}
      <div className="max-w-2xl mx-auto mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href={backHref} className="group inline-flex items-center gap-1 text-[13px] font-semibold text-ink-500 transition-colors hover:text-ink-800"><span className="inline-block transition-transform duration-300 group-hover:-translate-x-0.5">←</span> Deal</Link>
        <div className="flex gap-2">
          <button onClick={toggleGst}
            className="px-3.5 py-2 rounded-lg text-[13px] font-semibold border border-border bg-white text-ink-700 transition-colors duration-200 hover:border-[#d9d4f5] hover:bg-[#faf9ff]">
            {gst === 18 ? 'Remove GST' : 'Add 18% GST'}
          </button>
          <button onClick={() => window.print()}
            className="px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5"
            style={{ background: ACCENT }}>
            Save as PDF
          </button>
        </div>
      </div>

      {/* Invoice sheet */}
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-card overflow-hidden print:shadow-none print:rounded-none">
        {/* Header */}
        <div className="p-7 flex items-start justify-between gap-4" style={{ background: `linear-gradient(135deg, ${ACCENT_SOFT}, #ffffff)` }}>
          <div>
            <div className="text-[22px] font-bold text-ink-900">Invoice</div>
            <div className="text-[13px] text-ink-500 mt-0.5 tabular-nums">{data.number}</div>
            <div className="text-[12px] text-ink-400 mt-0.5">Issued {dateStr(data.issue_date)}</div>
          </div>
          <span className="text-[12px] font-bold px-3 py-1 rounded-full uppercase tracking-wide"
            style={data.status === 'paid'
              ? { color: '#16a34a', background: '#ecfdf3' }
              : { color: ACCENT, background: '#fff' }}>
            {data.status}
          </span>
        </div>

        {/* From / To */}
        <div className="px-7 py-5 grid grid-cols-2 gap-6 border-b border-border">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">From</div>
            <div className="text-[14px] font-semibold text-ink-900">{data.from.name}</div>
            <div className="text-[12.5px] text-ink-500">@{data.from.handle}</div>
            {data.from.location && <div className="text-[12.5px] text-ink-500">{data.from.location}</div>}
            {data.from.email && <div className="text-[12.5px] text-ink-500">{data.from.email}</div>}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">Bill to</div>
            <div className="text-[14px] font-semibold text-ink-900">{data.to.name}</div>
          </div>
        </div>

        {/* Line items */}
        <div className="px-7 py-5">
          <div className="grid grid-cols-[1fr_auto] gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400 pb-2 border-b border-border">
            <div>Description</div>
            <div className="text-right">Amount</div>
          </div>
          {data.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-4 py-3 border-b border-border">
              <div className="text-[13.5px] text-ink-800 leading-snug">{l.description}</div>
              <div className="text-[13.5px] font-semibold text-ink-900 tabular-nums text-right">{money(l.amount)}</div>
            </div>
          ))}

          {/* Totals */}
          <div className="mt-4 ml-auto w-full max-w-[260px] space-y-1.5 text-[13px]">
            <Row label="Subtotal" value={money(data.subtotal)} />
            {data.gst_pct > 0 && <Row label={`GST (${data.gst_pct}%)`} value={money(data.gst_amount)} />}
            <div className="flex justify-between pt-2 mt-1 border-t border-border">
              <span className="text-[14px] font-bold text-ink-900">Total due</span>
              <span className="text-[16px] font-bold tabular-nums" style={{ color: ACCENT }}>{money(data.total)}</span>
            </div>
          </div>
        </div>

        {/* Pay to */}
        {data.pay_to && (
          <div className="mx-7 mb-5 rounded-xl p-4" style={{ background: ACCENT_SOFT }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: ACCENT }}>
              Payment to · {data.pay_to.method === 'upi' ? 'UPI' : 'Bank transfer'}
            </div>
            <div className="space-y-0.5">
              {data.pay_to.lines.map((l) => (
                <div key={l.label} className="flex justify-between text-[12.5px]">
                  <span className="text-ink-500">{l.label}</span>
                  <span className="text-ink-900 font-medium tabular-nums">{l.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="px-7 pb-7 space-y-1.5">
          <div className="text-[12.5px] text-ink-600">{data.due_note}</div>
          <div className="text-[11px] text-ink-400 leading-relaxed">{data.tds_note}</div>
          {data.notes.map((n, i) => (
            <div key={i} className="text-[11px] text-ink-400">{n}</div>
          ))}
        </div>
      </div>

      <p className="max-w-2xl mx-auto mt-3 text-center text-[11px] text-ink-300 print:hidden">
        Use “Save as PDF” to export this invoice and email it to the brand.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink-600">
      <span>{label}</span>
      <span className="tabular-nums text-ink-800">{value}</span>
    </div>
  );
}
