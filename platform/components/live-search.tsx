'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildSuggestions } from '@/lib/suggestions';
import { brandSafety } from '@/lib/creator-metrics';

const ACCENT = '#6C4DF6';
const ACCENT_SOFT = '#F4F2FF';

interface LiveProfile {
  username: string;
  full_name: string;
  biography: string;
  category: string;
  followers: number;
  is_private: boolean;
  is_verified: boolean;
  profile_pic_url: string | null;
  score: number;
  engagement?: number;
  email?: string | null;
  phone?: string | null;
  link?: string | null;
  creator_id?: string;
  from?: 'db' | 'live';
  loc_match?: boolean;
  curated?: boolean;
  gender?: 'female' | 'male' | 'unknown' | null;
}

interface Program {
  id: string;
  name: string;
}

// A creator the user pinned to revisit — persisted client-side so finds aren't
// lost while pivoting through the similar-creators discovery graph. Works for
// live-crawled creators too (which have no creator_id for campaign recruiting).
interface SavedCreator {
  username: string;
  full_name: string;
  followers: number;
  profile_pic_url: string | null;
  category?: string;
  email?: string | null;
  phone?: string | null;
  biography?: string;
  engagement?: number | null;
}

interface ProfileData {
  handle: string;
  full_name: string;
  biography: string;
  category: string;
  followers: number;
  following: number;
  posts: number;
  is_verified: boolean;
  is_private: boolean;
  profile_pic_url: string | null;
  external_url: string | null;
  email: string | null;
  phone: string | null;
  recent: { shortcode: string; thumbnail: string | null; likes: number; comments: number; is_video: boolean; taken_at: number | null; caption: string }[];
  related?: { handle: string; full_name: string; is_verified: boolean; profile_pic_url: string | null }[];
  collabs?: { handle: string; count: number }[];
  sponsored_posts?: number;
  engagement?: number | null;
  source?: 'db' | 'live' | 'db_cached' | 'pending';
  refreshing?: boolean;
  last_scraped_at?: string | null;
}

