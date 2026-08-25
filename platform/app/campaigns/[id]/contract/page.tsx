'use client';

import { useCallback, useEffect, useState, Suspense, use } from 'react';
import Link from 'next/link';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { SignPanel } from '@/components/sign-panel';
import { PageDoodles } from '@/components/page-doodles';

interface Clause { n: number; heading: string; body: string[] }
interface Party { role: string; name: string; detail: string | null }
interface Signature { party_key: 'brand' | 'creator'; party: string; name: string; signed: boolean; signed_label: string | null; explicit: boolean }
interface Contract {
  available: boolean;
  id: string;
  reference: string;
  title: string;
  effective_date: string;
  effective_label: string;
  status: 'draft' | 'active' | 'completed';
  status_label: string;
  parties: Party[];
  summary: { label: string; value: string }[];
  clauses: Clause[];
  signatures: Signature[];
  footnote: string;
}

const STATUS_STYLE: Record<Contract['status'], { c: string; bg: string }> = {
  draft: { c: '#6b7280', bg: '#f1f0f7' },
  active: { c: ACCENT, bg: '#fff' },
  completed: { c: '#16a34a', bg: '#ecfdf3' },
};

export default function BrandContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <BrandContractView programId={id} />
    </Suspense>
  );
}

function BrandContractView({ programId }: { programId: string }) {
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [data, setData] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (cid: string) => {
    try {
      const d = (await fetch(`/api/brand/contract?program=${encodeURIComponent(programId)}&creator=${encodeURIComponent(cid)}`).then((r) => r.json())) as Contract;
      setData(d);
    } catch {
      setData({ available: false } as Contract);
    }
  }, [programId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cid = (params.get('creator') || '').trim();
    setCreatorId(cid || null);
    if (!cid) { setLoading(false); return; }
    reload(cid).finally(() => setLoading(false));
  }, [programId, reload]);

  const backHref = `/campaigns/${encodeURIComponent(programId)}/submissions`;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f4f8] grid place-items-center text-ink-400 text-[14px]">
        <span className="inline-block h-4 w-4 mr-3 rounded-full border-2 border-ink-200 border-t-transparent animate-spin" />
        Preparing agreement…
      </div>
    );
  }

  if (!creatorId || !data?.available) {
    return (
      <div className="min-h-screen bg-[#f5f4f8] grid place-items-center px-6">
        <div className="max-w-md text-center rounded-2xl bg-white border border-border shadow-card p-8">
          <div className="text-[16px] font-bold text-ink-900">Agreement unavailable</div>
          <p className="mt-2 text-[13px] text-ink-500">We couldn&rsquo;t find this deal. It may have been removed or isn&rsquo;t on one of your campaigns.</p>
          <Link href={backHref} className="group mt-4 inline-flex items-center gap-1 text-[13px] font-semibold transition-colors" style={{ color: ACCENT }}><span className="inline-block transition-transform duration-300 group-hover:-translate-x-0.5">←</span> Back to campaign</Link>
        </div>
      </div>
    );
  }

  const st = STATUS_STYLE[data.status];
  const mySig = data.signatures.find((s) => s.party_key === 'brand');
  const theirSig = data.signatures.find((s) => s.party_key === 'creator');

  return (
    <div className="relative isolate overflow-hidden min-h-screen bg-[#f5f4f8] py-8 px-4 font-sans">
      <PageDoodles className="-z-10" />
      {/* Action bar — hidden when printing */}
      <div className="max-w-2xl mx-auto mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href={backHref} className="group inline-flex items-center gap-1 text-[13px] font-semibold text-ink-500 transition-colors hover:text-ink-800"><span className="inline-block transition-transform duration-300 group-hover:-translate-x-0.5">←</span> Campaign</Link>
        <button onClick={() => window.print()}
          className="px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white transition-all duration-200 hover:brightness-105 hover:-translate-y-0.5"
          style={{ background: ACCENT }}>
          Save as PDF
        </button>
      </div>

      {creatorId && mySig && !mySig.explicit && (
        <SignPanel
          heading="Sign this agreement"
          subline={theirSig?.explicit ? `${theirSig.name} has signed. Add your countersignature to make it binding.` : 'Type your full legal name to sign on behalf of the brand.'}
          defaultName={mySig.name && mySig.name !== 'Brand' ? mySig.name : ''}
          onSign={async (name) => {
            const res = await fetch('/api/brand/contract', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ program: programId, creator: creatorId, signer_name: name }),
            });
            const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
            if (!res.ok || !j.ok) throw new Error('sign_failed');
            await reload(creatorId);
          }}
        />
      )}

      {/* Contract sheet */}
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-card overflow-hidden print:shadow-none print:rounded-none">
        {/* Header */}
        <div className="p-7 flex items-start justify-between gap-4" style={{ background: `linear-gradient(135deg, ${ACCENT_SOFT}, #ffffff)` }}>
          <div>
            <div className="text-[22px] font-bold text-ink-900 leading-tight">{data.title}</div>
            <div className="text-[13px] text-ink-500 mt-1 tabular-nums">{data.reference}</div>
            <div className="text-[12px] text-ink-400 mt-0.5">Effective {data.effective_label}</div>
          </div>
          <span className="text-[12px] font-bold px-3 py-1 rounded-full uppercase tracking-wide shrink-0"
            style={{ color: st.c, background: st.bg }}>
            {data.status_label}
          </span>
        </div>

        {/* Parties */}
        <div className="px-7 py-5 grid grid-cols-2 gap-6 border-b border-border">
          {data.parties.map((p) => (
            <div key={p.role}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">{p.role}</div>
              <div className="text-[14px] font-semibold text-ink-900">{p.name}</div>
              {p.detail && <div className="text-[12.5px] text-ink-500">{p.detail}</div>}
            </div>
          ))}
        </div>

        {/* Summary tiles */}
        <div className="px-7 py-5 grid grid-cols-3 gap-3 border-b border-border">
          {data.summary.map((s) => (
            <div key={s.label} className="rounded-xl border border-border p-3" style={{ background: '#fbfaff' }}>
              <div className="text-[11px] uppercase tracking-wider text-ink-400">{s.label}</div>
              <div className="text-[14px] font-semibold text-ink-900 mt-0.5 leading-snug">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Clauses */}
        <div className="px-7 py-6 space-y-5">
          {data.clauses.map((c) => (
            <section key={c.n} className="break-inside-avoid">
              <h2 className="text-[13.5px] font-bold text-ink-900">{c.n}. {c.heading}</h2>
              <div className="mt-1.5 space-y-1.5">
                {c.body.map((line, i) => (
                  <p key={i} className="text-[12.5px] text-ink-600 leading-relaxed whitespace-pre-line">{line}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Signatures */}
        <div className="px-7 pb-6 pt-2 border-t border-border grid grid-cols-2 gap-6 break-inside-avoid">
          {data.signatures.map((s) => (
            <div key={s.party}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2">{s.party}</div>
              <div className="h-9 flex items-end">
                {s.signed
                  ? <span className="text-[15px] font-semibold" style={{ color: ACCENT, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>{s.name}</span>
                  : <span className="text-[12px] text-ink-300">Awaiting signature</span>}
              </div>
              <div className="mt-1 border-t border-border pt-1.5 flex items-center justify-between">
                <span className="text-[12.5px] text-ink-700">{s.name}</span>
                {s.signed_label && <span className="text-[11px] text-ink-400">{s.signed_label}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Footnote */}
        <div className="px-7 pb-7">
          <p className="text-[11px] text-ink-400 leading-relaxed">{data.footnote}</p>
        </div>
      </div>

      <p className="max-w-2xl mx-auto mt-3 text-center text-[11px] text-ink-300 print:hidden">
        A template agreement generated from this deal — review the terms and use “Save as PDF” to keep a copy. Not legal advice.
      </p>
    </div>
  );
}
