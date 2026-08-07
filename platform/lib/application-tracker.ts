// ============================================================
// Application tracker — a creator can browse open campaigns and hit "Apply",
// which writes a program_recruits row with status 'applied'. But then it
// vanishes: the deals workspace only surfaces LIVE/priced deals, so a pure
// application (no rate, not yet accepted) shows up nowhere and the creator has
// no idea whether they've been seen, passed over, or picked up. This turns those
// same rows into a visible pipeline — what you applied to, where each stands,
// and what to do next.
//
// Pure and deterministic: it only classifies and orders the rows the route
// fetched — no ML/LLM, no writes. "today" is injected so relative dates are
// testable and timezone-honest.
// ============================================================

export interface ApplicationInput {
  program_id: string;
  program: string;
  brand: string;
  status: string;
  rate: number;
  created_at: string | null;  // ISO
}

// Where an application currently stands, from the creator's point of view.
export type Outcome = 'pending' | 'advanced' | 'accepted' | 'closed';

export interface ApplicationView {
  program_id: string;
  program: string;
  brand: string;
  status: string;
  outcome: Outcome;
  stage_label: string;
  detail: string;         // one-line "what this means / do next"
  target: 'campaign' | 'deals';  // where the CTA should point
  cta_label: string;
  when: string;           // ISO for sort
  when_label: string;     // "3d ago"
}

export interface ApplicationTracker {
  available: boolean;
  total: number;
  counts: { pending: number; advanced: number; accepted: number; closed: number };
  items: ApplicationView[];
  headline: string;
}

const DAY_MS = 86_400_000;

// Brand has engaged after the creator applied, but it's not a committed deal yet.
const ADVANCED_STATUSES = new Set(['contacted', 'invited', 'recruited']);
// A committed, live (or completed) deal.
const ACCEPTED_STATUSES = new Set(['accepted', 'active', 'paid']);
const CLOSED_STATUSES = new Set(['declined', 'rejected', 'withdrawn']);

function daysAgo(fromISO: string, today: string): number | null {
  const a = new Date(fromISO.slice(0, 10) + 'T00:00:00Z').getTime();
  const b = new Date(today + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}
function relLabel(fromISO: string | null, today: string): string {
  if (!fromISO) return '';
  const d = daysAgo(fromISO, today);
  if (d == null) return '';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(fromISO.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function classify(status: string, paidHint: boolean): { outcome: Outcome; label: string; detail: string; target: ApplicationView['target']; cta: string } {
  const s = (status ?? '').toLowerCase();
  if (s === 'paid' || paidHint) {
    return { outcome: 'accepted', label: 'Completed', detail: 'This collaboration is done and paid.', target: 'deals', cta: 'View deal' };
  }
  if (ACCEPTED_STATUSES.has(s)) {
    return { outcome: 'accepted', label: 'Accepted', detail: 'You\u2019re on board \u2014 this is now a live deal.', target: 'deals', cta: 'Open deal' };
  }
  if (ADVANCED_STATUSES.has(s)) {
    return { outcome: 'advanced', label: 'Brand responded', detail: 'The brand reached out \u2014 reply from your deals.', target: 'deals', cta: 'Respond' };
  }
  if (CLOSED_STATUSES.has(s)) {
    return { outcome: 'closed', label: 'Not selected', detail: 'Not a fit this time. Plenty more campaigns to apply to.', target: 'campaign', cta: 'View campaign' };
  }
  // 'applied' and anything unrecognised → still waiting.
  return { outcome: 'pending', label: 'Awaiting review', detail: 'Sent \u2014 waiting for the brand to review your profile.', target: 'campaign', cta: 'View campaign' };
}

const OUTCOME_RANK: Record<Outcome, number> = { advanced: 0, pending: 1, accepted: 2, closed: 3 };

export function buildApplicationTracker(apps: ApplicationInput[], todayISO: string): ApplicationTracker {
  const today = todayISO.slice(0, 10);

  const items: ApplicationView[] = apps.map((a) => {
    const c = classify(a.status, false);
    const when = a.created_at ?? todayISO;
    return {
      program_id: a.program_id,
      program: a.program,
      brand: a.brand,
      status: a.status,
      outcome: c.outcome,
      stage_label: c.label,
      detail: c.detail,
      target: c.target,
      cta_label: c.cta,
      when,
      when_label: relLabel(a.created_at, today),
    };
  });

  // Brand-responded first (needs action), then pending, then accepted, then
  // closed; within each, most recent first.
  items.sort((x, y) => OUTCOME_RANK[x.outcome] - OUTCOME_RANK[y.outcome] || y.when.localeCompare(x.when));

  const counts = {
    pending: items.filter((i) => i.outcome === 'pending').length,
    advanced: items.filter((i) => i.outcome === 'advanced').length,
    accepted: items.filter((i) => i.outcome === 'accepted').length,
    closed: items.filter((i) => i.outcome === 'closed').length,
  };

  let headline: string;
  if (items.length === 0) {
    headline = 'You haven\u2019t applied to any campaigns yet.';
  } else if (counts.advanced > 0) {
    headline = `${counts.advanced} brand${counts.advanced === 1 ? '' : 's'} responded \u2014 reply before they move on.`;
  } else if (counts.pending > 0) {
    headline = `${counts.pending} application${counts.pending === 1 ? '' : 's'} awaiting review.`;
  } else if (counts.accepted > 0) {
    headline = `${counts.accepted} of your applications turned into deals.`;
  } else {
    headline = 'No open applications right now \u2014 browse campaigns to apply.';
  }

  return {
    available: items.length > 0,
    total: items.length,
    counts,
    items,
    headline,
  };
}