interface RunResponse {
  prompt: string;
  tokens: string[];
  seeds: string[];
  results: LiveProfile[];
  persisted: number;
  resolved_from_names?: Array<{ name: string; handle: string; followers: number }>;
  auto_seeds?: Array<{ handle: string; followers: number }>;
  from_db?: number;
  from_live?: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Compact Indian-rupee format for sponsored-post rates (₹1.2L, ₹45K, ₹800).
function inr(n: number): string {
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(n >= 10_00_000 ? 0 : 1)}L`;
  if (n >= 1_000) return `₹${Math.round(n / 1_000)}K`;
  return `₹${Math.round(n / 100) * 100}`;
}

// Rising star = a modest-sized creator punching well above their tier's
// engagement floor — the kind worth signing before they get expensive.
function isRisingStar(followers: number, engagement: number | null): boolean {
  if (engagement == null || followers <= 0) return false;
  return followers < 250_000 && engagement >= expectedErFloor(followers) * 1.6;
}

function tierWord(f: number): string {
  return f >= 1_000_000 ? 'Mega' : f >= 500_000 ? 'Macro' : f >= 100_000 ? 'Mid-tier' : f >= 10_000 ? 'Micro' : 'Nano';
}

// A scannable one-line "persona pitch" assembled from the data we already have:
// who they are, engagement health, ballpark rate, cadence and reachability.
function personaLine(
  p: { followers: number; category?: string; email?: string | null; phone?: string | null },
  engagement: number | null,
  rate: { low: number; high: number } | null,
  cadence: string | null,
  themes: string[],
): string {
  const tier = tierWord(p.followers);
  const niche = p.category?.trim();
  const who = niche
    ? `${tier} ${niche.toLowerCase()}`
    : themes[0]
      ? `${tier} ${themes[0].replace(/^#/, '')} creator`
      : `${tier} creator`;
  const parts = [who];
  if (engagement != null) parts.push(`${engagement}% ER ${engagement >= expectedErFloor(p.followers) ? '(healthy)' : '(low)'}`);
  if (rate) parts.push(`~${inr(rate.low)}–${inr(rate.high)}/post`);
  if (cadence) parts.push(cadence.toLowerCase());
  if (isRisingStar(p.followers, engagement)) parts.push('on the rise');
  if (p.email) parts.push('email on file');
  else if (p.phone) parts.push('phone on file');
  return parts.join(' · ');
}

// Lightweight follower-growth tracking via localStorage. We snapshot followers
// on each profile view; on a later view we can show the delta since first seen.
interface GrowthSnap { f: number; t: number }
function readGrowth(handle: string): GrowthSnap[] {
  try {
    const all = JSON.parse(localStorage.getItem('ii_growth') ?? '{}');
    return Array.isArray(all[handle.toLowerCase()]) ? all[handle.toLowerCase()] : [];
  } catch {
    return [];
  }
}
function recordGrowth(handle: string, followers: number): void {
  if (followers <= 0) return;
  try {
    const all = JSON.parse(localStorage.getItem('ii_growth') ?? '{}');
    const key = handle.toLowerCase();
    const list: GrowthSnap[] = Array.isArray(all[key]) ? all[key] : [];
    const last = list[list.length - 1];
    // Skip if we already logged this count within the last 12h (avoid noise).
    if (last && last.f === followers && Date.now() - last.t < 12 * 3_600_000) return;
    list.push({ f: followers, t: Date.now() });
    all[key] = list.slice(-8); // keep recent history
    localStorage.setItem('ii_growth', JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

// Rough sponsored-post rate range (single IG in-feed post, India market).
// Rate-per-1k-followers tapers as audiences scale; healthy engagement commands
// a premium, weak engagement a discount. Heuristic — a starting point, not a quote.
function estimatedRate(
  followers: number,
  engagement: number | null,
): { low: number; high: number } | null {
  if (followers < 500) return null;
  const per1k =
    followers >= 500_000 ? [300, 600]
    : followers >= 100_000 ? [400, 750]
    : followers >= 50_000 ? [500, 900]
    : [600, 1100];
  const floor = expectedErFloor(followers);
  const factor =
    engagement == null ? 1 : engagement >= floor * 1.5 ? 1.25 : engagement >= floor ? 1.1 : 0.8;
  const k = followers / 1000;
  return { low: Math.round(k * per1k[0]! * factor), high: Math.round(k * per1k[1]! * factor) };
}

// Rough authenticity read: engagement that's far below the healthy floor for a
// creator's follower tier is a fake-follower warning sign. null = unknown ER.
function expectedErFloor(followers: number): number {
  if (followers >= 1_000_000) return 0.7;
  if (followers >= 100_000) return 1.0;
  if (followers >= 10_000) return 1.5;
  return 2.0;
}
function authenticityFlag(followers: number, engagement?: number): 'healthy' | 'low' | null {
  if (!engagement || engagement <= 0) return null;
  return engagement >= expectedErFloor(followers) ? 'healthy' : 'low';
}

interface AuthFactor { key: string; label: string; value: number; detail: string }
interface AuthReport { score: number; band: 'Strong' | 'Moderate' | 'Caution'; color: string; verdict: string; factors: AuthFactor[]; perPost: number[] }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Authenticity score: a transparent composite of four signals you can actually
// see in public data — real engagement vs the size benchmark, genuine comment
// activity (not just likes), consistency across recent posts (bot spikes are
// erratic), and a healthy follower/following ratio (mass-following is a red
// flag). Each factor is 0-100 with a plain-English reason, so the number is
// explainable rather than a black box.
function authenticityReport(
  profile: ProfileData,
  engagement: number | null,
): AuthReport | null {
  const recent = profile.recent ?? [];
  if (recent.length < 1 || profile.followers <= 0) return null;
  const followers = profile.followers;
  const floor = expectedErFloor(followers);

  // Per-post engagement rate (%) — the series behind the consistency chart.
  const perPost = recent.map((p) => ((p.likes + p.comments) / followers) * 100);
  const er = engagement ?? (perPost.reduce((s, x) => s + x, 0) / perPost.length);

  // 1) Engagement strength vs the expected floor for this follower tier.
  const ratio = er / floor;
  const engScore = clamp(ratio * 50, 8, 100);

  // 2) Comment quality — comments per 100 likes. Bought likes rarely come with
  //    proportional comments, so genuine discussion signals a real audience.
  const totalLikes = recent.reduce((s, p) => s + p.likes, 0);
  const totalComments = recent.reduce((s, p) => s + p.comments, 0);
  const cpl = (totalComments / Math.max(1, totalLikes)) * 100;
  const commentScore = clamp(20 + cpl * 30, 5, 100);

  // 3) Consistency — coefficient of variation of per-post ER. Real reach is
  //    steady; sudden isolated spikes hint at boosted/bot activity.
  const mean = perPost.reduce((s, x) => s + x, 0) / perPost.length;
  const sd = Math.sqrt(perPost.reduce((s, x) => s + (x - mean) ** 2, 0) / perPost.length);
  const cv = mean > 0 ? sd / mean : 1;
  const consistencyScore = clamp(100 - cv * 120, 5, 100);

  // 4) Follower/following ratio — accounts that follow huge numbers back often
  //    have inflated, low-quality audiences.
  const fr = profile.following / Math.max(1, followers);
  const ratioScore = clamp(100 - fr * 70, 15, 98);

  const score = Math.round(engScore * 0.4 + commentScore * 0.25 + consistencyScore * 0.2 + ratioScore * 0.15);
  const band: AuthReport['band'] = score >= 75 ? 'Strong' : score >= 55 ? 'Moderate' : 'Caution';
  const color = band === 'Strong' ? '#059669' : band === 'Moderate' ? '#b45309' : '#dc2626';
  const verdict =
    band === 'Strong'
      ? 'Signals point to a real, engaged audience — safe to shortlist.'
      : band === 'Moderate'
        ? 'Mostly healthy, with one or two signals worth a manual check.'
        : 'Several signals look off — verify the audience before committing budget.';

  const factors: AuthFactor[] = [
    {
      key: 'engagement',
      label: 'Engagement strength',
      value: Math.round(engScore),
      detail: `${er.toFixed(1)}% engagement vs ~${floor}% expected at ${fmt(followers)} followers — ${ratio >= 1 ? 'above' : 'below'} benchmark.`,
    },
    {
      key: 'comments',
      label: 'Comment quality',
      value: Math.round(commentScore),
      detail: `${cpl.toFixed(1)} comments per 100 likes — ${cpl >= 1 ? 'genuine conversation, not just passive likes.' : 'light on comments relative to likes.'}`,
    },
    {
      key: 'consistency',
      label: 'Consistency',
      value: Math.round(consistencyScore),
      detail: cv <= 0.4 ? 'Engagement is steady across recent posts.' : 'Engagement swings a lot post-to-post — worth a look.',
    },
    {
      key: 'ratio',
      label: 'Audience ratio',
      value: Math.round(ratioScore),
      detail: `Follows ${fmt(profile.following)} vs ${fmt(followers)} followers — ${fr <= 0.3 ? 'healthy ratio.' : 'follows back heavily, can dilute audience quality.'}`,
    },
  ];

  return { score, band, color, verdict, factors, perPost };
}

// ── Brand fit ──────────────────────────────────────────────────────────────
// Score how well a creator matches a brand brief, from public signals only:
// how much their bio / captions / themes overlap the brief (relevance), whether
// engagement is healthy for their size, how authentic the audience looks, and
// whether recent posts are brand-safe. A live competitor collab applies a
// penalty. Every factor carries a plain-English reason, so the % is explainable.
const FIT_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'our', 'your', 'who', 'are', 'was', 'will', 'can', 'has', 'have', 'had', 'not', 'but', 'all', 'any', 'out', 'use', 'want', 'need', 'looking', 'look', 'find', 'creators', 'creator', 'influencer', 'influencers', 'content', 'brand', 'brands', 'campaign', 'someone', 'people', 'they', 'their', 'them', 'about', 'into', 'over', 'more', 'most', 'very', 'really', 'good', 'great', 'best', 'top', 'new', 'india', 'indian', 'instagram', 'reel', 'reels', 'post', 'posts', 'who', 'whose']);

function fitKeywords(brief: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of brief.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 3 || FIT_STOPWORDS.has(raw) || /^\d+$/.test(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out.slice(0, 12);
}

interface FitFactor { key: string; label: string; value: number; detail: string }
interface FitReport { score: number; band: 'Strong fit' | 'Possible fit' | 'Weak fit'; color: string; verdict: string; factors: FitFactor[]; matched: string[]; missed: string[] }

function brandFit(profile: ProfileData, engagement: number | null, brief: string, blacklistHits: { brand: string }[]): FitReport | null {
  const kws = fitKeywords(brief);
  if (kws.length === 0) return null;

  const haystack = [
    profile.full_name, profile.biography, profile.category,
    contentThemes(profile.recent, 20).join(' '),
    ...profile.recent.map((p) => p.caption ?? ''),
  ].join(' ').toLowerCase();

  const matched = kws.filter((k) => haystack.includes(k));
  const missed = kws.filter((k) => !haystack.includes(k));
  const nicheScore = clamp(Math.round((matched.length / kws.length) * 100), matched.length ? 25 : 4, 100);

  const floor = expectedErFloor(profile.followers);
  const erScore = engagement && engagement > 0 ? clamp(Math.round((engagement / floor) * 55), 18, 100) : 50;

  const auth = authenticityReport(profile, engagement);
  const authScore = auth ? auth.score : 60;

  const safety = brandSafety([profile.biography ?? '', ...profile.recent.map((p) => p.caption ?? '')]);
  const safetyScore = safety.level === 'clean' ? 100 : safety.level === 'review' ? 55 : 18;

  let score = Math.round(nicheScore * 0.42 + erScore * 0.23 + authScore * 0.2 + safetyScore * 0.15);
  const conflict = blacklistHits.length > 0;
  if (conflict) score = Math.max(0, score - 18);
  score = clamp(score, 0, 100);

  const band: FitReport['band'] = score >= 72 ? 'Strong fit' : score >= 52 ? 'Possible fit' : 'Weak fit';
  const color = band === 'Strong fit' ? '#059669' : band === 'Possible fit' ? '#b45309' : '#dc2626';
  const verdict =
    band === 'Strong fit' ? 'Strong match on relevance and audience quality — shortlist with confidence.'
      : band === 'Possible fit' ? 'Partial match — workable with the right angle; mind the gaps below.'
        : 'Limited overlap with the brief — there are likely better fits.';

  const factors: FitFactor[] = [
    { key: 'niche', label: 'Brief relevance', value: nicheScore, detail: matched.length ? `Matches ${matched.length}/${kws.length} brief terms: ${matched.slice(0, 6).join(', ')}.` : 'No brief terms appear in their bio, captions or themes.' },
    { key: 'er', label: 'Engagement fit', value: erScore, detail: engagement && engagement > 0 ? `${engagement}% ER vs ~${floor}% expected at this follower size.` : 'Engagement unknown — hit “Refresh live” to pull it.' },
    { key: 'auth', label: 'Audience authenticity', value: authScore, detail: auth ? `${auth.band} authenticity signals from recent posts.` : 'Not enough recent posts to assess.' },
    { key: 'safety', label: 'Brand safety', value: safetyScore, detail: safety.level === 'clean' ? 'No risk flags in recent posts.' : `Flagged: ${safety.hits.map((h) => h.category).join(', ')}.` },
  ];
  if (conflict) factors.push({ key: 'conflict', label: 'Competitor conflict', value: 15, detail: `Recently collaborated with ${blacklistHits.map((h) => h.brand).join(', ')} — score penalised.` });

  return { score, band, color, verdict, factors, matched, missed };
}

// Lightweight fit for a search-results row: the full Brand Fit card needs recent
// posts (captions/themes), which list rows don't carry — so here we score
// relevance from the bio/name/category against the brief, plus engagement fit.
// It's the quick, sortable read; the drawer recomputes the full version.
function listFit(p: { full_name?: string; biography?: string; category?: string; followers: number; engagement?: number | null }, briefKws: string[]): number | null {
  if (briefKws.length === 0) return null;
  const hay = `${p.full_name ?? ''} ${p.biography ?? ''} ${p.category ?? ''}`.toLowerCase();
  const matched = briefKws.filter((k) => hay.includes(k)).length;
  const rel = clamp(Math.round((matched / briefKws.length) * 100), matched ? 25 : 6, 100);
  const er = p.engagement ?? 0;
  if (er <= 0) return rel; // no engagement scraped yet — relevance only
  const erScore = clamp(Math.round((er / expectedErFloor(p.followers)) * 55), 18, 100);
  return clamp(Math.round(rel * 0.68 + erScore * 0.32), 0, 100);
}

// Posting rhythm from recent-post timestamps + engagement. IG timestamps are
// UTC; we read them in IST (UTC+5:30) since the audience is India-first. Returns
// posts/week, the highest-engagement weekday, and a 3-hour best-time window.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function postingInsight(
  recent: { likes: number; comments: number; taken_at: number | null }[],
): { cadence: string; bestDay: string; bestWindow: string } | null {
  const ts = recent.filter((p) => p.taken_at && p.taken_at > 0);
  if (ts.length < 3) return null;

  const times = ts.map((p) => p.taken_at!).sort((a, b) => b - a);
  const spanDays = (times[0]! - times[times.length - 1]!) / 86_400;
  const perWeek = spanDays > 0 ? (times.length - 1) / (spanDays / 7) : 0;
  const cadence =
    perWeek >= 6 ? 'Posts daily'
    : perWeek >= 1 ? `~${Math.round(perWeek)}× / week`
    : `~${Math.max(1, Math.round(perWeek * 4))}× / month`;

  // IST = UTC + 5h30m → shift seconds before reading day/hour in UTC fields.
  const dayEng = new Array(7).fill(0);
  const hourEng = new Array(24).fill(0);
  for (const p of ts) {
    const d = new Date((p.taken_at! + 5.5 * 3600) * 1000);
    const eng = p.likes + p.comments;
    dayEng[d.getUTCDay()] += eng;
    hourEng[d.getUTCHours()] += eng;
  }
  const bestDayIdx = dayEng.indexOf(Math.max(...dayEng));
  const bestHour = hourEng.indexOf(Math.max(...hourEng));
  const fmtHr = (h: number) => {
    const hh = ((h + 24) % 24);
    const ampm = hh < 12 ? 'am' : 'pm';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}${ampm}`;
  };
  return {
    cadence,
    bestDay: DAYS[bestDayIdx]!,
    bestWindow: `${fmtHr(bestHour - 1)}–${fmtHr(bestHour + 2)} IST`,
  };
}

// Content themes: the hashtags a creator leans on most across recent captions —
// a quick read on what they actually post about, for brand-fit judgement.
function contentThemes(
  recent: { caption: string }[],
  limit = 6,
): string[] {
  const counts = new Map<string, number>();
  for (const p of recent) {
    const tags = p.caption?.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    for (const raw of tags) {
      const tag = raw.toLowerCase();
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

// Competitor brands to blacklist against. A creator who has tagged/mentioned
// one of these in a recent post is likely under a conflicting collaboration —
// flag them so they aren't approached while that overlap is live.
const COMPETITOR_BRANDS: { name: string; terms: string[] }[] = [
  { name: 'Myntra', terms: ['myntra'] },
  { name: 'Zara', terms: ['zara'] },
  { name: 'Max Fashion', terms: ['maxfashion', 'max fashion'] },
  { name: 'Pantaloons', terms: ['pantaloons'] },
  { name: 'Unique Loom', terms: ['uniqueloom', 'unique loom'] },
  { name: 'Ajio', terms: ['ajio'] },
  { name: 'Westside', terms: ['westside'] },
];

const BLACKLIST_WINDOW_DAYS = 30;

// Scan recent posts (within the blacklist window) for competitor mentions.
// Extra brand terms (comma-separated names/handles) can be supplied by the user.
function competitorConflicts(
  recent: { caption: string; taken_at: number | null; shortcode: string }[],
  extraTerms: string[] = [],
): { brand: string; daysAgo: number; shortcode: string }[] {
  const nowSec = Date.now() / 1000;
  const windowSec = BLACKLIST_WINDOW_DAYS * 86_400;
  const brands = [
    ...COMPETITOR_BRANDS,
    ...extraTerms.map((t) => ({ name: t, terms: [t.toLowerCase()] })),
  ];
  const hits: { brand: string; daysAgo: number; shortcode: string }[] = [];
  for (const p of recent) {
    if (!p.caption || !p.taken_at) continue;
    if (nowSec - p.taken_at > windowSec) continue; // older than the window
    const cap = p.caption.toLowerCase();
    for (const b of brands) {
      if (b.terms.some((t) => t && cap.includes(t))) {
        hits.push({ brand: b.name, daysAgo: Math.max(0, Math.round((nowSec - p.taken_at) / 86_400)), shortcode: p.shortcode });
        break;
      }
    }
  }
  // De-dupe by brand, keep the most recent.
  const byBrand = new Map<string, { brand: string; daysAgo: number; shortcode: string }>();
  for (const h of hits) {
    const ex = byBrand.get(h.brand);
    if (!ex || h.daysAgo < ex.daysAgo) byBrand.set(h.brand, h);
  }
  return [...byBrand.values()].sort((a, b) => a.daysAgo - b.daysAgo);
}

// Split the start-from field into exact handles vs names to resolve.
// Comma-separated; an entry with an internal space is treated as a name
// (e.g. "mridul sharma"), otherwise as an @handle.
// Click-to-send links: WhatsApp prefilled (Indian numbers default to +91) and
// a mailto with the draft as the body.
function waLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '');
  const withCc = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCc}?text=${encodeURIComponent(text)}`;
}
function mailLink(email: string, text: string): string {
  return `mailto:${email}?subject=${encodeURIComponent('Collaboration with you')}&body=${encodeURIComponent(text)}`;
}

function parseSeedInput(raw: string): { seeds: string[]; names: string[] } {
  const seeds: string[] = [];
  const names: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim().replace(/^@/, '');
    if (!entry) continue;
    if (/\s/.test(entry)) names.push(entry);
    else if (/^[a-z0-9._]+$/i.test(entry)) seeds.push(entry.toLowerCase());
    else names.push(entry);
  }
  return { seeds, names };
}

export function LiveSearch({
  initialPrompt = '',
  initialSeed = '',
  initialMode = 'crawl',
  onSearchPrompt,
}: {
  initialPrompt?: string;
  initialSeed?: string;
  initialMode?: 'db' | 'live' | 'crawl';
  // When set (the Lander), a new search pushes the prompt to the URL instead of
  // searching in-place — so browser back/forward navigates between searches and
  // returning restores the last one. Unset (Scraper) → search in place.
  onSearchPrompt?: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [seedText, setSeedText] = useState(initialSeed);
  const [needSeed, setNeedSeed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunResponse | null>(null);
  // worker live-crawl: true while we poll the search_query job for new creators
  const [crawling, setCrawling] = useState(false);
  const crawlRun = useRef(0); // bumped per search so stale polls self-cancel
  const [exporting, setExporting] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  // result filters / sort
  const [minFollowers, setMinFollowers] = useState(0);
  const [maxFollowers, setMaxFollowers] = useState(0);
  const [minER, setMinER] = useState(0);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [healthyOnly, setHealthyOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'relevance' | 'followers_desc' | 'followers_asc' | 'engagement' | 'fit'>('relevance');
  // Lander source toggle: 'instagram' = real creators from the browser scraper,
  // 'trends' = creators uploaded from the campaign Excel sheets.
  const [sourceBucket, setSourceBucket] = useState<'instagram' | 'trends'>('instagram');
  // Per-bucket result cache so toggling Instagram ↔ Trends and back RESTORES the
  // exact list you already saw instead of re-searching (the DB search re-ranks,
  // so a re-run returned a different/mixed list). Reset on a fresh prompt search.
  const bucketCache = useRef<Record<'instagram' | 'trends', RunResponse | null>>({ instagram: null, trends: null });
  // Lander creator-gender filter: 'any' | 'female' | 'male'.
  const [genderFilter, setGenderFilter] = useState<'any' | 'female' | 'male'>('any');
  // shortlist / recruit
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState('');
  const [recruited, setRecruited] = useState<Record<string, string>>({});
  const [recruiting, setRecruiting] = useState<string | null>(null);
  // outreach draft modal
  const [draftFor, setDraftFor] = useState<LiveProfile | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftChannel, setDraftChannel] = useState<'dm' | 'email'>('dm');
  const [draftLang, setDraftLang] = useState<'auto' | 'english' | 'hinglish' | 'hindi'>('auto');
  const [draftFollowup, setDraftFollowup] = useState(false);
  const [copied, setCopied] = useState(false);
  // bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // bulk outreach drafts
  const [bulkDraft, setBulkDraft] = useState<{ username: string; message: string; phone?: string | null; email?: string | null }[] | null>(null);
  const [bulkDraftLoading, setBulkDraftLoading] = useState(false);
  const [bulkChannel, setBulkChannel] = useState<'dm' | 'email'>('dm');
  const [bulkCopied, setBulkCopied] = useState(false);
  // creator profile drawer
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileRefreshing, setProfileRefreshing] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  // Measure the results-table viewport so the inline profile drawer can be
  // pinned to the left and sized to the visible width — keeping it fully on
  // screen instead of clipped inside the table's horizontal scroll.
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [drawerW, setDrawerW] = useState(0);
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setDrawerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileFor]);
  // Lazy live-enrichment of result rows: fresh stats stream in as rows scroll
  // into view (via /api/ig-stats), keeping the initial search instant.
  const [liveStats, setLiveStats] = useState<Record<string, { followers?: number; engagement?: number; profile_pic_url?: string | null }>>({});
  const enrichingRef = useRef<Set<string>>(new Set());
  const rowObserverRef = useRef<IntersectionObserver | null>(null);

  async function enrichRow(handle: string) {
    const key = handle.toLowerCase();
    if (enrichingRef.current.has(key)) return;
    enrichingRef.current.add(key);
    try {
      const d = await fetch(`/api/ig-stats?handle=${encodeURIComponent(handle)}`).then((r) => r.json());
      if (d && !d.error) {
        const patch: { followers?: number; engagement?: number; profile_pic_url?: string | null } = {};
        if (d.followers != null) patch.followers = d.followers;
        if (d.engagement != null) patch.engagement = d.engagement;
        if (d.profile_pic_url) patch.profile_pic_url = d.profile_pic_url;
        setLiveStats((s) => ({ ...s, [handle]: patch }));
      } else {
        enrichingRef.current.delete(key); // let it retry on the next scroll
      }
    } catch {
      enrichingRef.current.delete(key);
    }
  }

  function rowObserver(): IntersectionObserver {
    if (!rowObserverRef.current && typeof IntersectionObserver !== 'undefined') {
      rowObserverRef.current = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              const h = (e.target as HTMLElement).dataset.handle;
              if (h) void enrichRow(h);
              rowObserverRef.current?.unobserve(e.target);
            }
          }
        },
        { rootMargin: '300px' },
      );
    }
    return rowObserverRef.current!;
  }

  // New search → clear cached stats so the fresh result set re-enriches.
  useEffect(() => {
    setLiveStats({});
    enrichingRef.current = new Set();
  }, [run]);
  useEffect(() => () => rowObserverRef.current?.disconnect(), []);
  // outreach "contacted" tracking (localStorage) — handle -> first-contacted ms
  const [contacted, setContacted] = useState<Record<string, number>>({});
  const [hideContacted, setHideContacted] = useState(false);
  // When an ER-based filter is active, eagerly enrich every result (not just the
  // rows scrolled into view) so the filter has real engagement to act on. ER
  // isn't returned at search time, so without this the filter would see mostly
  // zeros. enrichRow de-dupes via enrichingRef, so this is safe to re-run.
  useEffect(() => {
    if (!run || (minER === 0 && !healthyOnly)) return;
    for (const p of run.results.slice(0, 60)) {
      if (!(p.username in liveStats)) void enrichRow(p.username);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, minER, healthyOnly]);
  // follow-up nudges: handles marked as done/replied, + the queue panel
  const [followupDone, setFollowupDone] = useState<string[]>([]);
  const [showFollowups, setShowFollowups] = useState(false);
  const FOLLOWUP_DAYS = 3;
  const isContacted = (h: string) => h.toLowerCase() in contacted;
  // pinned creators that persist across searches (localStorage)
  const [savedCreators, setSavedCreators] = useState<SavedCreator[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [shortlistBrief, setShortlistBrief] = useState('');
  // side-by-side compare
  const [compareSel, setCompareSel] = useState<Set<string>>(new Set());
  const [compareFor, setCompareFor] = useState<string[] | null>(null);
  const [compareData, setCompareData] = useState<Record<string, ProfileData | null>>({});
  const [compareLoading, setCompareLoading] = useState(false);

  function toggleCompare(handle: string) {
    setCompareSel((s) => {
      const n = new Set(s);
      if (n.has(handle)) n.delete(handle);
      else if (n.size < 4) n.add(handle);
      return n;
    });
  }

  async function openCompare() {
    const handles = [...compareSel];
    if (handles.length < 2) return;
    setCompareFor(handles);
    setShowSaved(false);
    setCompareLoading(true);
    setCompareData({});
    try {
      const entries = await Promise.all(
        handles.map(async (h) => {
          try {
            const d = await fetch(`/api/ig-profile?handle=${encodeURIComponent(h)}`).then((r) => r.json());
            return [h, d.error ? null : (d as ProfileData)] as const;
          } catch {
            return [h, null] as const;
          }
        }),
      );
      setCompareData(Object.fromEntries(entries));
    } finally {
      setCompareLoading(false);
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ii_contacted');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Migrate the old array-of-handles format to { handle: timestamp }.
        if (Array.isArray(parsed)) {
          const now = Date.now();
          setContacted(Object.fromEntries(parsed.map((h: string) => [h, now])));
        } else if (parsed && typeof parsed === 'object') {
          setContacted(parsed);
        }
      }
      const rawSaved = localStorage.getItem('ii_saved_creators');
      if (rawSaved) setSavedCreators(JSON.parse(rawSaved));
      const rawDone = localStorage.getItem('ii_followups_done');
      if (rawDone) setFollowupDone(JSON.parse(rawDone));
    } catch { /* ignore */ }
  }, []);

  function markFollowupDone(handle: string) {
    setFollowupDone((list) => {
      const next = list.includes(handle.toLowerCase()) ? list : [...list, handle.toLowerCase()];
      try { localStorage.setItem('ii_followups_done', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // Contacted > FOLLOWUP_DAYS ago and not yet marked done → a nudge is due.
  const dueFollowups = Object.entries(contacted)
    .filter(([h, ts]) => Date.now() - ts > FOLLOWUP_DAYS * 86_400_000 && !followupDone.includes(h))
    .sort((a, b) => a[1] - b[1])
    .map(([handle, ts]) => ({ handle, ts }));

  function openFollowup(handle: string) {
    setShowFollowups(false);
    void openDraft({ username: handle } as LiveProfile, 'dm', draftLang, true);
  }

  const isSaved = (u: string) => savedCreators.some((s) => s.username.toLowerCase() === u.toLowerCase());

  function toggleSaved(p: LiveProfile) {
    setSavedCreators((list) => {
      const exists = list.some((s) => s.username.toLowerCase() === p.username.toLowerCase());
      const next = exists
        ? list.filter((s) => s.username.toLowerCase() !== p.username.toLowerCase())
        : [{ username: p.username, full_name: p.full_name, followers: p.followers, profile_pic_url: p.profile_pic_url, category: p.category, email: p.email, phone: p.phone, biography: p.biography, engagement: liveStats[p.username]?.engagement ?? p.engagement ?? null }, ...list];
      try { localStorage.setItem('ii_saved_creators', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function clearSaved() {
    setSavedCreators([]);
    try { localStorage.removeItem('ii_saved_creators'); } catch { /* ignore */ }
  }

  function markContacted(handle: string) {
    setContacted((s) => {
      const key = handle.toLowerCase();
      if (key in s) return s; // keep the first-contacted time
      const n = { ...s, [key]: Date.now() };
      try { localStorage.setItem('ii_contacted', JSON.stringify(n)); } catch { /* ignore */ }
      return n;
    });
  }

  async function openProfile(handle: string) {
    if (profileFor === handle) {
      setProfileFor(null); // toggle closed
      return;
    }
    setProfileFor(handle);
    setProfile(null);
    setProfileError(null);
    setProfileLoading(true);
    try {
      const d = await fetch(`/api/ig-profile?handle=${encodeURIComponent(handle)}`).then((r) => r.json());
      if (d && !d.error) {
        setProfile(d as ProfileData);
        // Data is stale/missing → the worker was queued to (re)scrape it. Poll
        // the DB until the worker writes fresh data, then swap it in.
        if (d.refreshing) void pollWorkerRefresh(handle, d.last_scraped_at ?? null);
      } else setProfileError('live');
    } catch {
      setProfileError('live');
    } finally {
      setProfileLoading(false);
    }
  }

  // After the worker is queued to scrape a handle, poll /api/ig-profile until
  // last_scraped_at advances (the worker wrote fresh data), then update the open
  // drawer in place. Self-cancels if the user opens a different profile.
  async function pollWorkerRefresh(handle: string, since: string | null) {
    const sinceT = since ? new Date(since).getTime() : 0;
    // ~3 min budget — the worker scrapes at a human pace and may be working
    // through a queue before it re-scrapes this handle.
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if (profileFor !== handle) return; // user moved on
      try {
        const d = await fetch(`/api/ig-profile?handle=${encodeURIComponent(handle)}&_t=${Date.now()}`).then((r) => r.json());
        const t = d?.last_scraped_at ? new Date(d.last_scraped_at).getTime() : 0;
        if (d && !d.error && t > sinceT) {
          if (profileFor === handle) setProfile(d as ProfileData);
          return;
        }
      } catch {
        /* keep polling */
      }
    }
  }

  // Force the browser worker to re-scrape this profile, then poll until it
  // writes fresh data and swap it into the open drawer (no live IG call from the
  // server). Needs the worker running on the laptop.
  async function refreshProfile() {
    const handle = profileFor;
    if (!handle || profileRefreshing) return;
    setProfileRefreshing(true);
    try {
      const d = await fetch(`/api/ig-profile?handle=${encodeURIComponent(handle)}&force=1&_t=${Date.now()}`).then((r) => r.json());
      if (d && !d.error) { setProfile(d as ProfileData); setProfileError(null); }
      void pollWorkerRefresh(handle, d?.last_scraped_at ?? null);
    } catch {
      /* keep the existing data on a failed refresh */
    } finally {
      setProfileRefreshing(false);
    }
  }
  // recently searched — auto-tracked in localStorage, most-recent-first, capped.
  const RECENT_MAX = 10;
  const [recent, setRecent] = useState<string[]>([]);
  const autoRan = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ii_recent_searches');
      if (raw) setRecent(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Record a query as recently-searched (deduped, newest first, capped). Called
  // automatically on every real search.
  function addRecent(p: string) {
    const t = p.trim();
    if (t.length < 2 || t.startsWith('Similar to @')) return;
    setRecent((list) => {
      const next = [t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_MAX);
      try { localStorage.setItem('ii_recent_searches', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function removeRecent(p: string) {
    setRecent((list) => {
      const next = list.filter((x) => x !== p);
      try { localStorage.setItem('ii_recent_searches', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function runRecent(p: string) {
    setPrompt(p);
    setSelected(new Set());
    if (onSearchPrompt) { onSearchPrompt(p); return; } // Lander → URL-drives it
    void search({ promptOverride: p });
  }

  function toggleSelect(username: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(username)) n.delete(username);
      else n.add(username);
      return n;
    });
  }

  async function openDraft(p: LiveProfile, channel: 'dm' | 'email' = 'dm', lang: 'auto' | 'english' | 'hinglish' | 'hindi' = draftLang, followup = false) {
    setDraftFor(p);
    setDraftChannel(channel);
    setDraftLang(lang);
    setDraftFollowup(followup);
    setDraftText('');
    setCopied(false);
    setDraftLoading(true);
    try {
      const d = await fetch('/api/discover-live/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: p.username, prompt: run?.prompt, category: p.category, channel, language: lang, followup }),
      }).then((r) => r.json());
      setDraftText(d.message ?? d.error ?? 'Could not generate a message.');
    } catch (err) {
      setDraftText((err as Error).message);
    } finally {
      setDraftLoading(false);
    }
  }

  useEffect(() => {
    fetch('/api/programs')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.programs)) {
          setPrograms(d.programs);
          setProgramId((cur) => cur || d.programs[0]?.id || '');
        }
      })
      .catch(() => {});
  }, []);

  // Resolve the campaign to recruit into — creating one inline if needed.
  async function ensureProgram(): Promise<string | null> {
    let pid = programId;
    if (pid === '__new__' || !pid) {
      const name = window.prompt('New campaign name');
      if (!name?.trim()) return null;
      try {
        const d = await fetch('/api/programs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), source_prompt: run?.prompt }),
        }).then((r) => r.json());
        if (!d.program?.id) return null;
        setPrograms((ps) => [d.program, ...ps]);
        pid = d.program.id;
        setProgramId(pid);
      } catch {
        return null;
      }
    }
    return pid;
  }

  async function recruitOne(pid: string, p: LiveProfile) {
    if (!p.creator_id) return;
    await fetch(`/api/programs/${pid}/recruits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: p.creator_id, source_prompt: run?.prompt, relevance_score: p.score }),
    });
    setRecruited((m) => ({ ...m, [p.creator_id!]: pid }));
  }

  async function addToShortlist(p: LiveProfile) {
    if (!p.creator_id || recruiting) return;
    const pid = await ensureProgram();
    if (!pid) return;
    setRecruiting(p.creator_id);
    try {
      await recruitOne(pid, p);
    } finally {
      setRecruiting(null);
    }
  }

  async function bulkAdd() {
    const targets = shown.filter(
      (p) => selected.has(p.username) && p.creator_id && !recruited[p.creator_id],
    );
    if (targets.length === 0) return;
    const pid = await ensureProgram();
    if (!pid) return;
    setBulkBusy(true);
    try {
      for (const p of targets) {
        try { await recruitOne(pid, p); } catch { /* skip one, keep going */ }
      }
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  }

  async function runBulkDraft(
    targets: { username: string; category?: string; phone?: string | null; email?: string | null }[],
    channel: 'dm' | 'email',
  ) {
    const list = targets.slice(0, 20);
    if (list.length === 0) return;
    setShowSaved(false);
    setBulkChannel(channel);
    setBulkCopied(false);
    setBulkDraft(list.map((p) => ({ username: p.username, message: '', phone: p.phone, email: p.email })));
    setBulkDraftLoading(true);
    try {
      const results = await Promise.all(
        list.map(async (p) => {
          try {
            const d = await fetch('/api/discover-live/outreach', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ handle: p.username, prompt: run?.prompt, category: p.category, channel }),
            }).then((r) => r.json());
            return { username: p.username, message: d.message ?? d.error ?? '', phone: p.phone, email: p.email };
          } catch {
            return { username: p.username, message: '', phone: p.phone, email: p.email };
          }
        }),
      );
      setBulkDraft(results);
    } finally {
      setBulkDraftLoading(false);
    }
  }

  async function openBulkDraft(channel: 'dm' | 'email' = 'dm') {
    await runBulkDraft(shown.filter((p) => selected.has(p.username)), channel);
  }

  const suggestions = buildSuggestions(prompt);
  const sugOpen = showSug && suggestions.length > 0;

  // Brief = the search prompt; drives the "Fit" column for the whole list.
  const briefKws = fitKeywords(run?.prompt ?? '');
  // Score against the row merged with any lazily-scraped live stats, so Fit
  // sharpens as engagement streams in.
  const fitOf = (p: LiveProfile) => listFit({ ...p, ...(liveStats[p.username] ?? {}) }, briefKws) ?? -1;
  const erOf = (p: LiveProfile) => liveStats[p.username]?.engagement ?? p.engagement ?? 0;
  // Quality nudge for the default Relevance sort: DEMOTE creators whose live ER
  // is below the healthy floor for their size — so a perfectly keyword-matched
  // but dead-engagement account doesn't top the list. It only ever pushes down,
  // never up: boosting healthy accounts would let a big high-ER profile jump
  // over the server's location/curated ranking (e.g. a 17M celeb leaping above
  // genuine local creators). ER ≈ 0 only penalises once we've actually scraped
  // the creator — an enriched 0% ER is a real dead-audience signal; an un-scraped
  // 0 is just unknown, so it gets no adjustment and first paint stays in order.
  const qualityAdjust = (p: LiveProfile) => {
    const ls = liveStats[p.username];
    const scraped = ls?.engagement != null; // we've pulled live stats for them
    const er = ls?.engagement ?? p.engagement ?? 0;
    const known = scraped || er > 0;
    if (!known) return 0; // ER unknown — don't move them
    if (er <= 0) return -1.5; // scraped and ~0% ER → fake/dead audience, demote hard
    const ratio = er / expectedErFloor(p.followers);
    return ratio >= 1 ? 0 : clamp((ratio - 1) * 1.5, -1.5, 0); // healthy → no boost; low → demote
  };

  const shown = (() => {
    if (!run) return [] as LiveProfile[];
    const filtered = run.results.filter((p) => {
      // Filter on the live-enriched stats where available, falling back to the
      // search-time values. ER arrives lazily, so treat unknown ER as "keep"
      // (don't hide a creator just because we haven't scraped them yet) — the
      // list converges as enrichment streams in.
      const ls = liveStats[p.username];
      const followers = ls?.followers ?? p.followers;
      const er = ls?.engagement ?? p.engagement;
      const erKnown = er != null && er > 0;
      return (
        followers >= minFollowers &&
        (maxFollowers === 0 || followers <= maxFollowers) &&
        (minER === 0 || !erKnown || er >= minER) &&
        (!verifiedOnly || p.is_verified) &&
        (!healthyOnly || authenticityFlag(followers, er ?? undefined) !== 'low') &&
        (genderFilter === 'any' || p.gender === genderFilter) &&
        (!hideContacted || !isContacted(p.username))
      );
    });
    const sorted = [...filtered];
    if (sortBy === 'followers_desc') sorted.sort((a, b) => b.followers - a.followers);
    else if (sortBy === 'followers_asc') sorted.sort((a, b) => a.followers - b.followers);
    else if (sortBy === 'engagement') sorted.sort((a, b) => erOf(b) - erOf(a));
    else if (sortBy === 'fit') sorted.sort((a, b) => fitOf(b) - fitOf(a));
    else {
      // 'relevance' — mirror the server's ranking hierarchy so the quality nudge
      // can't cross the important boundaries: location matches lead, then the
      // user's curated creators (within the location bucket), and ONLY inside
      // that bucket do we apply the ER nudge + text score. Without this, a
      // curated local creator with low live ER would get demoted below a
      // healthy-ER mega-celeb, undoing the location/curated ranking.
      const baseOrder = new Map(run.results.map((p, i) => [p.username, i]));
      sorted.sort((a, b) => {
        const am = a.loc_match ? 0 : 1, bm = b.loc_match ? 0 : 1;
        if (am !== bm) return am - bm;
        if (a.loc_match && b.loc_match) {
          const ac = a.curated ? 0 : 1, bc = b.curated ? 0 : 1;
          if (ac !== bc) return ac - bc;
        }
        const d = (b.score + qualityAdjust(b)) - (a.score + qualityAdjust(a));
        if (Math.abs(d) > 0.001) return d;
        return (baseOrder.get(a.username) ?? 0) - (baseOrder.get(b.username) ?? 0);
      });
    }
    return sorted;
  })();

  // Tier boundary: on a location search (relevance sort), the exact city+niche
  // matches lead (loc_match) and the niche-related creators follow — insert a
  // divider between them. Only when there's a genuine mix of both.
  const exactMatchCount = shown.filter((p) => p.loc_match).length;
  const showTierDivider = sortBy === 'relevance' && exactMatchCount > 0 && exactMatchCount < shown.length;

  function pickSuggestion(s: string) {
    setPrompt(s);
    setShowSug(false);
    setActiveIdx(-1);
  }

  // One search: a username crawls Instagram live; otherwise search the database.
  function runSearch() {
    setShowSug(false); // close the autocomplete dropdown on every search
    setActiveIdx(-1);
    // On the Lander, push the prompt to the URL so browser back/forward navigates
    // between searches (the URL-watching effect re-runs the search). Elsewhere
    // (Scraper) search in place — the host drives the live browser-worker crawl.
    const p = prompt.trim();
    if (onSearchPrompt && p.length >= 2) { onSearchPrompt(p); return; }
    void search({ mode: initialMode });
  }

  // "More like this" — AI lookalikes. Uses the creator's content embedding (or
  // one generated from their bio/niche/captions) to find the most semantically
  // similar creators in the database via vector search.
  async function findSimilar(p: LiveProfile) {
    setSeedText('');
    setSelected(new Set());
    setLoading(true);
    setError(null);
    setNeedSeed(false);
    setProfileFor(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const r = await fetch(`/api/similar?handle=${encodeURIComponent(p.username)}&max=30`);
      const d = await r.json();
      if (!r.ok) {
        setError(d.message ?? d.error ?? 'Could not find similar creators.');
        setRun(null);
      } else {
        setRun({
          prompt: `Similar to @${p.username}`,
          tokens: [], seeds: [], results: (d.results ?? []) as LiveProfile[],
          persisted: 0, resolved_from_names: [], auto_seeds: [],
        } as RunResponse);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Arriving from the home page with a prompt → run once (seed optional; the
  // server self-seeds from the prompt when no handle/name is given).
  useEffect(() => {
    // URL-driven host (Lander): (re)run whenever the prompt in the URL changes,
    // so browser back/forward restores each search. Other hosts (Scraper) run
    // once on mount.
    if (onSearchPrompt) {
      const p = initialPrompt.trim();
      if (p.length >= 2 || initialSeed.trim().length >= 2) {
        setPrompt(initialPrompt);
        void search({ mode: initialMode, promptOverride: initialPrompt, seedOverride: initialMode === 'db' ? '' : (initialSeed || undefined) });
      }
      return;
    }
    if (autoRan.current) return;
    if (initialPrompt.trim().length >= 2 || initialSeed.trim().length >= 2) {
      autoRan.current = true;
      void search({ mode: initialMode, seedOverride: initialMode === 'db' ? '' : undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, initialSeed]);

  async function search(opts?: { promptOverride?: string; seedOverride?: string; mode?: 'db' | 'live' | 'crawl'; bucketOverride?: 'instagram' | 'trends'; genderOverride?: 'any' | 'female' | 'male' }) {
    const typedPrompt = (opts?.promptOverride ?? prompt).trim();
    const { seeds, names } = parseSeedInput(opts?.seedOverride ?? seedText);
    const mode = opts?.mode ?? 'crawl';
    // The server needs a prompt for ranking; for a bare username crawl, fall back
    // to the handle/name so we never invent a keyword the user didn't type.
    const p = typedPrompt.length >= 2 ? typedPrompt : (seeds[0] ?? names[0] ?? '');
    if (p.length < 2) return;

    // A fresh user search (not a bucket toggle) invalidates the cached buckets
    // and gets recorded as recently-searched.
    if (!opts?.bucketOverride) {
      bucketCache.current = { instagram: null, trends: null };
      addRecent(p);
    }

    // Worker-backed crawl: enqueue a search_query job, show instant DB matches,
    // then poll for the creators the worker tags as it crawls Instagram.
    if (mode === 'crawl') {
      crawlRun.current += 1; // cancel any in-flight poll from a previous search
      setLoading(true);
      setError(null);
      setNeedSeed(false);
      try {
        const r = await fetch('/api/crawl-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: p }),
        });
        const d = await r.json();
        if (!r.ok) {
          setError(d.message ?? d.error ?? 'Search failed');
          setRun(null);
          return;
        }
        const initial = (d.results ?? []) as LiveProfile[];
        setRun({
          prompt: p,
          tokens: (d.tokens ?? []) as string[],
          seeds: [],
          results: initial,
          persisted: 0,
          resolved_from_names: [],
          auto_seeds: [],
        } as RunResponse);
        if (d.job_id) void pollCrawl(d.job_id as string, initial);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setError(null);
    setNeedSeed(false);
    try {
      const r = await fetch('/api/discover-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify((() => {
          const g = opts?.genderOverride ?? genderFilter;
          return { prompt: p, seeds, names, mode, bucket: opts?.bucketOverride ?? sourceBucket, gender: g === 'any' ? undefined : g };
        })()),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.error === 'no_seeds') setNeedSeed(true);
        else setError(d.message ?? d.error ?? 'Search failed');
        setRun(null);
      } else {
        setRun(d as RunResponse);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Poll the worker search job, merging newly-tagged creators into the results
  // as they're discovered. Self-cancels when a newer search starts (crawlRun) or
  // when the job finishes / a time budget is hit.
  async function pollCrawl(jobId: string, initial: LiveProfile[]) {
    const my = crawlRun.current;
    setCrawling(true);
    const seen = new Set(initial.map((x) => x.username.toLowerCase()));
    const merged = [...initial];
    try {
      // ~4 min budget — the worker scrapes at a human pace, so results land over
      // a minute or two rather than instantly.
      for (let i = 0; i < 80; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        if (crawlRun.current !== my) return; // a newer search superseded us
        let d: { status?: string; done?: boolean; results?: LiveProfile[] };
        try {
          const r = await fetch(`/api/crawl-search/status?id=${encodeURIComponent(jobId)}`);
          d = await r.json();
        } catch {
          continue;
        }
        let changed = false;
        for (const c of d.results ?? []) {
          const k = c.username.toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            merged.push(c);
            changed = true;
          }
        }
        if (changed && crawlRun.current === my) {
          setRun((prev) => (prev ? { ...prev, results: [...merged] } : prev));
        }
        if (d.done) break;
      }
    } finally {
      if (crawlRun.current === my) setCrawling(false);
    }
  }

  async function downloadExcel(rows?: LiveProfile[]) {
    if (!run) return;
    const results = rows && rows.length > 0 ? rows : shown;
    setExporting(true);
    try {
      const r = await fetch('/api/discover-live/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: run.prompt, results }),
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${run.prompt.replace(/[^a-z0-9]+/gi, '_').slice(0, 40) || 'search'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function exportSaved() {
    if (savedCreators.length === 0) return;
    setExporting(true);
    try {
      const r = await fetch('/api/discover-live/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'saved_creators', results: savedCreators }),
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'saved_creators.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="w-full">
      {/* search box */}
      <div className="rounded-2xl bg-white border-2 border-[#e3def9] p-4 shadow-[0_12px_50px_rgba(108,77,246,0.12)] focus-within:border-[#6C4DF6] transition-colors">
        {/* prompt + database-search magnifier (above the line) */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setShowSug(true);
                setActiveIdx(-1);
              }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 120)}
              onKeyDown={(e) => {
                if (sugOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault();
                  setActiveIdx((i) => {
                    const n = suggestions.length;
                    return e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
                  });
                  return;
                }
                if (e.key === 'Escape') {
                  setShowSug(false);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  setShowSug(false);
                  runSearch();
                }
              }}
              rows={1}
              placeholder="Describe who you're looking for — e.g. nagpur fashion creators"
              className="w-full resize-none text-[16px] text-[#222] placeholder-[#9aa] focus:outline-none bg-transparent"
            />
            {sugOpen && (
              <div className="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl bg-white border border-[#ececec] shadow-[0_16px_50px_rgba(0,0,0,0.12)] overflow-hidden">
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => pickSuggestion(s)}
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
            onClick={runSearch}
            disabled={loading || prompt.trim().length < 2}
            aria-label="Search"
            title="Search"
            className="w-12 h-12 rounded-full grid place-items-center text-white shadow-md shrink-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:brightness-105 disabled:opacity-50 disabled:translate-y-0 disabled:shadow-md"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
          >
            {loading ? (
              <span className="w-5 h-5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            )}
          </button>
        </div>
      </div>

      {/* recently searched — auto-tracked, click to re-run, × to forget */}
      {recent.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[#999]">Recent:</span>
          {recent.map((p) => (
            <span key={p} className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full border border-[#e3def9] bg-white text-[12px]">
              <button onClick={() => runRecent(p)} className="hover:underline" style={{ color: ACCENT }} title="Search again">
                {p}
              </button>
              <button
                onClick={() => removeRecent(p)}
                className="w-4 h-4 grid place-items-center rounded-full text-[#bbb] hover:text-[#666] hover:bg-[#f3f3f3]"
                title="Remove"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* no-seed nudge (only when auto-seeding also found nothing) */}
      {needSeed && (
        <div className="mt-3 px-4 py-3 rounded-lg border border-[#e3def9] bg-[#faf9ff] text-[14px] text-[#444]">
          Couldn’t auto-find a starting point for that prompt.{' '}
          <span className="font-medium text-[#222]">Do you know anyone in this space?</span> Add a
          name (e.g. <span className="font-mono">mridul sharma</span>) or an @handle above and we’ll
          start from there.
        </div>
      )}

      {/* starting points: typed-name matches and/or auto-found seeds */}
      {run && !loading && (() => {
        const fromNames = (run.resolved_from_names ?? []).map((m) => ({
          handle: m.handle,
          followers: m.followers,
        }));
        const starts = [...fromNames, ...(run.auto_seeds ?? [])];
        if (starts.length === 0) return null;
        const label = fromNames.length > 0 ? 'Matched to' : 'Auto-found starting points';
        return (
          <div className="mt-3 px-4 py-2.5 rounded-lg border border-[#e3def9] bg-[#faf9ff] text-[13px] text-[#555]">
            {label}:{' '}
            {starts.map((m, i) => (
              <span key={m.handle}>
                {i > 0 && ', '}
                <a
                  href={`https://instagram.com/${m.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                  style={{ color: ACCENT }}
                >
                  @{m.handle}
                </a>{' '}
                <span className="text-[#999]">({fmt(m.followers)})</span>
              </span>
            ))}
          </div>
        );
      })()}

      {/* Instagram / Trends toggle — always visible on the Lander after a search,
          INCLUDING the empty/error state, so you can switch buckets even when the
          current one returned 0 (previously it lived inside the results block and
          vanished, stranding you on an empty bucket). */}
      {!loading && (run || error) && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* source bucket — Lander (db) only */}
          {initialMode === 'db' && (
            <div className="inline-flex rounded-xl border border-[#e3def9] bg-[#faf9ff] p-1">
              {([['instagram', 'Instagram'], ['trends', 'Trends']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => {
                    if (sourceBucket === val) return;
                    // Snapshot the list you're leaving, so returning restores it exactly.
                    bucketCache.current[sourceBucket] = run;
                    const cached = bucketCache.current[val];
                    setSourceBucket(val);
                    if (cached) { setRun(cached); setError(null); return; } // restore — no re-search, no mix-up
                    void search({ mode: 'db', bucketOverride: val, promptOverride: run?.prompt ?? prompt });
                  }}
                  className="px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all"
                  style={sourceBucket === val
                    ? { background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)`, color: '#fff' }
                    : { color: '#777', background: 'transparent' }}
                  title={val === 'instagram' ? 'Real creators discovered from Instagram by the scraper' : 'Creators uploaded from your campaign Excel sheets'}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {/* creator gender — both Lander and Scraper (client-side filter) */}
          <div className="inline-flex rounded-xl border border-[#e3def9] bg-[#faf9ff] p-1">
            {([['any', 'All'], ['female', 'Female'], ['male', 'Male']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setGenderFilter(val)}
                className="px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all"
                style={genderFilter === val
                  ? { background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)`, color: '#fff' }
                  : { color: '#777', background: 'transparent' }}
                title="Filter by the creator's gender (labeled from name/bio)"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 px-4 py-3 rounded-lg border border-rose-300 bg-rose-50 text-[14px] text-rose-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-10 flex flex-col items-center justify-center">
          <div className="w-10 h-10 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
          <div className="mt-3 text-[13px] text-[#888]">Finding starting points & crawling Instagram…</div>
        </div>
      )}

      {/* results table */}
      {run && !loading && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[14px] text-[#555]">
              <span className="font-semibold text-[#111]">{shown.length}</span>
              {shown.length !== run.results.length && <span className="text-[#999]">/{run.results.length}</span>} profiles for{' '}
              <span className="font-medium text-[#111]">“{run.prompt}”</span>
              {crawling && (
                <span className="ml-2 inline-flex items-center gap-1.5 text-[12px] text-[#9b7bff]">
                  <span className="w-3 h-3 rounded-full border-2 border-[#d9d2f7] border-t-[#9b7bff] animate-spin" />
                  crawling Instagram…
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void downloadExcel()}
                disabled={exporting || shown.length === 0}
                className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-[#e3def9] hover:bg-[#faf9ff] disabled:opacity-50"
                style={{ color: ACCENT }}
              >
                {exporting ? 'Preparing…' : '⬇ Download Excel'}
              </button>
            </div>
          </div>

          {/* filters + sort */}
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="inline-flex items-center gap-1">
              <select
                value={minFollowers}
                onChange={(e) => setMinFollowers(Number(e.target.value))}
                className={`px-2.5 py-1.5 rounded-lg border bg-white focus:outline-none focus:border-[#6C4DF6] ${minFollowers !== 0 ? 'border-[#6C4DF6] text-[#6C4DF6] font-medium' : 'border-[#e3def9]'}`}
              >
                <option value={0}>Any followers</option>
                <option value={1000}>1K+</option>
                <option value={5000}>5K+</option>
                <option value={10000}>10K+</option>
                <option value={100000}>100K+</option>
                <option value={1000000}>1M+</option>
              </select>
              {minFollowers !== 0 && (
                <button onClick={() => setMinFollowers(0)} className="w-4 h-4 grid place-items-center rounded-full text-[#c9b9ff] hover:text-rose-600 hover:bg-rose-50 text-[13px] leading-none" title="Clear this filter">×</button>
              )}
            </span>
            <span className="inline-flex items-center gap-1">
              <select
                value={maxFollowers}
                onChange={(e) => setMaxFollowers(Number(e.target.value))}
                className={`px-2.5 py-1.5 rounded-lg border bg-white focus:outline-none focus:border-[#6C4DF6] ${maxFollowers !== 0 ? 'border-[#6C4DF6] text-[#6C4DF6] font-medium' : 'border-[#e3def9]'}`}
                title="Cap follower count — useful for finding micro / nano creators"
              >
                <option value={0}>No max</option>
                <option value={10000}>Under 10K</option>
                <option value={50000}>Under 50K</option>
                <option value={100000}>Under 100K</option>
                <option value={500000}>Under 500K</option>
                <option value={1000000}>Under 1M</option>
              </select>
              {maxFollowers !== 0 && (
                <button onClick={() => setMaxFollowers(0)} className="w-4 h-4 grid place-items-center rounded-full text-[#c9b9ff] hover:text-rose-600 hover:bg-rose-50 text-[13px] leading-none" title="Clear this filter">×</button>
              )}
            </span>
            <span className="inline-flex items-center gap-1">
              <select
                value={minER}
                onChange={(e) => setMinER(Number(e.target.value))}
                className={`px-2.5 py-1.5 rounded-lg border bg-white focus:outline-none focus:border-[#6C4DF6] ${minER !== 0 ? 'border-[#6C4DF6] text-[#6C4DF6] font-medium' : 'border-[#e3def9]'}`}
                title="Minimum engagement rate"
              >
                <option value={0}>Any ER</option>
                <option value={1}>1%+ ER</option>
                <option value={2}>2%+ ER</option>
                <option value={3}>3%+ ER</option>
                <option value={5}>5%+ ER</option>
                <option value={8}>8%+ ER</option>
              </select>
              {minER !== 0 && (
                <button onClick={() => setMinER(0)} className="w-4 h-4 grid place-items-center rounded-full text-[#c9b9ff] hover:text-rose-600 hover:bg-rose-50 text-[13px] leading-none" title="Clear this filter">×</button>
              )}
            </span>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white cursor-pointer select-none">
              <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="accent-[#6C4DF6]" />
              Verified only
            </label>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white cursor-pointer select-none" title="Hide profiles whose engagement is suspiciously low for their size">
              <input type="checkbox" checked={healthyOnly} onChange={(e) => setHealthyOnly(e.target.checked)} className="accent-[#6C4DF6]" />
              Healthy eng. only
            </label>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white cursor-pointer select-none" title="Hide creators you've already reached out to">
              <input type="checkbox" checked={hideContacted} onChange={(e) => setHideContacted(e.target.checked)} className="accent-[#6C4DF6]" />
              Hide contacted
            </label>
            {(minFollowers !== 0 || maxFollowers !== 0 || minER !== 0 || verifiedOnly || healthyOnly || hideContacted || genderFilter !== 'any') && (
              <button
                onClick={() => {
                  setMinFollowers(0); setMaxFollowers(0); setMinER(0);
                  setVerifiedOnly(false); setHealthyOnly(false); setHideContacted(false);
                  setGenderFilter('any');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors"
                title="Clear all filters"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                Clear filters
              </button>
            )}
            <span className="ml-auto text-[#999]">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white focus:outline-none focus:border-[#6C4DF6]"
            >
              <option value="relevance">Relevance</option>
              <option value="fit">Brand fit</option>
              <option value="followers_desc">Followers: high → low</option>
              <option value="followers_asc">Followers: low → high</option>
              <option value="engagement">Engagement</option>
            </select>
            <span className="text-[#999]">·</span>
            <span className="text-[#999]">Add to</span>
            <select
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] bg-white focus:outline-none focus:border-[#6C4DF6] max-w-[160px]"
            >
              {programs.length === 0 && <option value="">No campaigns yet</option>}
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="__new__">＋ New campaign…</option>
            </select>
          </div>

          {/* bulk action bar */}
          {selected.size > 0 && (
            <div className="mb-3 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#f6f4ff] border border-[#e3def9] text-[13px]">
              <span className="font-medium text-[#111]">{selected.size} selected</span>
              <button
                onClick={() => void bulkAdd()}
                disabled={bulkBusy}
                className="px-3 py-1.5 rounded-lg text-white font-semibold disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                {bulkBusy ? 'Adding…' : `Add ${selected.size} to campaign`}
              </button>
              <button
                onClick={() => void openBulkDraft('dm')}
                className="px-3 py-1.5 rounded-lg font-semibold border border-[#e3def9] hover:bg-white"
                style={{ color: ACCENT }}
              >
                ✦ Draft outreach
              </button>
              <button
                onClick={() => void downloadExcel(shown.filter((p) => selected.has(p.username)))}
                disabled={exporting}
                className="px-3 py-1.5 rounded-lg font-semibold border border-[#e3def9] hover:bg-white disabled:opacity-50"
                style={{ color: ACCENT }}
              >
                {exporting ? 'Preparing…' : '⬇ Export selected'}
              </button>
              <button onClick={() => setSelected(new Set())} className="text-[#666] hover:text-[#111]">Clear</button>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="px-4 py-10 text-center text-[14px] text-[#888] border border-[#eee] rounded-xl">
              {crawling ? (
                <span className="inline-flex items-center gap-2 text-[#9b7bff]">
                  <span className="w-4 h-4 rounded-full border-2 border-[#d9d2f7] border-t-[#9b7bff] animate-spin" />
                  Crawling Instagram for fresh creators… new profiles appear here as the worker finds them.
                </span>
              ) : run.results.length === 0
                ? initialMode === 'db'
                  ? 'Nothing in the database matches that yet — try a broader search.'
                  : 'No creators found for that yet. Make sure the worker is running, or try a broader prompt.'
                : 'No profiles match these filters. Loosen them to see more.'}
            </div>
          ) : (
            <div ref={tableWrapRef} className="overflow-x-auto rounded-xl border border-[#eee]">
              <table className="w-full text-left border-collapse [&_th]:px-2 [&_td]:px-2">
                <thead>
                  <tr className="bg-[#faf9ff] text-[12px] uppercase tracking-wider text-[#888]">
                    <th className="px-3 py-2.5 w-8">
                      <input
                        type="checkbox"
                        className="accent-[#6C4DF6]"
                        checked={shown.length > 0 && shown.every((p) => selected.has(p.username))}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(shown.map((p) => p.username)) : new Set())
                        }
                      />
                    </th>
                    <th className="px-3 py-2.5 font-medium w-10">#</th>
                    <th className="px-3 py-2.5 font-medium">Creator</th>
                    <th className="px-3 py-2.5 font-medium">Category</th>
                    <th className="px-3 py-2.5 font-medium text-right">Followers</th>
                    <th className="px-3 py-2.5 font-medium text-right">Eng.</th>
                    <th className="px-3 py-2.5 font-medium text-center" title="How well each creator matches your search brief — relevance + engagement. Open a profile for the full breakdown.">Fit</th>
                    <th className="px-3 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3f3f3]">
                  {shown.map((pRaw, i) => {
                    // Merge any lazily-scraped live stats over the DB row.
                    const live = liveStats[pRaw.username];
                    const p = live ? { ...pRaw, ...live } : pRaw;
                    return (
                    <Fragment key={p.username}>
                    {showTierDivider && i === exactMatchCount && (
                      <tr>
                        <td colSpan={8} className="px-3 pt-5 pb-2">
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9b7bff] whitespace-nowrap">Also relevant to this niche</span>
                            <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, #e3def9, transparent)' }} />
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr
                      data-handle={p.username}
                      ref={(el) => { if (el) rowObserver().observe(el); }}
                      className={`hover:bg-[#fafaff] ${selected.has(p.username) || profileFor === p.username ? 'bg-[#faf9ff]' : ''}`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          className="accent-[#6C4DF6]"
                          checked={selected.has(p.username)}
                          onChange={() => toggleSelect(p.username)}
                        />
                      </td>
                      <td className="px-3 py-3 text-[13px] text-[#aaa] tabular-nums">{i + 1}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <button onClick={() => void openProfile(p.username)} className="shrink-0" title="View profile">
                            <Avatar name={p.full_name || p.username} url={p.profile_pic_url} handle={p.username} />
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => void openProfile(p.username)}
                                className="text-[14px] font-medium text-[#111] truncate hover:underline"
                                style={{ textDecorationColor: ACCENT }}
                                title="View profile"
                              >
                                @{p.username}
                              </button>
                              {p.is_verified && (
                                <span title="verified" style={{ color: ACCENT }}>✔</span>
                              )}
                              {p.from === 'db' && (
                                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#eef] text-[#6C4DF6]" title="from your database">
                                  DB
                                </span>
                              )}
                              {isRisingStar(p.followers, p.engagement ?? null) && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200" title="High engagement for their size — likely on the rise">
                                  ⭐ Rising
                                </span>
                              )}
                              {isContacted(p.username) && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600" title="You've reached out">
                                  Contacted ✓
                                </span>
                              )}
                            </div>
                            <div className="text-[12px] text-[#999] truncate max-w-[180px]">
                              {p.full_name || '—'}
                            </div>
                            {(p.email || p.phone || p.link) && (
                              <div className="mt-1 flex items-center gap-2 text-[11px]">
                                {p.email && (
                                  <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 text-[#10b981] hover:underline truncate max-w-[150px]" title={p.email}>✉ {p.email}</a>
                                )}
                                {p.phone && (
                                  <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-[#0ea5e9] hover:underline" title={p.phone}>📞 {p.phone}</a>
                                )}
                                {p.link && (
                                  <a href={p.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#888] hover:underline" title={p.link}>🔗 link</a>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-[#666]"><span className="block max-w-[130px] truncate" title={p.category || undefined}>{p.category || '—'}</span></td>
                      <td className="px-3 py-3 text-[14px] text-[#111] text-right tabular-nums">
                        {fmt(p.followers)}
                      </td>
                      <td className="px-3 py-3 text-[13px] text-right tabular-nums whitespace-nowrap">
                        {(() => {
                          const flag = authenticityFlag(p.followers, p.engagement);
                          return (
                            <span className="inline-flex items-center gap-1 justify-end" style={{ color: flag === 'low' ? '#f59e0b' : (p.engagement ?? 0) > 0 ? '#10b981' : '#bbb' }}>
                              {flag === 'low' && <span title="Low engagement for follower count — possible fake followers">⚠</span>}
                              {(p.engagement ?? 0) > 0 ? `${p.engagement}%` : '—'}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {(() => {
                          const fit = listFit({ ...p, ...(liveStats[p.username] ?? {}) }, briefKws);
                          if (fit == null) return <span className="text-[13px] text-[#ccc]">—</span>;
                          const c = fit >= 72 ? { bg: '#ecfdf5', fg: '#059669' } : fit >= 52 ? { bg: '#fff7ed', fg: '#b45309' } : { bg: '#fef2f2', fg: '#dc2626' };
                          return (
                            <span className="inline-block text-[12px] font-semibold px-2 py-0.5 rounded-md tabular-nums" style={{ background: c.bg, color: c.fg }} title="Quick fit vs your search brief — open the profile for the full Brand Fit breakdown">
                              {fit}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => toggleSaved(p)}
                            title={isSaved(p.username) ? 'Saved — click to remove' : 'Save creator'}
                            className="w-7 h-7 grid place-items-center rounded-lg border transition-colors"
                            style={{ color: ACCENT, borderColor: isSaved(p.username) ? ACCENT : '#e3def9', background: isSaved(p.username) ? '#f4f0ff' : undefined }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill={isSaved(p.username) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></svg>
                          </button>
                          <IconBtn onClick={() => void findSimilar(p)} title="AI lookalikes — find semantically similar creators">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17.5" cy="9.5" r="2" /><path d="M16 19a4 4 0 0 1 6-3" /></svg>
                          </IconBtn>
                          <IconBtn onClick={() => void openDraft(p)} title="AI outreach draft">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z" /></svg>
                          </IconBtn>
                          {p.creator_id && (recruited[p.creator_id] ? (
                            <span className="w-7 h-7 grid place-items-center rounded-lg text-emerald-600" title="Added to campaign">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10" /></svg>
                            </span>
                          ) : (
                            <IconBtn onClick={() => void addToShortlist(p)} disabled={recruiting === p.creator_id} title="Add to campaign">
                              {recruiting === p.creator_id ? (
                                <span className="w-3.5 h-3.5 rounded-full border-2 border-[#ddd] border-t-[#6C4DF6] animate-spin" />
                              ) : (
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                              )}
                            </IconBtn>
                          ))}
                          <a
                            href={`https://instagram.com/${p.username}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Open on Instagram"
                            className="w-7 h-7 grid place-items-center rounded-lg border border-[#e3def9] hover:bg-[#faf9ff]"
                            style={{ color: ACCENT }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M9 7h8v8" /></svg>
                          </a>
                        </div>
                      </td>
                    </tr>
                    {profileFor === p.username && (
                      <tr>
                        <td colSpan={8} className="p-0 bg-[#faf9ff]">
                          {/* Pin the drawer to the left edge and size it to the
                              visible width so it stays fully on screen even when
                              the table scrolls horizontally. */}
                          <div className="sticky left-0 px-4 pb-4 pt-0" style={drawerW ? { width: drawerW } : undefined}>
                            <ProfileSnapshot loading={profileLoading} error={profileError} profile={profile} refreshing={profileRefreshing} initialBrief={run?.prompt ?? ''} onRefresh={() => void refreshProfile()} onDraft={() => void openDraft(p)} onClose={() => setProfileFor(null)} onPivot={(h) => { setProfileFor(null); void search({ promptOverride: h, seedOverride: h, mode: 'live' }); }} />
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* AI outreach draft modal */}
      {draftFor && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/40 backdrop-blur-sm px-4 py-8" onClick={() => setDraftFor(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-[#e3def9] overflow-hidden" style={{ animation: 'ii-fadeup .2s both' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 flex items-center justify-between text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
              <div className="text-[15px] font-semibold">{draftFollowup ? 'Follow-up to' : 'Outreach to'} @{draftFor.username}</div>
              <button onClick={() => setDraftFor(null)} className="text-white/80 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#f4f0ff] text-[13px]">
                  {(['dm', 'email'] as const).map((ch) => (
                    <button
                      key={ch}
                      onClick={() => void openDraft(draftFor, ch, draftLang, draftFollowup)}
                      className={`px-3 py-1 rounded-md transition-colors ${draftChannel === ch ? 'bg-white shadow-sm font-medium' : 'text-[#888]'}`}
                      style={draftChannel === ch ? { color: ACCENT } : undefined}
                    >
                      {ch === 'dm' ? 'Instagram DM' : 'Email'}
                    </button>
                  ))}
                </div>
                <select
                  value={draftLang}
                  onChange={(e) => void openDraft(draftFor, draftChannel, e.target.value as 'auto' | 'english' | 'hinglish' | 'hindi', draftFollowup)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#e3def9] text-[13px] text-[#444] focus:outline-none focus:border-[#6C4DF6]"
                  title="Language"
                >
                  <option value="auto">🌐 Auto-detect</option>
                  <option value="english">English</option>
                  <option value="hinglish">Hinglish</option>
                  <option value="hindi">हिंदी</option>
                </select>
              </div>
              <textarea
                value={draftLoading ? 'Drafting…' : draftText}
                onChange={(e) => setDraftText(e.target.value)}
                readOnly={draftLoading}
                rows={7}
                className="w-full text-[14px] text-[#222] rounded-xl border border-[#e3def9] p-3 focus:outline-none focus:border-[#6C4DF6] focus:ring-4 focus:ring-[#6C4DF6]/10 transition-all resize-none"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  onClick={() => { void navigator.clipboard.writeText(draftText); setCopied(true); }}
                  disabled={draftLoading || !draftText}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold border border-[#e3def9] disabled:opacity-50"
                  style={{ color: ACCENT }}
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
                {draftChannel === 'email' ? (
                  draftFor.email ? (
                    <a
                      href={mailLink(draftFor.email, draftText)}
                      onClick={() => markContacted(draftFor.username)}
                      className={`px-4 py-2 rounded-lg text-white text-[13px] font-semibold ${draftLoading || !draftText ? 'pointer-events-none opacity-50' : ''}`}
                      style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
                    >
                      ✉ Send email
                    </a>
                  ) : (
                    <span className="px-4 py-2 text-[12px] text-[#999]">No email on file — use Copy</span>
                  )
                ) : (
                  <a
                    href={`https://ig.me/m/${draftFor.username}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => { void navigator.clipboard.writeText(draftText); setCopied(true); markContacted(draftFor.username); }}
                    className={`px-4 py-2 rounded-lg text-white text-[13px] font-semibold ${draftLoading || !draftText ? 'pointer-events-none opacity-50' : ''}`}
                    style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
                  >
                    ✦ Copy &amp; open DM →
                  </a>
                )}
                {draftFor.phone && (
                  <a
                    href={waLink(draftFor.phone, draftText)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => markContacted(draftFor.username)}
                    className={`px-4 py-2 rounded-lg text-white text-[13px] font-semibold ${draftLoading || !draftText ? 'pointer-events-none opacity-50' : ''}`}
                    style={{ background: '#25D366' }}
                  >
                    Send on WhatsApp
                  </a>
                )}
              </div>
              {draftChannel === 'dm' && (
                <p className="mt-2 text-[11px] text-[#aaa] text-right">Opens the DM with @{draftFor.username} — your message is copied, just paste &amp; send.</p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* bulk outreach drafts modal */}
      {bulkDraft && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/30 px-4 py-8" onClick={() => setBulkDraft(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-[#eee]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 pb-3 border-b border-[#f0f0f0]">
              <div className="text-[15px] font-semibold text-[#111]">
                Outreach drafts · {bulkDraft.length} creators
                {bulkDraftLoading && <span className="ml-2 text-[12px] font-normal text-[#999]">generating…</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#f4f4f6] text-[12px]">
                  {(['dm', 'email'] as const).map((ch) => (
                    <button
                      key={ch}
                      onClick={() => void openBulkDraft(ch)}
                      className={`px-2.5 py-1 rounded-md transition-colors ${bulkChannel === ch ? 'bg-white shadow-sm font-medium text-[#111]' : 'text-[#888]'}`}
                    >
                      {ch === 'dm' ? 'DM' : 'Email'}
                    </button>
                  ))}
                </div>
                <button onClick={() => setBulkDraft(null)} className="text-[#999] hover:text-[#111] text-lg leading-none">×</button>
              </div>
            </div>
            <div className="overflow-y-auto p-5 space-y-3 flex-1">
              {bulkDraft.map((item, i) => (
                <div key={item.username} className="rounded-xl border border-[#eee] p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-medium text-[#111]">@{item.username}</span>
                    <div className="flex items-center gap-2.5 text-[12px] font-medium">
                      <a
                        href={`https://ig.me/m/${item.username}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => { void navigator.clipboard.writeText(item.message); markContacted(item.username); }}
                        title="Copies the message and opens the DM with this creator"
                        className={`${!item.message ? 'pointer-events-none opacity-40' : ''}`}
                        style={{ color: ACCENT }}
                      >
                        ✦ DM
                      </a>
                      {item.email && (
                        <a href={mailLink(item.email, item.message)} onClick={() => markContacted(item.username)} className={`${!item.message ? 'pointer-events-none opacity-40' : ''}`} style={{ color: ACCENT }}>✉ Email</a>
                      )}
                      {item.phone && (
                        <a href={waLink(item.phone, item.message)} target="_blank" rel="noreferrer" onClick={() => markContacted(item.username)} className={`${!item.message ? 'pointer-events-none opacity-40' : ''}`} style={{ color: '#1ebe57' }}>WhatsApp</a>
                      )}
                      <button
                        onClick={() => { void navigator.clipboard.writeText(item.message); }}
                        disabled={!item.message}
                        className="disabled:opacity-40"
                        style={{ color: ACCENT }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={item.message || (bulkDraftLoading ? 'Drafting…' : '')}
                    onChange={(e) => setBulkDraft((cur) => cur?.map((x, j) => (j === i ? { ...x, message: e.target.value } : x)) ?? cur)}
                    readOnly={bulkDraftLoading}
                    rows={3}
                    className="w-full text-[13px] text-[#222] rounded-lg border border-[#e3def9] p-2.5 focus:outline-none focus:border-[#6C4DF6] resize-none"
                  />
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-[#f0f0f0] flex items-center justify-end">
              <button
                onClick={() => {
                  const all = bulkDraft.map((x) => `@${x.username}\n${x.message}`).join('\n\n———\n\n');
                  void navigator.clipboard.writeText(all);
                  setBulkCopied(true);
                }}
                disabled={bulkDraftLoading}
                className="px-4 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                {bulkCopied ? 'Copied all ✓' : 'Copy all'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Floating actions: follow-up nudges + saved creators */}
      {!showSaved && !showFollowups && (savedCreators.length > 0 || dueFollowups.length > 0) && (
        <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2.5">
          {dueFollowups.length > 0 && (
            <button
              onClick={() => setShowFollowups(true)}
              className="flex items-center gap-2 pl-4 pr-5 py-3 rounded-full text-white text-[14px] font-semibold shadow-[0_12px_40px_rgba(245,158,11,0.45)] hover:-translate-y-0.5 transition-transform"
              style={{ background: 'linear-gradient(135deg, #F59E0B, #F7B500)', animation: 'ii-fadeup .3s both' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              {dueFollowups.length} follow-up{dueFollowups.length > 1 ? 's' : ''} due
            </button>
          )}
          {savedCreators.length > 0 && (
            <button
              onClick={() => setShowSaved(true)}
              className="flex items-center gap-2 pl-4 pr-5 py-3 rounded-full text-white text-[14px] font-semibold shadow-[0_12px_40px_rgba(108,77,246,0.4)] hover:-translate-y-0.5 transition-transform"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)`, animation: 'ii-fadeup .3s both' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></svg>
              {savedCreators.length} saved
            </button>
          )}
        </div>
      )}

      {showFollowups && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setShowFollowups(false)}>
          <div className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col" style={{ animation: 'ii-slidein .25s both' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center justify-between text-white" style={{ background: 'linear-gradient(135deg, #F59E0B, #F7B500)' }}>
              <div className="text-[15px] font-semibold">Follow-ups due · {dueFollowups.length}</div>
              <button onClick={() => setShowFollowups(false)} className="text-white/80 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-2.5 text-[12px] text-[#888] border-b border-[#f0f0f0]">Contacted {FOLLOWUP_DAYS}+ days ago with no reply marked. Send a gentle nudge.</div>
            <div className="flex-1 overflow-y-auto divide-y divide-[#f3f3f3]">
              {dueFollowups.length === 0 ? (
                <div className="px-5 py-10 text-center text-[14px] text-[#999]">You're all caught up 🎉</div>
              ) : (
                dueFollowups.map(({ handle, ts }) => {
                  const days = Math.floor((Date.now() - ts) / 86_400_000);
                  return (
                    <div key={handle} className="flex items-center gap-3 px-5 py-3">
                      <Avatar name={handle} url={null} handle={handle} />
                      <div className="min-w-0 flex-1">
                        <a href={`https://instagram.com/${handle}`} target="_blank" rel="noreferrer" className="text-[14px] font-semibold text-[#111] truncate hover:underline">@{handle}</a>
                        <div className="text-[12px] text-[#999]">contacted {days} day{days !== 1 ? 's' : ''} ago</div>
                      </div>
                      <button onClick={() => openFollowup(handle)} className="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold hover:brightness-105 shrink-0" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>✦ Follow up</button>
                      <button onClick={() => markFollowupDone(handle)} className="text-[#bbb] hover:text-emerald-500 shrink-0" title="Mark replied / done">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10" /></svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {showSaved && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setShowSaved(false)}>
          <div className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col" style={{ animation: 'ii-slidein .25s both' }} onClick={(e) => e.stopPropagation()}>
            <style>{`@keyframes ii-slidein{from{transform:translateX(100%)}to{transform:none}}`}</style>
            <div className="px-5 py-4 flex items-center justify-between text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
              <div className="text-[15px] font-semibold">Saved creators · {savedCreators.length}</div>
              <button onClick={() => setShowSaved(false)} className="text-white/80 hover:text-white text-xl leading-none">×</button>
            </div>
            {savedCreators.length > 0 && (
              <div className="px-5 pt-3 pb-2 border-b border-[#eee]">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-[#999]">Rank by brand fit</label>
                <input
                  value={shortlistBrief}
                  onChange={(e) => setShortlistBrief(e.target.value)}
                  placeholder="Brief — e.g. sustainable skincare for Gen-Z women"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-[#e3def9] text-[12px] focus:outline-none focus:border-[#6C4DF6]"
                />
                {fitKeywords(shortlistBrief).length > 0 && (
                  <p className="mt-1 text-[11px] text-[#999]">Sorted by fit against this brief.</p>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto divide-y divide-[#f3f3f3]">
              {(() => {
                const kws = fitKeywords(shortlistBrief);
                const rows = savedCreators.map((s) => ({ s, fit: kws.length ? listFit(s, kws) : null }));
                if (kws.length) rows.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));
                return rows.map(({ s, fit }) => (
                <div key={s.username} className="flex items-center gap-3 px-5 py-3">
                  <input
                    type="checkbox"
                    className="accent-[#6C4DF6] shrink-0"
                    checked={compareSel.has(s.username)}
                    disabled={!compareSel.has(s.username) && compareSel.size >= 4}
                    onChange={() => toggleCompare(s.username)}
                    title="Select to compare (up to 4)"
                  />
                  <Avatar name={s.full_name || s.username} url={s.profile_pic_url} handle={s.username} />
                  <div className="min-w-0 flex-1">
                    <a href={`https://instagram.com/${s.username}`} target="_blank" rel="noreferrer" className="text-[14px] font-semibold text-[#111] truncate hover:underline">@{s.username}</a>
                    <div className="text-[12px] text-[#999] truncate">{fmt(s.followers)} followers{s.category ? ` · ${s.category}` : ''}</div>
                  </div>
                  {fit != null && (() => {
                    const c = fit >= 72 ? { bg: '#ecfdf5', fg: '#059669' } : fit >= 52 ? { bg: '#fff7ed', fg: '#b45309' } : { bg: '#fef2f2', fg: '#dc2626' };
                    return <span className="shrink-0 text-[12px] font-semibold px-2 py-0.5 rounded-md tabular-nums" style={{ background: c.bg, color: c.fg }} title="Fit vs the brief above">{fit}</span>;
                  })()}
                  <button onClick={() => toggleSaved({ username: s.username } as LiveProfile)} className="text-[#bbb] hover:text-rose-500 text-lg leading-none" title="Remove">×</button>
                </div>
                ));
              })()}
            </div>
            {compareSel.size > 0 && (
              <button
                onClick={() => void openCompare()}
                disabled={compareSel.size < 2}
                className="mx-5 mt-3 px-4 py-2.5 rounded-xl text-[13px] font-semibold border-2 disabled:opacity-50"
                style={{ color: ACCENT, borderColor: ACCENT }}
              >
                ⚖ Compare {compareSel.size} {compareSel.size < 2 ? '(pick 2+)' : 'side by side'}
              </button>
            )}
            <div className="px-5 py-4 border-t border-[#eee] flex items-center gap-2">
              <button
                onClick={() => void runBulkDraft(savedCreators, 'dm')}
                className="flex-1 px-4 py-2.5 rounded-xl text-white text-[14px] font-semibold hover:brightness-105"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
              >
                ✦ Draft outreach to all
              </button>
              <button onClick={() => void exportSaved()} disabled={exporting} className="px-4 py-2.5 rounded-xl text-[13px] font-medium border border-[#e3def9] hover:bg-[#faf9ff] disabled:opacity-50" style={{ color: ACCENT }} title="Export to Excel">{exporting ? '…' : '⬇'}</button>
              <button onClick={clearSaved} className="px-4 py-2.5 rounded-xl text-[13px] font-medium border border-[#eee] text-[#666] hover:bg-[#faf9ff]">Clear</button>
            </div>
          </div>
        </div>
      )}

      {compareFor && (
        <CompareModal
          handles={compareFor}
          data={compareData}
          loading={compareLoading}
          onClose={() => setCompareFor(null)}
          onDraft={(h) => { setCompareFor(null); void openDraft({ username: h } as LiveProfile); }}
        />
      )}

    </div>
  );
}

function CompareModal({
  handles,
  data,
  loading,
  onClose,
  onDraft,
}: {
  handles: string[];
  data: Record<string, ProfileData | null>;
  loading: boolean;
  onClose: () => void;
  onDraft: (handle: string) => void;
}) {
  const erOf = (p: ProfileData) =>
    p.followers > 0 && p.recent.length > 0
      ? Math.round((p.recent.reduce((s, x) => s + x.likes + x.comments, 0) / p.recent.length / p.followers) * 1000) / 10
      : null;

  const cols = handles.map((h) => {
    const p = data[h] ?? null;
    const er = p ? erOf(p) : null;
    const rate = p ? estimatedRate(p.followers, er) : null;
    const rhythm = p ? postingInsight(p.recent) : null;
    const themes = p ? contentThemes(p.recent, 4) : [];
    return { h, p, er, rate, rhythm, themes };
  });

  // Best-in-row highlights.
  const maxFollowers = Math.max(...cols.map((c) => c.p?.followers ?? 0));
  const maxEr = Math.max(...cols.map((c) => c.er ?? 0));

  const Row = ({ label, render }: { label: string; render: (c: (typeof cols)[number]) => React.ReactNode }) => (
    <tr className="border-t border-[#f3f3f3]">
      <td className="py-2.5 pr-3 text-[12px] text-[#999] align-top whitespace-nowrap">{label}</td>
      {cols.map((c) => (
        <td key={c.h} className="py-2.5 px-3 text-[13px] text-[#222] align-top">{render(c)}</td>
      ))}
    </tr>
  );

  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-black/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[85vh] overflow-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 px-5 py-4 flex items-center justify-between text-white z-10" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
          <div className="text-[15px] font-semibold">⚖ Compare creators · {cols.length}</div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl leading-none">×</button>
        </div>
        {loading ? (
          <div className="p-12 grid place-items-center"><div className="w-7 h-7 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" /></div>
        ) : (
          <div className="p-5 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th />
                  {cols.map((c) => (
                    <th key={c.h} className="px-3 pb-2 text-left">
                      <div className="flex items-center gap-2">
                        <Avatar name={c.p?.full_name || c.h} url={c.p?.profile_pic_url ?? null} handle={c.h} />
                        <a href={`https://instagram.com/${c.h}`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-[#111] hover:underline truncate">@{c.h}</a>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="Followers" render={(c) => <span className={c.p && c.p.followers === maxFollowers && maxFollowers > 0 ? 'font-bold' : ''} style={c.p && c.p.followers === maxFollowers ? { color: ACCENT } : undefined}>{c.p ? fmt(c.p.followers) : '—'}</span>} />
                <Row label="Engagement" render={(c) => c.er != null ? <span className={c.er === maxEr && maxEr > 0 ? 'font-bold' : ''} style={c.er === maxEr ? { color: '#059669' } : undefined}>{c.er}%</span> : '—'} />
                <Row label="Est. rate / post" render={(c) => c.rate ? `${inr(c.rate.low)}–${inr(c.rate.high)}` : '—'} />
                <Row label="Posts" render={(c) => c.p ? fmt(c.p.posts) : '—'} />
                <Row label="Cadence" render={(c) => c.rhythm?.cadence ?? '—'} />
                <Row label="Best time" render={(c) => c.rhythm ? `${c.rhythm.bestDay}, ${c.rhythm.bestWindow}` : '—'} />
                <Row label="Themes" render={(c) => c.themes.length ? <span className="text-[12px]">{c.themes.join(' ')}</span> : '—'} />
                <Row label="Contact" render={(c) => c.p?.email ? <span className="text-[12px] text-[#10b981] break-all">{c.p.email}</span> : c.p?.phone ? <span className="text-[12px] text-[#0ea5e9]">{c.p.phone}</span> : '—'} />
                <Row label="" render={(c) => (
                  <button onClick={() => onDraft(c.h)} className="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold hover:brightness-105" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>✦ Draft</button>
                )} />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileSnapshot({ loading, error, profile, refreshing, onRefresh, onDraft, onClose, onPivot, initialBrief = '' }: { loading: boolean; error?: string | null; profile: ProfileData | null; refreshing?: boolean; onRefresh?: () => void; onDraft: () => void; onClose: () => void; onPivot: (handle: string) => void; initialBrief?: string }) {
  const [copied, setCopied] = useState(false);
  const [rivals, setRivals] = useState('');
  const [growth, setGrowth] = useState<{ pct: number; days: number } | null>(null);
  useEffect(() => {
    if (!profile) return;
    const prior = readGrowth(profile.handle);
    const first = prior[0];
    if (first && first.f > 0 && first.f !== profile.followers) {
      const pct = Math.round(((profile.followers - first.f) / first.f) * 1000) / 10;
      const days = Math.max(1, Math.round((Date.now() - first.t) / 86_400_000));
      setGrowth({ pct, days });
    } else {
      setGrowth(null);
    }
    recordGrowth(profile.handle, profile.followers);
  }, [profile?.handle, profile?.followers]);
  // Semantic "more like this" — creators in our DB nearest by content embedding.
  const [similar, setSimilar] = useState<Array<{ handle: string; display_name: string | null; follower_count: number | null; category?: string | null; profile_photo_url: string | null; similarity: number }>>([]);
  useEffect(() => {
    if (!profile?.handle) { setSimilar([]); return; }
    let alive = true;
    fetch(`/api/creators/${encodeURIComponent(profile.handle)}/similar?limit=8`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setSimilar(d?.similar ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [profile?.handle]);
  if (loading) {
    return (
      <div className="relative rounded-xl border border-[#e3def9] bg-white p-6 grid place-items-center" style={{ animation: 'ii-fadeup .3s both' }}>
        <button onClick={onClose} className="absolute top-2.5 right-3 text-[#bbb] hover:text-[#666] text-lg leading-none" title="Close">×</button>
        <div className="w-7 h-7 rounded-full border-[3px] border-[#ece9fb] border-t-[#6C4DF6] animate-spin" />
      </div>
    );
  }
  if (error || !profile) {
    return (
      <div className="relative rounded-xl border border-[#e3def9] bg-white p-6 text-center" style={{ animation: 'ii-fadeup .3s both' }}>
        <button onClick={onClose} className="absolute top-2.5 right-3 text-[#bbb] hover:text-[#666] text-lg leading-none" title="Close">×</button>
        <div className="text-[14px] font-medium text-[#444]">Couldn&apos;t load this profile</div>
        <p className="mt-1.5 text-[12px] text-[#888] max-w-md mx-auto leading-relaxed">
          This creator hasn&apos;t been scraped yet. It&apos;s been queued for the Instagram worker — try again in a moment.
        </p>
      </div>
    );
  }
  const engagement = profile.followers > 0 && profile.recent.length > 0
    ? Math.round(
        (profile.recent.reduce((s, p) => s + p.likes + p.comments, 0) / profile.recent.length / profile.followers) * 1000,
      ) / 10
    : (profile.engagement ?? null);

  const floor = expectedErFloor(profile.followers);
  const healthy = engagement != null && engagement >= floor;
  const rhythm = postingInsight(profile.recent);
  const themes = contentThemes(profile.recent);
  const rate = estimatedRate(profile.followers, engagement);
  const rising = isRisingStar(profile.followers, engagement);
  const persona = personaLine(profile, engagement, rate, rhythm?.cadence ?? null, themes);
  const safety = brandSafety([profile.biography ?? '', ...profile.recent.map((p) => p.caption ?? '')]);
  const collabs = profile.collabs ?? [];
  const rivalTerms = rivals.toLowerCase().split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  const isRival = (h: string) => rivalTerms.some((t) => h.toLowerCase().includes(t));
  const conflictCount = collabs.filter((c) => isRival(c.handle)).length;
  const blacklistHits = competitorConflicts(profile.recent, rivalTerms);

  const copySummary = () => {
    const lines = [
      `@${profile.handle}${profile.is_verified ? ' ✔' : ''}${profile.full_name ? ` — ${profile.full_name}` : ''}`,
      persona,
      `${fmt(profile.followers)} followers · ${fmt(profile.posts)} posts${engagement != null ? ` · ${engagement}% engagement (${healthy ? 'healthy' : 'low'})` : ''}`,
      rate ? `Est. rate/post: ${inr(rate.low)}–${inr(rate.high)}` : '',
      rhythm ? `Posting: ${rhythm.cadence} · best ${rhythm.bestDay}, ${rhythm.bestWindow}` : '',
      themes.length ? `Themes: ${themes.join(' ')}` : '',
      profile.email ? `Email: ${profile.email}` : '',
      profile.phone ? `Phone: ${profile.phone}` : '',
      `https://instagram.com/${profile.handle}`,
    ].filter(Boolean);
    void navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="relative rounded-2xl border border-[#e3def9] bg-white p-5 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] gap-6 transition-shadow hover:shadow-[0_12px_44px_rgba(108,77,246,0.1)]" style={{ animation: 'ii-fadeup .3s both' }}>
      <button onClick={onClose} className="absolute top-3 right-3.5 z-10 w-7 h-7 grid place-items-center rounded-full bg-white border border-[#eee] shadow-sm text-[#999] hover:text-[#111] hover:bg-[#f3f3f3] text-lg leading-none" title="Close">×</button>
      {/* left: details, vertically balanced */}
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-3">
          <Avatar name={profile.full_name || profile.handle} url={profile.profile_pic_url} handle={profile.handle} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <a href={`https://instagram.com/${profile.handle}`} target="_blank" rel="noreferrer" className="text-[15px] font-semibold text-[#111] truncate hover:underline">@{profile.handle}</a>
              {profile.is_verified && <span style={{ color: ACCENT }}>✔</span>}
              {rising && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-600 border border-amber-200" title="High engagement for their size — likely on the rise">
                  ⭐ Rising star
                </span>
              )}
              {(() => {
                const src = profile.source;
                const cfg = src === 'pending'
                  ? { label: 'Scraping…', bg: '#fff7ed', fg: '#b45309', bd: '#fed7aa', tip: 'Queued for the Instagram worker — fresh data will appear shortly.' }
                  : profile.refreshing
                    ? { label: 'Refreshing…', bg: '#eff6ff', fg: '#2563eb', bd: '#bfdbfe', tip: 'The worker is re-scraping this profile for fresh data.' }
                    : { label: 'Worker data', bg: '#ecfdf5', fg: '#059669', bd: '#a7f3d0', tip: 'Scraped from Instagram by the browser worker.' };
                return (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border" style={{ background: cfg.bg, color: cfg.fg, borderColor: cfg.bd }} title={cfg.tip}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.fg }} />{cfg.label}
                  </span>
                );
              })()}
            </div>
            <div className="text-[12px] text-[#999] truncate">
              {profile.full_name}{profile.category ? ` · ${profile.category}` : ''}
              {growth && (
                <span className={`ml-1.5 font-medium ${growth.pct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {growth.pct >= 0 ? '▲' : '▼'} {Math.abs(growth.pct)}% · {growth.days}d
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-[#e3def9] bg-gradient-to-br from-[#faf9ff] to-white px-3.5 py-2.5" style={{ animation: 'ii-fadeup .4s .05s both' }}>
          <div className="text-[10px] uppercase tracking-wide text-[#999] mb-0.5">✦ Persona</div>
          <div className="text-[13px] font-medium text-[#222] leading-snug">{persona}</div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            ['Followers', fmt(profile.followers)],
            ['Following', fmt(profile.following)],
            ['Posts', fmt(profile.posts)],
            ['Eng.', engagement != null ? `${engagement}%` : '—'],
          ].map(([k, v], idx) => (
            <div
              key={k}
              className="rounded-xl border border-[#eee] bg-[#fafafc] py-2.5 transition-all hover:-translate-y-0.5 hover:border-[#d9d2f7] hover:shadow-sm"
              style={{ animation: `ii-countup .4s ${idx * 0.06}s both` }}
            >
              <div className="text-[15px] font-bold tabular-nums text-[#111] leading-none">{v}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-[#999]">{k}</div>
            </div>
          ))}
        </div>

        {profile.biography && (
          <p className="mt-4 text-[13px] text-[#444] whitespace-pre-line leading-relaxed line-clamp-5">{profile.biography}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
          {profile.email && <a href={`mailto:${profile.email}`} className="text-[#10b981] hover:underline">✉ {profile.email}</a>}
          {profile.phone && <a href={`tel:${profile.phone}`} className="text-[#0ea5e9] hover:underline">📞 {profile.phone}</a>}
          {profile.external_url && <a href={profile.external_url} target="_blank" rel="noreferrer" className="text-[#888] hover:underline truncate max-w-[220px]">🔗 {profile.external_url.replace(/^https?:\/\//, '')}</a>}
        </div>

        {engagement != null && (
          <div
            className="mt-4 inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg text-[12px] font-medium"
            style={{ background: healthy ? '#ecfdf5' : '#fff7ed', color: healthy ? '#059669' : '#b45309', animation: 'ii-fadeup .4s .25s both' }}
          >
            {healthy ? '✓' : '⚠'} {engagement}% engagement — {healthy ? 'healthy' : 'low'} for this tier (benchmark ≈ {floor}%)
          </div>
        )}

        <div
          className="mt-3 inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg text-[12px] font-medium"
          title={safety.hits.map((h) => `${h.category}: ${h.terms.join(', ')}`).join(' · ') || undefined}
          style={{
            background: safety.level === 'clean' ? '#ecfdf5' : safety.level === 'review' ? '#fff7ed' : '#fef2f2',
            color: safety.level === 'clean' ? '#059669' : safety.level === 'review' ? '#b45309' : '#dc2626',
            animation: 'ii-fadeup .4s .3s both',
          }}
        >
          {safety.level === 'clean'
            ? '🛡 Brand-safe — no risk flags in recent posts'
            : `${safety.level === 'flag' ? '⛔' : '⚠'} Brand safety: ${safety.hits.map((h) => h.category).join(', ')}`}
        </div>

        {blacklistHits.length > 0 && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5" style={{ animation: 'ii-fadeup .4s .32s both' }}>
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-rose-700">
              ⛔ Blacklist — competitor conflict
            </div>
            <p className="mt-0.5 text-[12px] text-rose-600 leading-snug">
              Collaborated with {blacklistHits.map((h) => h.brand).join(', ')} in the last {BLACKLIST_WINDOW_DAYS} days
              {' '}(most recent {blacklistHits[0]!.daysAgo === 0 ? 'today' : `${blacklistHits[0]!.daysAgo}d ago`}). Avoid approaching while that overlap is live.
            </p>
          </div>
        )}

        {rate && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-[#e3def9] bg-[#faf9ff] px-3.5 py-2.5" style={{ animation: 'ii-fadeup .4s .28s both' }}>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#999]">Est. rate / post</div>
              <div className="mt-0.5 text-[15px] font-bold text-[#111] tabular-nums">{inr(rate.low)} – {inr(rate.high)}</div>
            </div>
            <span className="text-[11px] text-[#aaa] text-right max-w-[120px] leading-tight">Indicative — IG in-feed, India</span>
          </div>
        )}

        {rhythm && (
          <div className="mt-3 grid grid-cols-3 gap-2" style={{ animation: 'ii-fadeup .4s .3s both' }}>
            {[
              ['📅', 'Cadence', rhythm.cadence],
              ['🔥', 'Best day', rhythm.bestDay],
              ['⏰', 'Best time', rhythm.bestWindow],
            ].map(([icon, label, val]) => (
              <div key={label} className="rounded-xl border border-[#eee] bg-[#fafafc] px-2.5 py-2 transition-all hover:-translate-y-0.5 hover:border-[#d9d2f7] hover:shadow-sm">
                <div className="text-[10px] uppercase tracking-wide text-[#999]">{icon} {label}</div>
                <div className="mt-0.5 text-[13px] font-semibold text-[#111] leading-tight">{val}</div>
              </div>
            ))}
          </div>
        )}

        {themes.length > 0 && (
          <div className="mt-3" style={{ animation: 'ii-fadeup .4s .35s both' }}>
            <div className="text-[10px] uppercase tracking-wide text-[#999] mb-1.5">Posts about</div>
            <div className="flex flex-wrap gap-1.5">
              {themes.map((t) => (
                <span key={t} className="px-2.5 py-1 rounded-full text-[12px] font-medium border border-[#e3def9] bg-[#f6f4ff]" style={{ color: ACCENT }}>{t}</span>
              ))}
            </div>
          </div>
        )}

        {collabs.length > 0 && (
          <div className="mt-3" style={{ animation: 'ii-fadeup .4s .38s both' }}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wide text-[#999]">
                Brand activity{profile.sponsored_posts ? ` · ${profile.sponsored_posts} sponsored` : ''}
              </div>
            </div>
            <input
              value={rivals}
              onChange={(e) => setRivals(e.target.value)}
              placeholder="Add more competitors to blacklist (comma-sep) — Myntra, Zara, Max, Pantaloons auto-checked"
              className="w-full mb-2 px-2.5 py-1.5 rounded-lg border border-[#e3def9] text-[12px] focus:outline-none focus:border-[#6C4DF6]"
            />
            {conflictCount > 0 && (
              <div className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-rose-50 text-rose-600">
                ⚠ {conflictCount} potential conflict{conflictCount > 1 ? 's' : ''} — recently tagged a competitor
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {collabs.map((c) => {
                const conflict = isRival(c.handle);
                return (
                  <a
                    key={c.handle}
                    href={`https://instagram.com/${c.handle}`}
                    target="_blank"
                    rel="noreferrer"
                    title={conflict ? 'Potential conflict' : `Tagged ${c.count}×`}
                    className={`px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${conflict ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-[#fafafc] border-[#eee] text-[#555] hover:border-[#d9d2f7]'}`}
                  >
                    {conflict && '⚠ '}@{c.handle}{c.count > 1 ? ` ·${c.count}` : ''}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-auto pt-5 grid grid-cols-2 gap-2">
          <button onClick={onDraft} className="min-h-[44px] px-3 py-2 rounded-lg text-white text-[13px] font-semibold flex items-center justify-center text-center leading-tight transition-all hover:-translate-y-0.5 hover:shadow-lg hover:brightness-105" style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}>
            ✦ Draft outreach
          </button>
          <a href={`https://instagram.com/${profile.handle}`} target="_blank" rel="noreferrer" className="min-h-[44px] px-3 py-2 rounded-lg text-[13px] font-semibold border border-[#e3def9] flex items-center justify-center text-center leading-tight transition-all hover:-translate-y-0.5 hover:bg-[#faf9ff]" style={{ color: ACCENT }}>
            Open Instagram ↗
          </a>
          <button onClick={copySummary} className="min-h-[44px] px-3 py-2 rounded-lg text-[13px] font-semibold border flex items-center justify-center text-center leading-tight transition-all hover:-translate-y-0.5 hover:bg-[#faf9ff]" style={{ color: copied ? '#059669' : ACCENT, borderColor: copied ? '#a7f3d0' : '#e3def9' }}>
            {copied ? '✓ Copied' : '⧉ Copy summary'}
          </button>
          {onRefresh && (
            <button onClick={onRefresh} disabled={refreshing} title="Re-fetch live followers & engagement from Instagram now" className="min-h-[44px] px-3 py-2 rounded-lg text-[13px] font-semibold border border-[#e3def9] flex items-center justify-center text-center leading-tight gap-1 transition-all hover:-translate-y-0.5 hover:bg-[#faf9ff] disabled:opacity-60" style={{ color: ACCENT }}>
              <span className={refreshing ? 'inline-block animate-spin' : 'inline-block'}>⟳</span> {refreshing ? 'Refreshing…' : 'Refresh live'}
            </button>
          )}
          <a href={`/report/${encodeURIComponent(profile.handle)}${initialBrief ? `?brief=${encodeURIComponent(initialBrief)}` : ''}`} target="_blank" rel="noreferrer" title="Open a print-ready one-page report for this creator" className="col-span-2 min-h-[44px] px-3 py-2 rounded-lg text-[13px] font-semibold border border-[#e3def9] flex items-center justify-center text-center leading-tight transition-all hover:-translate-y-0.5 hover:bg-[#faf9ff]" style={{ color: ACCENT }}>
            ⤓ Export one-pager
          </a>
        </div>
      </div>

      {/* analytics + media — masonry so cards fill the space evenly instead of
          leaving a tall column beside short ones */}
      <div className="min-w-0 lg:columns-2 [column-gap:1rem]">
        <div className="break-inside-avoid mb-4">
          <BrandFitCard profile={profile} engagement={engagement} blacklistHits={blacklistHits} initialBrief={initialBrief} />
        </div>
        <div className="break-inside-avoid mb-4">
          <CreatorAI
            body={{
              handle: profile.handle,
              full_name: profile.full_name,
              category: profile.category,
              followers: profile.followers,
              engagement,
              rate: rate ? `${inr(rate.low)}–${inr(rate.high)}` : null,
              themes,
              cadence: rhythm?.cadence ?? null,
              biography: profile.biography,
              recent_captions: profile.recent.map((p) => p.caption).filter(Boolean).slice(0, 9),
              tagged_accounts: collabs.map((c) => c.handle),
              recent_posts: profile.recent.slice(0, 9).map((p) => ({
                caption: p.caption,
                likes: p.likes,
                comments: p.comments,
                sponsored: /#(ad|sponsored|paid|paidpartnership|collab|partner)\b|paid partnership/i.test(p.caption ?? ''),
              })),
            }}
          />
        </div>
        <div className="break-inside-avoid mb-4">
          <AuthenticityCard profile={profile} engagement={engagement} />
        </div>
        <div className="break-inside-avoid mb-4">
          <ReelForecast profile={profile} />
        </div>
        {profile.recent.length > 0 && (
          <div className="break-inside-avoid mb-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#999]">Recent posts</div>
            <div className="grid grid-cols-3 gap-2">
              {profile.recent.map((post, i) => (
                <a
                  key={i}
                  href={post.shortcode ? `https://instagram.com/p/${post.shortcode}` : `https://instagram.com/${profile.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-square rounded-xl overflow-hidden bg-[#eee] group ring-1 ring-black/5 hover:ring-2 hover:ring-[#6C4DF6]/40 transition-all"
                  title={post.caption}
                  style={{ animation: `ii-fadeup .4s ${0.1 + i * 0.04}s both` }}
                >
                  {post.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/ig-image?u=${encodeURIComponent(post.thumbnail)}`} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" />
                  )}
                  <div className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/55 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-white text-[11px] font-semibold drop-shadow">♥ {fmt(post.likes)} · 💬 {fmt(post.comments)}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {profile.related && profile.related.length > 0 && (
          <div className="break-inside-avoid mb-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#999]">Related on Instagram</div>
            <div className="flex flex-col gap-1.5">
              {profile.related.slice(0, 6).map((r, i) => (
                <button
                  key={r.handle}
                  onClick={() => onPivot(r.handle)}
                  className="group flex items-center gap-2.5 w-full text-left px-2 py-1.5 rounded-xl border border-transparent hover:border-[#e3def9] hover:bg-[#faf9ff] transition-all"
                  title={`Explore @${r.handle}`}
                  style={{ animation: `ii-fadeup .4s ${0.1 + i * 0.04}s both` }}
                >
                  <Avatar name={r.full_name || r.handle} url={r.profile_pic_url} handle={r.handle} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-[13px] font-semibold text-[#111] truncate">@{r.handle}{r.is_verified && <span style={{ color: ACCENT }}>✔</span>}</span>
                    {r.full_name && <span className="block text-[11px] text-[#999] truncate">{r.full_name}</span>}
                  </span>
                  <span className="ml-auto text-[14px] opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: ACCENT }}>→</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {similar.length > 0 && (
          <div className="break-inside-avoid mb-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#999]">
              Similar creators <span className="normal-case font-normal text-[#bbb]">· in your database</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {similar.slice(0, 8).map((s, i) => (
                <button
                  key={s.handle}
                  onClick={() => onPivot(s.handle)}
                  className="group flex items-center gap-2.5 w-full text-left px-2 py-1.5 rounded-xl border border-transparent hover:border-[#e3def9] hover:bg-[#faf9ff] transition-all"
                  title={`Explore @${s.handle} · ${Math.round(s.similarity * 100)}% similar`}
                  style={{ animation: `ii-fadeup .4s ${0.1 + i * 0.04}s both` }}
                >
                  <Avatar name={s.display_name || s.handle} url={s.profile_photo_url} handle={s.handle} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-[#111] truncate">@{s.handle}</span>
                    <span className="block text-[11px] text-[#999] truncate">
                      {s.category || '—'}{s.follower_count != null ? ` · ${fmt(s.follower_count)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums" style={{ color: ACCENT }}>{Math.round(s.similarity * 100)}%</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Authenticity score, explained: a ring for the headline number, a labelled bar
// + plain-English reason per factor, and a per-post engagement chart so the
// score is backed by visible evidence rather than a bare number.
function AuthenticityCard({ profile, engagement }: { profile: ProfileData; engagement: number | null }) {
  const report = authenticityReport(profile, engagement);
  if (!report) {
    return (
      <div className="rounded-2xl border border-[#e3def9] bg-white p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-2">Authenticity score</div>
        <p className="text-[12px] text-[#888]">Needs live posts to score — hit “Refresh live” to pull the latest.</p>
      </div>
    );
  }
  const { score, band, color, verdict, factors, perPost } = report;
  const R = 26;
  const C = 2 * Math.PI * R;
  const dash = (score / 100) * C;
  const maxER = Math.max(...perPost, 0.01);
  const barColor = (v: number) => (v >= 70 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444');
  const txtColor = (v: number) => (v >= 70 ? '#059669' : v >= 50 ? '#b45309' : '#dc2626');

  return (
    <div className="rounded-2xl border border-[#e3def9] bg-white p-4" style={{ animation: 'ii-fadeup .4s .12s both' }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-3">Authenticity score</div>

      <div className="flex items-center gap-4">
        <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0">
          <circle cx="34" cy="34" r={R} fill="none" stroke="#eee" strokeWidth="7" />
          <circle cx="34" cy="34" r={R} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${dash} ${C}`} transform="rotate(-90 34 34)" />
          <text x="34" y="35" textAnchor="middle" dominantBaseline="central" fontSize="19" fontWeight="700" fill="#111">{score}</text>
        </svg>
        <div className="min-w-0">
          <div className="text-[14px] font-bold" style={{ color }}>{band}</div>
          <p className="text-[12px] text-[#666] leading-snug">{verdict}</p>
        </div>
      </div>

      <div className="mt-3.5 space-y-2.5">
        {factors.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[#444] font-medium">{f.label}</span>
              <span className="tabular-nums font-semibold" style={{ color: txtColor(f.value) }}>{f.value}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-[#f0eefb] overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${f.value}%`, background: barColor(f.value) }} />
            </div>
            <p className="mt-1 text-[11px] text-[#888] leading-snug">{f.detail}</p>
          </div>
        ))}
      </div>

      {perPost.length >= 3 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wide text-[#999] mb-1.5">Engagement per recent post</div>
          <div className="flex items-end gap-1 h-16">
            {perPost.map((v, i) => (
              <div key={i} className="flex-1 rounded-t bg-[#ddd6fb] hover:bg-[#6C4DF6] transition-colors" style={{ height: `${Math.max(6, (v / maxER) * 100)}%` }} title={`${v.toFixed(1)}% engagement`} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-[#aaa]"><span>newest</span><span>older</span></div>
        </div>
      )}
    </div>
  );
}

// Brand-fit card: paste a brand brief, get a 0-100 fit score with a transparent
// factor breakdown — all from public signals, no fabricated data. Brief seeds
// from the search prompt so it scores immediately, and stays editable.
function BrandFitCard({ profile, engagement, blacklistHits, initialBrief }: { profile: ProfileData; engagement: number | null; blacklistHits: { brand: string }[]; initialBrief: string }) {
  const [brief, setBrief] = useState(initialBrief);
  const report = brandFit(profile, engagement, brief, blacklistHits);
  const R = 26, C = 2 * Math.PI * R;
  const dash = report ? (report.score / 100) * C : 0;
  const barColor = (v: number) => (v >= 70 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444');
  const txtColor = (v: number) => (v >= 70 ? '#059669' : v >= 50 ? '#b45309' : '#dc2626');

  return (
    <div className="rounded-2xl border border-[#e3def9] bg-white p-4" style={{ animation: 'ii-fadeup .4s .1s both' }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-2">Brand fit</div>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={2}
        placeholder="Describe the brand or brief — e.g. sustainable skincare for Gen-Z women in metro cities"
        className="w-full px-2.5 py-2 rounded-lg border border-[#e3def9] text-[12px] resize-none focus:outline-none focus:border-[#6C4DF6]"
      />
      {!report ? (
        <p className="mt-2 text-[12px] text-[#888]">Enter a brand brief above to score how well this creator fits.</p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-4">
            <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
              <circle cx="32" cy="32" r={R} fill="none" stroke="#eee" strokeWidth="7" />
              <circle cx="32" cy="32" r={R} fill="none" stroke={report.color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${dash} ${C}`} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dasharray .5s ease' }} />
              <text x="32" y="33" textAnchor="middle" dominantBaseline="central" fontSize="17" fontWeight="700" fill="#111">{report.score}</text>
            </svg>
            <div className="min-w-0">
              <div className="text-[14px] font-bold" style={{ color: report.color }}>{report.band}</div>
              <p className="text-[12px] text-[#666] leading-snug">{report.verdict}</p>
            </div>
          </div>
          <div className="mt-3.5 space-y-2.5">
            {report.factors.map((f) => (
              <div key={f.key}>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#444] font-medium">{f.label}</span>
                  <span className="tabular-nums font-semibold" style={{ color: txtColor(f.value) }}>{f.value}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-[#f0eefb] overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${f.value}%`, background: barColor(f.value) }} />
                </div>
                <p className="mt-1 text-[11px] text-[#888] leading-snug">{f.detail}</p>
              </div>
            ))}
          </div>
          {report.missed.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-[#999] mb-1.5">Brief terms not found</div>
              <div className="flex flex-wrap gap-1.5">
                {report.missed.map((m) => (
                  <span key={m} className="px-2 py-0.5 rounded-full text-[11px] bg-[#fafafc] border border-[#eee] text-[#999]">{m}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// AI insights panel inside the profile drawer: auto-extracts the brands a
// creator has worked with + what they're known for, and answers free-form
// campaign-fit questions ("how good for a Goa campaign?") via /api/creator-ai.
// Typical share of a reel's total views accrued by N hours after posting —
// fast early, then a long tail. Used to turn an expected total into a
// views-over-time curve.
const REEL_CURVE = [
  { h: 1, f: 0.08 }, { h: 3, f: 0.18 }, { h: 6, f: 0.30 }, { h: 12, f: 0.45 },
  { h: 24, f: 0.62 }, { h: 48, f: 0.78 }, { h: 72, f: 0.88 }, { h: 120, f: 0.96 }, { h: 168, f: 1.0 },
];
// Reels are viewed far more than they're liked; ~6% like-through is typical, so
// views ≈ likes × ~16. A rough but consistent way to turn engagement → views.
const VIEWS_PER_LIKE = 16;
const hLabel = (h: number) => (h < 24 ? `${h}h` : `${h / 24}d`);

// Round a value up to a clean 1/2/5 × 10ⁿ so axis labels read nicely.
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const r = v / pow;
  const step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10;
  return step * pow;
}

interface ActualReel { ageH: number; views: number; live: boolean }
interface Forecast { expected: number; low: number; high: number; basisCount: number; avgLikes: number; curve: { h: number; low: number; exp: number; high: number }[]; actuals: ActualReel[] }

// taken_at can arrive as unix seconds or ms — normalise to ms.
function toMs(ts: number): number { return ts > 1e12 ? ts : ts * 1000; }

function reelForecast(profile: ProfileData): Forecast | null {
  const reels = profile.recent.filter((p) => p.is_video);
  const src = reels.length >= 2 ? reels : profile.recent;
  const likes = src.map((p) => p.likes).filter((n) => n > 0).sort((a, b) => a - b);
  if (likes.length < 2) return null;
  // Median + 20th/80th percentiles, so one viral/flop reel doesn't skew the
  // projection and the expected value always sits inside the low–high band.
  const pct = (q: number) => likes[Math.min(likes.length - 1, Math.max(0, Math.round(q * (likes.length - 1))))]!;
  const typicalLikes = pct(0.5);
  const expected = Math.round(typicalLikes * VIEWS_PER_LIKE);
  const low = Math.round(pct(0.2) * VIEWS_PER_LIKE);
  const high = Math.round(pct(0.8) * VIEWS_PER_LIKE);
  const curve = REEL_CURVE.map((c) => ({ h: c.h, low: Math.round(low * c.f), exp: Math.round(expected * c.f), high: Math.round(high * c.f) }));
  // Real recent reels plotted against the projection. Ones still inside the
  // 7-day window are "live" (in-flight, still gaining views); older ones are
  // settled and clamp to the right edge.
  const now = Date.now();
  const actuals: ActualReel[] = src
    .filter((p) => p.likes > 0 && p.taken_at != null)
    .map((p) => {
      const ageH = Math.max(0, (now - toMs(p.taken_at!)) / 3_600_000);
      return { ageH, views: Math.round(p.likes * VIEWS_PER_LIKE), live: ageH <= 168 };
    });
  return { expected, low, high, basisCount: src.length, avgLikes: Math.round(typicalLikes), curve, actuals };
}

// Projected views-over-time for a creator's NEXT reel, modelled from how their
// recent reels actually performed. Shows an expected curve with a low–high band
// so you can sanity-check a reel idea before commissioning it.
function ReelForecast({ profile }: { profile: ProfileData }) {
  const f = reelForecast(profile);
  // Re-render every 30s so any in-flight reel advances along the time axis,
  // giving the graph a genuinely live feel while the drawer stays open.
  const [, setTick] = useState(0);
  const hasLive = !!f && f.actuals.some((a) => a.live);
  useEffect(() => {
    if (!hasLive) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [hasLive]);
  if (!f) {
    return (
      <div className="rounded-2xl border border-[#e3def9] bg-white p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-2">Reel performance forecast</div>
        <p className="text-[12px] text-[#888]">Needs a few recent posts to project — hit “Refresh live”.</p>
      </div>
    );
  }
  const W = 320, H = 134, PAD_L = 34, PAD_R = 10, PAD_T = 8, PAD_B = 26;
  const n = f.curve.length;
  const liveCount = f.actuals.filter((a) => a.live).length;
  // Y-scale must contain the projection AND any real reel that overshot it,
  // rounded up to a clean number so the axis labels read nicely.
  const rawMax = Math.max(f.high, ...f.actuals.map((a) => a.views), 1);
  const axisMax = niceCeil(rawMax);
  const x = (i: number) => PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R);
  const xH = (h: number) => PAD_L + (Math.min(h, 168) / 168) * (W - PAD_L - PAD_R);
  const y = (v: number) => (H - PAD_B) - (v / axisMax) * (H - PAD_B - PAD_T);
  const yTicks = [0, axisMax / 2, axisMax];
  const lineExp = f.curve.map((c, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(c.exp).toFixed(1)}`).join(' ');
  const band =
    f.curve.map((c, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(c.high).toFixed(1)}`).join(' ') +
    ' ' +
    [...f.curve].reverse().map((c, i) => `L${x(n - 1 - i).toFixed(1)},${y(c.low).toFixed(1)}`).join(' ') +
    ' Z';

  return (
    <div className="rounded-2xl border border-[#e3def9] bg-white p-4" style={{ animation: 'ii-fadeup .4s .14s both' }}>
      <style>{`@keyframes ii-trace{to{stroke-dashoffset:0}}@keyframes ii-livepulse{0%,100%{r:3;opacity:1}50%{r:5;opacity:.55}}`}</style>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999]">Reel performance forecast</div>
        {liveCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#d97706]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" style={{ animation: 'ii-livepulse 1.4s ease-in-out infinite' }} />
            {liveCount} live now
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-[20px] font-bold text-[#111] tabular-nums">~{fmt(f.expected)}</div>
        <div className="text-[12px] text-[#888]">views in 7 days</div>
      </div>
      <div className="text-[12px] text-[#999] mb-2">Likely range {fmt(f.low)}–{fmt(f.high)} · from {f.basisCount} recent reels (typically {fmt(f.avgLikes)} likes)</div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }}>
        {/* Y-axis: horizontal gridlines + view-count labels */}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={PAD_L} y1={y(t)} x2={W - PAD_R} y2={y(t)} stroke="#efecfb" strokeWidth="1" />
            <text x={PAD_L - 5} y={y(t) + 3} textAnchor="end" fontSize="8" fill="#bbb">{t === 0 ? '0' : fmt(t)}</text>
          </g>
        ))}
        <text x={9} y={y(axisMax / 2)} textAnchor="middle" fontSize="8" fill="#bbb" transform={`rotate(-90 9 ${y(axisMax / 2)})`}>views</text>
        <path d={band} fill="#ede9fd" opacity="0.7" />
        <path d={lineExp} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          pathLength={1} strokeDasharray={1} strokeDashoffset={1} style={{ animation: 'ii-trace 1.1s .15s ease-out forwards' }} />
        {f.curve.map((c, i) => (
          <circle key={i} cx={x(i)} cy={y(c.exp)} r="2" fill={ACCENT} />
        ))}
        {/* Real recent reels overlaid on the projection. Settled reels clamp to
            the 7-day edge; in-flight reels sit at their real age and pulse. */}
        {f.actuals.map((a, i) => (
          <circle key={`a${i}`} cx={xH(a.ageH)} cy={y(a.views)} r={a.live ? 3 : 2.5}
            fill={a.live ? '#f59e0b' : '#c4b5fd'} stroke="#fff" strokeWidth="1"
            style={a.live ? { animation: 'ii-livepulse 1.6s ease-in-out infinite' } : undefined}>
            <title>{`${fmt(a.views)} est. views · ${a.live ? `${Math.round(a.ageH)}h old (still gaining)` : 'settled'}`}</title>
          </circle>
        ))}
        {/* X-axis: baseline, tick marks, time labels + caption */}
        <line x1={PAD_L} y1={y(0)} x2={W - PAD_R} y2={y(0)} stroke="#d9d3f2" strokeWidth="1" />
        {f.curve.map((c, i) => (
          (i === 0 || i === 4 || i === 6 || i === n - 1) ? (
            <g key={`t${i}`}>
              <line x1={x(i)} y1={y(0)} x2={x(i)} y2={y(0) + 4} stroke="#c9c2e8" strokeWidth="1" />
              <text x={x(i)} y={y(0) + 14} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="9" fill="#888">{hLabel(c.h)}</text>
            </g>
          ) : null
        ))}
        <text x={PAD_L + (W - PAD_L - PAD_R) / 2} y={H - 2} textAnchor="middle" fontSize="8" fill="#bbb">time after posting</text>
      </svg>

      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-[#999]">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-[2px] rounded" style={{ background: ACCENT }} /> expected</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded" style={{ background: '#ede9fd' }} /> low–high range</span>
        {liveCount > 0 && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f59e0b]" /> live reel</span>}
        {f.actuals.some((a) => !a.live) && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#c4b5fd]" /> past reel</span>}
      </div>
      <p className="mt-2 text-[11px] text-[#aaa] leading-snug">Projection from their recent reels, with their actual recent reels overlaid live. Hit “Refresh live” to re-pull — connect the account for continuous tracking.</p>
    </div>
  );
}

function CreatorAI({ body }: { body: Record<string, unknown> }) {
  const handle = String(body.handle ?? '');
  const [insight, setInsight] = useState<{ brands: string[]; content: string; summary: string; language: string; paid_performance: string; standout: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [chat, setChat] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  // Recompute insights whenever the underlying LIVE data changes — on open AND
  // after a "Refresh live" pull (fresh followers / engagement / posts) — so the
  // read stays real-time rather than frozen at first open.
  const insightKey = `${handle}|${body.followers ?? ''}|${body.engagement ?? ''}|${Array.isArray(body.recent_posts) ? (body.recent_posts as unknown[]).length : 0}|${Array.isArray(body.recent_captions) ? (body.recent_captions as unknown[]).join('').length : 0}`;
  useEffect(() => { setChat([]); setQ(''); }, [handle]); // reset chat only when switching creators
  useEffect(() => {
    let alive = true;
    setLoading(true); setFailed(false); setInsight(null);
    fetch('/api/creator-ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) setFailed(true);
        else setInsight({ brands: d.brands ?? [], content: d.content ?? '', summary: d.summary ?? '', language: d.language ?? '', paid_performance: d.paid_performance ?? '', standout: d.standout ?? '' });
      })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightKey]);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat, asking]);

  async function send(text?: string) {
    const question = (text ?? q).trim();
    if (question.length < 2 || asking) return;
    const next = [...chat, { role: 'user' as const, content: question }];
    setChat(next);
    setQ('');
    setAsking(true);
    try {
      const d = await fetch('/api/creator-ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, messages: next }),
      }).then((r) => r.json());
      setChat((c) => [...c, { role: 'assistant', content: d.error ? 'Could not reach AI right now.' : (d.answer || 'No answer.') }]);
    } catch {
      setChat((c) => [...c, { role: 'assistant', content: 'Could not reach AI right now.' }]);
    } finally {
      setAsking(false);
    }
  }

  const SUGGESTIONS = ['What should the first 3 seconds be?', 'Good fit for a Goa summer campaign?', 'Suggest a reel concept', 'Is the rate fair?'];

  return (
    <div className="rounded-2xl border border-[#e3def9] bg-gradient-to-br from-[#faf9ff] to-white p-4" style={{ animation: 'ii-fadeup .4s .1s both' }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-2.5">✦ AI insights</div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-3.5 w-2/3 rounded bg-[#efecfb] animate-pulse" />
          <div className="h-3.5 w-5/6 rounded bg-[#efecfb] animate-pulse" />
          <div className="h-3.5 w-1/2 rounded bg-[#efecfb] animate-pulse" />
        </div>
      ) : failed ? (
        <div className="text-[12px] text-[#888]">AI insights are unavailable right now.</div>
      ) : insight && (
        <div className="space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#999] mb-1.5">Brands worked with</div>
            {insight.brands.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {insight.brands.map((b) => (
                  <span key={b} className="px-2.5 py-1 rounded-full text-[12px] font-medium border border-[#e3def9] bg-white" style={{ color: ACCENT }}>{b}</span>
                ))}
              </div>
            ) : (
              <div className="text-[12px] text-[#999]">No clear brand collaborations detected in recent posts.</div>
            )}
          </div>
          {insight.language && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#999] mb-1">Content language</div>
              <span className="inline-block px-2.5 py-1 rounded-full text-[12px] font-medium border border-[#e3def9] bg-[#f6f4ff]" style={{ color: ACCENT }}>{insight.language}</span>
            </div>
          )}
          {insight.content && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#999] mb-1">Known for</div>
              <p className="text-[13px] text-[#333] leading-relaxed">{insight.content}</p>
            </div>
          )}
          {insight.paid_performance && (
            <div className="rounded-lg bg-[#faf9ff] border border-[#efecfb] p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-[#999] mb-1">💼 Paid campaign performance</div>
              <p className="text-[12.5px] text-[#333] leading-relaxed">{insight.paid_performance}</p>
            </div>
          )}
          {insight.standout && (
            <div className="rounded-lg bg-[#fffdf5] border border-[#f3e9c8] p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-[#a98b2e] mb-1">⭐ Stands out because</div>
              <p className="text-[12.5px] text-[#5c4d22] leading-relaxed">{insight.standout}</p>
            </div>
          )}
          {insight.summary && (
            <p className="text-[12px] text-[#666] leading-relaxed border-t border-[#efecfb] pt-2.5">{insight.summary}</p>
          )}
        </div>
      )}

      <div className="mt-3.5 pt-3.5 border-t border-[#efecfb]">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] uppercase tracking-wide text-[#999]">Ask AI · chat</div>
          {chat.length > 0 && (
            <button onClick={() => setChat([])} className="text-[10px] text-[#aaa] hover:text-[#666]">Clear</button>
          )}
        </div>

        {(chat.length > 0 || asking) && (
          <div ref={threadRef} className="mb-2 max-h-60 overflow-y-auto flex flex-col gap-2 pr-0.5">
            {chat.map((m, i) => (
              <div
                key={i}
                className={`max-w-[88%] px-2.5 py-1.5 rounded-2xl text-[12.5px] leading-relaxed whitespace-pre-line ${
                  m.role === 'user'
                    ? 'self-end text-white rounded-br-sm'
                    : 'self-start bg-white border border-[#e3def9] text-[#333] rounded-bl-sm'
                }`}
                style={m.role === 'user' ? { background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` } : { animation: 'ii-fadeup .25s both' }}
              >
                {m.content}
              </div>
            ))}
            {asking && (
              <div className="self-start bg-white border border-[#e3def9] text-[#999] px-3 py-2 rounded-2xl rounded-bl-sm text-[12px]">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#c4b9f5] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#c4b9f5] animate-bounce" style={{ animationDelay: '120ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#c4b9f5] animate-bounce" style={{ animationDelay: '240ms' }} />
                </span>
              </div>
            )}
          </div>
        )}

        {chat.length === 0 && !asking && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium border border-[#e3def9] bg-white text-[#555] hover:border-[#6C4DF6] hover:text-[#6C4DF6] transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
            placeholder={chat.length ? 'Ask a follow-up…' : 'Ask anything — e.g. what should the first 3 seconds be?'}
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-[#e3def9] text-[12px] focus:outline-none focus:border-[#6C4DF6]"
          />
          <button
            onClick={() => void send()}
            disabled={asking || q.trim().length < 2}
            className="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold disabled:opacity-50 hover:brightness-105"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #9b7bff)` }}
          >
            {asking ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title, disabled }: { children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-7 h-7 grid place-items-center rounded-lg border border-[#e3def9] hover:bg-[#faf9ff] disabled:opacity-50 transition-colors"
      style={{ color: ACCENT }}
    >
      {children}
    </button>
  );
}

function Avatar({ name, url, handle }: { name: string; url?: string | null; handle?: string | null }) {
  // Image source falls through stages: stored photo (proxied) → live photo
  // fetched by handle (for DB creators with no stored photo) → initials.
  const [stage, setStage] = useState(0);
  const cleanHandle = handle?.replace(/^@/, '');

  let src: string | null = null;
  if (stage === 0 && url) src = `/api/ig-image?u=${encodeURIComponent(url)}`;
  else if (stage < 2 && cleanHandle) src = `/api/ig-avatar?handle=${encodeURIComponent(cleanHandle)}`;

  if (src) {
    // IG CDN blocks hotlinking — route through our server-side proxy.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        onError={() => setStage((s) => (s === 0 && url ? 1 : 2))}
        className="w-9 h-9 rounded-full object-cover shrink-0 bg-[#eee]"
      />
    );
  }
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return (
    <div
      className="w-9 h-9 rounded-full grid place-items-center text-white text-[12px] font-semibold shrink-0"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))` }}
    >
      {initials}
    </div>
  );
}
