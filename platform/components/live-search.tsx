'use client';

import { useEffect, useRef, useState } from 'react';
import { buildSuggestions } from '@/lib/suggestions';

const ACCENT = '#6C4DF6';
const ACCENT_SOFT = '#F4F2FF';

interface LiveProfile {
  username: string;
  full_name: string;
  biography: string;
  category: string;
  followers: number;
  is_private: boolean;
  is_verified: boolean;
  profile_pic_url: string | null;
  score: number;
}

interface RunResponse {
  prompt: string;
  tokens: string[];
  seeds: string[];
  results: LiveProfile[];
  persisted: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function parseSeeds(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^@/, '').toLowerCase())
    .filter((s) => /^[a-z0-9._]+$/.test(s));
}

export function LiveSearch({
  initialPrompt = '',
  initialSeed = '',
}: {
  initialPrompt?: string;
  initialSeed?: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [seedText, setSeedText] = useState(initialSeed);
  const [needSeed, setNeedSeed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const autoRan = useRef(false);

  const suggestions = buildSuggestions(prompt);
  const sugOpen = showSug && suggestions.length > 0;

  function pickSuggestion(s: string) {
    setPrompt(s);
    setShowSug(false);
    setActiveIdx(-1);
  }

  // Arriving from the home page with both a prompt and a seed → run once.
  useEffect(() => {
    if (autoRan.current) return;
    if (initialPrompt.trim().length >= 2 && parseSeeds(initialSeed).length > 0) {
      autoRan.current = true;
      void search();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search() {
    const p = prompt.trim();
    if (p.length < 2) return;
    const seeds = parseSeeds(seedText);
    if (seeds.length === 0) {
      // No seed yet — Instagram can't keyword-search without a starting point.
      setNeedSeed(true);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setNeedSeed(false);
    try {
      const r = await fetch('/api/discover-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p, seeds }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.error === 'no_seeds') setNeedSeed(true);
        else setError(d.message ?? d.error ?? 'Search failed');
        setRun(null);
      } else {
        setRun(d as RunResponse);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function downloadExcel() {
    if (!run) return;
    setExporting(true);
    try {
      const r = await fetch('/api/discover-live/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: run.prompt, results: run.results }),
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${run.prompt.replace(/[^a-z0-9]+/gi, '_').slice(0, 40) || 'search'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="w-full">
      {/* search box */}
      <div className="rounded-2xl bg-white border-2 border-[#e3def9] p-4 shadow-[0_12px_50px_rgba(108,77,246,0.12)] focus-within:border-[#6C4DF6] transition-colors">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setShowSug(true);
              setActiveIdx(-1);
            }}
            onFocus={() => setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 120)}
            onKeyDown={(e) => {
              if (sugOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setActiveIdx((i) => {
                  const n = suggestions.length;
                  return e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
                });
                return;
              }
              if (e.key === 'Escape') {
                setShowSug(false);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (sugOpen && activeIdx >= 0) pickSuggestion(suggestions[activeIdx]!);
                else void search();
              }
            }}
            rows={2}
            placeholder="Describe who you're looking for — e.g. nagpur fashion creators"
            className="w-full resize-none text-[16px] text-[#222] placeholder-[#9aa] focus:outline-none bg-transparent"
          />
          {sugOpen && (
            <div className="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl bg-white border border-[#ececec] shadow-[0_16px_50px_rgba(0,0,0,0.12)] overflow-hidden">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => pickSuggestion(s)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[15px] transition-colors ${
                    i === activeIdx ? 'bg-[#f6f4ff]' : 'hover:bg-[#faf9ff]'
                  }`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                  <span className="text-[#333]">{s}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void search())}
            placeholder="Know anyone? add a starting @handle (e.g. the_brand_fashion_nagpur)"
            className="flex-1 px-3 py-2 rounded-lg border border-[#e3def9] text-[14px] focus:outline-none focus:border-[#6C4DF6]"
          />
          <button
            onClick={() => void search()}
            disabled={loading || prompt.trim().length < 2}
            className="px-5 py-2.5 rounded-lg text-white text-[14px] font-medium disabled:opacity-50 shrink-0"
            style={{ background: ACCENT }}
          >
            {loading ? 'Searching…' : 'Search Instagram'}
          </button>
        </div>
      </div>

      {/* no-seed nudge */}
      {needSeed && (
        <div className="mt-3 px-4 py-3 rounded-lg border border-[#e3def9] bg-[#faf9ff] text-[14px] text-[#444]">
          Instagram can’t keyword-search without a starting point.{' '}
          <span className="font-medium text-[#222]">Do you know anyone in this space?</span> Add their
          @handle above and we’ll find similar creators from there.
        </div>
      )}

      {error && (
        <div className="mt-3 px-4 py-3 rounded-lg border border-rose-300 bg-rose-50 text-[14px] text-rose-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-10 flex flex-col items-center justify-center">
          <div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
          <div className="mt-3 text-[13px] text-[#888]">Crawling Instagram from your seed…</div>
        </div>
      )}

      {/* results table */}
      {run && !loading && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[14px] text-[#555]">
              <span className="font-semibold text-[#111]">{run.results.length}</span> profiles for{' '}
              <span className="font-medium text-[#111]">“{run.prompt}”</span>
              {run.tokens.length > 0 && (
                <span className="ml-2 text-[#999]">· matching {run.tokens.join(', ')}</span>
              )}
              {run.persisted > 0 && (
                <span className="ml-2 text-[#999]">· {run.persisted} saved to database</span>
              )}
            </div>
            <button
              onClick={() => void downloadExcel()}
              disabled={exporting || run.results.length === 0}
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-[#e3def9] hover:bg-[#faf9ff] disabled:opacity-50"
              style={{ color: ACCENT }}
            >
              {exporting ? 'Preparing…' : '⬇ Download Excel'}
            </button>
          </div>

          {run.results.length === 0 ? (
            <div className="px-4 py-10 text-center text-[14px] text-[#888] border border-[#eee] rounded-xl">
              No profiles found from that seed. Try a different starting @handle.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#eee]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#faf9ff] text-[12px] uppercase tracking-wider text-[#888]">
                    <th className="px-3 py-2.5 font-medium w-10">#</th>
                    <th className="px-3 py-2.5 font-medium">Creator</th>
                    <th className="px-3 py-2.5 font-medium">Category</th>
                    <th className="px-3 py-2.5 font-medium text-right">Followers</th>
                    <th className="px-3 py-2.5 font-medium text-center">Relevance</th>
                    <th className="px-3 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3f3f3]">
                  {run.results.map((p, i) => (
                    <tr key={p.username} className="hover:bg-[#fafaff]">
                      <td className="px-3 py-3 text-[13px] text-[#aaa] tabular-nums">{i + 1}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar name={p.full_name || p.username} url={p.profile_pic_url} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[14px] font-medium text-[#111] truncate">
                                @{p.username}
                              </span>
                              {p.is_verified && (
                                <span title="verified" style={{ color: ACCENT }}>✔</span>
                              )}
                            </div>
                            <div className="text-[12px] text-[#999] truncate max-w-[260px]">
                              {p.full_name || '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-[#666]">{p.category || '—'}</td>
                      <td className="px-3 py-3 text-[14px] text-[#111] text-right tabular-nums">
                        {fmt(p.followers)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className="inline-block text-[12px] font-semibold px-2 py-0.5 rounded-md tabular-nums"
                          style={{ background: ACCENT_SOFT, color: ACCENT }}
                        >
                          {p.score}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <a
                          href={`https://instagram.com/${p.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[13px] font-medium hover:underline"
                          style={{ color: ACCENT }}
                        >
                          View →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const [err, setErr] = useState(false);
  if (url && !err) {
    // IG CDN blocks hotlinking — route through our server-side proxy.
    const src = `/api/ig-image?u=${encodeURIComponent(url)}`;
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        onError={() => setErr(true)}
        className="w-9 h-9 rounded-full object-cover shrink-0 bg-[#eee]"
      />
    );
  }
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return (
    <div
      className="w-9 h-9 rounded-full grid place-items-center text-white text-[12px] font-semibold shrink-0"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))` }}
    >
      {initials}
    </div>
  );
}
