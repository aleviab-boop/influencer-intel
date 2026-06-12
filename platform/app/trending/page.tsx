'use client';

import { useEffect, useState } from 'react';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface NewsItem { title: string; link: string; source: string; date: string }
interface TrendItem { title: string; traffic: string; link: string }

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
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch('/api/news')
      .then((r) => r.json())
      .then((d) => {
        setNews(d.news ?? []);
        setTrends(d.trends ?? []);
      })
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#111]">
      <MarketingNav />
      <main className="flex-1">
        <section className="py-10 md:py-12" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }}>
          <div className="max-w-6xl mx-auto px-6">
            <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>What&apos;s trending</span>
            <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Influencer & campaign pulse</h1>
            <p className="mt-2 text-[15px] text-[#555]">Live marketing news and what India is searching right now — updated through the day.</p>
          </div>
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
            ) : err || news.length === 0 ? (
              <div className="text-[14px] text-[#888] border border-[#eee] rounded-xl p-6">Couldn&apos;t load news right now. Try again shortly.</div>
            ) : (
              <div className="space-y-3">
                {news.map((n, i) => (
                  <a
                    key={i}
                    href={n.link}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-4 rounded-xl border border-[#eee] hover:border-[#d9d2f7] hover:shadow-[0_8px_30px_rgba(108,77,246,0.08)] transition-all"
                  >
                    <div className="flex items-center gap-2 mb-1.5 text-[12px]">
                      <span className="px-2 py-0.5 rounded-md font-medium" style={{ background: ACCENT_SOFT, color: ACCENT }}>{n.source}</span>
                      {n.date && <span className="text-[#aaa]">{ago(n.date)}</span>}
                    </div>
                    <div className="text-[15px] font-medium text-[#111] leading-snug">{n.title}</div>
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
