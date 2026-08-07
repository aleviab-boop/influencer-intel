// ============================================================
// Deal workspace — the portal lets a creator APPLY to campaigns, but once a
// brand recruits them there's nowhere to actually run the deal: what's due, when,
// what am I owed, what do I do next. This organises the creator's program_recruits
// rows (the same rows the brand kanban and earnings summary read) into a workable
// lifecycle: in-progress deals sorted by deadline, deals awaiting payment, and
// paid history — each with a parsed deliverable checklist, a due-date countdown,
// an urgency flag and a plain-English next action.
//
// Pure and deterministic: it only reshapes and annotates the deal rows the route
// already fetched (no writes, no schema assumptions beyond the columns earnings
// already uses). No ML, no LLM. "today" is injected so the module stays testable
// and timezone-honest.
// ============================================================

export interface DealInput {
  id: string;
  brand: string;
  program: string;
  rate: number;
  paid: boolean;
  paid_at: string | null;
  status: string;
  deliverables: string | null;
  due_date: string | null;   // YYYY-MM-DD
}

export interface DealView {
  id: string;
  brand: string;
  program: string;
  rate: number;
  deliverables: string[];
  due_date: string | null;
  days_to_due: number | null;   // negative = overdue
  urgency: 'overdue' | 'due-soon' | 'scheduled' | 'none';
  stage: 'in_progress' | 'awaiting_payment' | 'paid';
  stage_label: string;
  paid: boolean;
  paid_at: string | null;
  next_action: string;
}

export interface DealWorkspace {
  available: boolean;
  currency: 'INR';
  summary: {
    active_count: number;
    awaiting_payment_count: number;
    paid_count: number;
    total_earned: number;
    pending: number;
    lifetime: number;
    next_due: string | null;
    overdue_count: number;
  };
  groups: { key: string; label: string; deals: DealView[] }[];
  headline: string | null;
}

const DAY_MS = 86_400_000;
// Statuses that mean the brand has actually engaged this creator on the deal
// (vs. a cold application still sitting in the funnel).
const LIVE_STATUSES = new Set(['recruited', 'contacted', 'active', 'accepted', 'invited']);

function daysBetween(fromISO: string, toISO: string): number | null {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

// Split a free-text deliverables field into discrete line items.
function parseDeliverables(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n|;|·|•|\u2022|,(?=\s*\d)/)   // newlines, semicolons, bullets, or comma-before-a-count
    .map((s) => s.replace(/^[\s\-*•·]+/, '').trim())
    .filter((s) => s.length > 0);
}

function dateLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function buildDealWorkspace(deals: DealInput[], todayISO: string): DealWorkspace {
  const today = todayISO.slice(0, 10);

  const empty: DealWorkspace = {
    available: false, currency: 'INR',
    summary: {
      active_count: 0, awaiting_payment_count: 0, paid_count: 0,
      total_earned: 0, pending: 0, lifetime: 0, next_due: null, overdue_count: 0,
    },
    groups: [], headline: null,
  };

  // Only rows where the brand actually engaged — cold applications aren't "deals".
  const live = deals.filter((d) => LIVE_STATUSES.has((d.status ?? '').toLowerCase()) || d.paid || Number(d.rate) > 0);
  if (!live.length) return empty;

  let totalEarned = 0, pending = 0, overdueCount = 0, nextDue: string | null = null;

  const views: DealView[] = live.map((d) => {
    const rate = Number(d.rate) || 0;
    const deliverables = parseDeliverables(d.deliverables);
    const daysToDue = d.due_date ? daysBetween(today, d.due_date) : null;

    // Stage: paid → awaiting payment (delivered, deadline passed, unpaid) → in progress.
    let stage: DealView['stage'];
    if (d.paid) stage = 'paid';
    else if (d.due_date && daysToDue != null && daysToDue < 0) stage = 'awaiting_payment';
    else stage = 'in_progress';

    let urgency: DealView['urgency'] = 'none';
    if (stage === 'in_progress' && daysToDue != null) {
      urgency = daysToDue < 0 ? 'overdue' : daysToDue <= 3 ? 'due-soon' : 'scheduled';
    }

    if (d.paid) totalEarned += rate; else pending += rate;
    if (stage !== 'paid' && d.due_date && d.due_date >= today && (!nextDue || d.due_date < nextDue)) nextDue = d.due_date;
    if (urgency === 'overdue') overdueCount += 1;

    const stageLabel = stage === 'paid' ? 'Paid' : stage === 'awaiting_payment' ? 'Awaiting payment' : 'In progress';

    let nextAction: string;
    if (stage === 'paid') {
      nextAction = d.paid_at ? `Paid on ${dateLabel(d.paid_at.slice(0, 10))}.` : 'Paid.';
    } else if (stage === 'awaiting_payment') {
      nextAction = `Content delivered — follow up with ${d.brand} on your ${rate > 0 ? '₹' + rate.toLocaleString('en-IN') : ''} payment.`.replace('  ', ' ');
    } else if (urgency === 'overdue' && d.due_date) {
      nextAction = `Was due ${dateLabel(d.due_date)} — submit your content to ${d.brand} and confirm the new date.`;
    } else if (urgency === 'due-soon') {
      nextAction = `Due in ${daysToDue} day${daysToDue === 1 ? '' : 's'} — get your content to ${d.brand}.`;
    } else if (d.due_date) {
      nextAction = `Create and submit to ${d.brand} before ${dateLabel(d.due_date)}.`;
    } else {
      nextAction = `Confirm the brief and a delivery date with ${d.brand}.`;
    }

    return {
      id: d.id, brand: d.brand, program: d.program, rate, deliverables,
      due_date: d.due_date, days_to_due: daysToDue, urgency, stage, stage_label: stageLabel,
      paid: d.paid, paid_at: d.paid_at, next_action: nextAction,
    };
  });

  // In-progress first (soonest / most overdue on top), then awaiting payment, then paid.
  const urgencyRank: Record<DealView['urgency'], number> = { overdue: 0, 'due-soon': 1, scheduled: 2, none: 3 };
  const inProgress = views.filter((v) => v.stage === 'in_progress')
    .sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency] || (a.days_to_due ?? 1e9) - (b.days_to_due ?? 1e9));
  const awaiting = views.filter((v) => v.stage === 'awaiting_payment')
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  const paid = views.filter((v) => v.stage === 'paid')
    .sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? ''));

  const groups = [
    { key: 'in_progress', label: 'In progress', deals: inProgress },
    { key: 'awaiting_payment', label: 'Awaiting payment', deals: awaiting },
    { key: 'paid', label: 'Paid', deals: paid },
  ].filter((g) => g.deals.length > 0);

  const activeCount = inProgress.length;
  const pendingStr = pending > 0 ? `₹${pending.toLocaleString('en-IN')} pending` : 'nothing outstanding';
  const headline = overdueCount > 0
    ? `${overdueCount} deliverable${overdueCount === 1 ? '' : 's'} past due — clear ${overdueCount === 1 ? 'it' : 'them'} first. ${pendingStr}.`
    : activeCount > 0
      ? `${activeCount} deal${activeCount === 1 ? '' : 's'} in progress · ${pendingStr}.`
      : pending > 0
        ? `All content delivered — ${pendingStr} to collect.`
        : `You're all caught up. ₹${totalEarned.toLocaleString('en-IN')} earned so far.`;

  return {
    available: true,
    currency: 'INR',
    summary: {
      active_count: activeCount,
      awaiting_payment_count: awaiting.length,
      paid_count: paid.length,
      total_earned: totalEarned,
      pending,
      lifetime: totalEarned + pending,
      next_due: nextDue,
      overdue_count: overdueCount,
    },
    groups,
    headline,
  };
}
