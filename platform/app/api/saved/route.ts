import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// Durable saved-creators shortlist (global). Snapshot lets live-discovered
// creators (not yet in `creators`) still be saved.

// GET /api/saved → { creators: SavedCreator[] } (newest first)
export async function GET() {
  const db = getBolticClient();
  try {
    const rows = await db.query<{ handle: string; snapshot: Record<string, unknown> | null }>(
      `SELECT handle, snapshot FROM saved_creators ORDER BY created_at DESC`,
    );
    const creators = rows.map((r) => ({ username: r.handle, ...(r.snapshot ?? {}) }));
    return NextResponse.json({ creators });
  } catch (err) {
    console.error('[saved] list failed:', err);
    return NextResponse.json({ creators: [] });
  }
}

// POST /api/saved  { creator: { username, ... } }  → upsert (idempotent on handle)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const creator = body?.creator as { username?: string } | undefined;
  const handle = (creator?.username ?? '').trim().replace(/^@/, '');
  if (!handle) return NextResponse.json({ error: 'creator.username required' }, { status: 400 });

  const db = getBolticClient();
  try {
    // Resolve creator_id if this creator is already in the DB (best-effort).
    let creatorId: string | null = null;
    try {
      const m = await db.query<{ id: string }>(
        `SELECT id FROM creators WHERE platform='instagram' AND lower(handle)=lower($1) LIMIT 1`,
        [handle],
      );
      creatorId = m[0]?.id ?? null;
    } catch { /* ignore */ }

    await db.query(
      `INSERT INTO saved_creators (handle, creator_id, snapshot)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (handle) DO UPDATE SET
         creator_id = COALESCE(saved_creators.creator_id, EXCLUDED.creator_id),
         snapshot   = EXCLUDED.snapshot`,
      [handle, creatorId, JSON.stringify(creator)],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[saved] add failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/saved?handle=<handle>   → remove one
// DELETE /api/saved?all=1             → clear all
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const db = getBolticClient();
  try {
    if (url.searchParams.get('all') === '1') {
      await db.query(`DELETE FROM saved_creators`);
      return NextResponse.json({ ok: true });
    }
    const handle = (url.searchParams.get('handle') ?? '').trim().replace(/^@/, '');
    if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
    await db.query(`DELETE FROM saved_creators WHERE lower(handle)=lower($1)`, [handle]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[saved] delete failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
