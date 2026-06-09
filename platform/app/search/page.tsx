'use client';

import { useState } from 'react';
import { MarketingNav, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Parsed { location: string | null; genres: string[]; keywords: string[]; hashtags: string[] }
interface Account { handle: string; full_name: string | null; follower_count: number | null; profile_pic_url: string | null; is_verified: boolean; is_private: boolean; byline: string | null }

const k = (v: number | null): string => { const n = Number(v) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); };

export default function InstagramSearchPage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saved, setSaved] = useState<Record<string, 'saving' | 'done'>>({});
  const [twoFA, setTwoFA] = useState(false);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  async function run() {
    if (q.trim().length < 2) return;
    setLoading(true); setError(null); setAccounts([]); setSaved({});
    try {
      const d = await fetch(`/api/search/instagram?q=${encodeURIComponent(q.trim())}`).then((r) => r.json());
      setConfigured(d.configured);
      setParsed(d.parsed ?? null);
      setAccounts(d.accounts ?? []);
      setTwoFA(!!d.twoFactorRequired);
      if (d.error) setError(d.error);
    } catch {
      setError('Search failed. Try again.');
    } finally { setLoading(false); }
  }

  async function verify() {
    if (!/^\d{6}$/.test(code.trim())) { setError('Enter the 6-digit code.'); return; }
    setVerifying(true); setError(null);
    try {
      const d = await fetch('/api/search/instagram/2fa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      }).then((r) => r.json());
      if (d.ok) { setTwoFA(false); setCode(''); await run(); }
      else setError(d.error || 'Verification failed.');
    } catch {
      setError('Verification failed. Try again.');
    } finally { setVerifying(false); }
  }

  async function save(handle: string) {
    setSaved((s) => ({ ...s, [handle]: 'saving' }));
    await fetch(`/api/scrape/instagram?handle=${encodeURIComponent(handle)}&save=1`).catch(() => {});
    setSaved((s) => ({ ...s, [handle]: 'done' }));
  }

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <MarketingNav />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-[#eee]">
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }} />
          <div className="grid-bg absolute inset-0 opacity-50" />
          <div className="relative max-w-3xl mx-auto px-6 pt-16 pb-10 text-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold" style={{ background: '#fff', color: ACCENT }}>Instagram search</span>
            <h1 className="mt-5 text-4xl md:text-5xl font-bold tracking-tight text-ink-900">Search creators across Instagram</h1>
            <p className="mt-4 text-[16px] text-ink-600 max-w-xl mx-auto">Type a prompt like <span className="font-medium text-ink-800">“fashion nagpur”</span> — we break it down and search Instagram live for matching accounts.</p>
            <div className="mt-7 max-w-xl mx-auto rounded-2xl bg-white border-2 border-[#e3def9] focus-within:border-[#6C4DF6] shadow-[0_12px_50px_rgba(108,77,246,0.12)] transition-colors p-2 flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="e.g. fashion nagpur, fitness mumbai, food delhi" className="flex-1 px-4 py-3 bg-transparent text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none" />
              <button onClick={run} disabled={loading} className="px-6 py-3 text-sm font-semibold text-white bg-ink-900 rounded-xl hover:bg-ink-800 disabled:opacity-50">{loading ? 'Searching…' : 'Search'}</button>
            </div>
            {parsed && (parsed.location || parsed.genres.length > 0) && (
              <div className="mt-3 flex items-center justify-center gap-1.5 flex-wrap text-[12px]">
                <span className="text-ink-400">parsed:</span>
                {parsed.genres.map((g) => <span key={g} className="px-2 py-0.5 rounded-full" style={{ background: ACCENT_SOFT, color: ACCENT }}>{g}</span>)}
                {parsed.location && <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">📍 {parsed.location}</span>}
                {parsed.hashtags.slice(0, 3).map((h) => <span key={h} className="px-2 py-0.5 rounded-full bg-[#f1f0f7] text-ink-500">#{h}</span>)}
              </div>
            )}
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-8">
          {configured === false && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800 text-[14px]">
              <div className="font-semibold mb-1">Live Instagram search isn’t set up yet</div>
              Add a throwaway Instagram account’s credentials as <code className="text-[12px]">IG_SCRAPER_USER</code> / <code className="text-[12px]">IG_SCRAPER_PASS</code> in <code className="text-[12px]">.env</code> and restart — then this searches Instagram live, for free.
            </div>
          )}
          {twoFA && (
            <div className="mb-4 rounded-2xl border border-[#e3def9] bg-[#faf9ff] p-5">
              <div className="font-semibold text-ink-900 mb-1 text-[14px]">Enter the 2FA code</div>
              <p className="text-[13px] text-ink-500 mb-3">Instagram sent a code to the scraper account (SMS or authenticator app). Paste it to finish signing in.</p>
              <div className="flex gap-2 max-w-xs">
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => e.key === 'Enter' && verify()} inputMode="numeric" placeholder="123456" className="flex-1 px-3 py-2.5 rounded-xl border border-border text-[15px] tracking-[0.3em] text-center focus:outline-none focus:border-[#6C4DF6]" />
                <button onClick={verify} disabled={verifying} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50" style={{ background: ACCENT }}>{verifying ? 'Verifying…' : 'Verify'}</button>
              </div>
            </div>
          )}
          {error && <div className="mb-4 text-sm text-rose-700">{error}</div>}

          {loading && <div className="flex items-center justify-center py-16"><div className="w-9 h-9 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>}

          {!loading && accounts.length > 0 && (
            <div className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border text-[12px] text-ink-500">{accounts.length} accounts found on Instagram</div>
              {accounts.map((a) => (
                <div key={a.handle} className="flex items-center gap-3 px-4 py-3 border-b border-border-soft last:border-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a.profile_pic_url ? <img src={a.profile_pic_url} alt={a.handle} className="w-9 h-9 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" /> : <div className="w-9 h-9 rounded-full bg-[#eee] shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink-900 truncate flex items-center gap-1.5">{a.full_name || `@${a.handle}`}{a.is_verified && <span style={{ color: ACCENT }}>✔</span>}</div>
                    <div className="text-[11px] text-ink-400 truncate">@{a.handle}{a.follower_count != null ? ` · ${k(a.follower_count)} followers` : ''}{a.byline ? ` · ${a.byline}` : ''}</div>
                  </div>
                  <a href={`https://www.instagram.com/${a.handle}/`} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1.5 text-[12px] rounded-lg border border-border hover:bg-[#faf9ff] shrink-0">Open</a>
                  <button onClick={() => save(a.handle)} disabled={!!saved[a.handle]} className="px-2.5 py-1.5 text-[12px] font-semibold rounded-lg text-white disabled:opacity-60 shrink-0" style={{ background: ACCENT }}>
                    {saved[a.handle] === 'done' ? 'Saved ✓' : saved[a.handle] === 'saving' ? '…' : 'Save'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {!loading && configured && accounts.length === 0 && !error && parsed && (
            <div className="text-sm text-ink-400 py-12 text-center rounded-2xl border border-dashed border-border">No accounts found for “{q}”. Try a broader prompt.</div>
          )}
        </section>
      </main>
    </div>
  );
}
