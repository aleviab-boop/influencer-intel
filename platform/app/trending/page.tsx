'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';
import { InlineError } from '@/components/skeleton';

interface NewsItem { title: string; link: string; source: string; date: string; image: string; logo: string }
interface TrendItem { title: string; traffic: string; link: string }
// AI "trend radar" — a specific trend mapped to the marketing category it's
// breaking in (e.g. "polka dot → Fashion"). Served cache-first from /api/trends/radar.
interface RadarItem { item: string; category: string; note?: string; source?: string; url?: string; origin?: 'ai' | 'creators' }
// First-party Instagram trends, derived from our own crawl (trend_signals).
interface IgTrend {
  trend_type: 'format' | 'hashtag' | 'topic' | 'visual';
  display_name: string;
  phase: 'emerging' | 'growing' | 'peak' | 'saturated' | 'declining';
  velocity: number;
  usage_count_7d: number;
  categories: string[];
}

// Display metadata per trend type — label + a small glyph. Order here is the
// order groups render in (formats first: that's the "are Reels winning" signal).
const IG_TYPE_META: { key: IgTrend['trend_type']; label: string; glyph: string }[] = [
  { key: 'format', label: 'Content formats', glyph: '🎬' },
  { key: 'hashtag', label: 'Hashtags', glyph: '#' },
  { key: 'visual', label: 'Visual aesthetics', glyph: '🎨' },
  { key: 'topic', label: 'Topics', glyph: '💬' },
];
// Lifecycle phase → dot colour + human label.
const PHASE_META: Record<IgTrend['phase'], { c: string; label: string }> = {
  emerging: { c: '#3b82f6', label: 'Emerging' },
  growing: { c: '#10b981', label: 'Growing' },
  peak: { c: '#6C4DF6', label: 'Peak' },
  saturated: { c: '#f59e0b', label: 'Saturated' },
  declining: { c: '#94a3b8', label: 'Cooling' },
};

