'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ACCENT, ACCENT_SOFT, MarketingNav, MarketingFooter } from '@/components/marketing';
import { LiveSearch } from '@/components/live-search';
import { BrandSwitcher } from '@/components/brand-switcher';
import { BrandPipelinePanel, SaveCreatorButton } from '@/components/brand-pipeline';
import { CreatorAvatar } from '@/components/creator-avatar';
import { useBrandSession, updateBrandSession, clearBrandSession, brandScopePrompt, type BrandDnaProfile, type BrandCollaborator } from '@/lib/brand-session';
import { useBrandPipeline } from '@/lib/use-brand-pipeline';
import { addBrandToRoster } from '@/lib/agency-session';
import { useAgencyAccount } from '@/lib/use-agency-account';
import { buildSuggestions } from '@/lib/suggestions';

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

// Personalised typewriter examples for the brand's prompt bar. Built from the
// brand's DNA (category / keywords / archetypes / audience) so the placeholder
// cycles through searches that actually fit THIS brand — falling back to generic
// briefs when the DNA hasn't been mapped yet.
function brandExamples(brand: string, dna: BrandDnaProfile | null): string[] {
  const cat = (dna?.category || '').trim();
  const kws = (dna?.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const arch = (dna?.creator_archetypes ?? []).map((a) => a.trim()).filter(Boolean);
  const aud = (dna?.target_audience || '').trim();
  const ex: string[] = [];
  if (cat) ex.push(`${cat} creators in Mumbai for a ${brand} launch`);
  if (arch[0]) ex.push(`${arch[0]} who post about ${kws[0] || cat || 'your niche'}`);
  if (kws[1]) ex.push(`Creators covering ${kws[1]} with 85%+ credibility`);
  if (aud) ex.push(`Influencers whose audience is ${aud}`);
  ex.push(`Barter-ready ${cat || 'niche'} creators for gifting`);
  const cleaned = Array.from(new Set(ex.map((e) => e.trim()).filter(Boolean)));
  return cleaned.length
    ? cleaned.slice(0, 5)
    : [
        'Beauty micro-influencers in Mumbai with 85%+ credibility',
        'Vegan food bloggers in Bangalore for a product launch',
        'Fashion creators for a festive Diwali lookbook',
      ];
}

// Typewriter: types each phrase, holds, deletes, moves to the next.
function useTypewriter(words: string[]) {
  const [text, setText] = useState('');
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'deleting'>('typing');
  useEffect(() => {
    const word = words[i % words.length] ?? '';
    let timer: ReturnType<typeof setTimeout>;
    if (phase === 'typing') {
      if (text.length < word.length) timer = setTimeout(() => setText(word.slice(0, text.length + 1)), 45);
      else timer = setTimeout(() => setPhase('deleting'), 1600);
    } else {
      if (text.length > 0) timer = setTimeout(() => setText(word.slice(0, text.length - 1)), 22);
      else {
        setPhase('typing');
        setI((v) => v + 1);
        timer = setTimeout(() => {}, 0);
      }
    }
    return () => clearTimeout(timer);
  }, [text, phase, i, words]);
  return text;
}

// The brand's personalised prompt bar — same look as the lander hero (rounded
// white card, animated placeholder, autocomplete, gradient search button), but
// seeded to the brand's niche and wired straight into the workspace finder.
function BrandPromptBar({ brand, dna, onSearch }: { brand: string; dna: BrandDnaProfile | null; onSearch: (q: string) => void }) {
  const [value, setValue] = useState('');
  const [showSug, setShowSug] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const examplesRef = useRef<string[]>(brandExamples(brand, dna));
  examplesRef.current = brandExamples(brand, dna);
  const typed = useTypewriter(examplesRef.current);
  const suggestions = buildSuggestions(value);
  const sugOpen = showSug && suggestions.length > 0;

  const go = () => {
    const q = value.trim();
    if (q.length >= 2) {
      setShowSug(false);
      onSearch(q);
    }
  };
  const pick = (s: string) => {
    setValue(s);
    setShowSug(false);
    setActiveIdx(-1);
    onSearch(s);
  };

  return (
    <div className="mt-8 relative max-w-3xl text-left">
      <div className="rounded-2xl bg-white border-2 transition-colors p-4 shadow-[0_12px_50px_rgba(108,77,246,0.12)] focus-within:border-[#6C4DF6] border-[#e3def9]">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <textarea
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setShowSug(true);
                setActiveIdx(-1);
              }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 120)}
              onKeyDown={(e) => {
                if (sugOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault();
                  setActiveIdx((idx) => {
                    const n = suggestions.length;
                    return e.key === 'ArrowDown' ? (idx + 1) % n : (idx - 1 + n) % n;
                  });
                  return;
                }
                if (e.key === 'Escape') {
                  setShowSug(false);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (activeIdx >= 0 && suggestions[activeIdx]) pick(suggestions[activeIdx]!);
                  else go();
                }
              }}
              rows={1}
              className="w-full resize-none text-[17px] text-[#222] placeholder-transparent focus:outline-none bg-transparent"
            />
            {value.length === 0 && (
              <div className="pointer-events-none absolute inset-0 text-[17px] text-[#9aa] select-none">
                {typed}
                <span className="ii-caret" style={{ color: ACCENT }}>|</span>
              </div>
            )}
            {sugOpen && (
              <div className="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl bg-white border border-[#ececec] shadow-[0_16px_50px_rgba(0,0,0,0.12)] overflow-hidden">
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => pick(s)}
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
          <button
            onClick={go}
            aria-label="Search"
            title="Search"
            className="w-12 h-12 rounded-full grid place-items-center text-white shadow-md shrink-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:brightness-105"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          </button>
        </div>
      </div>
      <p className="mt-2.5 text-[13px] text-[#888]">
        Pre-scoped to {brand}. To search a particular username, use <span className="font-semibold" style={{ color: ACCENT }}>@username</span>
      </p>
    </div>
  );
}

