// ============================================================
// Creator notifications — a portal has a deal workspace and an earnings view,
// but nothing that tells a creator "here's what actually needs you today". This
// derives an actionable feed from the SAME program_recruits rows the deals and
// earnings views read: brand invites waiting on a reply, deliverables due soon
// or overdue, payments that have landed, and payments that have been pending too
// long. Each item carries a severity, a plain-English line, a timestamp for
// ordering, and a deep-link target.
//
// Pure and deterministic: it only classifies the rows the route already fetched
// — no writes, no events table, no ML/LLM. "today" is injected so the module
// stays testable and timezone-honest.
// ============================================================

import { normalizeStored } from './deliverable-submission';

export interface NotificationInput {
  id: string;
  brand: string;
  program: string;
  rate: number;
  paid: boolean;
  paid_at: string | null;   // ISO
  status: string;
  due_date: string | null;  // YYYY-MM-DD
  created_at: string | null; // ISO
  submissions?: unknown;     // raw JSONB — carries the brand's per-link verdicts
}

export type NotificationKind =
  | 'invite'          // brand engaged you; needs a reply
  | 'deadline_overdue'
  | 'deadline_soon'
  | 'payment_received'
  | 'payment_pending' // delivered, due passed, still unpaid a while
  | 'new_deal'        // recently recruited
  | 'changes_requested' // brand sent a submitted link back for changes
  | 'submission_approved'; // brand approved submitted work

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  severity: 'action' | 'info';
  title: string;
  body: string;
  brand: string;
  when: string;        // ISO used for sort + display
  when_label: string;  // "2d ago", "today", "in 3d"
  href: string;        // where the CTA goes
}

export interface NotificationFeed {
  available: boolean;
  action_count: number;
  total: number;
  headline: string | null;
  items: NotificationView[];
}

const DAY_MS = 86_400_000;
const INVITE_STATUSES = new Set(['recruited', 'contacted', 'invited']);
const LIVE_STATUSES = new Set(['recruited', 'contacted', 'active', 'accepted', 'invited']);

const money = (n: number): string => (n > 0 ? '₹' + n.toLocaleString('en-IN') : '');

