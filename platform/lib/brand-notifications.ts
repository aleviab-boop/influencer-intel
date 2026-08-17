// ============================================================
// Brand notifications — the agency side has a campaign list and a review queue,
// but nothing that says "here's what needs you today across every campaign".
// This derives an actionable feed from the brand's program_recruits rows (the
// same data the campaign + payout views read): creators who accepted or
// declined an invite, submissions waiting on your review, deals fully approved
// and ready to pay, and invites a creator hasn't replied to.
//
// Pure and deterministic — it only classifies rows the route already fetched.
// No writes, no events table, no ML. "today" is injected so it stays testable
// and timezone-honest. Mirrors lib/creator-notifications.ts on the creator side.
// ============================================================

import { normalizeStored } from './deliverable-submission';

export interface BrandNotificationInput {
  recruit_id: string;
  program_id: string;
  program: string;
  creator: string;          // display name or @handle
  creator_id: string;       // for deep-linking into the deal thread
  status: string;
  rate: number;
  paid: boolean;
  due_date: string | null;  // YYYY-MM-DD
  updated_at: string | null; // ISO
  created_at: string | null; // ISO
  submissions?: unknown;     // raw JSONB
  unread_messages?: number;      // creator messages the brand hasn't opened yet
  last_message_at?: string | null; // ISO of the latest creator message
}

export type BrandNotificationKind =
  | 'needs_review'      // creator submitted link(s) awaiting your verdict
  | 'ready_to_pay'      // all submissions approved, still unpaid
  | 'accepted'          // creator accepted the invite
  | 'declined'          // creator declined — slot to backfill
  | 'awaiting_response' // invite sent a while ago, no reply yet
  | 'overdue'           // unpaid deliverable past its due date, nothing approved
  | 'new_message';      // unread message(s) from the creator on this deal

export interface BrandNotificationView {
  id: string;
  kind: BrandNotificationKind;
  severity: 'action' | 'info';
  title: string;
  body: string;
  program: string;
  when: string;
  when_label: string;
  href: string;
}

export interface BrandNotificationFeed {
  available: boolean;
  action_count: number;
  total: number;
  headline: string | null;
  items: BrandNotificationView[];
}

const DAY_MS = 86_400_000;
const RECENT_DAYS = 14;

const money = (n: number): string => (n > 0 ? '₹' + n.toLocaleString('en-IN') : '');

