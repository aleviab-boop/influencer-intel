'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';

interface Draft {
  brief_creator_id: string;
  handle: string;
  display_name: string | null;
  outreach: {
    dm: string;
    email: { subject: string; body: string };
    generated_at: string;
  };
}

interface ShortlistResp {
  brief: { id: string; raw_text: string };
  creators: Array<{
    brief_creator_id: string;
    rank: number;
    creator: { handle: string; display_name: string | null; follower_count: number | string | null };
  }>;
}

export default function OutreachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: briefId } = use(params);
  const [shortlist, setShortlist] = useState<ShortlistResp | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [activeChannel, setActiveChannel] = useState<'dm' | 'email'>('dm');
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/briefs/${briefId}`).then((r) => r.json()).then(setShortlist).catch(() => {});
    fetch(`/api/briefs/${briefId}/outreach`)
      .then((r) => r.json())
      .then((d) => setDrafts(d.drafts ?? []))
      .catch(() => {});
  }, [briefId]);

  async function generate() {
    if (selected.size === 0) {
      setError('Pick at least one creator first.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch(`/api/briefs/${briefId}/outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief_creator_ids: Array.from(selected) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Failed');
      // Refresh drafts
      const r2 = await fetch(`/api/briefs/${briefId}/outreach`);
      const d2 = await r2.json();
      setDrafts(d2.drafts ?? []);
      setActiveIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <main className="min-h-screen bg-canvas">
      <AppHeader />

      <section className="max-w-6xl mx-auto px-6 pt-8 pb-4">
        <Link
          href={`/shortlist/${briefId}`}
          className="text-sm text-ink-600 hover:text-ink-900 inline-flex items-center gap-1.5 mb-4"
        >
          <span>←</span> Shortlist
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900 mb-1">
          Outreach drafts
        </h1>
        <p className="text-ink-600 text-body">
          Pick creators, generate personalised DM + email drafts, copy and send.
        </p>
      </section>

      {/* Picker */}
      <section className="max-w-6xl mx-auto px-6 pb-4">
        <div className="rounded-[14px] border border-border bg-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-ink-600">
              {selected.size} of {shortlist?.creators?.length ?? 0} selected
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelected(new Set((shortlist?.creators ?? []).slice(0, 10).map((c) => c.brief_creator_id)))}
                className="px-3 py-1.5 rounded-[8px] text-sm bg-canvas border border-border text-ink-600 hover:text-ink-900"
              >
                Top 10
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="px-3 py-1.5 rounded-[8px] text-sm bg-canvas border border-border text-ink-600 hover:text-ink-900"
              >
                Clear
              </button>
              <button
                onClick={generate}
                disabled={generating || selected.size === 0}
                className="px-4 py-1.5 rounded-[8px] bg-ink-900 text-white text-sm font-medium hover:bg-ink-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? 'Drafting…' : `Generate ${selected.size > 0 ? selected.size : ''} draft${selected.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-60 overflow-auto pr-1">
            {(shortlist?.creators ?? []).map((c) => (
              <label
                key={c.brief_creator_id}
                className="flex items-center gap-2 px-3 py-2 rounded-[8px] hover:bg-canvas cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.brief_creator_id)}
                  onChange={() => toggle(c.brief_creator_id)}
                  className="accent-ink-900"
                />
                <span className="text-[12px] text-ink-400 tabular-nums w-5">{c.rank}</span>
                <span className="text-sm text-ink-900 truncate">@{c.creator.handle}</span>
              </label>
            ))}
          </div>
        </div>
        {error && (
          <div className="mt-3 px-4 py-2 rounded-[10px] bg-canvas border border-danger/30 text-danger text-sm">
            {error}
          </div>
        )}
      </section>

      {/* Drafts canvas */}
      {drafts.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 pb-16">
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-3">
            <aside className="rounded-[14px] border border-border bg-surface p-2 max-h-[600px] overflow-auto">
              {drafts.map((d, i) => (
                <button
                  key={d.brief_creator_id}
                  onClick={() => setActiveIdx(i)}
                  className={`w-full text-left px-3 py-2 rounded-[8px] text-sm transition-colors ${
                    i === activeIdx ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-canvas'
                  }`}
                >
                  <div className="truncate">@{d.handle}</div>
                  {d.display_name && (
                    <div className="text-[11px] opacity-70 truncate">{d.display_name}</div>
                  )}
                </button>
              ))}
            </aside>

            <div className="rounded-[14px] border border-border bg-surface p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Tab active={activeChannel === 'dm'} onClick={() => setActiveChannel('dm')}>
                    Instagram DM
                  </Tab>
                  <Tab active={activeChannel === 'email'} onClick={() => setActiveChannel('email')}>
                    Email
                  </Tab>
                </div>
                <CopyButton
                  text={
                    activeChannel === 'dm'
                      ? drafts[activeIdx]?.outreach.dm ?? ''
                      : `Subject: ${drafts[activeIdx]?.outreach.email.subject ?? ''}\n\n${drafts[activeIdx]?.outreach.email.body ?? ''}`
                  }
                />
              </div>

              {activeChannel === 'email' && drafts[activeIdx] && (
                <div className="text-[12px] text-ink-400 uppercase tracking-wider mb-1">
                  Subject
                </div>
              )}
              {activeChannel === 'email' && drafts[activeIdx] && (
                <div className="px-3 py-2 rounded-[8px] bg-canvas border border-border text-sm text-ink-900 mb-4">
                  {drafts[activeIdx]!.outreach.email.subject}
                </div>
              )}

              <div className="text-[12px] text-ink-400 uppercase tracking-wider mb-1">
                {activeChannel === 'dm' ? 'Message' : 'Body'}
              </div>
              <pre className="px-4 py-3 rounded-[10px] bg-canvas border border-border text-sm text-ink-900 leading-relaxed whitespace-pre-wrap font-sans min-h-[200px]">
                {activeChannel === 'dm'
                  ? drafts[activeIdx]?.outreach.dm
                  : drafts[activeIdx]?.outreach.email.body}
              </pre>
              <div className="mt-3 flex items-center gap-3 text-[11px] text-ink-400">
                <span>Generated {drafts[activeIdx] ? new Date(drafts[activeIdx]!.outreach.generated_at).toLocaleString() : ''}</span>
                <span>·</span>
                <span>Always review before sending. We don&apos;t auto-send.</span>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-[8px] text-sm transition-colors ${
        active ? 'bg-ink-900 text-white' : 'bg-canvas border border-border text-ink-600 hover:text-ink-900'
      }`}
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="px-3 py-1.5 rounded-[8px] text-sm bg-canvas border border-border text-ink-600 hover:text-ink-900"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}
