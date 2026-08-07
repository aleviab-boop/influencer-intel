// ============================================================
// Brand action inbox — the campaign list tells a brand what campaigns EXIST, and
// each campaign's review page shows one campaign's submissions, but nothing rolls
// the brand's actual to-do across ALL its live campaigns into one place. This is
// the brand counterpart to the creator's notification feed: it answers "what
// needs me right now" — creators waiting on an application decision, submitted
// links awaiting a verdict, creators fully approved and owed money, and deadlines
// that have slipped with nothing delivered.
//
// Pure and deterministic: it classifies the recruit rows the route fetched — no
// ML/LLM, no writes. It reuses buildProgramReview() for the submission-derived
// counts so the two brand views can never disagree. "today" is injected for
// testable, timezone-honest relative dates.
// ============================================================

import { normalizeStored } from './deliverable-submission';
import { buildProgramReview, type ReviewRecruitInput } from './submission-review';

export interface InboxRecruitInput extends ReviewRecruitInput {
  created_at: string | null; // ISO
}

export interface InboxProgramInput {
  program_id: string;
  program_name: string;
  recruits: InboxRecruitInput[];
}

export type BrandInboxKind = 'applications' | 'review' | 'pay' | 'overdue';

export interface BrandInboxItem {
  id: string;
  kind: BrandInboxKind;
  severity: 'action' | 'info';
  title: string;
  body: string;
  program_id: string;
  program_name: string;
  count: number;
  href: string;
}

export interface BrandInbox {
  available: boolean;
  action_count: number;
  total: number;
  counts: { applications: number; review: number; ready_to_pay: number; overdue: number };
  headline: string | null;
  items: BrandInboxItem[];
}

const DAY_MS = 86_400_000;

function daysBetween(fromISO: string, toISO: string): number | null {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

// Kind ordering when both items are actions — unblock creators first (verdicts,
// then application decisions), then pay, then chase overdue deliveries.
const KIND_RANK: Record<BrandInboxKind, number> = { review: 0, applications: 1, pay: 2, overdue: 3 };

export function buildBrandInbox(programs: InboxProgramInput[], todayISO: string): BrandInbox {
  const today = todayISO.slice(0, 10);
  const items: BrandInboxItem[] = [];

  for (const prog of programs) {
    const recruits = prog.recruits.filter((r) => (r.status ?? '').toLowerCase() !== 'declined');
    if (recruits.length === 0) continue;

    // 1. New applications awaiting a yes/no — the brand is the blocker.
    const applications = recruits.filter((r) => (r.status ?? '').toLowerCase() === 'applied').length;
    if (applications > 0) {
      items.push({
        id: `${prog.program_id}:applications`,
        kind: 'applications',
        severity: 'action',
        title: `${applications} new ${plural(applications, 'application', 'applications')}`,
        body: `${plural(applications, 'A creator has', 'Creators have')} applied to ${prog.program_name} and ${plural(applications, 'is', 'are')} waiting on your decision.`,
        program_id: prog.program_id,
        program_name: prog.program_name,
        count: applications,
        href: `/campaigns/${encodeURIComponent(prog.program_id)}`,
      });
    }

    // 2 & 3. Submission verdicts + ready-to-pay — reuse the review builder so the
    // inbox and the per-campaign review screen always agree.
    const review = buildProgramReview(prog.program_id, prog.program_name, recruits, today);
    if (review.counts.pending > 0) {
      items.push({
        id: `${prog.program_id}:review`,
        kind: 'review',
        severity: 'action',
        title: `${review.counts.pending} ${plural(review.counts.pending, 'link', 'links')} to review`,
        body: `Submitted work on ${prog.program_name} is waiting for your approve / request-changes verdict.`,
        program_id: prog.program_id,
        program_name: prog.program_name,
        count: review.counts.pending,
        href: `/campaigns/${encodeURIComponent(prog.program_id)}/submissions`,
      });
    }
    if (review.counts.ready_to_pay > 0) {
      items.push({
        id: `${prog.program_id}:pay`,
        kind: 'pay',
        severity: 'action',
        title: `${review.counts.ready_to_pay} ${plural(review.counts.ready_to_pay, 'creator', 'creators')} ready to pay`,
        body: `Fully approved on ${prog.program_name} — clear the payout so the creator gets paid.`,
        program_id: prog.program_id,
        program_name: prog.program_name,
        count: review.counts.ready_to_pay,
        href: `/payouts`,
      });
    }

    // 4. Overdue with nothing delivered — the brand isn't blocked, but the
    // campaign is slipping. Info, not action.
    const overdue = recruits.filter((r) => {
      if (r.paid) return false;
      const status = (r.status ?? '').toLowerCase();
      if (status === 'applied') return false;
      if (!r.due_date) return false;
      const d = daysBetween(r.due_date, today);
      if (d == null || d <= 0) return false; // due_date in the past → today - due > 0
      return normalizeStored(r.submissions).length === 0;
    }).length;
    if (overdue > 0) {
      items.push({
        id: `${prog.program_id}:overdue`,
        kind: 'overdue',
        severity: 'info',
        title: `${overdue} overdue ${plural(overdue, 'deliverable', 'deliverables')}`,
        body: `${plural(overdue, 'A creator on', 'Creators on')} ${prog.program_name} ${plural(overdue, 'is', 'are')} past the due date with nothing submitted yet.`,
        program_id: prog.program_id,
        program_name: prog.program_name,
        count: overdue,
        href: `/campaigns/${encodeURIComponent(prog.program_id)}`,
      });
    }
  }

  if (items.length === 0) {
    return {
      available: false,
      action_count: 0,
      total: 0,
      counts: { applications: 0, review: 0, ready_to_pay: 0, overdue: 0 },
      headline: null,
      items: [],
    };
  }

  const sevRank: Record<BrandInboxItem['severity'], number> = { action: 0, info: 1 };
  items.sort(
    (a, b) =>
      sevRank[a.severity] - sevRank[b.severity] ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      b.count - a.count ||
      a.program_name.localeCompare(b.program_name),
  );

  const counts = {
    applications: sum(items, 'applications'),
    review: sum(items, 'review'),
    ready_to_pay: sum(items, 'pay'),
    overdue: sum(items, 'overdue'),
  };
  const actionCount = items.filter((i) => i.severity === 'action').length;

  let headline: string;
  if (counts.review > 0) {
    headline = `${counts.review} ${plural(counts.review, 'link', 'links')} awaiting your review.`;
  } else if (counts.applications > 0) {
    headline = `${counts.applications} ${plural(counts.applications, 'application', 'applications')} waiting on your decision.`;
  } else if (counts.ready_to_pay > 0) {
    headline = `${counts.ready_to_pay} ${plural(counts.ready_to_pay, 'creator is', 'creators are')} approved and ready to pay.`;
  } else {
    headline = `You\u2019re on top of the work \u2014 just ${counts.overdue} overdue ${plural(counts.overdue, 'delivery', 'deliveries')} to chase.`;
  }

  return {
    available: true,
    action_count: actionCount,
    total: items.length,
    counts,
    headline,
    items,
  };
}

function sum(items: BrandInboxItem[], kind: BrandInboxKind): number {
  return items.filter((i) => i.kind === kind).reduce((s, i) => s + i.count, 0);
}
