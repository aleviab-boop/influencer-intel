'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { PageDoodles } from '@/components/page-doodles';
import { InlineError } from '@/components/skeleton';

interface NewsItem { title: string; link: string; source: string; date: string; image: string; logo: string }
interface TrendItem { title: string; traffic: string; link: string }
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

  // First-party Instagram trends — independent of the news feed. Best-effort:
  // the board just stays empty if the crawl hasn't produced signals yet.
  async function loadIgTrends() {
    setIgLoading(true);
    try {
      const d = await fetch('/api/trends?limit=40', { cache: 'no-store' }).then((r) => r.json());
      setIgTrends(Array.isArray(d.trends) ? d.trends : []);
    } catch {
      setIgTrends([]);
    } finally {
      setIgLoading(false);
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    void loadIgTrends();
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
            <Link
              href="/"
              className="flex w-fit items-center gap-1.5 mb-3 text-[13px] font-medium text-[#666] hover:text-[#111] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
              </svg>
              Back to home
            </Link>
            <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>What&apos;s trending</span>
            <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Influencer & campaign pulse</h1>
            <p className="mt-2 text-[15px] text-[#555]">Live marketing news and what India is searching right now — refreshes through the day.</p>
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

        {/* First-party Instagram trends — our differentiator vs. the Google feed */}
        <section className="max-w-6xl mx-auto px-6 pt-10">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-2">
              <span className="text-[18px]">📸</span>
              <h2 className="text-[18px] font-bold">Trending on Instagram</h2>
            </div>
            <Link
              href="/trending/topics"
              className="inline-flex items-center gap-1 text-[13px] font-semibold shrink-0 hover:underline"
              style={{ color: ACCENT }}
            >
              What&apos;s viral right now →
            </Link>
          </div>
          <p className="text-[13px] text-[#888] mb-5">
            Straight from the creators we track — which formats, hashtags and aesthetics are gaining momentum right now.
          </p>
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

        <section className="max-w-6xl mx-auto px-6 py-10 grid lg:grid-cols-[1.7fr_1fr] gap-8">
          {/* News */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[18px]">📰</span>
              <h2 className="text-[18px] font-bold">Campaign & marketing news</h2>
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
                {news.map((n, i) => (
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
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[18px]">🔥</span>
              <h2 className="text-[18px] font-bold">Trending in India</h2>
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
