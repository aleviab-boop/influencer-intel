import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { cookieFromStorageState, probeCookie } from '@/lib/ig-fetch';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/session-extend
//   Validate-and-extend the captured IG session pool.
//
//   The churn problem this fixes: capture-session / seed-session stamped every
//   cookie with a hardcoded 30-day storage_expires_at, even though an IG
//   sessionid actually lives ~1 year. So healthy cookies were being RETIRED on a
//   timer — the pool went "empty" and live data went dark while the underlying
//   sessions were still perfectly valid, forcing needless re-captures.
//
//   This cron probes each account's cookie individually and lets IG — not a
//   timer — decide validity:
//     200        → cookie is alive → push storage_expires_at forward 180 days.
//     401 / 403  → cookie is genuinely dead → expire it now so the pool drops it
//                  (surfaces in the monitor's "ready pool empty" alert for re-capture).
//     429 / 0    → throttled or unknown → leave untouched (never retire a cookie
//                  we couldn't actually disprove).
//
//   Meant to run on a Vercel cron (daily). CRON_SECRET-guarded like the others.
const EXTEND_DAYS = 180;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const db = getBolticClient();
  let rows: Array<{ id: string; handle: string | null; storage_state: unknown }>;
  try {
    rows = await db.query<{ id: string; handle: string | null; storage_state: unknown }>(
      `SELECT id, handle, storage_state FROM service_accounts
       WHERE platform = 'instagram' AND storage_state IS NOT NULL`,
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }

  let extended = 0;
  let retired = 0;
  let skipped = 0;
  const results: Array<{ handle: string | null; status: number; action: string }> = [];

  for (const r of rows) {
    const cookie = cookieFromStorageState(r.storage_state);
    if (!cookie) {
      skipped++;
      results.push({ handle: r.handle, status: 0, action: 'no-cookie' });
      continue;
    }

    const status = await probeCookie(cookie);
    let action: string;
    if (status === 200) {
      await db.query(
        `UPDATE service_accounts
         SET storage_expires_at = now() + interval '${EXTEND_DAYS} days',
             status = 'active', updated_at = now()
         WHERE id = $1`,
        [r.id],
      );
      extended++;
      action = 'extended';
    } else if (status === 401 || status === 403) {
      // Genuinely dead → expire now (mirrors account-pool.ts on ban) so the
      // rotation drops it. Don't touch `status` — leave that vocabulary to the
      // worker; expiring is enough to exclude it from every "active + unexpired"
      // pool query.
      await db.query(
        `UPDATE service_accounts SET storage_expires_at = now(), updated_at = now() WHERE id = $1`,
        [r.id],
      );
      retired++;
      action = 'retired';
    } else {
      // 429 (throttled) or 0 (network/timeout) → inconclusive, leave as-is.
      skipped++;
      action = 'skipped';
    }
    results.push({ handle: r.handle, status, action });
  }

  return NextResponse.json({ ok: true, checked: rows.length, extended, retired, skipped, results });
}
