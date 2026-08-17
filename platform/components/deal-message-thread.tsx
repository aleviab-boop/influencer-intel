'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';

type Sender = 'brand' | 'creator';

interface MessageView {
  id: string;
  sender: Sender;
  mine: boolean;
  body: string;
  when: string;
  time_label: string;
  day_label: string;
  show_day: boolean;
  read: boolean;
}
interface Thread {
  available: boolean;
  viewer: Sender;
  counterpart_label: string;
  total: number;
  unread: number;
  last_at: string | null;
  items: MessageView[];
}

/**
 * Full-height chat panel for a per-deal brand↔creator thread. The thread JSON
 * is viewer-shaped server-side (each message already flagged mine/theirs), so
 * this same component drives both sides — only the GET/POST URLs differ.
 */
export function DealMessageThread({
  getUrl,
  postUrl,
  backHref,
  backLabel,
  title,
}: {
  getUrl: string;
  postUrl: string;
  backHref: string;
  backLabel: string;
  title: string;
}) {
  const [data, setData] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    return fetch(getUrl)
      .then((r) => r.json())
      .then((d: Thread) => setData(d))
      .catch(() => setData({ available: false } as Thread))
      .finally(() => setLoading(false));
  }, [getUrl]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [data?.items.length]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      }).then((res) => res.json());
      if (r?.saved) { setText(''); await load(); }
    } catch { /* leave the text so the user can retry */ } finally {
      setSending(false);
    }
  }, [text, sending, postUrl, load]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const counterpart = data?.counterpart_label ?? '';

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f4f8] font-sans">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-border">
        <div className="max-w-2xl mx-auto w-full px-5 py-3 flex items-center gap-3">
          <Link href={backHref} className="group inline-flex items-center gap-1 text-[13px] font-semibold text-ink-500 hover:text-ink-900 transition-colors">
            <span className="inline-block transition-transform duration-300 group-hover:-translate-x-0.5">←</span> {backLabel}
          </Link>
          <div className="ml-2 min-w-0">
            <div className="text-[14px] font-semibold text-ink-900 truncate">{counterpart || title}</div>
            <div className="text-[11.5px] text-ink-400 truncate">{title}</div>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 w-full">
        <div className="max-w-2xl mx-auto w-full px-5 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-24"><div className="w-9 h-9 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
          ) : !data?.available ? (
            <div className="text-center py-20 text-[13.5px] text-ink-400">This conversation isn&rsquo;t available.</div>
          ) : data.items.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-12 h-12 mx-auto rounded-2xl grid place-items-center mb-4" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /></svg>
              </div>
              <h2 className="text-[15px] font-semibold text-ink-900">No messages yet</h2>
              <p className="mt-1.5 text-[13px] text-ink-500">Start the conversation with {counterpart || 'them'} about this deal.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {data.items.map((m) => (
                <div key={m.id}>
                  {m.show_day && (
                    <div className="flex items-center justify-center my-4">
                      <span className="text-[11px] font-semibold text-ink-400 bg-white border border-border rounded-full px-3 py-1">{m.day_label}</span>
                    </div>
                  )}
                  <div className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[78%]">
                      <div
                        className="rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words"
                        style={m.mine
                          ? { background: ACCENT, color: '#fff', borderBottomRightRadius: 6 }
                          : { background: '#fff', color: '#1f2937', border: '1px solid var(--ii-border, #ececf2)', borderBottomLeftRadius: 6 }}
                      >
                        {m.body}
                      </div>
                      <div className={`mt-1 flex items-center gap-1 text-[10.5px] text-ink-400 ${m.mine ? 'justify-end' : 'justify-start'}`}>
                        <span>{m.time_label}</span>
                        {m.mine && <span>{m.read ? '· Read' : '· Sent'}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
      </main>

      {/* Composer */}
      {data?.available && (
        <footer className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-border">
          <div className="max-w-2xl mx-auto w-full px-5 py-3 flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={`Message ${counterpart || ''}…`}
              className="flex-1 resize-none max-h-32 text-[13.5px] text-ink-900 bg-[#f7f7fb] border border-border rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-ink-900"
            />
            <button
              onClick={() => void send()}
              disabled={sending || !text.trim()}
              className="shrink-0 h-10 px-4 rounded-xl text-[13px] font-semibold text-white transition-all duration-200 disabled:opacity-50 hover:brightness-105"
              style={{ background: ACCENT }}
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