function ago(date: string): string {
  const t = new Date(date).getTime();
  if (!t) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function TrendingPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [igTrends, setIgTrends] = useState<IgTrend[]>([]);
  const [igLoading, setIgLoading] = useState(true);
  const [radar, setRadar] = useState<RadarItem[]>([]);
  const [radarLoading, setRadarLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState(false);

  async function load(force = false) {
    try {
      if (force) await fetch('/api/news/refresh', { method: 'POST' }).catch(() => {});
      const d = await fetch('/api/news', { cache: 'no-store' }).then((r) => r.json());
      setNews(d.news ?? []);
      setTrends(d.trends ?? []);
      setUpdatedAt(d.updatedAt ?? '');
      setErr(false);
    } catch {
      setErr(true);
    }
  }

  // First-party Instagram trends — independent of the news feed. Fetched PER
  // TYPE (formats, hashtags, aesthetics, topics) so every column fills: a single
  // volume-ranked feed is ~all hashtags and starves the other three, so we ask
  // for each type's own top items and merge. Best-effort per type.
  async function loadIgTrends() {
    setIgLoading(true);
    try {
      const types: IgTrend['trend_type'][] = ['format', 'hashtag', 'visual', 'topic'];
      const groups = await Promise.all(
        types.map((ty) =>
          fetch(`/api/trends?type=${ty}&limit=8`, { cache: 'no-store' })
            .then((r) => r.json())
            .then((d) => (Array.isArray(d.trends) ? (d.trends as IgTrend[]) : []))
            .catch(() => [] as IgTrend[]),
        ),
      );
      setIgTrends(groups.flat());
    } catch {
      setIgTrends([]);
    } finally {
      setIgLoading(false);
    }
  }

  // AI trend radar — specific item→category insights. Best-effort: the board
  // just stays empty (or shows a "refreshing" note) if the cache hasn't filled.
  async function loadRadar() {
    setRadarLoading(true);
    try {
      const d = await fetch('/api/trends/radar', { cache: 'no-store' }).then((r) => r.json());
      setRadar(Array.isArray(d.items) ? d.items : []);
    } catch {
      setRadar([]);
    } finally {
      setRadarLoading(false);
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    void loadIgTrends();
    void loadRadar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#111]">
      <MarketingNav />
      <main className="flex-1">
        <section className="relative isolate overflow-hidden py-10 md:py-12" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.15), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.12), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }}>
          <PageDoodles className="-z-10" />
          <div className="max-w-6xl mx-auto px-6">
            <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>What&apos;s trending</span>
            <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Influencer & campaign pulse</h1>
            <p className="mt-2 text-[15px] text-[#555]">Everything trending for creators and campaigns right now — specific trends, viral formats and the patterns behind them, refreshed through the day.</p>
            <div className="mt-3 flex items-center gap-3">
              {updatedAt && (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[#999]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Updated {new Date(updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
              <button
                onClick={refresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e3def9] text-[12px] font-medium hover:bg-[#faf9ff] disabled:opacity-60"
                style={{ color: ACCENT }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? 'animate-spin' : ''}>
                  <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v4h-4" />
                </svg>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
        </section>

        {/* ── Trending now — our specific first-party + AI signals, unified ── */}
        <section className="max-w-6xl mx-auto px-6 pt-10">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[18px]">📈</span>
            <h2 className="text-[20px] font-bold tracking-tight">Trending now</h2>
          </div>
          <p className="text-[13px] text-[#888] mb-7">
            The specific trends, formats and patterns gaining momentum right now — grounded in what&apos;s breaking across India and the creators we track.
          </p>

          {/* Lead: AI trend radar — the most specific, sourced item → category picks */}
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-lg grid place-items-center text-[12px]" style={{ background: ACCENT_SOFT }}>🧭</span>
            <h3 className="text-[15px] font-bold">What&apos;s breaking, by category</h3>
          </div>
          <p className="text-[12px] text-[#999] mb-4">Specific trends mapped to the category a brand can ride them in — each backed by a recent source, refreshed daily.</p>
          {radarLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[76px] rounded-2xl bg-[#f5f4fb] animate-pulse" />
              ))}
            </div>
          ) : radar.length === 0 ? (
            <div className="text-[14px] text-[#888] border border-dashed border-[#e3def9] rounded-2xl p-6 bg-[#faf9ff]">
              The trend radar refreshes daily — check back shortly as it fills in.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {radar.map((t, i) => (
                <div key={i} className="rounded-2xl border border-[#eee] bg-white p-4 hover:border-[#d9d2f7] hover:shadow-[0_8px_30px_rgba(108,77,246,0.07)] transition-all">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[15px] font-bold text-[#111] capitalize truncate">{t.item}</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: ACCENT_SOFT, color: ACCENT }}>{t.category}</span>
                  </div>
                  {t.note && <p className="text-[12px] text-[#888] leading-snug">{t.note}</p>}
                  {t.origin === 'creators' ? (
                    // First-party crawl signal — not a sourced news trend, so it's
                    // badged distinctly and links to the full IG trend board.
                    <div className="mt-2 text-[11px] truncate">
                      <Link href="/trending/topics" className="inline-flex items-center gap-1 hover:underline" style={{ color: ACCENT }}>
                        <span className="text-[10px]">📸</span> From creators we track
                      </Link>
                    </div>
                  ) : t.source ? (
                    <div className="mt-2 text-[11px] text-[#aaa] truncate">
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: ACCENT }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /></svg>
                          {t.source}
                        </a>
                      ) : (
                        <span>Source: {t.source}</span>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Companion: first-party Instagram signals from the creators we crawl */}
          <div className="flex items-center justify-between gap-3 mt-9 mb-1">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg grid place-items-center text-[12px]" style={{ background: ACCENT_SOFT }}>📸</span>
              <h3 className="text-[15px] font-bold">From the creators we track</h3>
            </div>
            <Link
              href="/trending/topics"
              className="inline-flex items-center gap-1 text-[13px] font-semibold shrink-0 hover:underline"
              style={{ color: ACCENT }}
            >
              What&apos;s viral right now →
            </Link>
          </div>
          <p className="text-[12px] text-[#999] mb-4">Which formats, hashtags and aesthetics are gaining momentum across the accounts we crawl.</p>
          {igLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-44 rounded-2xl bg-[#f5f4fb] animate-pulse" />
              ))}
            </div>
          ) : igTrends.length === 0 ? (
            <div className="text-[14px] text-[#888] border border-dashed border-[#e3def9] rounded-2xl p-6 bg-[#faf9ff]">
              We&apos;re still gathering Instagram trend data from the creators we track — this board fills in as our crawl runs.
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {IG_TYPE_META.map((meta) => {
                  const group = igTrends.filter((t) => t.trend_type === meta.key).slice(0, 8);
                  if (group.length === 0) return null;
                  return (
                    <div key={meta.key} className="rounded-2xl border border-[#eee] bg-white p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-7 h-7 rounded-lg grid place-items-center text-[13px] font-bold" style={{ background: ACCENT_SOFT, color: ACCENT }}>{meta.glyph}</span>
                        <span className="text-[13px] font-bold text-ink-900">{meta.label}</span>
                      </div>
                      <ul className="space-y-2">
                        {group.map((t, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PHASE_META[t.phase].c }} title={PHASE_META[t.phase].label} />
                            <span className="text-[13px] text-[#222] truncate flex-1">{t.display_name}</span>
                            <span className="text-[11px] text-[#aaa] tabular-nums shrink-0">{t.usage_count_7d > 0 ? `${t.usage_count_7d}× / wk` : PHASE_META[t.phase].label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
              {/* Phase legend */}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[#999]">
                {(Object.keys(PHASE_META) as IgTrend['phase'][]).map((p) => (
                  <span key={p} className="inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: PHASE_META[p].c }} />
                    {PHASE_META[p].label}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ── Around the web — secondary: news + search, compacted ── */}
        <section className="max-w-6xl mx-auto px-6 pt-12">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[18px]">🌐</span>
            <h2 className="text-[20px] font-bold tracking-tight">Around the web</h2>
          </div>
          <p className="text-[13px] text-[#888] mb-6">Marketing headlines and what India is searching, for wider context.</p>
        </section>
        <section className="max-w-6xl mx-auto px-6 pb-12 grid lg:grid-cols-[1.7fr_1fr] gap-8">
          {/* News */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[15px]">📰</span>
              <h3 className="text-[15px] font-bold">Campaign & marketing news</h3>
            </div>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-[#f5f4fb] animate-pulse" />
                ))}
              </div>
            ) : err ? (
              <InlineError message="We couldn’t load trending news right now." onRetry={() => { setLoading(true); load().finally(() => setLoading(false)); }} />
            ) : news.length === 0 ? (
              <div className="text-[14px] text-[#888] border border-[#eee] rounded-xl p-6">No news to show right now.</div>
            ) : (
              <div className="space-y-3">
                {news.slice(0, 6).map((n, i) => (
                  <a
                    key={i}
                    href={n.link}
                    target="_blank"
                    rel="noreferrer"
                    className="flex gap-4 p-3 rounded-xl border border-[#eee] hover:border-[#d9d2f7] hover:shadow-[0_8px_30px_rgba(108,77,246,0.08)] transition-all"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={n.image || n.logo}
                      alt=""
                      className={`w-28 h-24 rounded-lg shrink-0 bg-[#fafafc] border border-[#eee] ${n.image ? 'object-cover' : 'object-contain p-3'}`}
                    />
                    <div className="min-w-0 self-center">
                      <div className="flex items-center gap-2 mb-1 text-[12px]">
                        {n.logo && /* eslint-disable-next-line @next/next/no-img-element */ <img src={n.logo} alt="" className="w-4 h-4 rounded" />}
                        <span className="font-medium" style={{ color: ACCENT }}>{n.source}</span>
                        {n.date && <span className="text-[#aaa]">· {ago(n.date)}</span>}
                      </div>
                      <div className="text-[15px] font-medium text-[#111] leading-snug">{n.title}</div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Trends */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[15px]">🔥</span>
              <h3 className="text-[15px] font-bold">Trending in India</h3>
            </div>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-12 rounded-xl bg-[#f5f4fb] animate-pulse" />
                ))}
              </div>
            ) : trends.length === 0 ? (
              <div className="text-[14px] text-[#888] border border-[#eee] rounded-xl p-6">No trends right now.</div>
            ) : (
              <div className="rounded-2xl border border-[#eee] overflow-hidden">
                {trends.map((t, i) => (
                  <a
                    key={i}
                    href={t.link}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 px-4 py-3 border-b border-[#f3f3f3] last:border-0 hover:bg-[#faf9ff] transition-colors"
                  >
                    <span className="w-6 text-[15px] font-bold tabular-nums" style={{ color: ACCENT }}>{i + 1}</span>
                    <span className="flex-1 min-w-0 text-[14px] text-[#222] truncate">{t.title}</span>
                    {t.traffic && <span className="text-[11px] text-[#999] shrink-0">{t.traffic} searches</span>}
                  </a>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] text-[#aaa]">Sources: Google News & Google Trends · refreshed periodically.</p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
