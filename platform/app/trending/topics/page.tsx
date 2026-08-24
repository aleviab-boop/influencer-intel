'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { InlineError } from '@/components/skeleton';
import { cleanTrendCategories } from '@/lib/trend-quality';

// A single trending topic, derived from the SUBJECT of the captions our crawl
// sees across the creators we track (trend_signals where trend_type='topic').
interface Topic {
  display_name: string;
  phase: 'emerging' | 'growing' | 'peak' | 'saturated' | 'declining';
  velocity: number | string;
  usage_count_7d: number | string;
  usage_count_24h: number | string;
  categories: string[];
}

// Lifecycle phase → dot colour + human label. Same palette as /trending.
const PHASE_META: Record<Topic['phase'], { c: string; label: string }> = {
  emerging: { c: '#3b82f6', label: 'Emerging' },
  growing: { c: '#10b981', label: 'Growing' },
  peak: { c: '#6C4DF6', label: 'Peak' },
  saturated: { c: '#f59e0b', label: 'Saturated' },
  declining: { c: '#94a3b8', label: 'Cooling' },
};

// Top-level filter tabs, each mapping to a set of phases.
const FILTERS: { key: string; label: string; phases: Topic['phase'][] | null }[] = [
  { key: 'all', label: 'All', phases: null },
  { key: 'rising', label: '🚀 Rising', phases: ['emerging', 'growing'] },
  { key: 'peak', label: '🔥 Peaking', phases: ['peak'] },
  { key: 'cooling', label: '❄️ Cooling', phases: ['saturated', 'declining'] },
];

const num = (v: number | string): number => Number(v) || 0;

// A small momentum indicator from the velocity sign.
function Momentum({ velocity }: { velocity: number }) {
  if (velocity > 0.1) {
    const pct = Math.round(velocity * 100);
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600 tabular-nums">
        ▲ {pct > 999 ? '999+' : pct}%
      </span>
    );
  }
  if (velocity < -0.1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#94a3b8] tabular-nums">
        ▼ {Math.abs(Math.round(velocity * 100))}%
      </span>
    );
  }
  return <span className="text-[11px] text-[#c4c4c4]">—</span>;
}

export default function TrendingTopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(false);
    try {
      const r = await fetch('/api/trends?type=topic&limit=80', { cache: 'no-store' });
      if (!r.ok) throw new Error('bad status');
      const d = await r.json();
      const raw: Topic[] = Array.isArray(d.trends) ? d.trends : [];
      // Sanitise categories up front so chips, filters and row labels all read
      // clean niches — never leftover hashtags/handles from creator niche fields.
      setTopics(raw.map((t) => ({ ...t, categories: cleanTrendCategories(t.categories) })));
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Category chips — the niches these topics span, ranked by how many topics
  // carry each, capped so the filter row stays tidy.
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of topics) {
      for (const c of t.categories ?? []) {
        if (!c) continue;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([c]) => c);
  }, [topics]);

  const visible = useMemo(() => {
    const phases = FILTERS.find((f) => f.key === filter)?.phases ?? null;
    return topics.filter((t) => {
      if (phases && !phases.includes(t.phase)) return false;
      if (category && !(t.categories ?? []).includes(category)) return false;
      return true;
    });
  }, [topics, filter, category]);

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#111]">
      <MarketingNav />
      <main className="flex-1">
        {/* Hero */}
        <section
          className="py-10 md:py-12"
          style={{
            background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(236,72,153,.14), transparent 60%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)`,
          }}
        >
          <div className="max-w-5xl mx-auto px-6">
            <div className="flex items-center gap-2">
              <Link href="/trending" className="text-[13px] text-[#888] hover:text-[#111]">Trending</Link>
              <span className="text-[13px] text-[#ccc]">/</span>
              <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>Topics</span>
            </div>
            <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">What&apos;s viral right now</h1>
            <p className="mt-2 text-[15px] text-[#555] max-w-2xl">
              The topics creators are actually posting about this week — pulled from the captions across the
              Instagram accounts we track, ranked by momentum. Not hashtags, not guesses: the real subjects going viral.
            </p>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-8">
          {/* Filter tabs */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="px-3.5 py-1.5 rounded-full text-[13px] font-medium border transition-colors"
                style={
                  filter === f.key
                    ? { background: ACCENT, color: '#fff', borderColor: ACCENT }
                    : { background: '#fff', color: '#555', borderColor: '#e7e7ee' }
                }
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Category chips */}
          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-6">
              <button
                onClick={() => setCategory(null)}
                className="px-2.5 py-1 rounded-full text-[12px] border transition-colors"
                style={
                  category === null
                    ? { background: ACCENT_SOFT, color: ACCENT, borderColor: '#e3def9' }
                    : { background: '#fff', color: '#999', borderColor: '#eee' }
                }
              >
                All niches
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(category === c ? null : c)}
                  className="px-2.5 py-1 rounded-full text-[12px] border capitalize transition-colors"
                  style={
                    category === c
                      ? { background: ACCENT_SOFT, color: ACCENT, borderColor: '#e3def9' }
                      : { background: '#fff', color: '#999', borderColor: '#eee' }
                  }
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Board */}
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-14 rounded-xl bg-[#f5f4fb] animate-pulse" />
              ))}
            </div>
          ) : err ? (
            <InlineError message="We couldn’t load trending topics right now." onRetry={() => void load()} />
          ) : topics.length === 0 ? (
            <div className="text-[14px] text-[#888] border border-dashed border-[#e3def9] rounded-2xl p-8 bg-[#faf9ff] text-center">
              <div className="text-2xl mb-2">🌱</div>
              We&apos;re still reading captions across the creators we track — trending topics fill in here as our
              crawl runs. Check back shortly.
            </div>
          ) : visible.length === 0 ? (
            <div className="text-[14px] text-[#888] border border-[#eee] rounded-2xl p-8 text-center">
              No topics match this filter right now.
            </div>
          ) : (
            <div className="rounded-2xl border border-[#eee] overflow-hidden">
              {visible.map((t, i) => {
                const vel = num(t.velocity);
                const wk = num(t.usage_count_7d);
                const day = num(t.usage_count_24h);
                return (
                  <div
                    key={`${t.display_name}-${i}`}
                    className="flex items-center gap-3 px-4 py-3 border-b border-[#f3f3f3] last:border-0 hover:bg-[#faf9ff] transition-colors"
                  >
                    <span className="w-6 text-[15px] font-bold tabular-nums shrink-0" style={{ color: ACCENT }}>
                      {i + 1}
                    </span>
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: PHASE_META[t.phase].c }}
                      title={PHASE_META[t.phase].label}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-[#111] capitalize truncate">{t.display_name}</div>
                      {(t.categories ?? []).length > 0 && (
                        <div className="text-[11px] text-[#aaa] capitalize truncate">
                          {(t.categories ?? []).slice(0, 3).join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <Momentum velocity={vel} />
                      <div className="text-[11px] text-[#bbb] tabular-nums">
                        {wk > 0 ? `${wk}× / wk` : PHASE_META[t.phase].label}
                        {day > 0 && <span className="text-[#d4d4d4]"> · {day} today</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Phase legend */}
          {!loading && !err && topics.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[#999]">
              {(Object.keys(PHASE_META) as Topic['phase'][]).map((p) => (
                <span key={p} className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: PHASE_META[p].c }} />
                  {PHASE_META[p].label}
                </span>
              ))}
            </div>
          )}

          <p className="mt-6 text-[11px] text-[#aaa]">
            First-party signal · topics extracted from the captions of creators we track · refreshes daily.
          </p>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
