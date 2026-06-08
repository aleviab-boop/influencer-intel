'use client';

import { useEffect, useState } from 'react';
import { MarketingNav } from '@/components/marketing';

interface Automation {
  id: string;
  name: string;
  post_label: string | null;
  trigger_type: 'keyword' | 'any';
  keyword: string | null;
  dm_message: string;
  comment_reply: string | null;
  status: 'active' | 'paused' | 'draft';
  reply_count: number;
  last_active_at: string | null;
}

interface Run {
  id: string;
  commenter: string | null;
  comment_text: string | null;
  matched: boolean;
  dm_sent: string | null;
  status: string;
  created_at: string;
}

export default function AutomationsPage() {
  const [items, setItems] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/automations');
      const d = await r.json();
      setItems(d.automations ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const active = items.filter((a) => a.status === 'active').length;
  const replies = items.reduce((s, a) => s + a.reply_count, 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f7fb] font-sans">
      <MarketingNav />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Comment to DM</div>
            <h1 className="text-2xl font-bold text-ink-900">Automations</h1>
          </div>
          <button onClick={() => setCreating((c) => !c)} className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800">
            + New automation
          </button>
        </div>

        {!loading && items.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Summary label="Automations" value={String(items.length)} />
            <Summary label="Active" value={String(active)} />
            <Summary label="Replies sent" value={replies.toLocaleString('en-IN')} accent />
          </div>
        )}

        {creating && <CreateForm onCreated={() => { setCreating(false); void load(); }} onCancel={() => setCreating(false)} />}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-sm text-ink-400 py-20 text-center rounded-2xl border border-dashed border-border bg-white">
            No automations yet. Create one to turn comments into DMs.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((a) => (
              <AutomationCard key={a.id} a={a} onChanged={load} />
            ))}
          </div>
        )}

        <p className="mt-8 text-[12px] text-ink-400">
          Phase 1 — the runner is simulated (logs the DM it would send). Connect Instagram &amp; enable messaging
          permissions to send for real.
        </p>
      </main>
    </div>
  );
}

function CreateForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [postLabel, setPostLabel] = useState('');
  const [trigger, setTrigger] = useState<'keyword' | 'any'>('keyword');
  const [keyword, setKeyword] = useState('');
  const [dm, setDm] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (name.trim().length < 2) return setErr('Name is required');
    if (dm.trim().length < 2) return setErr('DM message is required');
    if (trigger === 'keyword' && !keyword.trim()) return setErr('Keyword is required');
    setBusy(true);
    try {
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), post_label: postLabel.trim() || undefined, trigger_type: trigger, keyword: keyword.trim() || undefined, dm_message: dm.trim(), comment_reply: reply.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? 'Failed');
      else onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 p-5 rounded-2xl bg-white border border-border shadow-card">
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Automation name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Price Reply" className={inp} /></Field>
        <Field label="Post (optional)"><input value={postLabel} onChange={(e) => setPostLabel(e.target.value)} placeholder="Summer Collection reel" className={inp} /></Field>
        <Field label="Trigger">
          <div className="flex gap-1 p-1 rounded-lg bg-[#f2f2f7] w-max">
            {(['keyword', 'any'] as const).map((t) => (
              <button key={t} onClick={() => setTrigger(t)} className={`px-3 py-1.5 rounded-md text-[13px] capitalize ${trigger === t ? 'bg-white shadow-sm text-ink-900 font-medium' : 'text-ink-500'}`}>{t === 'any' ? 'any comment' : 'keyword'}</button>
            ))}
          </div>
        </Field>
        {trigger === 'keyword' && <Field label="Keyword"><input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="price" className={inp} /></Field>}
      </div>
      <Field label="DM message"><textarea value={dm} onChange={(e) => setDm(e.target.value)} rows={2} placeholder="Hey! Here's the link you asked for 👉 …" className={inp} /></Field>
      <Field label="Public comment reply (optional)"><input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Just sent you a DM! 💌" className={inp} /></Field>
      {err && <div className="mt-2 text-sm text-rose-700">{err}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-ink-600 hover:text-ink-900">Cancel</button>
        <button onClick={submit} disabled={busy} className="px-5 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50">{busy ? 'Creating…' : 'Create automation'}</button>
      </div>
    </div>
  );
}

