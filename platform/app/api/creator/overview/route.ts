import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { resolveCreatorId } from '@/lib/creator-identity';
import { buildNotifications, type NotificationInput } from '@/lib/creator-notifications';
import { buildDealWorkspace, type DealInput } from '@/lib/deal-workspace';
import { buildApplicationTracker, type ApplicationInput } from '@/lib/application-tracker';
import { computeGoalProgress, type GoalInput } from '@/lib/earnings-goal';

export const runtime = 'nodejs';

const IST_OFFSET_MIN = 5 * 60 + 30;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
function asObj(v: unknown): Record<string, unknown> {
  const obj = typeof v === 'string' ? safeParse(v) : v;
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
}

// Today + current-month + financial-year bounds, all in IST (creators bill INR/IST).
function istBounds(): {
  today: string; monthStart: string; monthEnd: string;
  day: number; daysInMonth: number; fyStart: string; fyEnd: string;
} {
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  const y = nowIst.getUTCFullYear();
  const m = nowIst.getUTCMonth(); // 0-based
  const day = nowIst.getUTCDate();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const today = `${y}-${pad(m + 1)}-${pad(day)}`;
  const monthStart = `${y}-${pad(m + 1)}-01`;
  const monthEnd = `${y}-${pad(m + 1)}-${pad(daysInMonth)}`;
  // Indian FY runs Apr 1 -> Mar 31.
  const fyStartYear = m + 1 >= 4 ? y : y - 1;
  const fyStart = `${fyStartYear}-04-01`;
  const fyEnd = `${fyStartYear + 1}-03-31`;
  return { today, monthStart, monthEnd, day, daysInMonth, fyStart, fyEnd };
}

interface RecruitRow {
  id: string;
  program_id: string;
  rate: string | number | null;
  paid: boolean;
  paid_at: string | null;
  status: string;
  due_date: string | null;
  created_at: string | null;
  submissions: unknown;
  deliverables: string | null;
  program_name: string | null;
  brand_name: string | null;
}
interface CreatorRow {
  follower_count: string | number | null;
  engagement_rate: string | number | null;
  primary_category: string | null;
  bio: string | null;
  payout_details: unknown;
  creator_prefs: unknown;
}

/**
 * GET /api/creator/overview?handle=<h>|?account=<id>
 *
 * One-shot dashboard summary: reuses each feature's own builder
 * (notifications, deals, applications, goal) plus the creators row so the home
 * cards show live badge numbers that never drift from the feature pages. All
 * DB-derived (no IG token), always 200 — `{ available:false }` carries a reason.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const db = getBolticClient();

  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    const b = istBounds();

    const [recruits, creatorRows] = await Promise.all([
      db.query<RecruitRow>(
        `SELECT pr.id, pr.program_id, pr.rate, pr.paid, pr.paid_at,
                pr.status, pr.due_date::text AS due_date, pr.created_at::text AS created_at,
                pr.submissions, pr.deliverables,
                p.name AS program_name, b.name AS brand_name
         FROM program_recruits pr
         JOIN programs p ON p.id = pr.program_id
         LEFT JOIN brands b ON b.id = p.brand_id
         WHERE pr.creator_id = $1`,
        [creatorId],
      ),
      db.query<CreatorRow>(
        `SELECT follower_count, engagement_rate, primary_category, bio, payout_details, creator_prefs
         FROM creators WHERE id = $1 LIMIT 1`,
        [creatorId],
      ),
    ]);

    const creator = creatorRows[0] ?? null;
    const prefs = asObj(creator?.creator_prefs);

    // ---- Feature builders (fed from the same recruit rows the pages read) ----
    const notificationInputs: NotificationInput[] = recruits
      .filter((r) => r.status !== 'declined')
      .map((r) => ({
        id: r.id, brand: r.brand_name ?? 'A brand', program: r.program_name ?? 'Campaign',
        rate: num(r.rate), paid: r.paid, paid_at: r.paid_at, status: r.status,
        due_date: r.due_date, created_at: r.created_at, submissions: r.submissions,
      }));
    const notifications = buildNotifications(notificationInputs, b.today);

    const dealInputs: DealInput[] = recruits
      .filter((r) => r.status !== 'declined')
      .map((r) => ({
        id: r.id, brand: r.brand_name ?? 'Brand', program: r.program_name ?? 'Campaign',
        rate: num(r.rate), paid: r.paid, paid_at: r.paid_at, status: r.status,
        deliverables: r.deliverables, due_date: r.due_date,
      }));
    const deals = buildDealWorkspace(dealInputs, b.today);

    const appInputs: ApplicationInput[] = recruits.map((r) => ({
      program_id: r.program_id, program: r.program_name ?? 'Campaign', brand: r.brand_name ?? 'Brand',
      status: r.status, rate: num(r.rate), created_at: r.created_at,
    }));
    const applications = buildApplicationTracker(appInputs, b.today);

    const earnedThisMonth = recruits
      .filter((r) => r.paid && r.paid_at && r.paid_at.slice(0, 10) >= b.monthStart && r.paid_at.slice(0, 10) <= b.monthEnd)
      .reduce((s, r) => s + num(r.rate), 0);
    const pendingThisMonth = recruits
      .filter((r) => !r.paid && r.status !== 'declined' && num(r.rate) > 0)
      .reduce((s, r) => s + num(r.rate), 0);
    const goalInput: GoalInput = {
      goal: num((asObj(prefs).monthly_goal)),
      earned_this_month: earnedThisMonth,
      pending_this_month: pendingThisMonth,
      day_of_month: b.day,
      days_in_month: b.daysInMonth,
    };
    const goal = computeGoalProgress(goalInput);

    // FY earnings (paid, within Apr–Mar) for the statement card.
    const fyEarned = recruits
      .filter((r) => r.paid && r.paid_at && r.paid_at.slice(0, 10) >= b.fyStart && r.paid_at.slice(0, 10) <= b.fyEnd)
      .reduce((s, r) => s + num(r.rate), 0);

    // Simple "is it configured" flags for the setup-style cards.
    const rateCard = asObj(prefs.rate_card);
    const rateCardSet = Object.keys(rateCard).length > 0;
    const payout = asObj(creator?.payout_details);
    const payoutSet = typeof payout.method === 'string' && payout.method.length > 0;

    return NextResponse.json({
      available: true,
      notifications: { action_count: notifications.action_count, total: notifications.total },
      deals: {
        active: deals.summary.active_count,
        awaiting_payment: deals.summary.awaiting_payment_count,
        overdue: deals.summary.overdue_count,
        next_due: deals.summary.next_due,
      },
      applications: { total: applications.total, counts: applications.counts },
      calendar: { next_due: deals.summary.next_due, overdue: deals.summary.overdue_count },
      goal: { has_goal: goal.has_goal, progress_pct: goal.progress_pct, status: goal.status },
      statement: { fy_earned: Math.round(fyEarned) },
      rate_card: { set: rateCardSet },
      payout: { set: payoutSet },
      analytics: {
        followers: num(creator?.follower_count),
        engagement_rate: creator?.engagement_rate != null ? num(creator.engagement_rate) : null,
      },
      media_kit: { ready: !!(creator?.bio && creator.primary_category && num(creator?.follower_count) > 0) },
    });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
