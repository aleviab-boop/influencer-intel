'use client';

import { useEffect, useState } from 'react';
import { ACCENT, ACCENT_SOFT } from '@/components/marketing';

interface Creator {
  username: string;
  full_name: string;
  followers: number;
  engagement: number;
  score: number;
  profile_pic_url: string | null;
  is_verified: boolean;
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

const fmt = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

export default function BrandCampaignsPage() {
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [audience, setAudience] = useState('');
  const [cities, setCities] = useState('');
  const [budget, setBudget] = useState('mid');
  const [goals, setGoals] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [trendsUsed, setTrendsUsed] = useState(0);

  // Prefill from the Brand DNA hand-off (/brand-campaigns?brand=&category=&audience=)
  // so "Generate campaign ideas →" carries the analysed brand straight in.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const b = q.get('brand');
    const c = q.get('category');
    const a = q.get('audience');
    if (b) setBrand((v) => v || b);
    if (c) setCategory((v) => v || c);
    if (a) setAudience((v) => v || a);
  }, []);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (brand.trim().length < 2 || category.trim().length < 2) {
      setError('Enter a brand name and category.');
      return;
    }
    setLoading(true);
    setCampaigns(null);
    try {
      const r = await fetch('/api/brand/campaign-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: brand.trim(),
          category: category.trim(),
          audience: audience.trim() || undefined,
          cities: cities.split(',').map((c) => c.trim()).filter(Boolean),
          budget,
          goals: goals.trim() || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || 'Could not generate ideas. Try again.');
        setLoading(false);
        return;
      }
      setCampaigns(Array.isArray(d.campaigns) ? d.campaigns : []);
      setTrendsUsed(typeof d.trends_used === 'number' ? d.trends_used : 0);
    } catch {
      setError('Could not reach the server. Try again.');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#fafafc] font-sans">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <header className="mb-8">
          <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold" style={{ background: ACCENT_SOFT, color: ACCENT }}>
            Trend-driven
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-900">Campaign ideas for your brand</h1>
          <p className="mt-2 text-[15px] text-ink-600 max-w-2xl">
            Tell us about your brand. We scan what&apos;s trending on Instagram reels in your niche right now and design
            campaigns you can run — each with a ready shortlist of creators from our database.
          </p>
        </header>

        {/* Brand profile form */}
        <form onSubmit={generate} className="rounded-2xl bg-white border border-border shadow-card p-6 grid sm:grid-cols-2 gap-4">
          <Field label="Brand name" required>
            <input className={inp} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. GlowRoot" />
          </Field>
          <Field label="Category / niche" required>
            <input className={inp} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. ayurvedic skincare" />
          </Field>
          <Field label="Target audience">
            <input className={inp} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. women 18–34, metro + tier-2" />
          </Field>
          <Field label="Target cities">
            <input className={inp} value={cities} onChange={(e) => setCities(e.target.value)} placeholder="e.g. Mumbai, Pune, Bengaluru" />
          </Field>
          <Field label="Budget">
            <select className={inp} value={budget} onChange={(e) => setBudget(e.target.value)}>
              <option value="low">Low — barter first</option>
              <option value="mid">Mid — barter + small paid</option>
              <option value="high">High — paid + ambassador</option>
            </select>
          </Field>
          <Field label="Goal (optional)">
            <input className={inp} value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="e.g. festive sales push" />
          </Field>

          <div className="sm:col-span-2 flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-70 flex items-center gap-2"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              {loading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
              {loading ? 'Scanning trends…' : 'Generate campaign ideas'}
            </button>
            {error && <span className="text-[13px] text-rose-600">{error}</span>}
          </div>
        </form>

        {/* Results */}
        {loading && (
          <p className="mt-8 text-center text-[14px] text-ink-500">
            Browsing current Instagram trends for your niche and matching creators…
          </p>
        )}

        {campaigns && campaigns.length === 0 && !loading && (
          <p className="mt-8 text-center text-[14px] text-ink-500">No campaign ideas came back. Try a broader category.</p>
        )}

        {campaigns && campaigns.length > 0 && (
          <div className="mt-8 space-y-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400">
              {campaigns.length} campaign {campaigns.length === 1 ? 'idea' : 'ideas'}
              {trendsUsed > 0 && (
                <span className="ml-2 normal-case tracking-normal font-medium" style={{ color: ACCENT }}>
                  · grounded in {trendsUsed} trend{trendsUsed === 1 ? '' : 's'} measured from your niche
                </span>
              )}
            </h2>
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

                {/* Creator shortlist */}
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
                    <p className="text-[13px] text-ink-500">
                      No database creators matched yet — the live finder can source them from{' '}
                      <span className="italic">{c.creator_query || category}</span>.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-ink-500 mb-1.5 block">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize" style={{ background: ACCENT_SOFT, color: ACCENT }}>
      {children}
    </span>
  );
}

const inp =
  'w-full px-3.5 py-2.5 border border-border bg-white text-sm text-ink-900 rounded-xl focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all';
