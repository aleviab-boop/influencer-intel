import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { resolveCreatorId } from '@/lib/creator-identity';
import { phylloStatus, isPhylloConfigured, ensurePhylloUser, createSDKToken } from '@/lib/phyllo-connector';

export const runtime = 'nodejs';
export const maxDuration = 25;

interface ConnectorRow {
  provider_user_id: string | null;
  provider_account_id: string | null;
  username: string | null;
  status: string;
  connected_at: string | null;
}

/**
 * GET /api/creator/connect/phyllo?handle=|account=
 *
 * Report whether the aggregator connector is available (env configured) and, if
 * the creator already linked, their connection status. DB-only. Always 200.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const status = phylloStatus();
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ ...status, available: false, reason: 'no_creator' });

    const db = getBolticClient();
    const [row] = await db.query<ConnectorRow>(
      `SELECT provider_user_id, provider_account_id, username, status,
              connected_at::text AS connected_at
         FROM creator_connectors
        WHERE creator_id = $1 AND provider = 'phyllo'
        ORDER BY updated_at DESC LIMIT 1`,
      [creatorId],
    );

    return NextResponse.json({
      ...status,
      available: status.configured,
      connector: row
        ? { status: row.status, username: row.username, connected_at: row.connected_at }
        : null,
    });
  } catch (err) {
    return NextResponse.json({ ...status, available: status.configured, error: (err as Error).message });
  }
}

/**
 * POST /api/creator/connect/phyllo?handle=|account=
 *
 * Start a connect session: ensure a Phyllo user exists for this creator, mint a
 * short-lived SDK token the frontend Connect widget consumes, and record a
 * pending connector row. Returns { ok, sdk_token, user_id, env, work_platform_id }.
 * Graceful 200 with { ok:false, reason:'not_configured' } when keys are absent.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const status = phylloStatus();
  if (!isPhylloConfigured()) {
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 200 });
  }
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ ok: false, reason: 'no_creator' }, { status: 200 });

    const db = getBolticClient();
    const [c] = await db.query<{ display_name: string | null; handle: string | null }>(
      `SELECT display_name, handle FROM creators WHERE id = $1 LIMIT 1`,
      [creatorId],
    );
    const name = c?.display_name?.trim() || c?.handle?.trim() || `creator-${creatorId.slice(0, 8)}`;

    const user = await ensurePhylloUser(creatorId, name);
    const token = await createSDKToken(user.id);

    // Record the intent so the webhook can reconcile even before it fires. The
    // unique constraint includes work_platform (NULL here), which Postgres treats
    // as distinct — so guard with NOT EXISTS to avoid duplicate pending rows.
    await db.query(
      `INSERT INTO creator_connectors (creator_id, provider, provider_user_id, status, updated_at)
       SELECT $1, 'phyllo', $2, 'pending', NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM creator_connectors
           WHERE creator_id = $1 AND provider = 'phyllo' AND provider_user_id = $2
        )`,
      [creatorId, user.id],
    );

    return NextResponse.json({
      ok: true,
      sdk_token: token.sdk_token,
      user_id: user.id,
      env: status.env,
      work_platform_id: status.work_platform_id,
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ ok: false, reason: 'error', error: msg }, { status: 200 });
  }
}