function AutomationCard({ a, onChanged }: { a: Automation; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<{ matched: boolean; fired: boolean; dm_sent: string | null } | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'done'>('idle');

  async function patch(patch: Partial<Automation>) {
    await fetch(`/api/automations/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    await onChanged();
  }
  async function remove() {
    if (!confirm(`Delete automation “${a.name}”?`)) return;
    await fetch(`/api/automations/${a.id}`, { method: 'DELETE' });
    await onChanged();
  }
  async function loadRuns() {
    const r = await fetch(`/api/automations/${a.id}/runs`);
    const d = await r.json();
    setRuns(d.runs ?? []);
  }
  async function runTest() {
    if (!comment.trim()) return;
    setBusy(true);
    setResult(null);
    setPhase('sending');
    try {
      const r = await fetch(`/api/automations/${a.id}/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: comment.trim(), commenter: '@test_user' }) });
      const d = await r.json();
      // brief "typing…" beat so the demo reads like a real reply
      await new Promise((res) => setTimeout(res, 1000));
      setResult(d);
      setPhase('done');
      await loadRuns();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const statusCls = a.status === 'active' ? 'text-emerald-700 bg-emerald-50' : a.status === 'paused' ? 'text-amber-700 bg-amber-50' : 'text-ink-500 bg-[#f2f2f7]';

  return (
    <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <span className="w-9 h-9 rounded-xl grid place-items-center text-white shrink-0 bg-ink-900">⚡</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink-900 truncate">{a.name}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusCls}`}>{a.status}</span>
          </div>
          <div className="text-[12px] text-ink-500 truncate">
            {a.trigger_type === 'any' ? 'Any comment' : <>Comment contains “<span className="text-ink-700">{a.keyword}</span>”</>}
            {a.post_label && <> · on {a.post_label}</>} → DM
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold tabular-nums text-ink-900">{a.reply_count.toLocaleString('en-IN')}</div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">replies</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => patch({ status: a.status === 'active' ? 'paused' : 'active' })} className="px-2.5 py-1.5 text-[12px] rounded-md border border-border hover:bg-[#faf9ff]">{a.status === 'active' ? 'Pause' : 'Activate'}</button>
          <button onClick={() => { setOpen((o) => !o); if (!open) { setPhase('idle'); setResult(null); void loadRuns(); } }} className="px-2.5 py-1.5 text-[12px] rounded-md border border-border hover:bg-[#faf9ff]">Test</button>
          <button onClick={remove} className="px-2 py-1.5 text-[12px] rounded-md text-ink-400 hover:text-rose-600">✕</button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border-soft bg-[#fafafe] p-4">
          <div className="text-[12px] text-ink-500 mb-2">Simulate a comment to test the trigger:</div>
          <div className="flex gap-2">
            <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runTest()} placeholder={`Try “${a.keyword ?? 'anything'}”`} className={inp} />
            <button onClick={runTest} disabled={busy} className="px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50 whitespace-nowrap">{busy ? 'Running…' : 'Run'}</button>
          </div>

          {/* animated conversation */}
          {phase !== 'idle' && (
            <div className="mt-3 rounded-xl border border-border bg-white p-3 space-y-2">
              {/* incoming comment */}
              <div className="flex items-end gap-2 ii-fadeup">
                <span className="w-6 h-6 rounded-full shrink-0" style={{ background: 'linear-gradient(135deg, hsl(265 70% 60%), hsl(305 70% 50%))' }} />
                <div className="max-w-[80%]">
                  <div className="text-[10px] text-ink-400 mb-0.5">@test_user commented</div>
                  <div className="px-3 py-1.5 rounded-2xl rounded-bl-sm bg-[#f1f0f7] text-ink-800 text-[13px]">{comment}</div>
                </div>
              </div>

              {/* typing → reply */}
              {phase === 'sending' ? (
                <div className="flex justify-end">
                  <div className="px-3.5 py-2.5 rounded-2xl rounded-br-sm bg-[#ece9fb] inline-flex gap-1 items-center">
                    {[0, 150, 300].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full bg-[#9b8bff] animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                  </div>
                </div>
              ) : result?.fired ? (
                <div className="ii-fadeup">
                  <div className="flex justify-end">
                    <div className="max-w-[80%]">
                      <div className="text-[10px] text-emerald-600 text-right mb-0.5 font-medium">✓ Auto-DM sent</div>
                      <div className="px-3.5 py-2 rounded-2xl rounded-br-sm text-white text-[13px] leading-relaxed" style={{ background: 'linear-gradient(135deg,#6C4DF6,#9b7bff)' }}>{result.dm_sent}</div>
                    </div>
                  </div>
                  {a.comment_reply && <div className="mt-1.5 text-[11px] text-ink-400 text-right">+ public reply: “{a.comment_reply}”</div>}
                </div>
              ) : (
                <div className={`ii-fadeup text-[13px] px-3 py-2 rounded-lg ${result?.matched ? 'bg-amber-50 text-amber-800' : 'bg-[#f4f4f6] text-ink-600'}`}>
                  {result?.matched ? '⏸ Matched, but this automation is paused — nothing sent.' : '✗ No keyword match — skipped, no DM sent.'}
                </div>
              )}
            </div>
          )}
          {runs.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">Recent runs</div>
              <div className="space-y-1">
                {runs.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-[12px] text-ink-600">
                    <span className={`w-1.5 h-1.5 rounded-full ${r.matched ? 'bg-emerald-500' : 'bg-ink-300'}`} />
                    <span className="text-ink-400">{r.commenter ?? '@user'}:</span>
                    <span className="truncate">“{r.comment_text}”</span>
                    <span className="ml-auto text-ink-400 shrink-0">{r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inp = 'w-full px-3 py-2 border border-border bg-white text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mt-3 first:mt-0">
      <span className="text-[12px] text-ink-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Summary({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-white border border-border p-4 shadow-card">
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-[#6C4DF6]' : 'text-ink-900'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}
