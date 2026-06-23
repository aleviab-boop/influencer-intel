// Pure scoring helpers for the exportable creator one-pager. Mirrors the logic
// behind the profile drawer's cards (brand fit, authenticity, reel forecast,
// persona) but framed around the /api/ig-profile response shape, with no React.
// Basics (fmt, rate, themes, posting, brand-safety) come from creator-metrics.

import { expectedErFloor, contentThemes, brandSafety, inr, fmt, tierWord } from './creator-metrics';

export interface ReportPost {
  shortcode?: string;
  thumbnail?: string | null;
  likes: number;
  comments: number;
  is_video?: boolean;
  taken_at?: number | null;
  caption?: string;
}

export interface ReportProfile {
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
  recent: ReportPost[];
  collabs?: { handle: string; count: number }[];
  sponsored_posts?: number;
  engagement?: number | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function authenticityFlag(followers: number, engagement?: number | null): 'healthy' | 'low' | null {
  if (!engagement || engagement <= 0) return null;
  return engagement >= expectedErFloor(followers) ? 'healthy' : 'low';
}

export function isRisingStar(followers: number, engagement: number | null): boolean {
  if (engagement == null || followers <= 0) return false;
  return followers < 250_000 && engagement >= expectedErFloor(followers) * 1.6;
}

export function personaLine(
  p: { followers: number; category?: string; email?: string | null; phone?: string | null },
  engagement: number | null,
  rate: { low: number; high: number } | null,
  cadence: string | null,
  themes: string[],
): string {
  const tier = tierWord(p.followers);
  const niche = p.category?.trim();
  const who = niche ? `${tier} ${niche.toLowerCase()}` : themes[0] ? `${tier} ${themes[0].replace(/^#/, '')} creator` : `${tier} creator`;
  const parts = [who];
  if (engagement != null) parts.push(`${engagement}% ER ${engagement >= expectedErFloor(p.followers) ? '(healthy)' : '(low)'}`);
  if (rate) parts.push(`~${inr(rate.low)}–${inr(rate.high)}/post`);
  if (cadence) parts.push(cadence.toLowerCase());
  if (isRisingStar(p.followers, engagement)) parts.push('on the rise');
  if (p.email) parts.push('email on file');
  else if (p.phone) parts.push('phone on file');
  return parts.join(' · ');
}

// ── Authenticity ────────────────────────────────────────────────────────────
export interface AuthFactor { key: string; label: string; value: number; detail: string }
export interface AuthReport { score: number; band: 'Strong' | 'Moderate' | 'Caution'; color: string; verdict: string; factors: AuthFactor[]; perPost: number[] }

export function authenticityReport(profile: ReportProfile, engagement: number | null): AuthReport | null {
  const recent = profile.recent ?? [];
  if (recent.length < 1 || profile.followers <= 0) return null;
  const followers = profile.followers;
  const floor = expectedErFloor(followers);
  const perPost = recent.map((p) => ((p.likes + p.comments) / followers) * 100);
  const er = engagement ?? perPost.reduce((s, x) => s + x, 0) / perPost.length;
  const ratio = er / floor;
  const engScore = clamp(ratio * 50, 8, 100);
  const totalLikes = recent.reduce((s, p) => s + p.likes, 0);
  const totalComments = recent.reduce((s, p) => s + p.comments, 0);
  const cpl = (totalComments / Math.max(1, totalLikes)) * 100;
  const commentScore = clamp(20 + cpl * 30, 5, 100);
  const mean = perPost.reduce((s, x) => s + x, 0) / perPost.length;
  const sd = Math.sqrt(perPost.reduce((s, x) => s + (x - mean) ** 2, 0) / perPost.length);
  const cv = mean > 0 ? sd / mean : 1;
  const consistencyScore = clamp(100 - cv * 120, 5, 100);
  const fr = profile.following / Math.max(1, followers);
  const ratioScore = clamp(100 - fr * 70, 15, 98);
  const score = Math.round(engScore * 0.4 + commentScore * 0.25 + consistencyScore * 0.2 + ratioScore * 0.15);
  const band: AuthReport['band'] = score >= 75 ? 'Strong' : score >= 55 ? 'Moderate' : 'Caution';
  const color = band === 'Strong' ? '#059669' : band === 'Moderate' ? '#b45309' : '#dc2626';
  const verdict =
    band === 'Strong' ? 'Signals point to a real, engaged audience — safe to shortlist.'
      : band === 'Moderate' ? 'Mostly healthy, with one or two signals worth a manual check.'
        : 'Several signals look off — verify the audience before committing budget.';
  const factors: AuthFactor[] = [
    { key: 'engagement', label: 'Engagement strength', value: Math.round(engScore), detail: `${er.toFixed(1)}% engagement vs ~${floor}% expected at ${fmt(followers)} followers — ${ratio >= 1 ? 'above' : 'below'} benchmark.` },
    { key: 'comments', label: 'Comment quality', value: Math.round(commentScore), detail: `${cpl.toFixed(1)} comments per 100 likes — ${cpl >= 1 ? 'genuine conversation, not just passive likes.' : 'light on comments relative to likes.'}` },
    { key: 'consistency', label: 'Consistency', value: Math.round(consistencyScore), detail: cv <= 0.4 ? 'Engagement is steady across recent posts.' : 'Engagement swings a lot post-to-post — worth a look.' },
    { key: 'ratio', label: 'Audience ratio', value: Math.round(ratioScore), detail: `Follows ${fmt(profile.following)} vs ${fmt(followers)} followers — ${fr <= 0.3 ? 'healthy ratio.' : 'follows back heavily, can dilute audience quality.'}` },
  ];
  return { score, band, color, verdict, factors, perPost };
}

// ── Competitor conflict ─────────────────────────────────────────────────────
const COMPETITOR_BRANDS: { name: string; terms: string[] }[] = [
  { name: 'Myntra', terms: ['myntra'] }, { name: 'Zara', terms: ['zara'] },
  { name: 'Max Fashion', terms: ['maxfashion', 'max fashion'] }, { name: 'Pantaloons', terms: ['pantaloons'] },
  { name: 'Ajio', terms: ['ajio'] }, { name: 'Westside', terms: ['westside'] },
];
const BLACKLIST_WINDOW_DAYS = 30;

export function competitorConflicts(recent: ReportPost[], extraTerms: string[] = []): { brand: string; daysAgo: number }[] {
  const nowSec = Date.now() / 1000;
  const windowSec = BLACKLIST_WINDOW_DAYS * 86_400;
  const brands = [...COMPETITOR_BRANDS, ...extraTerms.map((t) => ({ name: t, terms: [t.toLowerCase()] }))];
  const byBrand = new Map<string, { brand: string; daysAgo: number }>();
  for (const p of recent) {
    if (!p.caption || !p.taken_at) continue;
    if (nowSec - p.taken_at > windowSec) continue;
    const cap = p.caption.toLowerCase();
    for (const b of brands) {
      if (b.terms.some((t) => t && cap.includes(t))) {
        const daysAgo = Math.max(0, Math.round((nowSec - p.taken_at) / 86_400));
        const ex = byBrand.get(b.name);
        if (!ex || daysAgo < ex.daysAgo) byBrand.set(b.name, { brand: b.name, daysAgo });
        break;
      }
    }
  }
  return [...byBrand.values()].sort((a, b) => a.daysAgo - b.daysAgo);
}

// ── Brand fit ───────────────────────────────────────────────────────────────
const FIT_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'our', 'your', 'who', 'are', 'was', 'will', 'can', 'has', 'have', 'had', 'not', 'but', 'all', 'any', 'out', 'use', 'want', 'need', 'looking', 'look', 'find', 'creators', 'creator', 'influencer', 'influencers', 'content', 'brand', 'brands', 'campaign', 'someone', 'people', 'they', 'their', 'them', 'about', 'into', 'over', 'more', 'most', 'very', 'really', 'good', 'great', 'best', 'top', 'new', 'india', 'indian', 'instagram', 'reel', 'reels', 'post', 'posts', 'whose']);

