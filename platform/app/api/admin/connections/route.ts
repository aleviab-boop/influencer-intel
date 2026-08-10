import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// Admin view of every connected Instagram account and its health — connection
// status, token expiry, and last-sync outcome — so the team can spot accounts
// that need a reconnect before live insights silently stop. Read-only, never
// returns a token. Always 200.

interface Row {
  id: string;
  ig_username: string | null;
  handle: string | null;
  creator_id: string | null;
  follower_count: number | string | null;
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

// Derived health bucket for a single account.
type Health = 'active' | 'expiring' | 'expired' | 'error' | 'inactive';

function healthOf(r: Row): { health: Health; days_until_expiry: number | null } {
  let days: number | null = null;
  let expired = false;
  let expiringSoon = false;
  if (r.token_expires_at) {
    const ms = new Date(r.token_expires_at).getTime() - Date.now();
    if (Number.isFinite(ms)) {
      days = Math.floor(ms / 86_400_000);
      expired = ms <= 0;
      expiringSoon = !expired && days <= 7;
    }
  }
  if (r.connection_status !== 'active') return { health: 'inactive', days_until_expiry: days };
  if (expired) return { health: 'expired', days_until_expiry: days };
  if (r.last_sync_status && r.last_sync_status !== 'ok' && r.last_sync_status !== 'success')
    return { health: 'error', days_until_expiry: days };
  if (expiringSoon) return { health: 'expiring', days_until_expiry: days };
  return { health: 'active', days_until_expiry: days };
}

export async function GET() {
  try {
    const db = getBolticClient();
    const rows = await db.query<Row>(
      `SELECT ca.id, ca.ig_username, ca.creator_id, ca.connection_status,
              ca.last_sync_status, ca.last_sync_at, ca.posts_synced_count,
              ca.token_expires_at, ca.connected_at,
              c.handle, c.follower_count
       FROM connected_accounts ca
       LEFT JOIN creators c ON c.id = ca.creator_id
       ORDER BY (ca.connection_status = 'active') DESC, ca.connected_at DESC`,
    );

    const accounts = rows.map((r) => {
      const { health, days_until_expiry } = healthOf(r);
      return {
        id: r.id,
        ig_username: r.ig_username,
        handle: r.handle,
        creator_id: r.creator_id,
        follower_count: num(r.follower_count),
        connection_status: r.connection_status,
        last_sync_status: r.last_sync_status,
        last_sync_at: r.last_sync_at,
        posts_synced_count: num(r.posts_synced_count),
        token_expires_at: r.token_expires_at,
        connected_at: r.connected_at,
        health,
        days_until_expiry,
      };
    });

    const summary = {
      total: accounts.length,
      active: accounts.filter((a) => a.health === 'active').length,
      expiring: accounts.filter((a) => a.health === 'expiring').length,
      expired: accounts.filter((a) => a.health === 'expired').length,
      error: accounts.filter((a) => a.health === 'error').length,
      inactive: accounts.filter((a) => a.health === 'inactive').length,
    };

    return NextResponse.json({ summary, accounts }, { status: 200 });
  } catch (err) {
    console.error('[admin/connections] failed:', err);
    return NextResponse.json(
      { summary: { total: 0, active: 0, expiring: 0, expired: 0, error: 0, inactive: 0 }, accounts: [], error: (err as Error).message },
      { status: 200 },
    );
  }
}
