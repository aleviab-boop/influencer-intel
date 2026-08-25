'use client';

import { useState } from 'react';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';

interface Suggestion { label: string; message: string }

function ChannelIcon({ kind }: { kind: 'dm' | 'email' }) {
  if (kind === 'dm') {
    // Instagram glyph
    return (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5.5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  // Envelope
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="m3 6 9 6 9-6" />
    </svg>
  );
}

const inp =
  'w-full px-3.5 py-2.5 rounded-xl border border-[#e3def9] text-[14px] text-[#222] bg-white focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all';

export default function ReplyAssistant() {
  const [reply, setReply] = useState('');
  const [goal, setGoal] = useState('');
  const [brand, setBrand] = useState('');
  const [channel, setChannel] = useState<'dm' | 'email'>('dm');
  const [language, setLanguage] = useState<'english' | 'hinglish' | 'hindi'>('english');
  const [out, setOut] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  async function generate() {
    if (reply.trim().length < 3 || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const d = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply, goal, brand, channel, language }),
      }).then((r) => r.json());
      if (Array.isArray(d.suggestions) && d.suggestions.length) setOut(d.suggestions);
      else setErr(d.error || 'Could not draft a reply.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function copy(i: number, text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(i);
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#111]">
      <MarketingNav />
      <main className="flex-1">
        <section className="relative isolate overflow-hidden py-10 md:py-14" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.15), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.12), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }}>
          <PageDoodles className="-z-10" />
          <div className="max-w-2xl mx-auto px-6 text-center">
            <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>Reply Assistant</span>
            <h1 className="mt-2 text-3xl md:text-5xl font-bold tracking-tight">They replied — what do you say back?</h1>
            <p className="mt-3 text-[16px] text-[#555]">Paste the creator&apos;s message and get three ready-to-send responses, each with a different angle.</p>
          </div>
        </section>

        <section className="max-w-2xl mx-auto px-6 py-8">
          <div className="space-y-3">
            {/* Channel — icon-only toggle, sits on top so you pick the medium first */}
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-1.5 p-1.5 rounded-2xl bg-[#f4f0ff]">
                <button
                  onClick={() => setChannel('dm')}
                  title="Instagram DM"
                  aria-label="Instagram DM"
                  className={`w-11 h-10 grid place-items-center rounded-xl transition-all ${channel === 'dm' ? 'bg-white shadow-sm' : 'hover:bg-white/60'}`}
                  style={{ color: channel === 'dm' ? ACCENT : '#9b93b5' }}
                >
                  <ChannelIcon kind="dm" />
                </button>
                <button
                  onClick={() => setChannel('email')}
                  title="Email"
                  aria-label="Email"
                  className={`w-11 h-10 grid place-items-center rounded-xl transition-all ${channel === 'email' ? 'bg-white shadow-sm' : 'hover:bg-white/60'}`}
                  style={{ color: channel === 'email' ? ACCENT : '#9b93b5' }}
                >
                  <ChannelIcon kind="email" />
                </button>
              </div>
            </div>

            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={4}
              placeholder="Paste the creator's reply here… e.g. &quot;Hey! Sounds interesting — what's the budget and deliverables?&quot;"
              className={`${inp} resize-none`}
              autoFocus
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Your brand (optional)" className={inp} />
              <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Your goal — e.g. negotiate to ₹40k, share brief" className={inp} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={language} onChange={(e) => setLanguage(e.target.value as 'english' | 'hinglish' | 'hindi')} className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] text-[13px] text-[#444] focus:outline-none focus:border-[#6C4DF6]">
                <option value="english">English</option>
                <option value="hinglish">Hinglish</option>
                <option value="hindi">हिंदी</option>
              </select>
              <button
                onClick={generate}
                disabled={loading || reply.trim().length < 3}
                className="ml-auto px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-50 hover:brightness-105 flex items-center gap-2"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #F7B500)` }}
              >
                {loading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {loading ? 'Drafting…' : '✦ Draft replies'}
              </button>
            </div>
            {err && <div className="text-[13px] text-rose-600">{err}</div>}
          </div>

          {out.length > 0 && (
            <div className="mt-8 space-y-3">
              {out.map((s, i) => (
                <div key={i} className="rounded-2xl border border-[#eee] p-4" style={{ animation: `ii-fadeup .4s ${i * 0.08}s both` }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-semibold px-2.5 py-1 rounded-lg" style={{ background: ACCENT_SOFT, color: ACCENT }}>{s.label}</span>
                    <button onClick={() => copy(i, s.message)} className="text-[12px] font-medium hover:underline" style={{ color: copied === i ? '#059669' : ACCENT }}>
                      {copied === i ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-[14px] text-[#222] whitespace-pre-wrap leading-relaxed">{s.message}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
