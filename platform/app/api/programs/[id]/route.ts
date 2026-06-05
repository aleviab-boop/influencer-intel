import { NextRequest, NextResponse } from 'next/server';
import { getProgram, updateProgram } from '@/lib/programs-service';
import type { ProgramStatus } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

// GET /api/programs/[id] → { program, recruits, spent }
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const data = await getProgram(id);
    if (!data) return NextResponse.json({ error: 'program not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error('[programs] detail failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH /api/programs/[id]  { name?, status?, budget? } → update campaign
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  try {
    const program = await updateProgram({
      id,
      name: typeof body.name === 'string' ? body.name : undefined,
      status: typeof body.status === 'string' ? (body.status as ProgramStatus) : undefined,
      budget: typeof body.budget === 'number' ? body.budget : body.budget === null ? null : undefined,
    });
    if (!program) return NextResponse.json({ error: 'program not found' }, { status: 404 });
    return NextResponse.json({ program });
  } catch (err) {
    console.error('[programs] update failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
