'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

type ReviewState = 'approved' | 'changes' | 'pending';

interface ReviewLink {
  id: string;
  label: string | null;
  url: string;
  platform: string;
  domain: string;
  note: string | null;
  when_label: string;
  review: { state: 'approved' | 'changes'; at: string; comment: string | null } | null;
  review_state: ReviewState;
}
interface ReviewCreator {
  creator_id: string;
  handle: string;
  display_name: string;
  rate: number;
  paid: boolean;
  due_label: string | null;
  required: number;
  submitted: number;
  approved: number;
  changes: number;
  pending: number;
  all_approved: boolean;
  ready_to_pay: boolean;
  status_label: string;
  links: ReviewLink[];
}
interface ProgramReview {
  available: boolean;
  program_id: string;
  program_name: string;
  counts: {
    creators_submitted: number;
    links_total: number;
    pending: number;
    approved: number;
    changes: number;
    ready_to_pay: number;
  };
  creators: ReviewCreator[];
  headline: string;
}

const inr = (n: number): string => `\u20b9${Math.round(n).toLocaleString('en-IN')}`;

const STATE_C: Record<ReviewState, { c: string; b: string; label: string }> = {
  approved: { c: '#16a34a', b: '#ecfdf3', label: 'Approved' },
  changes: { c: '#d97706', b: '#fffbeb', label: 'Changes requested' },
  pending: { c: ACCENT, b: ACCENT_SOFT, label: 'Awaiting review' },
};

export default function CampaignSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        <Review id={id} />
      </main>
    </div>
  );
}

