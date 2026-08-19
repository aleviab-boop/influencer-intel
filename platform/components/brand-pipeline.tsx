'use client';

// ============================================================
// Brand pipeline UI — the agency-owned creator funnel for one brand.
//
// Three exports that share ONE hook instance (lifted to the page) so the
// "Saved ✓" buttons on creator cards and the funnel panel never drift:
//   - SaveCreatorButton: a compact save/saved toggle for any creator card.
//   - BrandPipelinePanel: the funnel — creators grouped by outreach stage,
//     with stage advancement, removal, and a one-click Contact action.
//   - ContactModal / BulkContactModal (internal): draft a message from brand DNA
//     + creator snapshot, then either SEND email (Resend + outreach_messages log)
//     or hand off a DM draft via ig.me — auto-advancing rows to 'contacted'. Bulk
//     drafts in parallel but sends email sequentially (deliverability), capped at 20.
// Signed-out users see a nudge to create an agency account (the whole point:
// saving is a reason to hold an account).
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const keyOf = (handleOrItem: string | { handle: string }): string =>
  (typeof handleOrItem === 'string' ? handleOrItem : handleOrItem.handle).toLowerCase();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface OutreachHistoryItem {
  id: string;
  channel: string;
  recipient: string | null;
  subject: string | null;
  preview: string;
  status: string;
  sent_at: string;
}
const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

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

  return <PipelineBoard pipeline={pipeline} brand={brand} category={category} />;
}

