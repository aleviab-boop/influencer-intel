import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getAgencySession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/brand/pipeline/export?brand=GlowRoot
//   → text/csv download of this account's pipeline for the brand.
//
// Agencies live in spreadsheets — let them pull their owned funnel out whenever
// they want. Strictly scoped to the signed-in account_id + brand (401 when
// unauthenticated). Contact points (email/phone from the saved snapshot) are
// included so the export is usable for their own outreach tooling.

interface Row {
  handle: string;
  status: string;
  note: string | null;
  snapshot: Record<string, unknown> | null;
  added_at: string;
  updated_at: string;
}

// RFC-4180-ish: quote every field, double embedded quotes.
const cell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
const snap = (s: Record<string, unknown> | null, k: string): string => {
  const v = s?.[k];
  return v == null ? '' : String(v);
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const s = await getAgencySession();
  if (!s) return NextResponse.json({ error: 'Not signed in.', needsAuth: true }, { status: 401 });

  const brand = (req.nextUrl.searchParams.get('brand') || '').trim();
  if (!brand) return NextResponse.json({ error: 'brand is required' }, { status: 400 });

  try {
    const rows = await getBolticClient().query<Row>(
      `SELECT handle, status, note, snapshot,
              added_at::text AS added_at, updated_at::text AS updated_at
         FROM brand_pipeline
        WHERE account_id = $1 AND lower(brand_name) = lower($2)
        ORDER BY added_at DESC`,
      [s.account_id, brand],
    );

    const header = ['handle', 'name', 'followers', 'engagement', 'email', 'phone', 'status', 'note', 'added_at', 'updated_at'];
    const lines = [header.map(cell).join(',')];
    for (const r of rows) {
      lines.push([
        cell(r.handle),
        cell(snap(r.snapshot, 'name')),
        cell(snap(r.snapshot, 'followers')),
        cell(snap(r.snapshot, 'engagement')),
        cell(snap(r.snapshot, 'email')),
        cell(snap(r.snapshot, 'phone')),
        cell(r.status),
        cell(r.note),
        cell(r.added_at),
        cell(r.updated_at),
      ].join(','));
    }
    // Prepend a BOM so Excel opens UTF-8 handles/names correctly.
    const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
    const safeBrand = brand.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'brand';
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pipeline-${safeBrand}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[pipeline/export] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