export function fitKeywords(brief: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of brief.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 3 || FIT_STOPWORDS.has(raw) || /^\d+$/.test(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out.slice(0, 12);
}

export interface FitFactor { key: string; label: string; value: number; detail: string }
export interface FitReport { score: number; band: 'Strong fit' | 'Possible fit' | 'Weak fit'; color: string; verdict: string; factors: FitFactor[]; matched: string[]; missed: string[] }

export function brandFit(profile: ReportProfile, engagement: number | null, brief: string): FitReport | null {
  const kws = fitKeywords(brief);
  if (kws.length === 0) return null;
  const haystack = [profile.full_name, profile.biography, profile.category, contentThemes(profile.recent, 20).join(' '), ...profile.recent.map((p) => p.caption ?? '')].join(' ').toLowerCase();
  const matched = kws.filter((k) => haystack.includes(k));
  const missed = kws.filter((k) => !haystack.includes(k));
  const nicheScore = clamp(Math.round((matched.length / kws.length) * 100), matched.length ? 25 : 4, 100);
  const floor = expectedErFloor(profile.followers);
  const erScore = engagement && engagement > 0 ? clamp(Math.round((engagement / floor) * 55), 18, 100) : 50;
  const auth = authenticityReport(profile, engagement);
  const authScore = auth ? auth.score : 60;
  const safety = brandSafety([profile.biography ?? '', ...profile.recent.map((p) => p.caption ?? '')]);
  const safetyScore = safety.level === 'clean' ? 100 : safety.level === 'review' ? 55 : 18;
  const blacklistHits = competitorConflicts(profile.recent);
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
    { key: 'er', label: 'Engagement fit', value: erScore, detail: engagement && engagement > 0 ? `${engagement}% ER vs ~${floor}% expected at this follower size.` : 'Engagement data not available.' },
    { key: 'auth', label: 'Audience authenticity', value: authScore, detail: auth ? `${auth.band} authenticity signals from recent posts.` : 'Not enough recent posts to assess.' },
    { key: 'safety', label: 'Brand safety', value: safetyScore, detail: safety.level === 'clean' ? 'No risk flags in recent posts.' : `Flagged: ${safety.hits.map((h) => h.category).join(', ')}.` },
  ];
  if (conflict) factors.push({ key: 'conflict', label: 'Competitor conflict', value: 15, detail: `Recently collaborated with ${blacklistHits.map((h) => h.brand).join(', ')} — score penalised.` });
  return { score, band, color, verdict, factors, matched, missed };
}

// ── Reel forecast ───────────────────────────────────────────────────────────
const VIEWS_PER_LIKE = 16;
export interface Forecast { expected: number; low: number; high: number; basisCount: number; avgLikes: number }

export function reelForecast(profile: ReportProfile): Forecast | null {
  const reels = profile.recent.filter((p) => p.is_video);
  const src = reels.length >= 2 ? reels : profile.recent;
  const likes = src.map((p) => p.likes).filter((n) => n > 0).sort((a, b) => a - b);
  if (likes.length < 2) return null;
  const pct = (q: number) => likes[Math.min(likes.length - 1, Math.max(0, Math.round(q * (likes.length - 1))))]!;
  const typicalLikes = pct(0.5);
  return {
    expected: Math.round(typicalLikes * VIEWS_PER_LIKE),
    low: Math.round(pct(0.2) * VIEWS_PER_LIKE),
    high: Math.round(pct(0.8) * VIEWS_PER_LIKE),
    basisCount: src.length,
    avgLikes: Math.round(typicalLikes),
  };
}
