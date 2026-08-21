import { NextRequest, NextResponse } from 'next/server';
import { listPrograms, listProgramsByBrandName, createProgram } from '@/lib/programs-service';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/programs → ProgramSummary[]
// ?brand=<name>  → strict brand-workspace view: ONLY that brand's own campaigns
//                  (localStorage brand session has no auth brand_id, so we scope
//                  by name and deliberately exclude the shared agency demo pool).
// otherwise      → signed-in brand sees its own (+ shared/unassigned demo ones);
//                  logged-out preview keeps the global agency view.
export async function GET(req: NextRequest) {
  try {
    const brand = req.nextUrl.searchParams.get('brand');
    if (brand && brand.trim()) {
      const programs = await listProgramsByBrandName(brand.trim());
      return NextResponse.json({ programs });
    }
    const session = await getSession();
    const programs = await listPrograms(session?.brand_id);
    return NextResponse.json({ programs });
  } catch (err) {
    console.error('[programs] list failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/programs  { name, description?, source_prompt?, budget?, start_date?, end_date? } → Program
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || body.name.trim().length < 2) {
    return NextResponse.json({ error: 'name must be at least 2 characters' }, { status: 400 });
  }
  const budget = body.budget != null && body.budget !== '' && Number.isFinite(Number(body.budget)) ? Number(body.budget) : null;
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  try {
    // Stamp the new campaign with the signed-in brand so it's scoped to them.
    const session = await getSession();
    const program = await createProgram({
      name: body.name.trim(),
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
      requirements: typeof body.requirements === 'string' && body.requirements.trim() ? body.requirements.trim() : null,
      source_prompt: typeof body.source_prompt === 'string' ? body.source_prompt : null,
      brand_id: session?.brand_id ?? null,
      brand_name: typeof body.brand === 'string' && body.brand.trim() ? body.brand.trim() : null,
      budget,
      start_date: date(body.start_date),
      end_date: date(body.end_date),
    });
    return NextResponse.json({ program });
  } catch (err) {
    console.error('[programs] create failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
