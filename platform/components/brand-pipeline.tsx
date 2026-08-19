'use client';

// ============================================================
// Brand pipeline UI — the agency-owned creator funnel for one brand.
//
// Three exports that share ONE hook instance (lifted to the page) so the
// "Saved ✓" buttons on creator cards and the funnel panel never drift:
//   - SaveCreatorButton: a compact save/saved toggle for any creator card.
//   - BrandPipelinePanel: the funnel — creators grouped by outreach stage,
//     with stage advancement, removal, and a one-click Contact action.
//   - ContactModal (internal): drafts a message from brand DNA + creator
//     snapshot, then either SENDS email (Resend + outreach_messages log) or
//     hands off a DM draft via ig.me — auto-advancing the row to 'contacted'.
// Signed-out users see a nudge to create an agency account (the whole point:
// saving is a reason to hold an account).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import {
  PIPELINE_STATUSES,
  type PipelineStatus,
  type PipelineItem,
  type SaveCreatorInput,
} from '@/lib/use-brand-pipeline';

interface PipelineApi {
  items: PipelineItem[];
  loading: boolean;
  needsAuth: boolean;
  has: (handle: string) => boolean;
  save: (input: SaveCreatorInput) => Promise<boolean>;
  updateStatus: (handle: string, status: PipelineStatus) => Promise<boolean>;
  updateNote: (handle: string, note: string) => Promise<boolean>;
  remove: (handle: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_LABEL: Record<PipelineStatus, string> = {
  saved: 'Saved',
  contacted: 'Contacted',
  replied: 'Replied',
  negotiating: 'Negotiating',
  won: 'Won',
  passed: 'Passed',
};

const STATUS_COLOR: Record<PipelineStatus, string> = {
  saved: '#6C4DF6',
  contacted: '#0891b2',
  replied: '#0d9488',
  negotiating: '#d97706',
  won: '#16a34a',
  passed: '#9ca3af',
};

const fmt = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

const snapStr = (s: Record<string, unknown> | null, k: string): string =>
  s && typeof s[k] === 'string' ? (s[k] as string) : '';
const snapNum = (s: Record<string, unknown> | null, k: string): number =>
  s && Number.isFinite(Number(s[k])) ? Number(s[k]) : 0;

// ---- Save / Saved toggle for a creator card ------------------------------

export function SaveCreatorButton({
  pipeline,
  creator,
  compact = false,
}: {
  pipeline: PipelineApi;
  creator: {
    username: string;
    full_name?: string;
    followers?: number;
    engagement?: number;
    profile_pic_url?: string | null;
    creator_id?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const saved = pipeline.has(creator.username);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (saved) {
        await pipeline.remove(creator.username);
      } else {
        await pipeline.save({
          handle: creator.username,
          creator_id: creator.creator_id ?? null,
          snapshot: {
            name: creator.full_name || creator.username,
            followers: creator.followers ?? 0,
            engagement: creator.engagement ?? 0,
            profile_pic_url: creator.profile_pic_url ?? null,
            // Carry contact points so the Contact action can prefill later.
            email: creator.email ?? null,
            phone: creator.phone ?? null,
          },
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={saved ? 'Remove from pipeline' : 'Save to pipeline'}
      className={`shrink-0 rounded-lg font-semibold transition-colors disabled:opacity-50 ${compact ? 'text-[11px] px-2 py-1' : 'text-[12px] px-2.5 py-1.5'}`}
      style={
        saved
          ? { background: ACCENT_SOFT, color: ACCENT }
          : { background: 'white', color: '#6b7280', border: '1px solid #e5e7eb' }
      }
    >
      {saved ? 'Saved ✓' : '+ Save'}
    </button>
  );
}

// ---- The funnel panel ----------------------------------------------------

export function BrandPipelinePanel({
  pipeline,
  brand,
  category = '',
}: {
  pipeline: PipelineApi;
  brand: string;
  category?: string;
}) {
  if (pipeline.needsAuth) {
    return (
      <div className="rounded-2xl border border-border bg-white p-6 text-center">
        <h3 className="text-[15px] font-bold text-ink-900">Save creators to your pipeline</h3>
        <p className="mt-1.5 text-[13px] text-ink-500 max-w-md mx-auto">
          Create a free agency account to build a persistent, owned funnel for {brand} — track outreach from saved to won.
        </p>
        <a
          href="/agency/login"
          className="inline-block mt-4 px-4 py-2 rounded-xl text-white text-[13px] font-semibold"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
        >
          Create agency account →
        </a>
      </div>
    );
  }

  const { items } = pipeline;
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-white/60 p-6 text-center">
        <p className="text-[13.5px] text-ink-500">
          No creators saved for {brand} yet. Tap <span className="font-semibold text-ink-700">+ Save</span> on any creator to start your pipeline.
        </p>
      </div>
    );
  }

  // Group by stage, in funnel order.
  const byStatus = new Map<PipelineStatus, PipelineItem[]>();
  for (const st of PIPELINE_STATUSES) byStatus.set(st, []);
  for (const it of items) byStatus.get(it.status)?.push(it);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {PIPELINE_STATUSES.map((st) => {
          const n = byStatus.get(st)?.length ?? 0;
          if (n === 0) return null;
          return (
            <span key={st} className="text-[11.5px] px-2.5 py-1 rounded-full font-semibold" style={{ background: `${STATUS_COLOR[st]}14`, color: STATUS_COLOR[st] }}>
              {STATUS_LABEL[st]} · {n}
            </span>
          );
        })}
      </div>

      <div className="space-y-2.5">
        {items.map((it) => (
          <PipelineRow key={it.id} item={it} pipeline={pipeline} brand={brand} category={category} />
        ))}
      </div>
    </div>
  );
}

function PipelineRow({
  item,
  pipeline,
  brand,
  category,
}: {
  item: PipelineItem;
  pipeline: PipelineApi;
  brand: string;
  category: string;
}) {
  const [busy, setBusy] = useState(false);
  const [contacting, setContacting] = useState(false);
  const name = snapStr(item.snapshot, 'name') || item.handle;
  const followers = snapNum(item.snapshot, 'followers');
  const engagement = snapNum(item.snapshot, 'engagement');
  const pic = snapStr(item.snapshot, 'profile_pic_url');

  async function change(status: PipelineStatus) {
    if (busy || status === item.status) return;
    setBusy(true);
    try {
      await pipeline.updateStatus(item.handle, status);
    } finally {
      setBusy(false);
    }
  }
  async function drop() {
    if (busy) return;
    setBusy(true);
    try {
      await pipeline.remove(item.handle);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white border border-border px-3 py-2.5">
      <div className="w-9 h-9 rounded-full bg-ink-100 grid place-items-center text-[13px] font-semibold text-ink-500 overflow-hidden shrink-0">
        {pic ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pic} alt="" className="w-full h-full object-cover" />
        ) : (
          item.handle.slice(0, 1).toUpperCase()
        )}
      </div>
      <a
        href={`https://instagram.com/${item.handle}`}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1"
      >
        <div className="text-[13.5px] font-semibold text-ink-900 truncate">{name}</div>
        <div className="text-[11.5px] text-ink-500">
          @{item.handle}
          {followers ? ` · ${fmt(followers)} followers` : ''}
          {engagement ? ` · ${engagement.toFixed(1)}% ER` : ''}
        </div>
      </a>

      <button
        onClick={() => setContacting(true)}
        className="shrink-0 text-[12px] font-semibold rounded-lg px-2.5 py-1.5 transition-colors"
        style={{ background: ACCENT_SOFT, color: ACCENT }}
        title="Draft & send outreach"
      >
        Contact
      </button>

      <select
        value={item.status}
        onChange={(e) => void change(e.target.value as PipelineStatus)}
        disabled={busy}
        className="text-[12px] font-semibold rounded-lg border border-border bg-white px-2 py-1.5 disabled:opacity-50 cursor-pointer"
        style={{ color: STATUS_COLOR[item.status] }}
      >
        {PIPELINE_STATUSES.map((st) => (
          <option key={st} value={st} style={{ color: '#111' }}>
            {STATUS_LABEL[st]}
          </option>
        ))}
      </select>

      <button
        onClick={() => void drop()}
        disabled={busy}
        title="Remove"
        className="shrink-0 text-ink-300 hover:text-rose-500 text-[16px] leading-none px-1 disabled:opacity-50"
      >
        ×
      </button>

      {contacting && (
        <ContactModal
          item={item}
          brand={brand}
          category={category}
          pipeline={pipeline}
          onClose={() => setContacting(false)}
        />
      )}
    </div>
  );
}

// ---- Contact modal — draft + send, then advance to 'contacted' -----------

function ContactModal({
  item,
  brand,
  category,
  pipeline,
  onClose,
}: {
  item: PipelineItem;
  brand: string;
  category: string;
  pipeline: PipelineApi;
  onClose: () => void;
}) {
  const snapEmail = snapStr(item.snapshot, 'email');
  const [channel, setChannel] = useState<'dm' | 'email'>(snapEmail ? 'email' : 'dm');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [recipient, setRecipient] = useState(snapEmail);
  const [send, setSend] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const genDraft = useCallback(
    async (ch: 'dm' | 'email') => {
      setLoading(true);
      setDraft('');
      try {
        const r = await fetch('/api/discover-live/outreach', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            handle: item.handle,
            brand,
            category,
            channel: ch === 'email' ? 'email' : 'dm',
            prompt: category ? `${brand} — ${category} collaboration` : `collaboration with ${brand}`,
          }),
        });
        const d = await r.json().catch(() => ({}));
        setDraft(typeof d.message === 'string' ? d.message : '');
      } catch {
        setDraft('');
      } finally {
        setLoading(false);
      }
    },
    [item.handle, brand, category],
  );

  // Draft on open (and whenever the channel changes).
  useEffect(() => {
    void genDraft(channel);
  }, [channel, genDraft]);

  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function sendEmailNow() {
    if (!EMAIL_RE.test(recipient) || !draft || send === 'sending') return;
    setSend('sending');
    setErr('');
    try {
      const r = await fetch('/api/outreach/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          handle: item.handle,
          message: draft,
          recipient,
          subject: `Collaboration with ${brand}`,
          creator_id: item.creator_id ?? undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        setSend('sent');
        await pipeline.updateStatus(item.handle, 'contacted');
      } else {
        setSend('error');
        setErr(d.error || 'Email could not be delivered.');
      }
    } catch {
      setSend('error');
      setErr('Could not reach the server.');
    }
  }

  function sendDmNow() {
    if (!draft) return;
    void navigator.clipboard.writeText(draft).catch(() => {});
    setCopied(true);
    void pipeline.updateStatus(item.handle, 'contacted');
    window.open(`https://ig.me/m/${item.handle}`, '_blank', 'noopener');
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="text-[15px] font-semibold text-ink-900">Outreach to @{item.handle}</div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 text-[18px] leading-none">×</button>
        </div>

        <div className="p-5 space-y-3">
          {/* Channel toggle */}
          <div className="inline-flex items-center p-1 rounded-lg bg-[#f4f4f6] text-[12.5px]">
            {(['dm', 'email'] as const).map((ch) => (
              <button
                key={ch}
                onClick={() => { setChannel(ch); setSend('idle'); setCopied(false); }}
                className={`px-3 py-1 rounded-md capitalize transition-colors ${channel === ch ? 'bg-white shadow-sm font-semibold' : 'text-ink-500'}`}
                style={channel === ch ? { color: ACCENT } : undefined}
              >
                {ch === 'dm' ? 'Instagram DM' : 'Email'}
              </button>
            ))}
          </div>

          {/* Draft */}
          <textarea
            value={loading ? 'Drafting a warm opener…' : draft}
            onChange={(e) => setDraft(e.target.value)}
            readOnly={loading}
            rows={7}
            className="w-full rounded-xl border border-border px-3 py-2.5 text-[13.5px] text-ink-800 leading-relaxed resize-y focus:outline-none focus:ring-2"
            style={{ ['--tw-ring-color' as string]: ACCENT_SOFT }}
          />

          {channel === 'email' && (
            <input
              type="email"
              value={recipient}
              onChange={(e) => { setRecipient(e.target.value); setSend('idle'); }}
              placeholder="creator@email.com"
              className="w-full rounded-xl border border-border px-3 py-2 text-[13.5px] focus:outline-none focus:ring-2"
              style={{ ['--tw-ring-color' as string]: ACCENT_SOFT }}
            />
          )}

          {err && <p className="text-[12.5px] text-rose-600">{err}</p>}
          {send === 'sent' && (
            <p className="text-[12.5px] text-emerald-600">Sent to {recipient} — logged, and {item.handle} moved to Contacted.</p>
          )}
          {copied && channel === 'dm' && (
            <p className="text-[12.5px] text-emerald-600">Copied — the DM opened in a new tab. Paste &amp; send, {item.handle} moved to Contacted.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border bg-[#fafafc]">
          <button
            onClick={() => void genDraft(channel)}
            disabled={loading}
            className="text-[12.5px] font-semibold disabled:opacity-50"
            style={{ color: ACCENT }}
          >
            {loading ? 'Drafting…' : 'Re-draft'}
          </button>

          {channel === 'email' ? (
            <button
              onClick={() => void sendEmailNow()}
              disabled={loading || !draft || !EMAIL_RE.test(recipient) || send === 'sending' || send === 'sent'}
              className="px-4 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              {send === 'sending' ? 'Sending…' : send === 'sent' ? 'Sent ✓' : 'Send email'}
            </button>
          ) : (
            <button
              onClick={sendDmNow}
              disabled={loading || !draft}
              className="px-4 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              Copy &amp; open DM
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
