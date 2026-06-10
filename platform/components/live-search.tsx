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
  engagement?: number;
  creator_id?: string;
  from?: 'db' | 'live';
}

interface Program {
  id: string;
  name: string;
}

interface RunResponse {
  prompt: string;
  tokens: string[];
  seeds: string[];
  results: LiveProfile[];
  persisted: number;
  resolved_from_names?: Array<{ name: string; handle: string; followers: number }>;
  auto_seeds?: Array<{ handle: string; followers: number }>;
  from_db?: number;
  from_live?: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Split the start-from field into exact handles vs names to resolve.
// Comma-separated; an entry with an internal space is treated as a name
// (e.g. "mridul sharma"), otherwise as an @handle.
function parseSeedInput(raw: string): { seeds: string[]; names: string[] } {
  const seeds: string[] = [];
  const names: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim().replace(/^@/, '');
    if (!entry) continue;
    if (/\s/.test(entry)) names.push(entry);
    else if (/^[a-z0-9._]+$/i.test(entry)) seeds.push(entry.toLowerCase());
    else names.push(entry);
  }
  return { seeds, names };
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
  // result filters / sort
  const [minFollowers, setMinFollowers] = useState(0);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'relevance' | 'followers' | 'engagement'>('relevance');
  // shortlist / recruit
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState('');
  const [recruited, setRecruited] = useState<Record<string, string>>({});
  const [recruiting, setRecruiting] = useState<string | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    fetch('/api/programs')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.programs)) {
          setPrograms(d.programs);
          setProgramId((cur) => cur || d.programs[0]?.id || '');
        }
      })
      .catch(() => {});
  }, []);

  async function addToShortlist(p: LiveProfile) {
    if (!p.creator_id || recruiting) return;
    let pid = programId;
    if (pid === '__new__' || !pid) {
      const name = window.prompt('New campaign name');
      if (!name?.trim()) return;
      try {
        const d = await fetch('/api/programs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), source_prompt: run?.prompt }),
        }).then((r) => r.json());
        if (!d.program?.id) return;
        setPrograms((ps) => [d.program, ...ps]);
        pid = d.program.id;
        setProgramId(pid);
      } catch {
        return;
      }
    }
    setRecruiting(p.creator_id);
    try {
      await fetch(`/api/programs/${pid}/recruits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: p.creator_id, source_prompt: run?.prompt, relevance_score: p.score }),
      });
      setRecruited((m) => ({ ...m, [p.creator_id!]: pid }));
    } finally {
      setRecruiting(null);
    }
  }

  const suggestions = buildSuggestions(prompt);
  const sugOpen = showSug && suggestions.length > 0;

  const shown = (() => {
    if (!run) return [] as LiveProfile[];
    const filtered = run.results.filter(
      (p) => p.followers >= minFollowers && (!verifiedOnly || p.is_verified),
    );
    const sorted = [...filtered];
    if (sortBy === 'followers') sorted.sort((a, b) => b.followers - a.followers);
    else if (sortBy === 'engagement') sorted.sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0));
    // 'relevance' keeps the server order (score, then followers)
    return sorted;
  })();

  function pickSuggestion(s: string) {
    setPrompt(s);
    setShowSug(false);
    setActiveIdx(-1);
  }

  // Arriving from the home page with a prompt → run once (seed optional; the
  // server self-seeds from the prompt when no handle/name is given).
  useEffect(() => {
    if (autoRan.current) return;
    if (initialPrompt.trim().length >= 2) {
      autoRan.current = true;
      void search();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search() {
    const p = prompt.trim();
    if (p.length < 2) return;
    const { seeds, names } = parseSeedInput(seedText);

    setLoading(true);
    setError(null);
    setNeedSeed(false);
    try {
      const r = await fetch('/api/discover-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p, seeds, names }),
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
            placeholder="Optional — leave blank to auto-find, or start from a name / @handle"
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

      {/* no-seed nudge (only when auto-seeding also found nothing) */}
      {needSeed && (
        <div className="mt-3 px-4 py-3 rounded-lg border border-[#e3def9] bg-[#faf9ff] text-[14px] text-[#444]">
          Couldn’t auto-find a starting point for that prompt.{' '}
          <span className="font-medium text-[#222]">Do you know anyone in this space?</span> Add a
          name (e.g. <span className="font-mono">mridul sharma</span>) or an @handle above and we’ll
          start from there.
        </div>
      )}

      {/* starting points: typed-name matches and/or auto-found seeds */}
      {run && !loading && (() => {
        const fromNames = (run.resolved_from_names ?? []).map((m) => ({
          handle: m.handle,
          followers: m.followers,
        }));
        const starts = [...fromNames, ...(run.auto_seeds ?? [])];
        if (starts.length === 0) return null;
        const label = fromNames.length > 0 ? 'Matched to' : 'Auto-found starting points';
        return (
          <div className="mt-3 px-4 py-2.5 rounded-lg border border-[#e3def9] bg-[#faf9ff] text-[13px] text-[#555]">
            {label}:{' '}
            {starts.map((m, i) => (
              <span key={m.handle}>
                {i > 0 && ', '}
                <a
                  href={`https://instagram.com/${m.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                  style={{ color: ACCENT }}
                >
                  @{m.handle}
                </a>{' '}
                <span className="text-[#999]">({fmt(m.followers)})</span>
              </span>
            ))}
          </div>
        );
      })()}

      {error && (
        <div className="mt-3 px-4 py-3 rounded-lg border border-rose-300 bg-rose-50 text-[14px] text-rose-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-10 flex flex-col items-center justify-center">
          <div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
          <div className="mt-3 text-[13px] text-[#888]">Finding starting points & crawling Instagram…</div>
        </div>
      )}

      {/* results table */}
      {run && !loading && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[14px] text-[#555]">
              <span className="font-semibold text-[#111]">{shown.length}</span>
              {shown.length !== run.results.length && <span className="text-[#999]">/{run.results.length}</span>} profiles for{' '}
              <span className="font-medium text-[#111]">“{run.prompt}”</span>
              {(run.from_live ?? 0) > 0 && (
                <span className="ml-2 text-[#999]">· {run.from_live} live</span>
              )}
              {(run.from_db ?? 0) > 0 && (
                <span className="ml-2 text-[#999]">· {run.from_db} from DB</span>
              )}
              {run.persisted > 0 && (
                <span className="ml-2 text-[#999]">· {run.persisted} saved</span>
              )}
            </div>
            <button
              onClick={() => void downloadExcel()}
              disabled={exporting || shown.length === 0}
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-[#e3def9] hover:bg-[#faf9ff] disabled:opacity-50"
              style={{ color: ACCENT }}
            >
              {exporting ? 'Preparing…' : '⬇ Download Excel'}
            </button>
          </div>

          {/* filters + sort */}
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <select
              value={minFollowers}
              onChange={(e) => setMinFollowers(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white focus:outline-none focus:border-[#6C4DF6]"
            >
              <option value={0}>Any followers</option>
              <option value={1000}>1K+</option>
              <option value={10000}>10K+</option>
              <option value={100000}>100K+</option>
              <option value={1000000}>1M+</option>
            </select>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white cursor-pointer select-none">
              <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="accent-[#6C4DF6]" />
              Verified only
            </label>
            <span className="ml-auto text-[#999]">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white focus:outline-none focus:border-[#6C4DF6]"
            >
              <option value="relevance">Relevance</option>
              <option value="followers">Followers</option>
              <option value="engagement">Engagement</option>
            </select>
            <span className="text-[#999]">·</span>
            <span className="text-[#999]">Add to</span>
            <select
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white focus:outline-none focus:border-[#6C4DF6] max-w-[160px]"
            >
              {programs.length === 0 && <option value="">No campaigns yet</option>}
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="__new__">＋ New campaign…</option>
            </select>
          </div>

          {shown.length === 0 ? (
            <div className="px-4 py-10 text-center text-[14px] text-[#888] border border-[#eee] rounded-xl">
              {run.results.length === 0
                ? 'No profiles found from that seed. Try a different starting @handle.'
                : 'No profiles match these filters. Loosen them to see more.'}
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
                    <th className="px-3 py-2.5 font-medium text-right">Eng.</th>
                    <th className="px-3 py-2.5 font-medium text-center">Relevance</th>
                    <th className="px-3 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3f3f3]">
                  {shown.map((p, i) => (
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
                              {p.from === 'db' && (
                                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#eef] text-[#6C4DF6]" title="from your database">
                                  DB
                                </span>
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
                      <td className="px-3 py-3 text-[13px] text-right tabular-nums" style={{ color: (p.engagement ?? 0) > 0 ? '#10b981' : '#bbb' }}>
                        {(p.engagement ?? 0) > 0 ? `${p.engagement}%` : '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className="inline-block text-[12px] font-semibold px-2 py-0.5 rounded-md tabular-nums"
                          style={{ background: ACCENT_SOFT, color: ACCENT }}
                        >
                          {p.score}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {p.creator_id && (recruited[p.creator_id] ? (
                          <span className="text-[12px] font-medium text-emerald-600 mr-3">Added ✓</span>
                        ) : (
                          <button
                            onClick={() => void addToShortlist(p)}
                            disabled={recruiting === p.creator_id}
                            className="text-[12px] font-semibold mr-3 px-2 py-1 rounded-md border border-[#e3def9] hover:bg-[#faf9ff] disabled:opacity-50"
                            style={{ color: ACCENT }}
                            title="Add to campaign"
                          >
                            {recruiting === p.creator_id ? '…' : '+ Add'}
                          </button>
                        ))}
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
