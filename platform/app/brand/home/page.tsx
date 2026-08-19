'use client';

import { useCallback, useEffect, useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';
import { LiveSearch } from '@/components/live-search';
import { BrandSwitcher } from '@/components/brand-switcher';
import { useBrandSession, updateBrandSession, clearBrandSession, brandScopePrompt, type BrandMode } from '@/lib/brand-session';
import { addBrandToRoster } from '@/lib/agency-session';

interface Creator {
  username: string;
  full_name: string;
  followers: number;
  engagement: number;
  profile_pic_url: string | null;
}
interface Campaign {
  title: string;
  angle: string;
  trend: { name: string; type: string; why_now: string };
  format: string;
  campaign_type: string;
  hashtags: string[];
  deliverables: string;
  creator_query: string;
  creators: Creator[];
}
interface Trend {
  display_name: string;
  trend_type: string;
  phase: string;
  velocity: number | string;
  usage_count_7d: number | string;
}

const fmt = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

// Turn the barter/paid choice into a budget hint the campaign model understands.
const budgetForMode = (m: BrandMode): string =>
  m === 'paid' ? 'paid — paid reels + ambassador deals' : 'barter — gifting / product-seeding first';

export default function BrandHomePage() {
  const session = useBrandSession();
  const [ready, setReady] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Distinguish "no session" from "haven't checked yet" so we don't flash the
  // sign-in prompt before the hook reads localStorage.
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(t);
  }, []);

  const dna = session?.dna ?? null;
  const category = dna?.category || '';
  const mode = session?.mode ?? 'barter';

  // Keep the active brand in the agency roster so the switcher dropdown always
  // lists every brand they've opened (with its cached DNA for instant switching).
  useEffect(() => {
    if (!session?.brand) return;
    addBrandToRoster({
      brand: session.brand,
      url: session.url ?? null,
      social: session.social ?? null,
      category: dna?.category ?? null,
      dna,
      ts: session.ts,
    });
  }, [session?.brand, session?.ts, session?.url, session?.social, dna]);

  const loadCampaigns = useCallback(async () => {
    if (!session?.brand || !category) return;
    setCampaignsLoading(true);
    setError(null);
    setCampaigns(null);
    try {
      const r = await fetch('/api/brand/campaign-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: session.brand,
          category,
          audience: dna?.target_audience || undefined,
          budget: budgetForMode(mode),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || 'Could not load campaigns.');
        return;
      }
      setCampaigns(Array.isArray(d.campaigns) ? d.campaigns : []);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setCampaignsLoading(false);
    }
  }, [session?.brand, category, dna?.target_audience, mode]);

  // Auto-load personalised campaigns when the brand + mode are known.
  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  // Trending in the brand's niche (category-filtered, falling back to top movers).
  useEffect(() => {
    if (!category) return;
    let cancelled = false;
    (async () => {
      const firstWord = category.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';
      const tryFetch = async (q: string): Promise<Trend[]> => {
        try {
          const r = await fetch(`/api/trends?${q}`);
          const d = await r.json().catch(() => ({}));
          return Array.isArray(d.trends) ? d.trends : [];
        } catch {
          return [];
        }
      };
      let rows = firstWord ? await tryFetch(`category=${encodeURIComponent(firstWord)}&limit=10`) : [];
      if (rows.length === 0) rows = await tryFetch('limit=10');
      if (!cancelled) setTrends(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [category]);

  function setMode(m: BrandMode) {
    if (m !== mode) updateBrandSession({ mode: m });
  }

  if (!ready) return <div className="min-h-screen bg-[#fafafc]" />;

  // Not signed in → send them to brand login.
  if (!session) {
    return (
      <div className="min-h-screen bg-[#fafafc] font-sans grid place-items-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-ink-900">Sign in your brand first</h1>
          <p className="mt-2 text-[15px] text-ink-600">
            Your workspace personalises campaigns, creators and trends to your brand. Analyse your brand DNA to get started.
          </p>
          <a
            href="/brand-dna"
            className="inline-block mt-5 px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
          >
            Brand login →
          </a>
        </div>
      </div>
    );
  }

  const scope = brandScopePrompt(session);

  return (
    <div className="min-h-screen bg-[#fafafc] font-sans">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Brand header */}
        <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                Agency workspace
              </span>
              {/* Pick which of the agency's brands to work on */}
              <BrandSwitcher activeBrand={session.brand} />
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-900">{session.brand}</h1>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              {category && <span className="text-[13px] text-ink-600 capitalize">{category}</span>}
              {dna?.positioning && <span className="text-[13px] text-ink-400">· {dna.positioning}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Barter / Paid toggle */}
            <div className="inline-flex items-center p-1 rounded-xl bg-white border border-border text-[13px]">
              {(['barter', 'paid'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3.5 py-1.5 rounded-lg capitalize transition-colors ${mode === m ? 'text-white font-semibold' : 'text-ink-500'}`}
                  style={mode === m ? { background: ACCENT } : undefined}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              onClick={() => { clearBrandSession(); window.location.href = '/brand/login'; }}
              className="text-[12.5px] text-ink-400 hover:text-ink-600 underline"
            >
              Switch brand
            </button>
          </div>
        </header>

        {/* Ways to market better */}
        {dna?.opportunities?.length ? (
          <div className="mb-8 rounded-2xl p-5" style={{ background: ACCENT_SOFT }}>
            <div className="text-[12px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: ACCENT }}>
              Ways to market {session.brand} better
            </div>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {dna.opportunities.map((o) => (
                <li key={o} className="text-[13.5px] text-ink-700 flex gap-2">
                  <span style={{ color: ACCENT }}>→</span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Trending in your niche */}
        {trends.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">Trending in your space</h2>
            <div className="flex flex-wrap gap-2">
              {trends.map((t) => {
                const vel = Math.round(Number(t.velocity) * 100);
                return (
                  <div key={`${t.trend_type}-${t.display_name}`} className="rounded-xl bg-white border border-border px-3 py-2">
                    <div className="text-[13.5px] font-semibold text-ink-900">{t.display_name}</div>
                    <div className="text-[11.5px] text-ink-500 capitalize">
                      {t.phase} · {Number.isFinite(vel) ? `${vel >= 0 ? '+' : ''}${vel}%` : t.trend_type} · {Number(t.usage_count_7d) || 0} posts/7d
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Campaigns you can run */}
        <section className="mb-10">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400">
              Campaigns you can run <span className="normal-case tracking-normal text-ink-400">· {mode}</span>
            </h2>
            <button
              onClick={() => void loadCampaigns()}
              disabled={campaignsLoading}
              className="text-[12.5px] font-semibold disabled:opacity-50"
              style={{ color: ACCENT }}
            >
              {campaignsLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {campaignsLoading && (
            <p className="text-center text-[14px] text-ink-500 py-6">Designing {mode} campaigns for {session.brand}…</p>
          )}
          {error && <p className="text-[13px] text-rose-600">{error}</p>}

          {campaigns && campaigns.length > 0 && (
            <div className="space-y-5">
              {campaigns.map((c, i) => (
                <div key={i} className="rounded-2xl bg-white border border-border shadow-card overflow-hidden">
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <h3 className="text-[18px] font-bold text-ink-900">{c.title}</h3>
                        <p className="mt-1 text-[14px] text-ink-600">{c.angle}</p>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {c.campaign_type && <Tag>{c.campaign_type}</Tag>}
                        {c.format && <Tag>{c.format}</Tag>}
                      </div>
                    </div>
                    {c.trend?.name && (
                      <div className="mt-4 rounded-xl p-3.5" style={{ background: ACCENT_SOFT }}>
                        <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: ACCENT }}>
                          <span className="uppercase text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-white/70">{c.trend.type || 'trend'}</span>
                          {c.trend.name}
                        </div>
                        {c.trend.why_now && <p className="mt-1 text-[12.5px] text-ink-600">Why now — {c.trend.why_now}</p>}
                      </div>
                    )}
                    {c.deliverables && (
                      <p className="mt-4 text-[13px] text-ink-600"><span className="font-semibold text-ink-800">Deliverables:</span> {c.deliverables}</p>
                    )}
                    {c.hashtags?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {c.hashtags.map((h) => (
                          <span key={h} className="text-[12px] px-2 py-0.5 rounded-full border border-border text-ink-500">{h}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-border bg-[#fafafc] px-6 py-4">
                    <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-400 mb-3">
                      Suggested creators {c.creators?.length ? `(${c.creators.length})` : ''}
                    </div>
                    {c.creators?.length ? (
                      <div className="grid sm:grid-cols-2 gap-2">
                        {c.creators.map((cr) => (
                          <a
                            key={cr.username}
                            href={`https://instagram.com/${cr.username}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-3 rounded-xl bg-white border border-border px-3 py-2 hover:border-[#c9bdfb] transition-colors"
                          >
                            <div className="w-9 h-9 rounded-full bg-ink-100 grid place-items-center text-[13px] font-semibold text-ink-500 overflow-hidden shrink-0">
                              {cr.profile_pic_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={cr.profile_pic_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                cr.username.slice(0, 1).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13.5px] font-semibold text-ink-900 truncate">@{cr.username}</div>
                              <div className="text-[11.5px] text-ink-500">
                                {fmt(cr.followers)} followers{cr.engagement ? ` · ${cr.engagement.toFixed(1)}% ER` : ''}
                              </div>
                            </div>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[13px] text-ink-500">No database creators matched yet — use the finder below.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {campaigns && campaigns.length === 0 && !campaignsLoading && !error && (
            <p className="text-[14px] text-ink-500">No campaigns came back. Try refreshing.</p>
          )}
        </section>

        {/* Scoped creator discovery — the prompt bar remembers the brand's niche */}
        <section>
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 mb-3">
            Find creators for {session.brand}
          </h2>
          <p className="text-[13px] text-ink-500 mb-4">
            Pre-scoped to your niche — search within {category || 'your space'} and we&apos;ll rank creators that fit.
          </p>
          <LiveSearch initialPrompt={scope} initialMode="db" initialBucket="instagram" />
        </section>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize" style={{ background: ACCENT_SOFT, color: ACCENT }}>
      {children}
    </span>
  );
}
