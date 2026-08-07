// ============================================================
// Submission review (brand side) — the creator portal lets a creator attach live
// post URLs to a deal (program_recruits.submissions), but nothing on the brand
// side reads them, so that proof-of-work was a write into the void. This is the
// counterpart: for one campaign it rolls every recruited creator's submitted
// links into a review queue — who has delivered, whether the links cover the
// agreed deliverables, and which are still awaiting the brand's verdict — then
// flags who is fully approved and ready to be paid.
//
// Pure and deterministic: it only classifies the recruit rows + submissions the
// route fetched — no ML/LLM, no writes. The route persists a verdict back into
// the submissions JSONB via setSubmissionReview(); this module only computes.
// "today" is injected for testable, timezone-honest relative dates.
// ============================================================

import {
  normalizeStored,
  detectPlatform,
  type SubmissionRecord,
  type SubmissionReview,
} from './deliverable-submission';

export interface ReviewRecruitInput {
  creator_id: string;
  handle: string;
  display_name: string | null;
  status: string;
  rate: number;
  paid: boolean;
  due_date: string | null;      // YYYY-MM-DD
  deliverables: string | null;  // raw TEXT
  submissions: unknown;         // raw JSONB from the column
}

export type ReviewState = 'approved' | 'changes' | 'pending';

export interface ReviewLink {
  id: string;
  label: string | null;
  url: string;
  platform: string;
  domain: string;
  note: string | null;
  when_label: string;
  review: SubmissionReview | null;
  review_state: ReviewState;    // convenience: review?.state ?? 'pending'
}

export interface ReviewCreator {
  creator_id: string;
  handle: string;
  display_name: string;
  rate: number;
  paid: boolean;
  due_label: string | null;
  required: number;             // parsed deliverable count (min 1 if links exist)
  submitted: number;
  approved: number;
  changes: number;
  pending: number;              // links awaiting a verdict
  all_approved: boolean;        // every required piece submitted AND approved
  ready_to_pay: boolean;        // all_approved && rate > 0 && !paid
  status_label: string;
  links: ReviewLink[];
}

export interface ProgramReview {
  available: boolean;
  program_id: string;
  program_name: string;
  counts: {
    creators_submitted: number;   // recruits with ≥1 link
    links_total: number;
    pending: number;              // links awaiting a verdict
    approved: number;
    changes: number;
    ready_to_pay: number;         // creators fully approved, priced, unpaid
  };
  creators: ReviewCreator[];      // only those with submissions, review-priority order
  headline: string;
}

function parseDeliverables(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n|;|\u00b7|\u2022|,(?=\s*\d)/)
    .map((s) => s.replace(/^[\s\-*\u2022\u00b7]+/, '').trim())
    .filter((s) => s.length > 0);
}

const DAY_MS = 86_400_000;
function relLabel(fromISO: string, today: string): string {
  const a = new Date(fromISO.slice(0, 10) + 'T00:00:00Z').getTime();
  const b = new Date(today + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  const d = Math.round((b - a) / DAY_MS);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(fromISO.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function dateLabel(iso: string): string {
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00Z' : ''));
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function reviewRow(recruit: ReviewRecruitInput, today: string): ReviewCreator {
  const records: SubmissionRecord[] = normalizeStored(recruit.submissions);
  const sorted = [...records].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const deliverables = parseDeliverables(recruit.deliverables);
  const submitted = sorted.length;
  const required = Math.max(deliverables.length, submitted > 0 ? 1 : 0);

  const links: ReviewLink[] = sorted.map((s) => {
    const { domain } = detectPlatform(s.url);
    const review = s.review ?? null;
    return {
      id: s.id,
      label: s.label,
      url: s.url,
      platform: s.platform,
      domain,
      note: s.note,
      when_label: relLabel(s.created_at, today),
      review,
      review_state: review?.state ?? 'pending',
    };
  });

  const approved = links.filter((l) => l.review_state === 'approved').length;
  const changes = links.filter((l) => l.review_state === 'changes').length;
  const pending = links.filter((l) => l.review_state === 'pending').length;

  // Fully approved = enough approved links to cover every required deliverable,
  // and nothing sent back for changes.
  const allApproved = submitted > 0 && changes === 0 && approved >= required && required > 0;
  const readyToPay = allApproved && recruit.rate > 0 && !recruit.paid;

  const statusLabel = recruit.paid
    ? 'Paid'
    : allApproved ? 'Approved \u2014 ready to pay'
    : changes > 0 ? 'Changes requested'
    : pending > 0 ? `${pending} link${pending === 1 ? '' : 's'} to review`
    : 'No links yet';

  return {
    creator_id: recruit.creator_id,
    handle: recruit.handle,
    display_name: recruit.display_name ?? recruit.handle,
    rate: recruit.rate,
    paid: recruit.paid,
    due_label: recruit.due_date ? dateLabel(recruit.due_date) : null,
    required,
    submitted,
    approved,
    changes,
    pending,
    all_approved: allApproved,
    ready_to_pay: readyToPay,
    status_label: statusLabel,
    links,
  };
}

// Order: links that need a verdict first, then changes-requested, then
// ready-to-pay, then paid/done — so the brand's work is at the top.
function priority(c: ReviewCreator): number {
  if (c.paid) return 4;
  if (c.pending > 0) return 0;
  if (c.changes > 0) return 1;
  if (c.ready_to_pay) return 2;
  return 3;
}

export function buildProgramReview(
  programId: string,
  programName: string,
  recruits: ReviewRecruitInput[],
  todayISO: string,
): ProgramReview {
  const today = todayISO.slice(0, 10);

  const rows = recruits
    .map((r) => reviewRow(r, today))
    .filter((c) => c.submitted > 0)   // only creators who have actually delivered
    .sort((a, b) => priority(a) - priority(b) || b.submitted - a.submitted);

  const counts = {
    creators_submitted: rows.length,
    links_total: rows.reduce((s, c) => s + c.submitted, 0),
    pending: rows.reduce((s, c) => s + c.pending, 0),
    approved: rows.reduce((s, c) => s + c.approved, 0),
    changes: rows.reduce((s, c) => s + c.changes, 0),
    ready_to_pay: rows.filter((c) => c.ready_to_pay).length,
  };

  let headline: string;
  if (rows.length === 0) {
    headline = 'No creators have submitted deliverables yet.';
  } else if (counts.pending > 0) {
    headline = `${counts.pending} link${counts.pending === 1 ? '' : 's'} awaiting your review across ${rows.length} creator${rows.length === 1 ? '' : 's'}.`;
  } else if (counts.ready_to_pay > 0) {
    headline = `${counts.ready_to_pay} creator${counts.ready_to_pay === 1 ? '' : 's'} fully approved and ready to pay.`;
  } else if (counts.changes > 0) {
    headline = `Waiting on ${counts.changes} revised deliverable${counts.changes === 1 ? '' : 's'}.`;
  } else {
    headline = 'All submitted work has been reviewed.';
  }

  return {
    available: rows.length > 0,
    program_id: programId,
    program_name: programName,
    counts,
    creators: rows,
    headline,
  };
}
