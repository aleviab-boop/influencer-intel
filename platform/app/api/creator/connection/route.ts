import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { resolveCreatorId } from '@/lib/creator-identity';

export const runtime = 'nodejs';

interface AccountRow {
  id: string;
  ig_username: string | null;
  connection_status: string | null;
  last_sync_status: string | null;
  last_sync_at: string | null;
  posts_synced_count: number | string | null;
  token_expires_at: string | null;
  connected_at: string | null;
}

const num = (v: number | string | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * GET /api/creator/connection?handle=|account=
 *
 * Instagram connection health for the resolved creator, so the dashboard can
 * show "Connected — live insights on" vs a "Connect Instagram" CTA. DB-only,
 * always 200. Never returns an access token or any secret.
 *
 * Shape:
 *   { connected: boolean, reason?: 'no_creator' | 'no_account',
 *     ig_username, connection_status, last_sync_status, last_sync_at,
 *     posts_synced_count, token_expires_at, connected_at,
 *     expiring_soon: boolean, expired: boolean, days_until_expiry: number | null }
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) {
      return NextResponse.json({ connected: false, reason: 'no_creator' }, { status: 200 });
    }

    const db = getBolticClient();
    const rows = await db.query<AccountRow>(
      `SELECT id, ig_username, connection_status, last_sync_status, last_sync_at,
              posts_synced_count, token_expires_at, connected_at
       FROM connected_accounts
       WHERE creator_id = $1
       ORDER BY (connection_status = 'active') DESC, connected_at DESC
       LIMIT 1`,
      [creatorId],
    );

    const acc = rows[0];
    if (!acc) {
      return NextResponse.json({ connected: false, reason: 'no_account' }, { status: 200 });
    }

    // Token expiry health (long-lived IG tokens last ~60 days).
    let daysUntilExpiry: number | null = null;
    let expired = false;
    let expiringSoon = false;
    if (acc.token_expires_at) {
      const ms = new Date(acc.token_expires_at).getTime() - Date.now();
      if (Number.isFinite(ms)) {
        daysUntilExpiry = Math.floor(ms / 86_400_000);
        expired = ms <= 0;
        expiringSoon = !expired && daysUntilExpiry <= 7;
      }
    }

    const connected = acc.connection_status === 'active' && !expired;

    return NextResponse.json(
      {
        connected,
        ig_username: acc.ig_username,
        connection_status: acc.connection_status,
        last_sync_status: acc.last_sync_status,
        last_sync_at: acc.last_sync_at,
        posts_synced_count: num(acc.posts_synced_count),
        token_expires_at: acc.token_expires_at,
        connected_at: acc.connected_at,
        expiring_soon: expiringSoon,
        expired,
        days_until_expiry: daysUntilExpiry,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[creator/connection] failed:', err);
    return NextResponse.json({ connected: false, reason: 'error' }, { status: 200 });
  }
}
