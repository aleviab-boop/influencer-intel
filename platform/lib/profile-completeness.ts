// ============================================================
// Profile completeness — the portal now has a lot of surfaces (settings, payout,
// media kit, deals), but a creator dropping in cold has no idea what to do
// first or why their media kit looks thin. This scores how "set up" they are
// and turns it into a short, ordered checklist with a single clear next step,
// so onboarding is guided rather than a scavenger hunt.
//
// Pure and deterministic: it reads a handful of booleans/counts the route
// already gathered (profile fields, payout status, deal counts) and applies
// fixed weights — no ML/LLM, no writes. The weights encode what actually makes
// a creator brand-ready: a payout method and a bio matter more than a city.
// ============================================================

export interface CompletenessInput {
  has_name: boolean;
  has_bio: boolean;
  has_category: boolean;
  has_city: boolean;
  has_photo: boolean;
  has_followers: boolean;
  has_payout: boolean;
  has_activity: boolean;   // applied to / been recruited for at least one campaign
}

export interface ChecklistItem {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  weight: number;
  href: string;
}

export interface Completeness {
  score: number;                 // 0-100, weighted
  grade: 'complete' | 'strong' | 'getting-there' | 'just-started';
  done_count: number;
  total_count: number;
  headline: string;
  next: { label: string; hint: string; href: string } | null;  // first undone item
  items: ChecklistItem[];
}

const SETTINGS = '/creator/settings';
const PAYOUT = '/creator/payout';
const CAMPAIGNS = '/creator';

// Ordered by onboarding priority. Weights sum to 100.
function buildItems(i: CompletenessInput): ChecklistItem[] {
  return [
    { key: 'name', label: 'Add your display name', hint: 'How brands see you.', done: i.has_name, weight: 12, href: SETTINGS },
    { key: 'bio', label: 'Write a short bio', hint: 'Your pitch — what you make and for whom.', done: i.has_bio, weight: 20, href: SETTINGS },
    { key: 'niche', label: 'Set your niche', hint: 'Your primary category powers brand matches.', done: i.has_category, weight: 14, href: SETTINGS },
    { key: 'city', label: 'Add your city', hint: 'Location helps local and regional briefs find you.', done: i.has_city, weight: 8, href: SETTINGS },
    { key: 'photo', label: 'Have a profile photo', hint: 'A face makes your media kit land.', done: i.has_photo, weight: 8, href: SETTINGS },
    { key: 'followers', label: 'Reach data on file', hint: 'Follower count anchors your suggested rates.', done: i.has_followers, weight: 8, href: CAMPAIGNS },
    { key: 'payout', label: 'Add a payout method', hint: 'So brands know exactly where to pay you.', done: i.has_payout, weight: 22, href: PAYOUT },
    { key: 'activity', label: 'Apply to a campaign', hint: 'Get into the running for a brand deal.', done: i.has_activity, weight: 8, href: CAMPAIGNS },
  ];
}

export function computeCompleteness(input: CompletenessInput): Completeness {
  const items = buildItems(input);
  const total = items.reduce((s, it) => s + it.weight, 0) || 1;
  const earned = items.filter((it) => it.done).reduce((s, it) => s + it.weight, 0);
  const score = Math.round((earned / total) * 100);
  const doneCount = items.filter((it) => it.done).length;

  const grade: Completeness['grade'] =
    score >= 100 ? 'complete' : score >= 75 ? 'strong' : score >= 40 ? 'getting-there' : 'just-started';

  const firstUndone = items.find((it) => !it.done) ?? null;
  const next = firstUndone
    ? { label: firstUndone.label, hint: firstUndone.hint, href: firstUndone.href }
    : null;

  const headline =
    grade === 'complete' ? 'Your profile is brand-ready.'
    : grade === 'strong' ? `Almost there — ${items.length - doneCount} step${items.length - doneCount === 1 ? '' : 's'} left to be brand-ready.`
    : grade === 'getting-there' ? 'Good start — a few more details make you far easier to book.'
    : 'Let\u2019s get your profile ready for brands.';

  return { score, grade, done_count: doneCount, total_count: items.length, headline, next, items };
}