// Small section header in the marketing style: a coloured eyebrow above a bold title.
function SectionHead({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
      <div>
        <span className="text-[13px] font-semibold" style={{ color: ACCENT }}>{eyebrow}</span>
        <h2 className="mt-1 text-2xl md:text-[28px] font-bold tracking-tight text-[#111]">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export default function BrandHomePage() {
  const session = useBrandSession();
  const { account, logout } = useAgencyAccount();
  // A dedicated brand account owns exactly one brand (itself) — no roster to
  // switch, and the workspace reads as a "Brand workspace" not an agency one.
  const isBrand = account?.account_type === 'brand';
  const [ready, setReady] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Brand DNA (re)analysis, driven from the empty state when a workspace has no DNA.
  const [dnaRunning, setDnaRunning] = useState(false);
  const [dnaError, setDnaError] = useState<string | null>(null);
  // The active finder query. null = use the brand's default scope; a string is a
  // search the user ran from the personalised prompt bar or the finder itself.
  const [query, setQuery] = useState<string | null>(null);
  const finderRef = useRef<HTMLDivElement>(null);

  // Distinguish "no session" from "haven't checked yet" so we don't flash the
  // sign-in prompt before the hook reads localStorage.
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(t);
  }, []);

  const dna = session?.dna ?? null;
  const category = dna?.category || '';
  const collaborators: BrandCollaborator[] = session?.collaborators ?? [];
  // Campaigns still generate against a sensible default posture (barter/gifting
  // first) — the explicit toggle was removed to keep the workspace uncluttered.
  const budget = 'barter — gifting / product-seeding first';

  // One pipeline hook for the whole page — shared by the "+ Save" buttons on
  // creator cards and the funnel panel below, so they always stay in sync.
  const pipeline = useBrandPipeline(session?.brand ?? null);

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
          budget,
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
  }, [session?.brand, category, dna?.target_audience]);

  // Auto-load personalised campaigns when the brand + DNA are known.
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

  // Lazy-load "Creators who fit {brand}" for a returning brand that has DNA but
  // no cached collaborators yet (signed up before the feature existed, or the
  // list wasn't persisted). Grounds on the saved DNA server-side — best-effort.
  useEffect(() => {
    if (!session?.brand || !category || collaborators.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/brand/collaborators?brand=${encodeURIComponent(session.brand)}`);
        const d = await r.json().catch(() => ({}));
        const list = Array.isArray(d.collaborators) ? d.collaborators : [];
        if (!cancelled && list.length > 0) updateBrandSession({ collaborators: list });
      } catch {
        /* best-effort — the section just stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.brand, category, collaborators.length]);

  // (Re)analyse the brand's DNA from the workspace. This is what rescues an
  // empty workspace: if DNA analysis failed at sign-up (e.g. the LLM key wasn't
  // set), the brand lands here with no category — one click maps it and unlocks
  // opportunities, trends and campaigns.
  const runDna = useCallback(async () => {
    if (!session?.brand) return;
    setDnaRunning(true);
    setDnaError(null);
    try {
      const r = await fetch('/api/brand/dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: session.brand,
          url: session.url ?? undefined,
          social: session.social ?? undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.profile) {
        setDnaError(d.error || 'Could not analyse your brand. Please try again.');
        return;
      }
      updateBrandSession({
        dna: d.profile,
        collaborators: Array.isArray(d.collaborators) ? d.collaborators : [],
      });
    } catch {
      setDnaError('Could not reach the server. Please try again.');
    } finally {
      setDnaRunning(false);
    }
  }, [session?.brand, session?.url, session?.social]);

  if (!ready) return <div className="min-h-screen bg-white" />;

  // Not signed in → send them to brand login.
  if (!session) {
    return (
      <div className="min-h-screen bg-white font-sans grid place-items-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-[#111]">Sign in your brand first</h1>
          <p className="mt-2 text-[15px] text-[#555]">
            Your workspace personalises campaigns, creators and trends to your brand. Analyse your brand DNA to get started.
          </p>
          <a
            href="/brand/login"
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
  // What the finder actually searches: an explicit search from the prompt bar,
  // else the brand's default niche scope.
  const finderPrompt = query ?? scope;

  const runSearch = (q: string) => {
    setQuery(q);
    // Bring the results into view — the prompt bar lives up in the hero.
    setTimeout(() => finderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#111] font-sans">
      <MarketingNav />

      {/* Brand hero — mirrors the lander's radial-gradient headline band, with a
          personalised prompt bar as the centrepiece. */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{ background: `radial-gradient(880px 420px at 50% -12%, ${ACCENT_SOFT}, rgba(255,255,255,0))` }}
        />
        <div className="max-w-6xl mx-auto w-full px-6 pt-12 pb-12">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span
                className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold bg-white border border-[#ececff] shadow-sm"
                style={{ color: ACCENT }}
              >
                {isBrand ? 'Brand workspace' : 'Agency workspace'}
              </span>
              {/* Only agencies switch between a roster; a brand account owns one brand. */}
              {!isBrand && <BrandSwitcher activeBrand={session.brand} />}
            </div>
            {/* A brand account logs out entirely; an agency just switches brand. */}
            <button
              onClick={async () => {
                if (isBrand) await logout();
                clearBrandSession();
                window.location.href = '/brand/login';
              }}
              className="text-[13px] font-medium text-[#666] hover:text-[#111] px-3.5 py-2 rounded-lg border border-[#e6e6ef] bg-white hover:border-[#d9d2f7] transition-colors"
            >
              {isBrand ? 'Log out' : 'Switch brand'}
            </button>
          </div>

          <h1 className="mt-6 text-4xl md:text-[46px] leading-[1.05] font-bold tracking-tight">
            {session.brand}&apos;s command center
          </h1>
          <p className="mt-3 text-[16px] text-[#555] max-w-2xl">
            {category
              ? <>Find creators, run campaigns and track trends — all pre-scoped to {session.brand}{dna?.positioning ? <> ({dna.positioning})</> : null}.</>
              : <>Search creators for {session.brand} below. Map your brand DNA to unlock personalised campaigns, trends and opportunities.</>}
          </p>

          <BrandPromptBar brand={session.brand} dna={dna} onSearch={runSearch} />
        </div>
      </section>

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 pb-20">
        {/* Brand-DNA-driven intelligence, or an empty state that unlocks it */}
        {category ? (
          <>
            {/* What they can improve */}
            {dna?.opportunities?.length ? (
              <div
                className="mb-14 rounded-[26px] p-6 md:p-8 border border-[#ececff]"
                style={{ background: ACCENT_SOFT }}
              >
                <div className="text-[13px] font-semibold" style={{ color: ACCENT }}>
                  Ways to market {session.brand} better
                </div>
                <ul className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-3">
                  {dna.opportunities.map((o) => (
                    <li key={o} className="text-[14.5px] text-[#333] flex gap-2.5 leading-relaxed">
                      <span className="mt-0.5 shrink-0" style={{ color: ACCENT }}>→</span>
                      <span>{o}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Creators who've worked with this brand before */}
            {collaborators.length > 0 && (
              <section className="mb-14">
                <SectionHead
                  eyebrow="Warm intros"
                  title={`Creators who fit ${session.brand}`}
                />
                <p className="text-[14px] text-[#666] -mt-2 mb-5 max-w-2xl">
                  Past collaborators, creators {session.brand} tags, and top creators in its product niche — the warmest place to start outreach.
                </p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {collaborators.map((cr) => (
                    <div
                      key={cr.username}
                      className="flex items-center gap-3 rounded-2xl bg-white border border-[#eee] px-3.5 py-2.5 hover:border-[#c9bdfb] transition-colors"
                    >
                      <a
                        href={`https://instagram.com/${cr.username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 min-w-0 flex-1"
                      >
                        <CreatorAvatar handle={cr.username} name={cr.full_name} pic={cr.profile_pic_url} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-semibold text-[#111] truncate">@{cr.username}</div>
                          <div className="text-[11.5px] text-[#888]">
                            {cr.followers > 0
                              ? <>{fmt(cr.followers)} followers{cr.engagement ? ` · ${cr.engagement.toFixed(1)}% ER` : ''}</>
                              : 'Tap to view on Instagram'}
                          </div>
                        </div>
                      </a>
                      <SaveCreatorButton
                        pipeline={pipeline}
                        creator={{
                          username: cr.username,
                          full_name: cr.full_name,
                          followers: cr.followers,
                          engagement: cr.engagement,
                          profile_pic_url: cr.profile_pic_url,
                        }}
                        compact
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Trending in your niche */}
            {trends.length > 0 && (
              <section className="mb-14">
                <SectionHead eyebrow="Stay in the loop" title="Trending in your space" />
                <div className="flex flex-wrap gap-2.5">
                  {trends.map((t) => {
                    const vel = Math.round(Number(t.velocity) * 100);
                    return (
                      <div
                        key={`${t.trend_type}-${t.display_name}`}
                        className="rounded-2xl bg-white border border-[#eee] px-4 py-2.5 shadow-[0_6px_24px_rgba(0,0,0,0.05)]"
                      >
                        <div className="text-[14px] font-semibold text-[#111]">{t.display_name}</div>
                        <div className="text-[12px] text-[#888] capitalize">
                          {t.phase} · {Number.isFinite(vel) ? `${vel >= 0 ? '+' : ''}${vel}%` : t.trend_type} · {Number(t.usage_count_7d) || 0} posts/7d
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Campaigns you can run */}
            <section className="mb-14">
              <SectionHead
                eyebrow="Ready to launch"
                title="Campaigns you can run"
                action={
                  <button
                    onClick={() => void loadCampaigns()}
                    disabled={campaignsLoading}
                    className="text-[13px] font-semibold disabled:opacity-50 hover:opacity-80"
                    style={{ color: ACCENT }}
                  >
                    {campaignsLoading ? 'Loading…' : 'Refresh'}
                  </button>
                }
              />

              {campaignsLoading && (
                <p className="text-center text-[14px] text-[#777] py-6">Designing campaigns for {session.brand}…</p>
              )}
              {error && <p className="text-[13px] text-rose-600">{error}</p>}

              {campaigns && campaigns.length > 0 && (
                <div className="space-y-5">
                  {campaigns.map((c, i) => (
                    <div key={i} className="rounded-[26px] bg-white border border-[#eeeef6] shadow-[0_8px_40px_rgba(0,0,0,0.06)] overflow-hidden">
                      <div className="p-6 md:p-7">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div>
                            <h3 className="text-[19px] font-bold tracking-tight text-[#111]">{c.title}</h3>
                            <p className="mt-1.5 text-[14px] text-[#555] leading-relaxed">{c.angle}</p>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {c.campaign_type && <Tag>{c.campaign_type}</Tag>}
                            {c.format && <Tag>{c.format}</Tag>}
                          </div>
                        </div>
                        {c.trend?.name && (
                          <div className="mt-4 rounded-2xl p-4" style={{ background: ACCENT_SOFT }}>
                            <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: ACCENT }}>
                              <span className="uppercase text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-white/70">{c.trend.type || 'trend'}</span>
                              {c.trend.name}
                            </div>
                            {c.trend.why_now && <p className="mt-1 text-[12.5px] text-[#666]">Why now — {c.trend.why_now}</p>}
                          </div>
                        )}
                        {c.deliverables && (
                          <p className="mt-4 text-[13px] text-[#555]"><span className="font-semibold text-[#333]">Deliverables:</span> {c.deliverables}</p>
                        )}
                        {c.hashtags?.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {c.hashtags.map((h) => (
                              <span key={h} className="text-[12px] px-2 py-0.5 rounded-full border border-[#eee] text-[#888]">{h}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="border-t border-[#f0f0f0] bg-[#fafafc] px-6 md:px-7 py-5">
                        <div className="text-[12px] font-semibold uppercase tracking-wider text-[#999] mb-3">
                          Suggested creators {c.creators?.length ? `(${c.creators.length})` : ''}
                        </div>
                        {c.creators?.length ? (
                          <div className="grid sm:grid-cols-2 gap-2.5">
                            {c.creators.map((cr) => (
                              <div
                                key={cr.username}
                                className="flex items-center gap-3 rounded-2xl bg-white border border-[#eee] px-3.5 py-2.5 hover:border-[#c9bdfb] transition-colors"
                              >
                                <a
                                  href={`https://instagram.com/${cr.username}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-3 min-w-0 flex-1"
                                >
                                  <CreatorAvatar handle={cr.username} name={cr.full_name} pic={cr.profile_pic_url} />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[13.5px] font-semibold text-[#111] truncate">@{cr.username}</div>
                                    <div className="text-[11.5px] text-[#888]">
                                      {fmt(cr.followers)} followers{cr.engagement ? ` · ${cr.engagement.toFixed(1)}% ER` : ''}
                                    </div>
                                  </div>
                                </a>
                                <SaveCreatorButton pipeline={pipeline} creator={cr} compact />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[13px] text-[#888]">No database creators matched yet — use the finder below.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {campaigns && campaigns.length === 0 && !campaignsLoading && !error && (
                <p className="text-[14px] text-[#888]">No campaigns came back. Try refreshing.</p>
              )}
            </section>
          </>
        ) : (
          // Empty workspace: DNA never got mapped (or analysis failed at sign-up).
          // This is the fix for a blank workspace — map the DNA right here.
          <section className="mb-14">
            <div className="rounded-[26px] border border-[#ececff] p-8 md:p-12 text-center" style={{ background: ACCENT_SOFT }}>
              <span
                className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold bg-white border border-[#ececff]"
                style={{ color: ACCENT }}
              >
                One step to a personalised workspace
              </span>
              <h2 className="mt-4 text-2xl md:text-[30px] font-bold tracking-tight text-[#111]">
                Let&apos;s map {session.brand}&apos;s DNA
              </h2>
              <p className="mt-3 text-[15px] text-[#555] max-w-xl mx-auto leading-relaxed">
                We couldn&apos;t find a brand profile for {session.brand} yet, so campaigns, trends and
                creator suggestions are empty. Analyse your brand now and we&apos;ll unlock everything —
                positioning, marketing opportunities, niche trends and ready-to-run campaigns.
              </p>
              <button
                onClick={() => void runDna()}
                disabled={dnaRunning}
                className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white text-[15px] font-semibold disabled:opacity-60"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
              >
                {dnaRunning ? 'Analysing your brand…' : 'Analyse my brand DNA →'}
              </button>
              {dnaError && <p className="mt-4 text-[13px] text-rose-600">{dnaError}</p>}
              <p className="mt-4 text-[12.5px] text-[#999]">
                This takes ~20–40 seconds. You can still use the creator finder above in the meantime.
              </p>
            </div>
          </section>
        )}

        {/* Your pipeline — the creator funnel for this brand */}
        <section className="mb-14">
          <SectionHead
            eyebrow="Your shortlist"
            title={`${session.brand} pipeline`}
            action={
              pipeline.items.length > 0 ? (
                <span className="text-[13px] text-[#888]">{pipeline.items.length} saved</span>
              ) : undefined
            }
          />
          <BrandPipelinePanel pipeline={pipeline} brand={session.brand} category={category} />
        </section>

        {/* Scoped creator discovery — driven by the personalised prompt bar above */}
        <section ref={finderRef}>
          <SectionHead eyebrow="Discover" title={`Find creators for ${session.brand}`} />
          <p className="text-[14px] text-[#666] -mt-2 mb-5 max-w-2xl">
            Pre-scoped to your niche — search within {category || 'your space'} and we&apos;ll rank creators that fit.
          </p>
          <LiveSearch
            initialPrompt={finderPrompt}
            initialMode="db"
            initialBucket="instagram"
            pipeline={pipeline}
            onSearchPrompt={(q) => setQuery(q)}
          />
        </section>
      </main>

      <MarketingFooter />
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