function daysBetween(fromISO: string, toISO: string): number | null {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

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

export function buildBrandNotifications(
  items: BrandNotificationInput[],
  todayISO: string,
): BrandNotificationFeed {
  const today = todayISO.slice(0, 10);
  const out: BrandNotificationView[] = [];

  for (const d of items) {
    const status = (d.status ?? '').toLowerCase();
    const rate = Number(d.rate) || 0;
    const rateStr = money(rate);
    const reviewHref = `/campaigns/${d.program_id}/submissions`;
    const payHref = '/payouts';
    const campaignHref = '/campaign-management';

    // 0. Unread message(s) from the creator — surfaced on any deal (even paid),
    // since a conversation can outlive the payout. Loud action signal.
    if (d.unread_messages && d.unread_messages > 0) {
      const n = d.unread_messages;
      const when = d.last_message_at ?? d.updated_at ?? todayISO;
      out.push({
        id: `${d.recruit_id}:message`,
        kind: 'new_message',
        severity: 'action',
        title: `New message from ${d.creator}`,
        body: `${n} unread message${n === 1 ? '' : 's'} about ${d.program}. Open the thread to reply.`,
        program: d.program,
        when,
        when_label: relLabel(daysBetween(when.slice(0, 10), today)),
        href: `/campaigns/${d.program_id}/messages?creator=${d.creator_id}`,
      });
    }

    // Classify submitted links: pending (no verdict) vs approved vs changes.
    const records = normalizeStored(d.submissions).filter((s) => !!s.url);
    const pending = records.filter((s) => !s.review);
    const approved = records.filter((s) => s.review?.state === 'approved');
    const changes = records.filter((s) => s.review?.state === 'changes');

    // 1. Submissions awaiting your review — loudest brand signal.
    if (!d.paid && pending.length > 0) {
      const latest = pending.reduce((a, b) => (b.created_at > a.created_at ? b : a));
      const n = pending.length;
      out.push({
        id: `${d.recruit_id}:review`,
        kind: 'needs_review',
        severity: 'action',
        title: `${d.creator} submitted ${n} link${n === 1 ? '' : 's'} for ${d.program}`,
        body: `Review ${n === 1 ? 'it' : 'them'} and approve or request changes to keep the deal moving.`,
        program: d.program,
        when: latest.created_at ?? d.updated_at ?? todayISO,
        when_label: relLabel(latest.created_at ? daysBetween(latest.created_at.slice(0, 10), today) : null),
        href: reviewHref,
      });
    }

    // 2. Everything approved, nothing pending/changes, still unpaid → pay them.
    if (!d.paid && rate > 0 && records.length > 0 && approved.length === records.length && changes.length === 0) {
      out.push({
        id: `${d.recruit_id}:pay`,
        kind: 'ready_to_pay',
        severity: 'action',
        title: `Pay ${d.creator}${rateStr ? ` ${rateStr}` : ''} for ${d.program}`,
        body: `All deliverables approved — release the payment to close out the deal.`,
        program: d.program,
        when: d.updated_at ?? todayISO,
        when_label: '',
        href: payHref,
      });
    }

    const updatedDays = d.updated_at ? daysBetween(d.updated_at.slice(0, 10), today) : null;
    const recent = updatedDays != null && updatedDays <= RECENT_DAYS;

    // 3. Invite responses (recent status changes).
    if (status === 'recruited' && recent && records.length === 0) {
      out.push({
        id: `${d.recruit_id}:accepted`,
        kind: 'accepted',
        severity: 'info',
        title: `${d.creator} accepted ${d.program}`,
        body: `They\u2019re in${rateStr ? ` at ${rateStr}` : ''}. Send the brief and set a deadline.`,
        program: d.program,
        when: d.updated_at ?? todayISO,
        when_label: relLabel(updatedDays),
        href: campaignHref,
      });
    } else if (status === 'declined' && recent) {
      out.push({
        id: `${d.recruit_id}:declined`,
        kind: 'declined',
        severity: 'action',
        title: `${d.creator} declined ${d.program}`,
        body: `Recruit another creator to fill the slot.`,
        program: d.program,
        when: d.updated_at ?? todayISO,
        when_label: relLabel(updatedDays),
        href: campaignHref,
      });
    }

    // 4. Invite sent a while ago, still no reply.
    if (status === 'invited' && !d.paid) {
      const createdDays = d.created_at ? daysBetween(d.created_at.slice(0, 10), today) : null;
      if (createdDays != null && createdDays >= 3) {
        out.push({
          id: `${d.recruit_id}:awaiting`,
          kind: 'awaiting_response',
          severity: 'info',
          title: `${d.creator} hasn\u2019t replied to ${d.program}`,
          body: `Invited ${createdDays}d ago — nudge them or line up an alternative.`,
          program: d.program,
          when: d.created_at ?? todayISO,
          when_label: relLabel(createdDays == null ? null : -createdDays),
          href: campaignHref,
        });
      }
    }

    // 5. Unpaid deliverable overdue with nothing approved yet.
    if (!d.paid && status !== 'declined' && d.due_date) {
      const daysToDue = daysBetween(today, d.due_date);
      if (daysToDue != null && daysToDue < 0 && approved.length === 0) {
        out.push({
          id: `${d.recruit_id}:overdue`,
          kind: 'overdue',
          severity: 'action',
          title: `${d.program} is overdue from ${d.creator}`,
          body: `Was due ${dateLabel(d.due_date)}. Follow up to get the deliverable in.`,
          program: d.program,
          when: d.due_date,
          when_label: relLabel(daysToDue),
          href: reviewHref,
        });
      }
    }
  }

  if (!out.length) {
    return { available: false, action_count: 0, total: 0, headline: null, items: [] };
  }

  const sevRank: Record<BrandNotificationView['severity'], number> = { action: 0, info: 1 };
  out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.when.localeCompare(a.when));

  const actionCount = out.filter((n) => n.severity === 'action').length;
  const headline = actionCount > 0
    ? `${actionCount} thing${actionCount === 1 ? '' : 's'} need${actionCount === 1 ? 's' : ''} your attention.`
    : `You\u2019re all caught up — ${out.length} recent update${out.length === 1 ? '' : 's'}.`;

  return { available: true, action_count: actionCount, total: out.length, headline, items: out };
}
