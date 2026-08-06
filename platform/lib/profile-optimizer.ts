// ============================================================
// Profile / bio optimizer — the bio is the landing page every new visitor hits
// before deciding to follow (or to reach out for a collab). This grades the
// profile against the handful of things that actually convert: a clear "what I
// do", a searchable keyword in the name field, a call-to-action, a working link,
// and a scannable structure. Each check comes with a concrete fix, and the whole
// thing rolls into a score plus a ready-to-paste bio rewrite.
//
// Pure and deterministic: plain rules over the profile fields the route already
// fetched. No ML, no LLM. Suggestions are starting points, not gospel.
// ============================================================

export interface ProfileInput {
  name: string | null;
  username: string | null;
  biography: string | null;
  website: string | null;
  niche: string | null;
  followers: number | null;
}

export interface ProfileCheck {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  fix: string | null;
}

export interface ProfileOptimizer {
  available: boolean;
  score: number;
  grade: 'sharp' | 'solid' | 'needs-work';
  checks: ProfileCheck[];
  suggested_bio: string | null;
  headline: string | null;
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;
// Words that signal the creator has stated what they DO / who they are.
const NICHE_HINTS = ['creator', 'blogger', 'vlogger', 'artist', 'chef', 'coach', 'founder', 'designer',
  'photographer', 'model', 'fitness', 'travel', 'food', 'fashion', 'beauty', 'makeup', 'tech', 'gaming',
  'music', 'dance', 'comedy', 'lifestyle', 'wellness', 'yoga', 'author', 'writer', 'entrepreneur',
  'influencer', 'content', 'stylist', 'nutritionist', 'educator', 'speaker', 'consultant'];
// Phrases that act as a call-to-action.
const CTA_HINTS = ['dm', 'email', 'collab', 'link below', 'link in bio', 'shop', 'book', 'subscribe',
  'sign up', 'join', 'download', 'watch', 'follow for', 'tap the link', '👇', '⬇', 'contact', 'enquir',
  'inquir', 'business', 'partnerships', 'work with'];

export function analyzeProfile(p: ProfileInput): ProfileOptimizer {
  const bio = (p.biography ?? '').trim();
  const name = (p.name ?? '').trim();
  const hasBio = bio.length > 0;

  const empty: ProfileOptimizer = {
    available: false, score: 0, grade: 'needs-work', checks: [], suggested_bio: null, headline: null,
  };
  // Need at least a profile to assess.
  if (!p.username && !hasBio && !name) return empty;

  const bioLower = bio.toLowerCase();
  const nameLower = name.toLowerCase();
  const checks: ProfileCheck[] = [];
  let score = 100;

  // 1) Bio present & substantive.
  if (!hasBio) {
    score -= 30;
    checks.push({ key: 'bio', label: 'Bio filled in', status: 'fail',
      detail: 'Your bio is empty — the single biggest missed conversion opportunity.',
      fix: 'Write 2–3 short lines: who you are, what you post, and one call-to-action.' });
  } else if (bio.length < 25) {
    score -= 12;
    checks.push({ key: 'bio', label: 'Bio filled in', status: 'warn',
      detail: `Your bio is very short (${bio.length} chars) — there's room to say more.`,
      fix: 'Add a line on what a visitor gets by following you.' });
  } else {
    checks.push({ key: 'bio', label: 'Bio filled in', status: 'pass',
      detail: 'You have a substantive bio for visitors to read.', fix: null });
  }

  // 2) Clear "what I do" / niche keyword.
  const nicheWord = p.niche?.trim().toLowerCase() || null;
  const statesNiche = NICHE_HINTS.some((h) => bioLower.includes(h)) || (nicheWord != null && bioLower.includes(nicheWord));
  if (hasBio && statesNiche) {
    checks.push({ key: 'niche', label: 'Clear niche', status: 'pass',
      detail: 'Your bio makes it clear what you do — visitors know what they\u2019re following.', fix: null });
  } else {
    score -= 18;
    checks.push({ key: 'niche', label: 'Clear niche', status: hasBio ? 'warn' : 'fail',
      detail: 'It\u2019s not obvious what you do from the bio — visitors bounce when they can\u2019t tell.',
      fix: `Lead with your lane, e.g. “${nicheWord ? cap(nicheWord) : 'Fashion & lifestyle'} creator” on line one.` });
  }

  // 3) Call-to-action.
  const hasCTA = hasBio && CTA_HINTS.some((h) => bioLower.includes(h));
  if (hasCTA) {
    checks.push({ key: 'cta', label: 'Call-to-action', status: 'pass',
      detail: 'Your bio tells visitors what to do next.', fix: null });
  } else {
    score -= 15;
    checks.push({ key: 'cta', label: 'Call-to-action', status: 'warn',
      detail: 'No clear call-to-action — visitors don\u2019t know how to work with you.',
      fix: 'Add a line like “📩 Collabs: name@email” or “Shop my picks 👇”.' });
  }

  // 4) Link present.
  if (p.website && p.website.trim().length > 0) {
    checks.push({ key: 'link', label: 'Link in bio', status: 'pass',
      detail: 'You have a link — the only clickable path off your profile.', fix: null });
  } else {
    score -= 15;
    checks.push({ key: 'link', label: 'Link in bio', status: 'fail',
      detail: 'No link in bio — you\u2019re losing every visitor who wants to go deeper.',
      fix: 'Add a link (a link-in-bio page, your shop, or latest content).' });
  }

  // 5) Searchable name field (IG indexes the Name field, not just the handle).
  const nameIsJustHandle = !name || nameLower === (p.username ?? '').toLowerCase();
  const nameHasKeyword = NICHE_HINTS.some((h) => nameLower.includes(h)) || (nicheWord != null && nameLower.includes(nicheWord));
  if (name && nameHasKeyword) {
    checks.push({ key: 'name', label: 'Searchable name', status: 'pass',
      detail: 'Your name field carries a keyword Instagram search can index.', fix: null });
  } else {
    score -= 12;
    checks.push({ key: 'name', label: 'Searchable name', status: 'warn',
      detail: nameIsJustHandle
        ? 'Your name field just repeats your handle — a wasted search field.'
        : 'Your name field has no discoverable keyword.',
      fix: `Set your name to “Name | ${nicheWord ? cap(nicheWord) : 'Your niche'}” so you surface in search.` });
  }

  // 6) Scannability (line breaks / emoji as visual anchors).
  if (hasBio) {
    const lines = bio.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
    const hasEmoji = EMOJI_RE.test(bio);
    if (lines >= 2 || hasEmoji) {
      checks.push({ key: 'structure', label: 'Scannable layout', status: 'pass',
        detail: 'Your bio uses line breaks / emojis so it\u2019s easy to skim.', fix: null });
    } else {
      score -= 8;
      checks.push({ key: 'structure', label: 'Scannable layout', status: 'warn',
        detail: 'Your bio is one dense block — harder to skim in the 2 seconds you get.',
        fix: 'Break it into short lines and add an emoji or two as visual anchors.' });
    }
  }

  score = Math.max(0, Math.min(100, score));
  const grade: ProfileOptimizer['grade'] = score >= 82 ? 'sharp' : score >= 60 ? 'solid' : 'needs-work';

  // ---- Ready-to-paste bio rewrite ---------------------------------------
  const nicheLabel = nicheWord ? cap(nicheWord) : 'Lifestyle';
  const firstName = name ? name.split(/\s+/)[0] : (p.username ?? 'You');
  const suggested_bio = [
    `${nicheLabel} creator ✨`,
    `Helping you with ${nicheWord ? nicheWord : 'daily inspo'} | ${followerBadge(p.followers)}`,
    `📩 Collabs: ${firstName?.toLowerCase()}@email.com`,
    `Latest below 👇`,
  ].join('\n');

  const failing = checks.filter((c) => c.status !== 'pass').length;
  const headline = grade === 'sharp'
    ? 'Your profile is sharp — it tells visitors who you are and what to do next.'
    : `${failing} quick fix${failing === 1 ? '' : 'es'} would turn more profile visits into follows and collab enquiries.`;

  return { available: true, score, grade, checks, suggested_bio, headline };
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function followerBadge(f: number | null): string {
  if (!f || f <= 0) return 'Join the community';
  const n = f >= 1_000_000 ? (f / 1_000_000).toFixed(1) + 'M' : f >= 1_000 ? Math.round(f / 1_000) + 'K' : String(f);
  return `${n} strong`;
}
