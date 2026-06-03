'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CreatorCard } from './creator-card';
import type { Brief, ShortlistCreatorView, ShortlistEvent } from '@influencer-intel/shared/types';

interface BriefResponse {
  brief: Brief;
  creators: ShortlistCreatorView[];
  pending_count?: number;
}

type Phase = 'loading' | 'preliminary' | 'streaming' | 'final';

export function ShortlistView({ briefId }: { briefId: string }) {
  const [data, setData] = useState<BriefResponse | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/briefs/${briefId}`);
        if (!res.ok) return;
        const body = (await res.json()) as BriefResponse;
        if (cancelled) return;
        setData(body);
        const pending = body.pending_count ?? 0;
        setPendingCount(pending);
        if (body.creators.length > 0) {
          setDone(body.creators.length);
          setTotal(body.creators.length + pending);
          if (pending === 0) {
            setPhase('final');
          } else {
            setPhase((p) => (p === 'loading' ? 'streaming' : p));
          }
        }
      } catch {}
    };
    poll();
    // Poll every 4s while we're not in 'final' state — covers the case
    // where SSE drops or platform restarts mid-session.
    const interval = setInterval(() => {
      if (phase !== 'final') poll();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [briefId, phase]);

  useEffect(() => {
    if (!data) return;
    const es = new EventSource(`/api/briefs/${briefId}/stream`);
    es.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as ShortlistEvent;
        if (evt.type === 'preliminary') {
          setData((prev) => (prev ? { ...prev, creators: evt.creators } : prev));
          setPendingCount(evt.pending_count);
          setTotal(evt.creators.length + evt.pending_count);
          setDone(evt.creators.length);
          setPhase('streaming');
        } else if (evt.type === 'creator_added') {
          setData((prev) => {
            if (!prev) return prev;
            const next = [...prev.creators];
            next.splice(evt.rank - 1, 0, evt.creator);
            return { ...prev, creators: next.slice(0, 28) };
          });
          setDone((d) => d + 1);
        } else if (evt.type === 'reranked') {
          setData((prev) => {
            if (!prev) return prev;
            const map = new Map(prev.creators.map((c) => [c.brief_creator_id, c]));
            const next = evt.ordered_brief_creator_ids
              .map((id) => map.get(id))
              .filter((c): c is ShortlistCreatorView => !!c);
            return { ...prev, creators: next };
          });
        } else if (evt.type === 'progress') {
          setDone(evt.done);
          setTotal(evt.total);
        } else if (evt.type === 'complete') {
          setPhase('final');
          setPendingCount(0);
        }
      } catch {}
    };
    return () => es.close();
  }, [briefId, data]);

  if (!data) return <Loading />;

  const spec = data.brief.parsed_spec;
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <main className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 bg-canvas/95 backdrop-blur border-b border-border-soft">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="text-sm text-ink-600 hover:text-ink-900 transition-colors flex items-center gap-1.5">
            <span className="text-base">←</span> New brief
          </Link>
          <div className="flex items-center gap-2">
            <ProgressPill phase={phase} done={done} total={total} pct={progressPct} />
            {data.creators.length > 0 && (
              <>
                <Link
                  href={`/shortlist/${briefId}/compare`}
                  className="px-3 py-1.5 rounded-[8px] text-sm bg-canvas border border-border text-ink-600 hover:text-ink-900 transition-colors"
                >
                  Compare
                </Link>
                <Link
                  href={`/shortlist/${briefId}/outreach`}
                  className="px-3 py-1.5 rounded-[8px] text-sm bg-canvas border border-border text-ink-600 hover:text-ink-900 transition-colors"
                >
                  Outreach
                </Link>
                <a
                  href={`/api/briefs/${briefId}/export`}
                  className="px-3 py-1.5 rounded-[8px] text-sm bg-ink-900 text-white hover:bg-ink-800 transition-colors"
                >
                  Export ⬇
                </a>
              </>
            )}
          </div>
        </div>
        {phase !== 'final' && total > 0 && (
          <div className="h-[2px] bg-border-soft">
            <div
              className="h-full bg-ink-900 transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-8 pb-4">
        <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">Brief</div>
        <p className="text-lg text-ink-900 leading-relaxed">{data.brief.raw_text}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {spec?.campaign_type && <Pill label="campaign">{readable(spec.campaign_type)}</Pill>}
          {spec?.category && <Pill label="category">{spec.category}</Pill>}
          {spec?.target_gender && <Pill label="audience">{spec.target_gender}</Pill>}
          {(spec?.target_age_min || spec?.target_age_max) && (
            <Pill label="age">{spec?.target_age_min}–{spec?.target_age_max}</Pill>
          )}
          {(spec?.target_cities ?? []).map((c) => (
            <Pill key={c} label="city">{c}</Pill>
          ))}
          {(spec?.target_languages ?? []).map((l) => (
            <Pill key={l} label="lang">{l}</Pill>
          ))}
          {spec?.budget_amount && <Pill label="budget">₹{spec.budget_amount.toLocaleString()}</Pill>}
          {spec?.vibe && <Pill label="vibe">{spec.vibe}</Pill>}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16">
        {data.creators.length === 0 ? (
          <EmptyState pending={pendingCount} />
        ) : (
          <ShortlistResults creators={data.creators} pendingCount={pendingCount} phase={phase} />
        )}
      </section>
    </main>
  );
}

function ShortlistResults({
  creators,
  pendingCount,
  phase,
}: {
  creators: ShortlistCreatorView[];
  pendingCount: number;
  phase: Phase;
}) {
  type Tier = '' | 'mega' | 'macro' | 'micro' | 'nano';
  const [tier, setTier] = useState<Tier>('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [city, setCity] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');

  const cityOptions = Array.from(
    new Set(creators.map((c) => c.creator.primary_city).filter((v): v is string => !!v)),
  ).sort();
  const categoryOptions = Array.from(
    new Set(creators.map((c) => c.creator.primary_category).filter((v): v is string => !!v)),
  ).sort();

  const filtered = creators.filter((c) => {
    const fc = Number(c.creator.follower_count ?? 0);
    if (tier === 'mega' && fc < 1_000_000) return false;
    if (tier === 'macro' && (fc < 100_000 || fc >= 1_000_000)) return false;
    if (tier === 'micro' && (fc < 10_000 || fc >= 100_000)) return false;
    if (tier === 'nano' && (fc < 5_000 || fc >= 10_000)) return false;
    if (verifiedOnly && !c.creator.is_verified) return false;
    if (city && c.creator.primary_city !== city) return false;
    if (category && c.creator.primary_category !== category) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${c.creator.handle} ${c.creator.display_name ?? ''} ${c.creator.bio ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const anyFilter = tier || verifiedOnly || city || category || search.trim();

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-medium text-ink-900">
          Shortlist{' '}
          <span className="text-ink-400 font-normal">
            · {filtered.length}
            {anyFilter ? ` of ${creators.length}` : ''}
          </span>
        </h2>
        {phase !== 'final' && pendingCount > 0 && (
          <span className="text-sm text-ink-600">Researching {pendingCount} more…</span>
        )}
      </div>

      <div className="rounded-[12px] border border-border bg-surface p-3 mb-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by handle, name, bio…"
            className="flex-1 min-w-[220px] px-3 py-1.5 rounded-[8px] bg-canvas border border-border text-sm focus:outline-none focus:border-ink-400"
          />
          <button
            onClick={() => setVerifiedOnly((v) => !v)}
            className={`px-3 py-1.5 rounded-[8px] text-sm transition-colors ${
              verifiedOnly ? 'bg-ink-900 text-white' : 'bg-canvas border border-border text-ink-600 hover:text-ink-900'
            }`}
          >
            ✓ Verified
          </button>
          {anyFilter && (
            <button
              onClick={() => {
                setTier('');
                setVerifiedOnly(false);
                setCity('');
                setCategory('');
                setSearch('');
              }}
              className="px-3 py-1.5 rounded-[8px] text-sm text-ink-400 hover:text-ink-900"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['', 'mega', 'macro', 'micro', 'nano'] as Tier[]).map((t) => (
            <button
              key={t}
              onClick={() => setTier(t)}
              className={`px-2.5 py-1 rounded-full text-[12px] transition-colors ${
                tier === t ? 'bg-ink-900 text-white' : 'bg-canvas border border-border text-ink-600 hover:text-ink-900'
              }`}
            >
              {t === '' ? 'All sizes' : t === 'mega' ? 'Mega 1M+' : t === 'macro' ? 'Macro 100K-1M' : t === 'micro' ? 'Micro 10K-100K' : 'Nano 5K-10K'}
            </button>
          ))}
          {cityOptions.length > 0 && (
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="px-2 py-1 rounded-full text-[12px] bg-canvas border border-border text-ink-600"
            >
              <option value="">Any city</option>
              {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {categoryOptions.length > 0 && (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-2 py-1 rounded-full text-[12px] bg-canvas border border-border text-ink-600"
            >
              <option value="">Any category</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-surface p-8 text-center text-ink-600">
          No creators match the current filters. Clear them to see all {creators.length}.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((creator) => (
            <CreatorCard key={creator.brief_creator_id} creator={creator} />
          ))}
        </div>
      )}
    </>
  );
}

function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="flex items-center gap-3 text-ink-600">
        <span className="w-2 h-2 rounded-full bg-ink-400 animate-pulse" />
        Loading…
      </div>
    </main>
  );
}

function ProgressPill({ phase, done, total, pct }: { phase: Phase; done: number; total: number; pct: number }) {
  if (phase === 'final') {
    return (
      <span className="text-sm text-ink-900 font-medium tabular-nums flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-success" />
        Final shortlist · {done} creators
      </span>
    );
  }
  if (total === 0) {
    return (
      <span className="text-sm text-ink-600 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />
        Researching…
      </span>
    );
  }
  return (
    <span className="text-sm text-ink-600 flex items-center gap-2 tabular-nums">
      <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />
      {done} of {total} researched · {pct}%
    </span>
  );
}

function Pill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-full bg-canvas border border-border text-sm">
      <span className="text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      <span className="text-ink-900">{children}</span>
    </span>
  );
}

function EmptyState({ pending }: { pending: number }) {
  const phases = [
    'Discovering candidates from hashtag pages',
    'Generating creator handles via GPT-4o',
    'Sampling profiles & engagement',
    'Computing credibility scores',
    'Ranking against your brief',
  ];
  return (
    <div className="rounded-[14px] border border-border bg-surface px-8 py-14 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-canvas border border-border text-sm text-ink-600 mb-5">
        <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />
        {pending > 0 ? `Researching ${pending} creators` : 'Researching candidates'}
      </div>
      <h3 className="text-2xl font-semibold text-ink-900 mb-2">First-paint takes a few minutes.</h3>
      <p className="text-ink-600 max-w-md mx-auto leading-relaxed">
        On a cold-start brief like this one we&rsquo;re researching every candidate from scratch. Subsequent briefs in the same category hit cache in seconds.
      </p>
      <ul className="mt-8 space-y-2 max-w-sm mx-auto text-left">
        {phases.map((p, i) => (
          <li key={p} className="flex items-center gap-2.5 text-sm text-ink-600">
            <span
              className="w-1.5 h-1.5 rounded-full bg-ink-400"
              style={{ animationDelay: `${i * 200}ms` }}
            />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function readable(v: string) {
  return v.replace(/_/g, ' ');
}
