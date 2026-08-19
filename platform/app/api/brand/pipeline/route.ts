import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getAgencySession } from '@/lib/auth';

export const runtime = 'nodejs';

// ============================================================
// /api/brand/pipeline — a signed-in agency's per-brand creator funnel.
//
// Every handler is gated by the agency session and scoped to (account_id, brand):
// an agency only ever sees / mutates its OWN pipeline for the brand it names.
// Unsigned callers get 401 — saving a creator is a reason to hold an account.
//
//   GET    ?brand=GlowRoot            → { items: PipelineItem[] }
//   POST   { brand, handle, ... }     → upsert a saved creator (idempotent)
//   PATCH  { brand, handle, status?, note? } → move a creator down the funnel
//   DELETE ?brand=GlowRoot&handle=x   → remove one from the pipeline
// ============================================================

const STATUSES = ['saved', 'contacted', 'replied', 'negotiating', 'won', 'passed'] as const;
type PipelineStatus = (typeof STATUSES)[number];

interface PipelineRow {
  id: string;
  brand_name: string;
  handle: string;
  creator_id: string | null;
  snapshot: Record<string, unknown> | null;
  status: string;
  note: string | null;
  added_at: string;
  updated_at: string;
}

interface PipelineItem {
  id: string;
  brand: string;
  handle: string;
  creator_id: string | null;
  snapshot: Record<string, unknown> | null;
  status: PipelineStatus;
  note: string | null;
  added_at: string;
  updated_at: string;
}

function toItem(r: PipelineRow): PipelineItem {
  return {
    id: r.id,
    brand: r.brand_name,
    handle: r.handle,
    creator_id: r.creator_id,
    snapshot: r.snapshot,
    status: (STATUSES.includes(r.status as PipelineStatus) ? r.status : 'saved') as PipelineStatus,
    note: r.note,
    added_at: String(r.added_at),
    updated_at: String(r.updated_at),
  };
}

const cleanHandle = (h: unknown): string =>
  typeof h === 'string' ? h.trim().replace(/^@/, '').toLowerCase() : '';
const cleanBrand = (b: unknown): string => (typeof b === 'string' ? b.trim() : '');

// GET ?brand=... — this account's pipeline for a brand, newest first.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const s = await getAgencySession();
  if (!s) return NextResponse.json({ error: 'Not signed in.', needsAuth: true }, { status: 401 });
  const brand = cleanBrand(req.nextUrl.searchParams.get('brand'));
  if (!brand) return NextResponse.json({ error: 'brand is required' }, { status: 400 });

  try {
    const rows = await getBolticClient().query<PipelineRow>(
      `SELECT id, brand_name, handle, creator_id, snapshot, status, note,
              added_at::text AS added_at, updated_at::text AS updated_at
         FROM brand_pipeline
        WHERE account_id = $1 AND lower(brand_name) = lower($2)
        ORDER BY added_at DESC`,
      [s.account_id, brand],
    );
    return NextResponse.json({ items: rows.map(toItem) });
  } catch (err) {
    console.error('[pipeline] GET failed:', err);
    return NextResponse.json({ items: [] });
  }
}

// POST { brand, handle, creator_id?, snapshot?, note? } — save a creator.
// Idempotent on (account_id, lower(brand_name), lower(handle)): re-saving a
// creator refreshes the snapshot/creator_id, never duplicates the row.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const s = await getAgencySession();
  if (!s) return NextResponse.json({ error: 'Not signed in.', needsAuth: true }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const brand = cleanBrand(body.brand);
  const handle = cleanHandle(body.handle);
  if (!brand || !handle) return NextResponse.json({ error: 'brand and handle are required' }, { status: 400 });

  const creator_id = typeof body.creator_id === 'string' && body.creator_id ? body.creator_id : null;
  const snapshot = body.snapshot && typeof body.snapshot === 'object' ? body.snapshot : null;
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null;

  try {
    const rows = await getBolticClient().query<PipelineRow>(
      `INSERT INTO brand_pipeline (account_id, brand_name, handle, creator_id, snapshot, note)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (account_id, lower(brand_name), lower(handle))
       DO UPDATE SET creator_id = COALESCE(EXCLUDED.creator_id, brand_pipeline.creator_id),
                     snapshot   = COALESCE(EXCLUDED.snapshot, brand_pipeline.snapshot),
                     note       = COALESCE(EXCLUDED.note, brand_pipeline.note),
                     updated_at = now()
        RETURNING id, brand_name, handle, creator_id, snapshot, status, note,
                  added_at::text AS added_at, updated_at::text AS updated_at`,
      [s.account_id, brand, handle, creator_id, snapshot ? JSON.stringify(snapshot) : null, note],
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ error: 'save failed' }, { status: 500 });
    return NextResponse.json({ item: toItem(row) });
  } catch (err) {
    console.error('[pipeline] POST failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH { brand, handle, status?, note? } — advance a creator or edit its note.
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const s = await getAgencySession();
  if (!s) return NextResponse.json({ error: 'Not signed in.', needsAuth: true }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const brand = cleanBrand(body.brand);
  const handle = cleanHandle(body.handle);
  if (!brand || !handle) return NextResponse.json({ error: 'brand and handle are required' }, { status: 400 });

  const status = typeof body.status === 'string' && STATUSES.includes(body.status as PipelineStatus)
    ? (body.status as PipelineStatus)
    : null;
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null;
  if (!status && note === null) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  try {
    const rows = await getBolticClient().query<PipelineRow>(
      `UPDATE brand_pipeline
          SET status = COALESCE($4, status),
              note   = COALESCE($5, note),
              updated_at = now()
        WHERE account_id = $1 AND lower(brand_name) = lower($2) AND lower(handle) = lower($3)
      RETURNING id, brand_name, handle, creator_id, snapshot, status, note,
                added_at::text AS added_at, updated_at::text AS updated_at`,
      [s.account_id, brand, handle, status, note],
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ item: toItem(row) });
  } catch (err) {
    console.error('[pipeline] PATCH failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE ?brand=...&handle=... — drop a creator from the pipeline.
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const s = await getAgencySession();
  if (!s) return NextResponse.json({ error: 'Not signed in.', needsAuth: true }, { status: 401 });

  const brand = cleanBrand(req.nextUrl.searchParams.get('brand'));
  const handle = cleanHandle(req.nextUrl.searchParams.get('handle'));
  if (!brand || !handle) return NextResponse.json({ error: 'brand and handle are required' }, { status: 400 });

  try {
    await getBolticClient().query(
      `DELETE FROM brand_pipeline
        WHERE account_id = $1 AND lower(brand_name) = lower($2) AND lower(handle) = lower($3)`,
      [s.account_id, brand, handle],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[pipeline] DELETE failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
