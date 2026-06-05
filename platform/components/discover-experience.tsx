'use client';

import { useEffect, useState } from 'react';

interface DiscoveredInfluencer {
  creator_id: string;
  name: string | null;
  genre: string | null;
  region: string | null;
  niche: string | null;
  platform: string;
  source: string;
  source_url: string;
  relevance_score: number;
  confidence_score: number;
  quality_score: number;
  quality_band: string;
  tags: string[];
  rank: number;
}

interface Dropped {
  below_threshold: number;
  insufficient_data: number;
}

interface ProgramSummary {
  id: string;
  name: string;
  recruit_count: number;
  recruited_count: number;
}

// Self-contained discover + recruit experience. Embeds anywhere (e.g. inline on
// the home page) — no header. Pass `initialPrompt` to auto-run a search on mount.
export function DiscoverExperience({ initialPrompt = '' }: { initialPrompt?: string }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DiscoveredInfluencer[]>([]);
  const [below, setBelow] = useState<DiscoveredInfluencer[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [minQuality, setMinQuality] = useState(80);
  const [dropped, setDropped] = useState<Dropped | null>(null);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [recruitFor, setRecruitFor] = useState<DiscoveredInfluencer | null>(null);
  const [recruited, setRecruited] = useState<Record<string, string>>({});

  useEffect(() => {
    void refreshPrograms();
  }, []);

  // Auto-run when an initial prompt is provided (e.g. arriving from a search box).
  useEffect(() => {
    if (initialPrompt && initialPrompt.trim().length >= 3) {
      void run(initialPrompt.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  async function refreshPrograms() {
    try {
      const r = await fetch('/api/programs');
      const d = await r.json();
      if (Array.isArray(d.programs)) setPrograms(d.programs);
    } catch {
      /* ignore */
    }
  }

  async function run(p: string, quality = minQuality) {
    if (p.trim().length < 3) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p.trim(), min_quality: quality }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? 'Discovery failed');
        setResults([]);
        setBelow([]);
        setDropped(null);
      } else {
        setResults(d.results ?? []);
        setBelow(d.below_threshold ?? []);
        setLastPrompt(d.prompt ?? p.trim());
        setDropped(d.dropped ?? null);
        setHasSearched(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="max-w-6xl mx-auto w-full px-6 py-12 flex-1 flex flex-col">
      <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-400">Discover &amp; Recruit</div>
      <h2 className="text-2xl font-semibold text-ink-900 mb-6">Your recruit-ready shortlist</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(prompt);
        }}
        className="mb-8"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. summer Goa lookbook"
            className="flex-1 px-4 py-3 border border-border bg-surface text-base text-ink-900 rounded-lg focus:outline-none focus:border-ink-900 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || prompt.trim().length < 3}
            className="px-5 py-3 bg-ink-900 text-white text-sm font-medium rounded-lg hover:bg-ink-800 disabled:opacity-50"
          >
            {loading ? 'Discovering…' : 'Discover'}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <label className="text-[13px] text-ink-600">
            Min quality score
            <span className="ml-2 font-semibold text-ink-900 tabular-nums">{minQuality}</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minQuality}
            onChange={(e) => setMinQuality(Number(e.target.value))}
            className="w-48 accent-ink-900"
          />
          <span className="text-[12px] text-ink-400">creators below this score are dropped</span>
        </div>
      </form>

      {loading && results.length === 0 && (
        <div className="flex-1 min-h-[42vh] flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-full border-[3px] border-[#FBE3DA] border-t-[#F2542D] animate-spin" />
          <div className="mt-4 text-sm text-ink-400">Discovering influencers…</div>
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-rose-300 bg-rose-50 text-sm text-rose-700">{error}</div>
      )}

      {results.length > 0 && (
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm text-ink-600">
            {results.length} influencers for <span className="text-ink-900 font-medium">“{lastPrompt}”</span>
            {dropped && dropped.below_threshold + dropped.insufficient_data > 0 && (
              <span className="ml-2 text-ink-400">
                · {dropped.below_threshold} below {minQuality}
                {dropped.insufficient_data > 0 && `, ${dropped.insufficient_data} no data`} dropped
              </span>
            )}
          </div>
          <a href="/campaigns" className="text-sm text-ink-600 hover:text-ink-900">View campaigns →</a>
        </div>
      )}

      <div className="space-y-2">
        {results.map((inf) => (
          <ResultRow key={inf.creator_id} inf={inf} recruitedTo={recruited[inf.creator_id]} onRecruit={() => setRecruitFor(inf)} />
        ))}
      </div>

      {below.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[12px] uppercase tracking-wider text-ink-400">
              Below quality {minQuality} · matched but filtered out
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-2 opacity-75">
            {below.map((inf) => (
              <ResultRow key={inf.creator_id} inf={inf} recruitedTo={recruited[inf.creator_id]} onRecruit={() => setRecruitFor(inf)} />
            ))}
          </div>
          <p className="mt-3 text-[12px] text-ink-400">
            These matched “{lastPrompt}” but scored under {minQuality} (often missing engagement data). Lower the
            slider to include them.
          </p>
        </div>
      )}

      {!loading && !error && hasSearched && results.length === 0 && below.length === 0 && (
        <div className="text-sm text-ink-400 py-16 text-center">No influencers matched “{lastPrompt}”. Try a broader prompt.</div>
      )}
      {!loading && !error && !hasSearched && (
        <div className="text-sm text-ink-400 py-16 text-center">Enter a campaign prompt above to discover influencers.</div>
      )}

      {recruitFor && (
        <RecruitModal
          inf={recruitFor}
          programs={programs}
          sourcePrompt={lastPrompt}
          onClose={() => setRecruitFor(null)}
          onRecruited={(programName) => {
            setRecruited((m) => ({ ...m, [recruitFor.creator_id]: programName }));
            setRecruitFor(null);
            void refreshPrograms();
          }}
        />
      )}
    </section>
  );
}

