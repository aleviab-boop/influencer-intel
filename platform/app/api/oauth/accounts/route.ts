import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { oauthConfigStatus } from '@/lib/oauth-service';

export const runtime = 'nodejs';

// GET /api/oauth/accounts → { config, accounts[] }
//   Lists connected Instagram accounts + whether OAuth is configured.
export async function GET() {
  try {
    const db = getBolticClient();
    const accounts = await db.query(
      `SELECT ca.id, ca.ig_username, ca.creator_id, ca.connection_status,
              ca.last_sync_status, ca.last_sync_at, ca.posts_synced_count,
              ca.token_expires_at, ca.connected_at,
              c.handle, c.follower_count
       FROM connected_accounts ca
       LEFT JOIN creators c ON c.id = ca.creator_id
       ORDER BY ca.connected_at DESC`,
    );
    return NextResponse.json({ config: oauthConfigStatus(), accounts });
  } catch (err) {
    console.error('[oauth/accounts] failed:', err);
    return NextResponse.json(
      { config: oauthConfigStatus(), accounts: [], error: (err as Error).message },
      { status: 200 },
    );
  }
}