function PipelineBoard({ pipeline, brand, category }: { pipeline: PipelineApi; brand: string; category: string }) {
  const { items } = pipeline;
  // Selected handles (lowercased) for bulk contact.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  // Group by stage, in funnel order.
  const byStatus = useMemo(() => {
    const m = new Map<PipelineStatus, PipelineItem[]>();
    for (const st of PIPELINE_STATUSES) m.set(st, []);
    for (const it of items) m.get(it.status)?.push(it);
    return m;
  }, [items]);

  // Drop any selections whose rows have disappeared (removed, etc.).
  useEffect(() => {
    const live = new Set(items.map((i) => keyOf(i)));
    setSelected((prev) => {
      const next = new Set([...prev].filter((h) => live.has(h)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(keyOf(i))),
    [items, selected],
  );

  function toggleOne(handle: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(handle);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }
  // Click a stage chip → select/deselect every creator in that stage.
  function toggleStage(st: PipelineStatus) {
    const rows = byStatus.get(st) ?? [];
    if (rows.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = rows.every((r) => next.has(keyOf(r)));
      for (const r of rows) { if (allIn) next.delete(keyOf(r)); else next.add(keyOf(r)); }
      return next;
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-white/60 p-6 text-center">
        <p className="text-[13.5px] text-ink-500">
          No creators saved for {brand} yet. Tap <span className="font-semibold text-ink-700">+ Save</span> on any creator to start your pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex flex-wrap gap-2 flex-1">
          {PIPELINE_STATUSES.map((st) => {
            const rows = byStatus.get(st) ?? [];
            if (rows.length === 0) return null;
            const allIn = rows.every((r) => selected.has(keyOf(r)));
            return (
              <button
                key={st}
                onClick={() => toggleStage(st)}
                title={`Select all in ${STATUS_LABEL[st]}`}
                className="text-[11.5px] px-2.5 py-1 rounded-full font-semibold transition-shadow"
                style={{
                  background: `${STATUS_COLOR[st]}14`,
                  color: STATUS_COLOR[st],
                  boxShadow: allIn ? `inset 0 0 0 1.5px ${STATUS_COLOR[st]}` : undefined,
                }}
              >
                {STATUS_LABEL[st]} · {rows.length}
              </button>
            );
          })}
        </div>
        <a
          href={`/api/brand/pipeline/export?brand=${encodeURIComponent(brand)}`}
          className="shrink-0 text-[12px] font-semibold text-ink-500 hover:text-ink-800 border border-border rounded-lg px-2.5 py-1 transition-colors"
          title={`Download ${brand} pipeline as CSV`}
        >
          Export CSV
        </a>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-white px-3.5 py-2.5 flex-wrap">
          <span className="text-[13px] font-semibold text-ink-800">{selected.size} selected</span>
          <button
            onClick={() => setBulkOpen(true)}
            className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg text-white"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
          >
            Draft outreach →
          </button>
          <button onClick={() => setSelected(new Set())} className="text-[12.5px] text-ink-400 hover:text-ink-600 underline">
            Clear
          </button>
        </div>
      )}

      <div className="space-y-2.5">
        {items.map((it) => (
          <PipelineRow
            key={it.id}
            item={it}
            pipeline={pipeline}
            brand={brand}
            category={category}
            selected={selected.has(keyOf(it))}
            onToggleSelect={() => toggleOne(it.handle)}
          />
        ))}
      </div>

      {bulkOpen && selectedItems.length > 0 && (
        <BulkContactModal
          items={selectedItems}
          brand={brand}
          category={category}
          pipeline={pipeline}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
}

function PipelineRow({
  item,
  pipeline,
  brand,
  category,
  selected,
  onToggleSelect,
}: {
  item: PipelineItem;
  pipeline: PipelineApi;
  brand: string;
  category: string;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [contacting, setContacting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<OutreachHistoryItem[] | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const name = snapStr(item.snapshot, 'name') || item.handle;
  const followers = snapNum(item.snapshot, 'followers');
  const engagement = snapNum(item.snapshot, 'engagement');
  const pic = snapStr(item.snapshot, 'profile_pic_url');

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const r = await fetch(`/api/outreach/history?handle=${encodeURIComponent(item.handle)}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      setHistory(Array.isArray(d.items) ? d.items : []);
    } catch {
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  }, [item.handle]);

  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history === null) void loadHistory();
  }

  // After sending, the log changed — drop the cache so it refetches on next open.
  function afterContact() {
    setContacting(false);
    setHistory(null);
    if (showHistory) void loadHistory();
  }

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
    <div
      className="rounded-xl bg-white border border-border transition-colors"
      style={selected ? { borderColor: ACCENT, background: ACCENT_SOFT } : undefined}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="shrink-0 w-4 h-4 rounded cursor-pointer accent-[#6C4DF6]"
          title="Select for bulk outreach"
        />
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
          onClick={toggleHistory}
          className={`shrink-0 text-[12px] font-semibold rounded-lg px-2 py-1.5 transition-colors ${showHistory ? 'text-ink-700' : 'text-ink-400 hover:text-ink-600'}`}
          title="Outreach history"
        >
          Log{history && history.length > 0 ? ` · ${history.length}` : ''}
        </button>

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
      </div>

      {/* Outreach history — this account's logged sends to this creator */}
      {showHistory && (
        <div className="border-t border-border px-3 py-2.5">
          {histLoading && <p className="text-[12px] text-ink-400">Loading history…</p>}
          {!histLoading && history && history.length === 0 && (
            <p className="text-[12px] text-ink-400">No outreach logged yet — the Contact button records email sends here.</p>
          )}
          {!histLoading && history && history.length > 0 && (
            <ul className="space-y-1.5">
              {history.map((h) => (
                <li key={h.id} className="text-[12px] text-ink-600 flex items-start gap-2">
                  <span
                    className="shrink-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ background: h.status === 'sent' ? '#dcfce7' : '#fee2e2', color: h.status === 'sent' ? '#15803d' : '#b91c1c' }}
                  >
                    {h.channel}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink-800 font-medium">{h.subject || '(no subject)'}</span>
                    {h.recipient ? <span className="text-ink-400"> → {h.recipient}</span> : null}
                    {h.preview ? <span className="block text-ink-400 truncate">{h.preview}</span> : null}
                  </span>
                  <span className="shrink-0 text-ink-400">{fmtDate(h.sent_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {contacting && (
        <ContactModal
          item={item}
          brand={brand}
          category={category}
          pipeline={pipeline}
          onClose={afterContact}
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

// ---- Bulk contact — draft + send to many at once -------------------------
// Drafts every selected creator in PARALLEL (fast — pure LLM calls), but SENDS
// email SEQUENTIALLY with a small delay (deliverability: a tight burst of cold
// mail trips rate limits and spam filters). Every success advances that row to
// 'contacted'. Partial failure is normal — no-email rows are skipped, failures
// stay put for retry. Capped at 20, and each draft is individually personalized
// (not one template blasted N times) to keep this legitimate, not spammy.

type SendState = 'idle' | 'sending' | 'sent' | 'failed' | 'skipped';
interface BulkRow {
  message: string;
  recipient: string;
  state: SendState;
  error?: string;
}
const MAX_BULK = 20;
const SEND_DELAY_MS = 400;

function BulkContactModal({
  items,
  brand,
  category,
  pipeline,
  onClose,
}: {
  items: PipelineItem[];
  brand: string;
  category: string;
  pipeline: PipelineApi;
  onClose: () => void;
}) {
  const targets = useMemo(() => items.slice(0, MAX_BULK), [items]);
  // Read the live target list inside async loops without re-subscribing effects.
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  const [channel, setChannel] = useState<'dm' | 'email'>(
    targets.some((t) => snapStr(t.snapshot, 'email')) ? 'email' : 'dm',
  );
  const [rows, setRows] = useState<Record<string, BulkRow>>({});
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  const genAll = useCallback(async (ch: 'dm' | 'email') => {
    setDrafting(true);
    const list = targetsRef.current;
    // Seed rows (preserve any recipient the user already edited).
    setRows((prev) => {
      const next: Record<string, BulkRow> = {};
      for (const it of list) {
        const k = keyOf(it);
        next[k] = { message: '', recipient: prev[k]?.recipient ?? snapStr(it.snapshot, 'email'), state: 'idle' };
      }
      return next;
    });
    const results = await Promise.all(
      list.map(async (it) => {
        try {
          const r = await fetch('/api/discover-live/outreach', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              handle: it.handle,
              brand,
              category,
              channel: ch === 'email' ? 'email' : 'dm',
              prompt: category ? `${brand} — ${category} collaboration` : `collaboration with ${brand}`,
            }),
          });
          const d = await r.json().catch(() => ({}));
          return { k: keyOf(it), message: typeof d.message === 'string' ? d.message : '' };
        } catch {
          return { k: keyOf(it), message: '' };
        }
      }),
    );
    setRows((prev) => {
      const next = { ...prev };
      for (const r of results) if (next[r.k]) next[r.k] = { ...next[r.k]!, message: r.message };
      return next;
    });
    setDrafting(false);
  }, [brand, category]);

  useEffect(() => { void genAll(channel); }, [channel, genAll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const emailable = targets.filter((t) => EMAIL_RE.test(rows[keyOf(t)]?.recipient ?? '')).length;
  const sentCount = Object.values(rows).filter((r) => r.state === 'sent').length;
  const failedCount = Object.values(rows).filter((r) => r.state === 'failed').length;

  async function sendAllEmail() {
    if (sending) return;
    setSending(true);
    const snap = rows;
    const queue = targetsRef.current.filter((t) => {
      const r = snap[keyOf(t)];
      return r && r.state !== 'sent' && EMAIL_RE.test(r.recipient) && r.message.trim().length > 1;
    });
    for (let i = 0; i < queue.length; i++) {
      const it = queue[i]!;
      const k = keyOf(it);
      const r = snap[k]!;
      setRows((p) => ({ ...p, [k]: { ...p[k]!, state: 'sending', error: undefined } }));
      try {
        const res = await fetch('/api/outreach/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            handle: it.handle,
            message: r.message,
            recipient: r.recipient,
            subject: `Collaboration with ${brand}`,
            creator_id: it.creator_id ?? undefined,
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d.ok) {
          setRows((p) => ({ ...p, [k]: { ...p[k]!, state: 'sent' } }));
          await pipeline.updateStatus(it.handle, 'contacted');
        } else {
          setRows((p) => ({ ...p, [k]: { ...p[k]!, state: 'failed', error: d.error || 'Send failed' } }));
        }
      } catch {
        setRows((p) => ({ ...p, [k]: { ...p[k]!, state: 'failed', error: 'Network error' } }));
      }
      if (i < queue.length - 1) await sleep(SEND_DELAY_MS);
    }
    setSending(false);
  }

  function sendDmOne(it: PipelineItem) {
    const k = keyOf(it);
    const msg = rows[k]?.message ?? '';
    if (!msg) return;
    void navigator.clipboard.writeText(msg).catch(() => {});
    setRows((p) => ({ ...p, [k]: { ...p[k]!, state: 'sent' } }));
    void pipeline.updateStatus(it.handle, 'contacted');
    window.open(`https://ig.me/m/${it.handle}`, '_blank', 'noopener');
  }

  const badge = (state: SendState) => {
    if (state === 'sent') return <span className="text-[11px] text-emerald-600 font-semibold">Sent ✓</span>;
    if (state === 'sending') return <span className="text-[11px] text-ink-400">Sending…</span>;
    if (state === 'failed') return <span className="text-[11px] text-rose-600 font-semibold">Failed</span>;
    return null;
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="text-[15px] font-semibold text-ink-900">
            Bulk outreach · {targets.length} creator{targets.length === 1 ? '' : 's'}
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 text-[18px] leading-none">×</button>
        </div>

        {/* Channel toggle + summary */}
        <div className="px-5 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center p-1 rounded-lg bg-[#f4f4f6] text-[12.5px]">
            {(['dm', 'email'] as const).map((ch) => (
              <button
                key={ch}
                onClick={() => setChannel(ch)}
                className={`px-3 py-1 rounded-md transition-colors ${channel === ch ? 'bg-white shadow-sm font-semibold' : 'text-ink-500'}`}
                style={channel === ch ? { color: ACCENT } : undefined}
              >
                {ch === 'dm' ? 'Instagram DM' : 'Email'}
              </button>
            ))}
          </div>
          {channel === 'email' && (
            <span className="text-[12px] text-ink-500">{emailable} emailable · {targets.length - emailable} DM-only</span>
          )}
          {(sentCount > 0 || failedCount > 0) && (
            <span className="text-[12px] text-ink-500">{sentCount} sent{failedCount ? ` · ${failedCount} failed` : ''}</span>
          )}
        </div>

        {/* Per-creator drafts */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {targets.map((it) => {
            const k = keyOf(it);
            const row = rows[k];
            const noEmail = channel === 'email' && !EMAIL_RE.test(row?.recipient ?? '');
            return (
              <div key={it.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-[13px] font-semibold text-ink-900 truncate">@{it.handle}</div>
                  <div className="flex items-center gap-2">
                    {badge(row?.state ?? 'idle')}
                    {channel === 'dm' && (
                      <button
                        onClick={() => sendDmOne(it)}
                        disabled={drafting || !row?.message}
                        className="text-[11.5px] font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50"
                        style={{ background: ACCENT_SOFT, color: ACCENT }}
                      >
                        Copy &amp; open
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  value={drafting && !row?.message ? 'Drafting…' : (row?.message ?? '')}
                  onChange={(e) => setRows((p) => ({ ...p, [k]: { ...p[k]!, message: e.target.value } }))}
                  readOnly={drafting && !row?.message}
                  rows={3}
                  className="w-full rounded-lg border border-border px-2.5 py-2 text-[12.5px] text-ink-800 leading-relaxed resize-y focus:outline-none"
                />
                {channel === 'email' && (
                  <input
                    type="email"
                    value={row?.recipient ?? ''}
                    onChange={(e) => setRows((p) => ({ ...p, [k]: { ...p[k]!, recipient: e.target.value } }))}
                    placeholder="no email on file — add one to send"
                    className={`mt-1.5 w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] focus:outline-none ${noEmail ? 'border-amber-300 bg-amber-50' : 'border-border'}`}
                  />
                )}
                {row?.error && <p className="mt-1 text-[11px] text-rose-600">{row.error}</p>}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border bg-[#fafafc]">
          <button
            onClick={() => void genAll(channel)}
            disabled={drafting || sending}
            className="text-[12.5px] font-semibold disabled:opacity-50"
            style={{ color: ACCENT }}
          >
            {drafting ? 'Drafting…' : 'Re-draft all'}
          </button>
          {channel === 'email' ? (
            <button
              onClick={() => void sendAllEmail()}
              disabled={drafting || sending || emailable === 0}
              className="px-4 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              {sending ? `Sending… (${sentCount}/${emailable})` : `Send ${emailable} email${emailable === 1 ? '' : 's'}`}
            </button>
          ) : (
            <span className="text-[12px] text-ink-500">Copy &amp; open each DM above — sending by hand keeps it compliant.</span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