function ResultRow({ inf, recruitedTo, onRecruit }: { inf: DiscoveredInfluencer; recruitedTo: string | undefined; onRecruit: () => void }) {
  return (
    <article className="grid grid-cols-[28px_1fr_auto_auto_auto_auto] items-center gap-4 px-4 py-3.5 rounded-xl bg-surface border border-border hover:border-ink-900/30 transition-all">
      <span className="text-sm text-ink-400 font-mono tabular-nums text-center">{inf.rank}</span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <a href={inf.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink-900 hover:text-ink-600 truncate">
            {inf.name ?? inf.source_url}
          </a>
          <span className="text-[11px] uppercase tracking-wider text-ink-400">{inf.platform}</span>
        </div>
        <div className="mt-1 flex items-center gap-2.5 text-sm text-ink-600 min-w-0 flex-wrap">
          {inf.genre && <span>{inf.genre}</span>}
          {inf.niche && <span className="text-ink-400">· {inf.niche}</span>}
          {inf.region && <span className="text-ink-400">· {inf.region}</span>}
          {inf.tags.slice(0, 4).map((t) => (
            <span key={t} className="px-2 py-0.5 rounded-full bg-canvas border border-border text-[12px] text-ink-700">{t}</span>
          ))}
        </div>
      </div>
      <ScorePill label="Relevance" value={inf.relevance_score} />
      <ScorePill label="Confidence" value={inf.confidence_score} />
      <QualityPill value={inf.quality_score} />
      {recruitedTo ? (
        <span className="px-3 py-1.5 text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg whitespace-nowrap">✓ {recruitedTo}</span>
      ) : (
        <button onClick={onRecruit} className="px-4 py-1.5 text-[13px] font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 whitespace-nowrap">Recruit</button>
      )}
    </article>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-right shrink-0 w-[72px]">
      <div className="text-lg font-semibold tabular-nums text-ink-900 leading-none">{Math.round(value)}</div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-1">{label}</div>
    </div>
  );
}

function QualityPill({ value }: { value: number }) {
  const pass = value >= 80;
  return (
    <div className="text-right shrink-0 w-[64px]">
      <div className={`inline-block px-2 py-0.5 rounded-md text-sm font-semibold tabular-nums border ${pass ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
        {Math.round(value)}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-1">Quality</div>
    </div>
  );
}

function RecruitModal({ inf, programs, sourcePrompt, onClose, onRecruited }: { inf: DiscoveredInfluencer; programs: ProgramSummary[]; sourcePrompt: string; onClose: () => void; onRecruited: (programName: string) => void }) {
  const [mode, setMode] = useState<'existing' | 'new'>(programs.length > 0 ? 'existing' : 'new');
  const [programId, setProgramId] = useState(programs[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      let targetId = programId;
      let targetName = programs.find((p) => p.id === programId)?.name ?? '';
      if (mode === 'new') {
        if (newName.trim().length < 2) {
          setErr('Program name must be at least 2 characters');
          setBusy(false);
          return;
        }
        const cr = await fetch('/api/programs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim(), source_prompt: sourcePrompt }),
        });
        const cd = await cr.json();
        if (!cr.ok) {
          setErr(cd.error ?? 'Could not create program');
          setBusy(false);
          return;
        }
        targetId = cd.program.id;
        targetName = cd.program.name;
      }
      if (!targetId) {
        setErr('Pick or create a program');
        setBusy(false);
        return;
      }
      const rr = await fetch(`/api/programs/${targetId}/recruits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: inf.creator_id, source_prompt: sourcePrompt, relevance_score: inf.relevance_score, confidence_score: inf.confidence_score }),
      });
      const rd = await rr.json();
      if (!rr.ok) {
        setErr(rd.error ?? 'Recruit failed');
        setBusy(false);
        return;
      }
      onRecruited(targetName);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="w-full max-w-md bg-surface rounded-xl border border-border shadow-hover p-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1">Recruit to program</div>
        <div className="text-lg font-semibold text-ink-900 mb-4 truncate">{inf.name ?? inf.source_url}</div>
        {programs.length > 0 && (
          <div className="flex gap-1 mb-4">
            <TabButton active={mode === 'existing'} onClick={() => setMode('existing')}>Existing program</TabButton>
            <TabButton active={mode === 'new'} onClick={() => setMode('new')}>New program</TabButton>
          </div>
        )}
        {mode === 'existing' && programs.length > 0 ? (
          <select value={programId} onChange={(e) => setProgramId(e.target.value)} className="w-full px-3 py-2.5 border border-border bg-canvas text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900">
            {programs.map((p) => (<option key={p.id} value={p.id}>{p.name} ({p.recruit_count})</option>))}
          </select>
        ) : (
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Program name (e.g. Summer Goa 2026)" className="w-full px-3 py-2.5 border border-border bg-canvas text-sm text-ink-900 rounded-lg focus:outline-none focus:border-ink-900" />
        )}
        {err && <div className="mt-3 text-sm text-rose-700">{err}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink-600 hover:text-ink-900">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-5 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50">{busy ? 'Recruiting…' : 'Recruit'}</button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 text-[13px] rounded-lg transition-colors ${active ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900 border border-border'}`}>
      {children}
    </button>
  );
}
