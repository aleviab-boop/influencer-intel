import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { computeGoalProgress, type GoalInput } from '@/lib/earnings-goal';

export const runtime = 'nodejs';

const IST_OFFSET_MIN = 5 * 60 + 30;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Current month boundaries + day, in IST — creators here bill in INR/IST.
function istMonth(): { start: string; end: string; day: number; days_in_month: number } {
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  const y = nowIst.getUTCFullYear();
  const m = nowIst.getUTCMonth(); // 0-based
  const day = nowIst.getUTCDate();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const start = `${y}-${pad(m + 1)}-01`;
  const end = `${y}-${pad(m + 1)}-${pad(daysInMonth)}`;
  return { start, end, day, days_in_month: daysInMonth };
}

async function resolveCreatorId(
  db: ReturnType<typeof getBolticClient>,
  accountId: string | null,
  handle: string | null,
): Promise<string | null> {
  if (accountId) {
    const rows = await db.query<{ creator_id: string }>(
      `SELECT creator_id FROM connected_accounts WHERE id = $1 LIMIT 1`, [accountId],
    );
    return rows[0]?.creator_id ?? null;
  }
  if (handle) {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM creators WHERE LOWER(handle) = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1`, [handle],
    );
    return rows[0]?.id ?? null;
  }
  const rows = await db.query<{ creator_id: string }>(
    `SELECT creator_id FROM connected_accounts WHERE connection_status = 'active'
     ORDER BY connected_at DESC LIMIT 1`,
  );
  return rows[0]?.creator_id ?? null;
}

function readGoal(v: unknown): number {
  const obj = typeof v === 'string' ? safeParse(v) : v;
  if (obj && typeof obj === 'object' && 'monthly_goal' in obj) return num((obj as Record<string, unknown>).monthly_goal);
  return 0;
}
function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

async function progressFor(db: ReturnType<typeof getBolticClient>, creatorId: string): Promise<ReturnType<typeof computeGoalProgress>> {
  const { start, end, day, days_in_month } = istMonth();

  const prefsRows = await db.query<{ creator_prefs: unknown }>(
    `SELECT creator_prefs FROM creators WHERE id = $1 LIMIT 1`, [creatorId],
  );
  const goal = readGoal(prefsRows[0]?.creator_prefs);

  // Paid this calendar month.
  const paidRows = await db.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(rate), 0) AS total FROM program_recruits
     WHERE creator_id = $1 AND paid = true
       AND paid_at::date BETWEEN $2::date AND $3::date`,
    [creatorId, start, end],
  );
  // Unpaid but expected (live, non-declined, has a rate).
  const pendingRows = await db.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(rate), 0) AS total FROM program_recruits
     WHERE creator_id = $1 AND paid = false AND status <> 'declined' AND rate > 0`,
    [creatorId],
  );

  const input: GoalInput = {
    goal,
    earned_this_month: num(paidRows[0]?.total),
    pending_this_month: num(pendingRows[0]?.total),
    day_of_month: day,
    days_in_month,
  };
  return computeGoalProgress(input);
}

/** GET /api/creator/goal?handle=|account= — monthly goal progress. */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').toLowerCase() ?? null;
  const db = getBolticClient();

  try {
    const creatorId = await resolveCreatorId(db, accountId, handle);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });
    return NextResponse.json({ available: true, ...(await progressFor(db, creatorId)) });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * PATCH /api/creator/goal?handle=|account=  Body: { monthly_goal: <int> }
 * Sets (or clears, with 0) the monthly earnings target in creator_prefs, then
 * returns fresh progress.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').toLowerCase() ?? null;
  const db = getBolticClient();

  try {
    const body = (await request.json().catch(() => ({}))) as { monthly_goal?: unknown };
    const goal = Math.max(0, Math.min(100_000_000, Math.round(num(body.monthly_goal))));

    const creatorId = await resolveCreatorId(db, accountId, handle);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    // Merge into existing prefs so we don't clobber other keys.
    const existing = await db.query<{ creator_prefs: unknown }>(
      `SELECT creator_prefs FROM creators WHERE id = $1 LIMIT 1`, [creatorId],
    );
    const prev = (typeof existing[0]?.creator_prefs === 'string'
      ? safeParse(existing[0]!.creator_prefs as string)
      : existing[0]?.creator_prefs) as Record<string, unknown> | null;
    const merged = { ...(prev ?? {}), monthly_goal: goal };

    await db.update('creators', { id: creatorId }, {
      creator_prefs: JSON.stringify(merged),
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ available: true, saved: true, ...(await progressFor(db, creatorId)) });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
