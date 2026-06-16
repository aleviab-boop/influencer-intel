'use client';

import { useEffect, useState } from 'react';
import { MarketingNav, MarketingFooter, ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface TrendItem { title: string; traffic: string; link: string }
interface ShortItem { id: string; title: string; channel: string; views: number; likes: number; thumbnail: string; link: string; durationSec: number }

function fmtViews(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export default function TrendingPage() {
  const [shorts, setShorts] = useState<ShortItem[]>([]);
  const [shortsErr, setShortsErr] = useState<string | null>(null);
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(force = false) {
    if (force) await fetch('/api/news/refresh', { method: 'POST' }).catch(() => {});
    const [shortsRes, newsRes] = await Promise.allSettled([
      fetch('/api/shorts', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/news', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    if (shortsRes.status === 'fulfilled') {
      setShorts(shortsRes.value.items ?? []);
      setShortsErr(shortsRes.value.error ?? null);
    } else {
      setShortsErr('fetch_failed');
    }
    if (newsRes.status === 'fulfilled') {
      setTrends(newsRes.value.trends ?? []);
      setUpdatedAt(newsRes.value.updatedAt ?? new Date().toISOString());
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
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
        <section className="py-10 md:py-12" style={{ background: `radial-gradient(60% 60% at 12% 0%, rgba(108,77,246,.16), transparent 60%), radial-gradient(55% 55% at 90% 6%, rgba(247,181,0,.15), transparent 60%), radial-gradient(55% 50% at 60% 0%, rgba(236,72,153,.12), transparent 55%), linear-gradient(180deg, ${ACCENT_SOFT}, #ffffff)` }}>
          <div className="max-w-6xl mx-auto px-6">
            <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>What&apos;s trending</span>
            <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Trending reels & shorts</h1>
            <p className="mt-2 text-[15px] text-[#555]">The short-form videos blowing up in India right now — spot a format, brief your creators to make their own.</p>
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

        <section className="max-w-6xl mx-auto px-6 py-10 grid lg:grid-cols-[1.7fr_1fr] gap-8">
          {/* Trending Shorts */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[18px]">🎬</span>
              <h2 className="text-[18px] font-bold">Trending shorts in India</h2>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-[9/12] rounded-xl bg-[#f5f4fb] animate-pulse" />
                ))}
              </div>
            ) : shortsErr === 'no_key' ? (
              <div className="text-[14px] text-[#666] border border-[#e3def9] bg-[#faf9ff] rounded-xl p-6 leading-relaxed">
                <div className="font-semibold mb-1" style={{ color: ACCENT }}>Almost there — one free key needed</div>
                Trending Shorts is powered by the YouTube Data API. Add a free <code className="px-1 rounded bg-white border border-[#eee]">YOUTUBE_API_KEY</code> to your environment and this fills with today&apos;s top short-form videos in India.
              </div>
            ) : shortsErr || shorts.length === 0 ? (
              <div className="text-[14px] text-[#888] border border-[#eee] rounded-xl p-6">Couldn&apos;t load trending shorts right now. Try again shortly.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {shorts.map((s) => (
                  <a
                    key={s.id}
                    href={s.link}
                    target="_blank"
                    rel="noreferrer"
                    className="group rounded-xl border border-[#eee] overflow-hidden hover:border-[#d9d2f7] hover:shadow-[0_8px_30px_rgba(108,77,246,0.08)] transition-all"
                  >
                    <div className="relative aspect-[9/12] bg-[#fafafc] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.thumbnail} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                        <span className="text-white text-[11px] font-semibold">▶ {fmtViews(s.views)} views</span>
                      </div>
                    </div>
                    <div className="p-2.5">
                      <div className="text-[13px] font-medium text-[#111] leading-snug line-clamp-2">{s.title}</div>
                      <div className="mt-1 text-[12px] text-[#999] truncate">{s.channel}</div>
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
            <p className="mt-3 text-[11px] text-[#aaa]">Sources: YouTube Shorts & Google Trends · refreshed periodically.</p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