function daysBetween(fromISO: string, toISO: string): number | null {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

// Human "when": negative days = past, 0 = today, positive = future.
function relLabel(days: number | null): string {
  if (days == null) return '';
  if (days === 0) return 'today';
  if (days < 0) return `${Math.abs(days)}d ago`;
  return `in ${days}d`;
}

function dateLabel(iso: string): string {
  const d = new Date(iso + (iso.length <= 10 ? 'T00:00:00Z' : ''));
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function buildNotifications(items: NotificationInput[], todayISO: string): NotificationFeed {
  const today = todayISO.slice(0, 10);
  const dealsHref = '/creator/deals';
  const earningsHref = '/creator/goal';   // earnings context lives on the goal tracker

  const out: NotificationView[] = [];

  for (const d of items) {
    const status = (d.status ?? '').toLowerCase();
    const rate = Number(d.rate) || 0;
    const rateStr = money(rate);
    const daysToDue = d.due_date ? daysBetween(today, d.due_date) : null;
    const createdDays = d.created_at ? daysBetween(d.created_at.slice(0, 10), today) : null;

    // 1. Brand invite awaiting a reply — highest priority.
    if (INVITE_STATUSES.has(status) && !d.paid) {
      out.push({
        id: `${d.id}:invite`,
        kind: 'invite',
        severity: 'action',
        title: `${d.brand} wants you for ${d.program}`,
        body: `You\u2019ve been invited${rateStr ? ` at ${rateStr}` : ''}. Review the brief and confirm.`,
        brand: d.brand,
        when: d.created_at ?? todayISO,
        when_label: relLabel(createdDays),
        href: dealsHref,
      });
    } else if (status === 'accepted' && createdDays != null && createdDays <= 7) {
      // 1b. Recently accepted — a fresh live deal to start.
      out.push({
        id: `${d.id}:new`,
        kind: 'new_deal',
        severity: 'info',
        title: `New deal with ${d.brand}`,
        body: `${d.program} is now active${rateStr ? ` · ${rateStr}` : ''}. Line up your content.`,
        brand: d.brand,
        when: d.created_at ?? todayISO,
        when_label: relLabel(createdDays),
        href: dealsHref,
      });
    }

    // Brand verdicts on submitted links — surfaced whether or not the deal is
    // otherwise "live", but not once it's paid & closed. Changes-requested is
    // the loudest single signal; a clean approval is a satisfying info nudge.
    if (!d.paid) {
      const reviewed = normalizeStored(d.submissions)
        .map((s) => s.review)
        .filter((r): r is NonNullable<typeof r> => !!r);
      const changes = reviewed.filter((r) => r.state === 'changes');
      const approved = reviewed.filter((r) => r.state === 'approved');
      if (changes.length > 0) {
        const latest = changes.reduce((a, b) => (b.at > a.at ? b : a));
        out.push({
          id: `${d.id}:changes`,
          kind: 'changes_requested',
          severity: 'action',
          title: `${d.brand} requested changes on ${d.program}`,
          body: latest.comment
            ? `\u201c${latest.comment}\u201d — revise and re-submit your link${changes.length > 1 ? 's' : ''}.`
            : `${changes.length} submitted link${changes.length === 1 ? ' was' : 's were'} sent back. Revise and re-submit.`,
          brand: d.brand,
          when: latest.at,
          when_label: relLabel(daysBetween(latest.at.slice(0, 10), today)),
          href: `${dealsHref}/${d.id}/submit`,
        });
      } else if (approved.length > 0) {
        const latest = approved.reduce((a, b) => (b.at > a.at ? b : a));
        out.push({
          id: `${d.id}:approved`,
          kind: 'submission_approved',
          severity: 'info',
          title: `${d.brand} approved your work`,
          body: `${approved.length} deliverable${approved.length === 1 ? '' : 's'} approved for ${d.program}${rateStr ? ` — ${rateStr} due` : ''}.`,
          brand: d.brand,
          when: latest.at,
          when_label: relLabel(daysBetween(latest.at.slice(0, 10), today)),
          href: `${dealsHref}/${d.id}/submit`,
        });
      }
    }

    // Only rows that are actual deals carry deadline/payment signals.
    const isDeal = LIVE_STATUSES.has(status) || d.paid || rate > 0;
    if (!isDeal) continue;

    // 2. Payment landed.
    if (d.paid && d.paid_at) {
      const paidDays = daysBetween(d.paid_at.slice(0, 10), today);
      if (paidDays != null && paidDays <= 21) {
        out.push({
          id: `${d.id}:paid`,
          kind: 'payment_received',
          severity: 'info',
          title: `${rateStr || 'Payment'} received from ${d.brand}`,
          body: `Paid on ${dateLabel(d.paid_at.slice(0, 10))} for ${d.program}.`,
          brand: d.brand,
          when: d.paid_at,
          when_label: relLabel(paidDays),
          href: earningsHref,
        });
      }
      continue; // paid deals have no outstanding deadline/payment nudges
    }

    // 3. Deadline signals (unpaid deals with a due date).
    if (d.due_date && daysToDue != null) {
      if (daysToDue < 0) {
        // Overdue → treat as delivered-and-awaiting once it's well past.
        if (daysToDue <= -3 && rate > 0) {
          out.push({
            id: `${d.id}:pending`,
            kind: 'payment_pending',
            severity: 'action',
            title: `Chase payment from ${d.brand}`,
            body: `${d.program} was due ${dateLabel(d.due_date)}${rateStr ? ` — ${rateStr} still outstanding` : ''}. Follow up.`,
            brand: d.brand,
            when: d.due_date,
            when_label: relLabel(daysToDue),
            href: `${dealsHref}/${d.id}`,
          });
        } else {
          out.push({
            id: `${d.id}:overdue`,
            kind: 'deadline_overdue',
            severity: 'action',
            title: `Overdue: ${d.program}`,
            body: `Was due ${dateLabel(d.due_date)} for ${d.brand}. Submit your content and reset the date.`,
            brand: d.brand,
            when: d.due_date,
            when_label: relLabel(daysToDue),
            href: dealsHref,
          });
        }
      } else if (daysToDue <= 3) {
        out.push({
          id: `${d.id}:soon`,
          kind: 'deadline_soon',
          severity: 'action',
          title: `Due ${daysToDue === 0 ? 'today' : `in ${daysToDue}d`}: ${d.program}`,
          body: `Deliverable for ${d.brand} is due ${dateLabel(d.due_date)}. Get it over the line.`,
          brand: d.brand,
          when: d.due_date,
          when_label: relLabel(daysToDue),
          href: dealsHref,
        });
      }
    }
  }

  if (!out.length) {
    return { available: false, action_count: 0, total: 0, headline: null, items: [] };
  }

  // Sort: action items first, then by recency of `when` (most recent/urgent top).
  const sevRank: Record<NotificationView['severity'], number> = { action: 0, info: 1 };
  out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.when.localeCompare(a.when));

  const actionCount = out.filter((n) => n.severity === 'action').length;
  const headline = actionCount > 0
    ? `${actionCount} thing${actionCount === 1 ? '' : 's'} need${actionCount === 1 ? 's' : ''} your attention.`
    : `You\u2019re all caught up — ${out.length} recent update${out.length === 1 ? '' : 's'}.`;

  return {
    available: true,
    action_count: actionCount,
    total: out.length,
    headline,
    items: out,
  };
}