function Review({ id }: { id: string }) {
  const [data, setData] = useState<ProgramReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/programs/${encodeURIComponent(id)}/submissions`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed to load');
        return r.json();
      })
      .then((d: ProgramReview) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setVerdict = useCallback(
    async (creatorId: string, submissionId: string, state: 'approved' | 'changes' | null, comment?: string) => {
      const key = `${creatorId}:${submissionId}`;
      setBusy(key);
      try {
        const r = await fetch(`/api/programs/${encodeURIComponent(id)}/submissions`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creator_id: creatorId, submission_id: submissionId, state, comment }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Update failed');
        setData(await r.json());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [id],
  );

  return (
    <>
      <Link href={`/campaigns/${encodeURIComponent(id)}`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        Back to campaign
      </Link>

      <h1 className="text-2xl font-bold text-ink-900">Review deliverables</h1>
      {data?.program_name && <p className="mt-0.5 text-[13.5px] text-ink-400">{data.program_name}</p>}
      {data?.headline && <p className="mt-1.5 text-[14px] text-ink-600">{data.headline}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
      ) : error ? (
        <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-[13.5px] text-rose-700">{error}</div>
      ) : !data?.available ? (
        <div className="mt-8 text-center py-16 rounded-2xl border border-dashed border-border bg-white">
          <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-4" style={{ background: ACCENT_SOFT, color: ACCENT }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
          </div>
          <h2 className="text-[16px] font-semibold text-ink-900">No submissions yet</h2>
          <p className="mt-1.5 text-[13.5px] text-ink-500 max-w-sm mx-auto">When your recruited creators attach their live post links, they\u2019ll show up here for you to approve or send back.</p>
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            <Chip label="Awaiting review" value={data.counts.pending} c={STATE_C.pending.c} />
            <Chip label="Approved" value={data.counts.approved} c={STATE_C.approved.c} />
            <Chip label="Changes requested" value={data.counts.changes} c={STATE_C.changes.c} />
            <Chip label="Ready to pay" value={data.counts.ready_to_pay} c="#16a34a" />
          </div>

          <div className="mt-6 space-y-4">
            {data.creators.map((c) => (
              <CreatorCard key={c.creator_id} c={c} busy={busy} onVerdict={setVerdict} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function CreatorCard({
  c,
  busy,
  onVerdict,
}: {
  c: ReviewCreator;
  busy: string | null;
  onVerdict: (creatorId: string, submissionId: string, state: 'approved' | 'changes' | null, comment?: string) => void;
}) {
  return (
    <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink-900 truncate">{c.display_name}</div>
          <div className="text-[12.5px] text-ink-400 truncate">@{c.handle.replace(/^@/, '')}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[12.5px] font-semibold" style={{ color: c.ready_to_pay ? '#16a34a' : c.changes > 0 ? STATE_C.changes.c : c.pending > 0 ? ACCENT : '#6b7280' }}>
            {c.status_label}
          </div>
          <div className="text-[11.5px] text-ink-400 mt-0.5">
            {c.approved}/{c.required} approved{c.rate > 0 ? ` \u00b7 ${inr(c.rate)}` : ''}
          </div>
        </div>
      </div>

      {c.ready_to_pay && (
        <div className="mx-5 mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-3.5 py-2.5">
          <span className="text-[12.5px] text-[#15803d] font-medium">All deliverables approved \u2014 clear to pay {inr(c.rate)}.</span>
          <Link href="/payouts" className="shrink-0 text-[12px] font-semibold text-white rounded-lg px-3 py-1.5" style={{ background: '#16a34a' }}>Go to payouts</Link>
        </div>
      )}

      <div className="border-t border-border-soft divide-y divide-border-soft">
        {c.links.map((l) => (
          <LinkRow key={l.id} creatorId={c.creator_id} l={l} busy={busy} onVerdict={onVerdict} />
        ))}
      </div>
    </div>
  );
}

function LinkRow({
  creatorId,
  l,
  busy,
  onVerdict,
}: {
  creatorId: string;
  l: ReviewLink;
  busy: string | null;
  onVerdict: (creatorId: string, submissionId: string, state: 'approved' | 'changes' | null, comment?: string) => void;
}) {
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState(l.review?.comment ?? '');
  const sc = STATE_C[l.review_state];
  const isBusy = busy === `${creatorId}:${l.id}`;

  return (
    <div className="p-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color: sc.c, background: sc.b }}>{sc.label}</span>
            {l.label && <span className="text-[13px] font-medium text-ink-800 truncate">{l.label}</span>}
            <span className="text-[11.5px] text-ink-400">{l.platform} \u00b7 {l.when_label}</span>
          </div>
          <a href={l.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-[#6C4DF6] hover:underline break-all">
            {l.url}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>
          </a>
          {l.note && <p className="mt-1 text-[12.5px] text-ink-500">\u201c{l.note}\u201d</p>}
          {l.review?.comment && (
            <p className="mt-1.5 text-[12.5px] text-ink-600 border-l-2 pl-2" style={{ borderColor: sc.c }}>Your note: {l.review.comment}</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          disabled={isBusy}
          onClick={() => onVerdict(creatorId, l.id, 'approved')}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border transition-all disabled:opacity-50"
          style={l.review_state === 'approved'
            ? { color: '#fff', background: '#16a34a', borderColor: '#16a34a' }
            : { color: '#16a34a', background: '#fff', borderColor: '#bbf7d0' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          {l.review_state === 'approved' ? 'Approved' : 'Approve'}
        </button>
        <button
          disabled={isBusy}
          onClick={() => setShowComment((s) => !s)}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border transition-all disabled:opacity-50"
          style={l.review_state === 'changes'
            ? { color: '#fff', background: STATE_C.changes.c, borderColor: STATE_C.changes.c }
            : { color: STATE_C.changes.c, background: '#fff', borderColor: '#fde68a' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
          {l.review_state === 'changes' ? 'Changes requested' : 'Request changes'}
        </button>
        {l.review && (
          <button
            disabled={isBusy}
            onClick={() => onVerdict(creatorId, l.id, null)}
            className="text-[12px] font-medium text-ink-400 hover:text-ink-700 px-2 py-1.5 disabled:opacity-50"
          >
            Clear verdict
          </button>
        )}
      </div>

      {showComment && (
        <div className="mt-3 rounded-xl border border-border bg-[#faf9ff] p-3">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="What needs to change? (optional \u2014 the creator will see this)"
            className="w-full text-[13px] text-ink-800 bg-white border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:border-ink-900 resize-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              disabled={isBusy}
              onClick={() => { onVerdict(creatorId, l.id, 'changes', comment.trim() || undefined); setShowComment(false); }}
              className="text-[12.5px] font-semibold text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
              style={{ background: STATE_C.changes.c }}
            >
              Send back for changes
            </button>
            <button onClick={() => setShowComment(false)} className="text-[12.5px] font-medium text-ink-400 hover:text-ink-700 px-2 py-1.5">Cancel</button>
          </div>
        </div>
      )}
    </div>
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
