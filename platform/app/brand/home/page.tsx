'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ACCENT, ACCENT_SOFT, MarketingNav, MarketingFooter } from '@/components/marketing';
import { Doodle, DOODLE_HUES } from '@/components/doodles';
import { LiveSearch } from '@/components/live-search';
import { BrandSwitcher } from '@/components/brand-switcher';
import { BrandPipelinePanel, SaveCreatorButton } from '@/components/brand-pipeline';
import { CreatorAvatar } from '@/components/creator-avatar';
import { PageDoodles } from '@/components/page-doodles';
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
  content_ideas?: string[];
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
  // target_audience is a full descriptive sentence (e.g. "Samsung primarily
  // targets tech-savvy consumers aged 25–45, who are early adopters…"). Distil a
  // short leading clause so the placeholder reads like a real search and stays on
  // one line instead of dumping a paragraph over the search button.
  if (aud) {
    const audSnippet = aud
      .replace(/^[A-Z][a-z]+ (?:primarily |mainly )?(?:targets?|serves?|is aimed at) /i, '')
      .split(/[.;,]/)[0]!
      .trim();
    if (audSnippet) {
      const short = audSnippet.length > 44 ? `${audSnippet.slice(0, 44).trim()}…` : audSnippet;
      ex.push(`Creators reaching ${short}`);
    }
  }
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

  // AI-backed, brand-grounded autocomplete. Debounced so it powers live typing
  // without a call per keystroke; grounded on the brand's DNA so the ideas fit
  // THIS brand. Falls back to the instant local suggestions when the AI list is
  // empty (offline / mid-request / 1–2 chars typed).
  const [aiSug, setAiSug] = useState<string[]>([]);
  const dnaRef = useRef(dna);
  dnaRef.current = dna;
  useEffect(() => {
    const q = value.trim();
    // Skip the network for 1–2 chars (local completions are better there); still
    // fetch brand-native STARTERS when the box is empty and focused.
    if (q.length >= 1 && q.length < 3) {
      setAiSug([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/brand/prompt-suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand, q, dna: dnaRef.current }),
        });
        const d = await r.json().catch(() => ({}));
        if (!cancelled) setAiSug(Array.isArray(d.suggestions) ? d.suggestions.slice(0, 6) : []);
      } catch {
        if (!cancelled) setAiSug([]);
      }
    }, q.length === 0 ? 0 : 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value, brand]);

  const suggestions = aiSug.length > 0 ? aiSug : buildSuggestions(value);
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
    <div className="mt-8 relative w-full text-left">
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
              <div className="pointer-events-none absolute inset-0 flex items-center whitespace-nowrap overflow-hidden text-[17px] text-[#9aa] select-none">
                <span className="min-w-0 truncate">{typed}</span>
                <span className="ii-caret shrink-0" style={{ color: ACCENT }}>|</span>
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
  // Trending TOPICS specifically (the actionable "what to make content about"
  // signal) — surfaced ahead of the mixed format/hashtag chips and clickable
  // straight into a creator search.
  const [topicTrends, setTopicTrends] = useState<Trend[]>([]);
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

      // Trending topics for this niche — the "what to make" signal. Fetched
      // separately (type=topic) so it's guaranteed present and not outranked by
      // high-volume hashtags in the mixed set.
      let topics = firstWord ? await tryFetch(`type=topic&category=${encodeURIComponent(firstWord)}&limit=8`) : [];
      if (topics.length === 0) topics = await tryFetch('type=topic&limit=8');

      if (!cancelled) {
        setTopicTrends(topics);
        // Drop topics from the mixed chips so they aren't shown twice.
        setTrends(rows.filter((t) => t.trend_type !== 'topic'));
      }
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
    <div className="relative isolate overflow-hidden min-h-screen flex flex-col bg-white text-[#111] font-sans">
      <PageDoodles className="-z-10" />
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
              <a
                href="/"
                aria-label="Back to home"
                className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-[#666] hover:text-[#111] px-3 py-2 rounded-lg border border-[#e6e6ef] bg-white hover:border-[#d9d2f7] transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200 group-hover:-translate-x-0.5"><path d="M15 18l-6-6 6-6" /></svg>
                Back
              </a>
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
                clearBrandSession();
                if (isBrand) {
                  // Full log out → back to the role chooser.
                  await logout();
                  window.location.href = '/login';
                } else {
                  // Agency just drops the active brand to pick another.
                  window.location.href = '/brand/login';
                }
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
            {/* Brand DNA profile — laid out like a brand-guidelines deck: a
                numbered section per DNA facet. This is the saved analysis the
                whole workspace personalises from; surfaced here so the brand
                can read (and re-run) it. */}
            {dna && <BrandDnaGuidelines brand={session.brand} dna={dna} />}

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
                    <li key={o} className="group text-[14.5px] text-[#333] flex gap-2.5 leading-relaxed">
                      <span className="mt-0.5 shrink-0 transition-transform duration-200 group-hover:translate-x-1" style={{ color: ACCENT }}>→</span>
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
                      className="flex items-center gap-3 rounded-2xl bg-white border border-[#eee] px-3.5 py-2.5 transition-all duration-200 hover:border-[#c9bdfb] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(108,77,246,0.10)]"
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
            {(topicTrends.length > 0 || trends.length > 0) && (
              <section className="mb-14">
                <SectionHead eyebrow="Stay in the loop" title="Trending in your space" />

                {/* Topics to build on — clickable straight into a creator search */}
                {topicTrends.length > 0 && (
                  <div className="mb-5">
                    <div className="text-[13px] font-semibold text-[#555] mb-2.5">
                      Topics to build a campaign on
                      <span className="ml-1.5 font-normal text-[#aaa]">— tap to find creators already posting about it</span>
                    </div>
                    <div className="flex flex-wrap gap-2.5">
                      {topicTrends.map((t) => {
                        const vel = Math.round(Number(t.velocity) * 100);
                        const rising = Number(t.velocity) > 0.1;
                        return (
                          <button
                            key={`topic-${t.display_name}`}
                            onClick={() => runSearch(t.display_name)}
                            className="group text-left rounded-2xl bg-white border border-[#eee] px-4 py-2.5 shadow-[0_6px_24px_rgba(0,0,0,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#c9bdfb] hover:shadow-[0_12px_34px_rgba(108,77,246,0.12)]"
                          >
                            <div className="flex items-center gap-2">
                              <div className="text-[14px] font-semibold text-[#111] capitalize">{t.display_name}</div>
                              {rising && (
                                <span className="text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: '#e7f8f0', color: '#0f9d6a' }}>
                                  rising
                                </span>
                              )}
                            </div>
                            <div className="text-[12px] text-[#888] capitalize">
                              {t.phase} · {Number.isFinite(vel) ? `${vel >= 0 ? '+' : ''}${vel}%` : 'topic'} · {Number(t.usage_count_7d) || 0} posts/7d
                            </div>
                            <div className="mt-1 text-[11.5px] font-medium opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: ACCENT }}>
                              Find creators →
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {trends.length > 0 && (
                  <>
                    {topicTrends.length > 0 && (
                      <div className="text-[13px] font-semibold text-[#555] mb-2.5">Formats, hashtags & looks gaining momentum</div>
                    )}
                    <div className="flex flex-wrap gap-2.5">
                  {trends.map((t) => {
                    const vel = Math.round(Number(t.velocity) * 100);
                    return (
                      <div
                        key={`${t.trend_type}-${t.display_name}`}
                        className="rounded-2xl bg-white border border-[#eee] px-4 py-2.5 shadow-[0_6px_24px_rgba(0,0,0,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#c9bdfb] hover:shadow-[0_12px_34px_rgba(108,77,246,0.12)]"
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-[14px] font-semibold text-[#111]">{t.display_name}</div>
                          <span className="text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: ACCENT_SOFT, color: ACCENT }}>
                            {t.trend_type === 'visual' ? 'look' : t.trend_type}
                          </span>
                        </div>
                        <div className="text-[12px] text-[#888] capitalize">
                          {t.phase} · {Number.isFinite(vel) ? `${vel >= 0 ? '+' : ''}${vel}%` : t.trend_type} · {Number(t.usage_count_7d) || 0} posts/7d
                        </div>
                      </div>
                    );
                  })}
                    </div>
                  </>
                )}
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
                    <div key={i} className="rounded-[26px] bg-white border border-[#eeeef6] shadow-[0_8px_40px_rgba(0,0,0,0.06)] overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-[#e0d9fb] hover:shadow-[0_20px_60px_rgba(108,77,246,0.12)]">
                      <div className="p-6 md:p-7">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div className="flex items-start gap-3.5 min-w-0">
                            <span
                              className="shrink-0 mt-0.5 w-8 h-8 rounded-xl grid place-items-center text-[13px] font-bold"
                              style={{ background: ACCENT_SOFT, color: ACCENT }}
                            >
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <div className="min-w-0">
                              <h3 className="text-[19px] font-bold tracking-tight text-[#111]">{c.title}</h3>
                              <p className="mt-1.5 text-[14px] text-[#555] leading-relaxed">{c.angle}</p>
                            </div>
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
                          <div className="mt-4 rounded-2xl border border-[#f0f0f0] bg-[#fafafc] px-4 py-3">
                            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#999]">Deliverables</div>
                            <p className="mt-1 text-[13px] text-[#555] leading-relaxed">{c.deliverables}</p>
                          </div>
                        )}
                        {(c.content_ideas?.length ?? 0) > 0 && (
                          <div className="mt-4">
                            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#999] mb-2">Content ideas</div>
                            <ul className="space-y-2">
                              {c.content_ideas!.map((idea, k) => (
                                <li key={k} className="flex gap-2.5 text-[13.5px] text-[#444] leading-relaxed">
                                  <span
                                    className="shrink-0 mt-0.5 w-5 h-5 rounded-full grid place-items-center text-[10.5px] font-bold"
                                    style={{ background: ACCENT_SOFT, color: ACCENT }}
                                  >
                                    {k + 1}
                                  </span>
                                  <span>{idea}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
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
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div className="text-[12px] font-semibold uppercase tracking-wider text-[#999]">
                            Suggested creators {c.creators?.length ? `(${c.creators.length})` : ''}
                          </div>
                          {(c.creator_query || c.title) && (
                            <button
                              onClick={() => runSearch(c.creator_query || c.title)}
                              className="text-[12.5px] font-semibold hover:opacity-80 shrink-0"
                              style={{ color: ACCENT }}
                            >
                              Find creators for this campaign →
                            </button>
                          )}
                        </div>
                        {c.creators?.length ? (
                          <div className="grid sm:grid-cols-2 gap-2.5">
                            {c.creators.map((cr) => (
                              <div
                                key={cr.username}
                                className="flex items-center gap-3 rounded-2xl bg-white border border-[#eee] px-3.5 py-2.5 transition-all duration-200 hover:border-[#c9bdfb] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(108,77,246,0.10)]"
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

        {/* Build & run your own campaigns manually (brand-scoped programs) */}
        <BrandCampaignManager brand={session.brand} />

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
          <SectionHead eyebrow="Discover" title={`Creators for ${session.brand}`} />
          <p className="text-[14px] text-[#666] -mt-2 mb-5 max-w-2xl">
            Ranked from the prompt bar above — searched across AI-suggested handles, your database and live Instagram, pre-scoped to {category || 'your space'}.
          </p>
          <LiveSearch
            initialPrompt={finderPrompt}
            initialMode="db"
            initialBucket="instagram"
            pipeline={pipeline}
            onSearchPrompt={(q) => setQuery(q)}
            hideInput
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

// A campaign is a program the brand runs (recruit creators → pipeline → deals →
// budget). Mirrors the fields the standalone /campaigns manager persists.
interface BrandProgram {
  id: string;
  name: string;
  description: string | null;
  status: string;
  recruit_count: number;
  recruited_count: number;
  budget: number | string | null;
  spent: number | string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

const inr = (v: number | string | null): string => {
  const n = v == null ? 0 : Number(v) || 0;
  return '₹' + (n >= 1e7 ? (n / 1e7).toFixed(1) + 'Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + 'L' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));
};
const fmtDate = (s: string | null): string => {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const campRange = (a: string | null, b: string | null): string | null => {
  if (a && b) return `${fmtDate(a)} – ${fmtDate(b)}`;
  if (a) return `From ${fmtDate(a)}`;
  if (b) return `Until ${fmtDate(b)}`;
  return null;
};
const CAMP_STATUS: Record<string, { t: string; c: string; b: string }> = {
  active: { t: 'Active', c: '#047857', b: '#ecfdf5' },
  paused: { t: 'Paused', c: '#b45309', b: '#fffbeb' },
  closed: { t: 'Closed', c: '#6b7280', b: '#f3f4f6' },
};

// The brand's OWN campaign manager, embedded in the workspace: build a campaign
// by hand (name, brief, requirements, budget, dates) and see the ones already
// running — persisted brand-scoped via /api/programs, the same store the
// standalone /campaigns manager uses. Complements the AI "Campaigns you can run"
// ideas above with a place to actually plan and track real programs.
function BrandCampaignManager({ brand }: { brand: string }) {
  const [programs, setPrograms] = useState<BrandProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', requirements: '', budget: '', start_date: '', end_date: '' });
  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/programs?brand=' + encodeURIComponent(brand));
      const d = await r.json().catch(() => ({}));
      setPrograms(Array.isArray(d.programs) ? d.programs : []);
    } catch {
      /* best-effort — the section just shows empty */
    } finally {
      setLoading(false);
    }
  }, [brand]);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (form.name.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await fetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          requirements: form.requirements.trim() || undefined,
          budget: form.budget ? Number(form.budget) : undefined,
          start_date: form.start_date || undefined,
          end_date: form.end_date || undefined,
        }),
      });
      if (r.ok) {
        setForm({ name: '', description: '', requirements: '', budget: '', start_date: '', end_date: '' });
        setCreating(false);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const active = programs.filter((p) => p.status === 'active').length;
  const spend = programs.reduce((s, p) => s + (Number(p.spent) || 0), 0);
  const cinp = 'w-full px-3 py-2 border border-[#e6e6ef] bg-white text-[14px] text-[#111] rounded-lg focus:outline-none focus:border-[#6C4DF6] transition-colors';

  return (
    <section className="mb-14">
      <SectionHead
        eyebrow="Plan & run"
        title="Campaigns you manage"
        action={
          <div className="flex items-center gap-3">
            <a href="/campaigns" className="text-[13px] font-semibold hover:opacity-80" style={{ color: ACCENT }}>
              Open full manager →
            </a>
            <button
              onClick={() => setCreating((c) => !c)}
              className="text-[13px] font-semibold text-white px-3.5 py-2 rounded-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              {creating ? 'Close' : '+ New campaign'}
            </button>
          </div>
        }
      />
      <p className="text-[14px] text-[#666] -mt-2 mb-5 max-w-2xl">
        Build a campaign by hand and track it end to end — recruit creators, move them through your pipeline, set deals and watch budget. Scoped to {brand}.
      </p>

      {/* Manual create form */}
      {creating && (
        <div className="mb-5 p-5 md:p-6 rounded-[22px] bg-white border border-[#eeeef6] shadow-[0_8px_40px_rgba(0,0,0,0.06)]">
          <div className="text-[13px] font-semibold text-[#111] mb-4">New campaign</div>
          <div className="grid md:grid-cols-2 gap-3.5">
            <CampField label="Campaign name" className="md:col-span-2">
              <input value={form.name} onChange={setF('name')} onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus placeholder="e.g. Festive glow-up with creators" className={cinp} />
            </CampField>
            <CampField label="Brief / goal (optional)" className="md:col-span-2">
              <textarea value={form.description} onChange={setF('description')} rows={2} placeholder={`What's this campaign about? e.g. recruit 10 skincare micro-creators for a ${brand} launch`} className={`${cinp} resize-none`} />
            </CampField>
            <CampField label="Requirements (optional)" className="md:col-span-2">
              <textarea value={form.requirements} onChange={setF('requirements')} rows={3} placeholder="Who & what you need — e.g. 50K–300K followers, ER 2%+, based in Mumbai/Delhi, 1 reel + 2 stories, deliver by the 20th" className={`${cinp} resize-none`} />
            </CampField>
            <CampField label="Budget (₹, optional)">
              <input type="number" value={form.budget} onChange={setF('budget')} placeholder="500000" className={cinp} />
            </CampField>
            <div className="grid grid-cols-2 gap-3.5">
              <CampField label="Start date"><input type="date" value={form.start_date} onChange={setF('start_date')} className={cinp} /></CampField>
              <CampField label="End date"><input type="date" value={form.end_date} onChange={setF('end_date')} className={cinp} /></CampField>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-[13px] text-[#666] hover:text-[#111]">Cancel</button>
            <button
              onClick={create}
              disabled={busy || form.name.trim().length < 2}
              className="px-5 py-2 text-[13px] font-semibold text-white rounded-lg disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
            >
              {busy ? 'Creating…' : 'Create campaign'}
            </button>
          </div>
        </div>
      )}

      {/* Existing campaigns */}
      {loading ? (
        <div className="flex items-center justify-center py-14">
          <div className="w-8 h-8 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
        </div>
      ) : programs.length === 0 ? (
        <div className="text-[14px] text-[#888] py-12 text-center rounded-[22px] border border-dashed border-[#e6e6ef] bg-white">
          No campaigns yet. Hit <span className="font-semibold" style={{ color: ACCENT }}>+ New campaign</span> to build one by hand.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4 text-[12.5px] text-[#666]">
            <span className="px-3 py-1 rounded-full bg-white border border-[#eee]"><b className="text-[#111]">{programs.length}</b> campaigns</span>
            <span className="px-3 py-1 rounded-full bg-white border border-[#eee]"><b className="text-[#111]">{active}</b> active</span>
            <span className="px-3 py-1 rounded-full bg-white border border-[#eee]">Committed spend <b style={{ color: ACCENT }}>{inr(spend)}</b></span>
          </div>
          <div className="space-y-2.5">
            {programs.map((p) => {
              const budget = Number(p.budget) || 0;
              const spent = Number(p.spent) || 0;
              const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
              const over = budget > 0 && spent > budget;
              const st = CAMP_STATUS[p.status] ?? { t: p.status, c: '#6b7280', b: '#f3f4f6' };
              const range = campRange(p.start_date, p.end_date);
              return (
                <a
                  key={p.id}
                  href={`/campaigns/${p.id}`}
                  className="group flex items-center gap-4 px-5 py-4 rounded-2xl bg-white border border-[#eee] transition-all duration-200 hover:border-[#c9bdfb] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(108,77,246,0.10)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-semibold text-[#111] truncate group-hover:text-[#6C4DF6] transition-colors">{p.name}</span>
                      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2 py-0.5 rounded-full" style={{ color: st.c, background: st.b }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.c }} />
                        {st.t}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#888] mt-1 flex items-center gap-2 flex-wrap">
                      {range ? <span className="text-[#666] font-medium">{range}</span> : <span>Created {fmtDate(p.created_at)}</span>}
                      <span className="text-[#ccc]">·</span>
                      <span>{p.recruit_count} creators</span>
                      <span className="text-[#ccc]">·</span>
                      <span className="text-emerald-700">{p.recruited_count} confirmed</span>
                    </div>
                  </div>
                  <div className="hidden sm:block w-40 shrink-0">
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className={over ? 'text-rose-600 font-medium' : 'text-[#444] font-medium'}>{inr(spent)}</span>
                      <span className="text-[#999]">{budget > 0 ? `of ${inr(budget)}` : 'no budget'}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#eef] overflow-hidden">
                      <div className="h-1.5 rounded-full" style={{ width: `${budget > 0 ? pct : 0}%`, background: over ? '#ef4444' : 'linear-gradient(90deg,#6C4DF6,#9b7bff)' }} />
                    </div>
                  </div>
                  <div className="shrink-0 text-[#ccc] group-hover:text-[#6C4DF6] transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                  </div>
                </a>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function CampField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="text-[12px] text-[#888] mb-1 block">{label}</span>
      {children}
    </label>
  );
}

// The Brand DNA profile rendered as a brand-guidelines deck: each populated DNA
// facet becomes its own numbered section (01, 02, …) with a big index numeral,
// a label and either prose or a chip row — mirroring a printed brand book.
function BrandDnaGuidelines({ brand, dna }: { brand: string; dna: BrandDnaProfile }) {
  type Section = { label: string; caption: string } & (
    | { kind: 'text'; value: string }
    | { kind: 'chips'; value: string[] }
  );
  const text = (v?: string | null): string => (typeof v === 'string' ? v.trim() : '');
  const chips = (v?: string[]): string[] => (v ?? []).map((x) => x.trim()).filter(Boolean);

  const raw: (Section | null)[] = [
    text(dna.summary) ? { label: 'Brand story', caption: 'Who they are', kind: 'text', value: text(dna.summary) } : null,
    text(dna.positioning) ? { label: 'Positioning', caption: 'Market stance', kind: 'text', value: text(dna.positioning) } : null,
    text(dna.target_audience) ? { label: 'Audience', caption: 'Who they sell to', kind: 'text', value: text(dna.target_audience) } : null,
    chips(dna.values).length ? { label: 'Values', caption: 'What they stand for', kind: 'chips', value: chips(dna.values) } : null,
    chips(dna.personality).length ? { label: 'Personality', caption: 'Tone & voice', kind: 'chips', value: chips(dna.personality) } : null,
    text(dna.aesthetic) ? { label: 'Aesthetic', caption: 'Look & feel', kind: 'text', value: text(dna.aesthetic) } : null,
    chips(dna.content_pillars).length ? { label: 'Content pillars', caption: 'Recurring themes', kind: 'chips', value: chips(dna.content_pillars) } : null,
    chips(dna.keywords).length ? { label: 'Keywords', caption: 'Discovery terms', kind: 'chips', value: chips(dna.keywords) } : null,
    chips(dna.creator_archetypes).length ? { label: 'Creator fit', caption: 'Who to work with', kind: 'chips', value: chips(dna.creator_archetypes) } : null,
    chips(dna.competitors).length ? { label: 'Competitors', caption: 'Peers & rivals', kind: 'chips', value: chips(dna.competitors) } : null,
  ];
  const sections = raw.filter((s): s is Section => s !== null);

  // Playful per-card accents + hand-drawn doodles (shared set) so the "brand
  // book" feels alive rather than a static spec sheet. Each card cycles a hue.
  const HUES = DOODLE_HUES;

  const gridRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) { setShown(true); io.disconnect(); } },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className="mb-14">
      <style>{`
        .ii-dna-card { opacity: 0; transform: translateY(16px); }
        .ii-dna-card.ii-in { opacity: 1; transform: none; transition: opacity .55s cubic-bezier(.22,1,.36,1), transform .55s cubic-bezier(.22,1,.36,1); }
        @media (prefers-reduced-motion: reduce) { .ii-dna-card { opacity: 1; transform: none; } }
      `}</style>
      <SectionHead
        eyebrow="Brand DNA"
        title={`${brand} brand guidelines`}
        action={
          <a href="/brand-dna" className="text-[13px] font-semibold hover:opacity-80" style={{ color: ACCENT }}>
            Re-analyse →
          </a>
        }
      />
      <div className="rounded-[26px] overflow-hidden border border-[#eeeef6] shadow-[0_8px_40px_rgba(0,0,0,0.06)] bg-white">
        {/* Cover band with floating doodles */}
        <div className="relative overflow-hidden px-6 md:px-8 py-8 border-b border-[#f0f0f0]" style={{ background: ACCENT_SOFT }}>
          <Doodle shape={0} color="#6C4DF6" className="ii-floatr pointer-events-none absolute right-8 top-5 h-9 w-9 opacity-70" style={{ ['--r' as string]: '12deg', animationDelay: '0s' }} />
          <Doodle shape={1} color="#EC4899" className="ii-floatr pointer-events-none absolute right-24 top-10 h-6 w-6 opacity-60" style={{ ['--r' as string]: '-8deg', animationDelay: '1.2s' }} />
          <Doodle shape={2} color="#8B5CF6" className="ii-floatr pointer-events-none absolute right-1 bottom-3 h-16 w-16 opacity-40" style={{ ['--r' as string]: '6deg', animationDelay: '.6s' }} />
          <Doodle shape={7} color="#F59E0B" className="ii-floatr pointer-events-none absolute left-1 -bottom-2 h-14 w-14 opacity-30" style={{ ['--r' as string]: '-14deg', animationDelay: '2s' }} />
          <div className="relative">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: ACCENT }}>Brand guidelines</div>
            <h3 className="mt-1 text-[26px] md:text-[30px] font-bold tracking-tight text-[#111]">{brand}</h3>
            {text(dna.category) && <p className="mt-1 text-[14px] text-[#555] capitalize">{text(dna.category)}</p>}
          </div>
        </div>
        {/* Numbered sections */}
        <div ref={gridRef} className="grid sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s, i) => {
            const hue = HUES[i % HUES.length]!;
            return (
              <div
                key={s.label}
                className={`ii-dna-card group relative overflow-hidden p-6 md:p-7 border-b border-[#f2f2f7] sm:[&:nth-child(2n)]:border-l lg:[&:nth-child(2n)]:border-l-0 lg:[&:not(:nth-child(3n+1))]:border-l border-[#f2f2f7] transition-colors duration-200 hover:bg-[#faf9ff]${shown ? ' ii-in' : ''}`}
                style={{ transitionDelay: shown ? `${i * 55}ms` : '0ms' }}
              >
                {/* growing accent bar */}
                <span className="absolute left-0 top-7 bottom-7 w-[3px] rounded-full origin-top scale-y-0 opacity-0 transition-all duration-300 group-hover:scale-y-100 group-hover:opacity-100" style={{ background: hue }} />
                {/* corner doodle */}
                <Doodle shape={i} color={hue} className="pointer-events-none absolute right-5 top-5 h-7 w-7 opacity-25 transition-all duration-300 group-hover:opacity-90 group-hover:rotate-12 group-hover:scale-110" />
                <div className="text-[34px] font-bold leading-none tabular-nums opacity-30 transition-all duration-200 group-hover:opacity-70" style={{ color: hue }}>
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div className="mt-3 text-[14px] font-bold text-[#111]">{s.label}</div>
                <div className="text-[11.5px] text-[#999] mb-2.5">{s.caption}</div>
                {s.kind === 'text' ? (
                  <p className="text-[13.5px] text-[#444] leading-relaxed">{s.value}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {s.value.map((v) => (
                      <span
                        key={v}
                        className="text-[12px] px-2.5 py-1 rounded-full border border-[#ececf6] bg-[#fafafc] text-[#555] capitalize cursor-default transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                        style={{ ['--h' as string]: hue }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = hue; e.currentTarget.style.color = hue; e.currentTarget.style.background = hue + '12'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#ececf6'; e.currentTarget.style.color = '#555'; e.currentTarget.style.background = '#fafafc'; }}
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
