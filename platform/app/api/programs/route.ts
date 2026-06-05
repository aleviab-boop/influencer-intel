import { NextRequest, NextResponse } from 'next/server';
import { listPrograms, createProgram } from '@/lib/programs-service';

export const runtime = 'nodejs';

// GET /api/programs → ProgramSummary[]
export async function GET() {
  try {
    const programs = await listPrograms();
    return NextResponse.json({ programs });
  } catch (err) {
    console.error('[programs] list failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/programs  { name, description?, source_prompt? } → Program
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || body.name.trim().length < 2) {
    return NextResponse.json({ error: 'name must be at least 2 characters' }, { status: 400 });
  }
  try {
    const program = await createProgram({
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : null,
      source_prompt: typeof body.source_prompt === 'string' ? body.source_prompt : null,
    });
    return NextResponse.json({ program });
  } catch (err) {
    console.error('[programs] create failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
