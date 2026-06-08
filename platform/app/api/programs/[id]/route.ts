import { NextRequest, NextResponse } from 'next/server';
import { getProgram, updateProgram, deleteProgram } from '@/lib/programs-service';
import type { ProgramStatus } from '@influencer-intel/shared/types';

const dateOrUndef = (v: unknown): string | null | undefined => {
  if (v === null || v === '') return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return undefined;
};

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

// PATCH /api/programs/[id]  { name?, description?, status?, budget?, start_date?, end_date? }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  try {
    const program = await updateProgram({
      id,
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : body.description === null ? null : undefined,
      status: typeof body.status === 'string' ? (body.status as ProgramStatus) : undefined,
      budget: typeof body.budget === 'number' ? body.budget : body.budget === null ? null : undefined,
      start_date: dateOrUndef(body.start_date),
      end_date: dateOrUndef(body.end_date),
    });
    if (!program) return NextResponse.json({ error: 'program not found' }, { status: 404 });
    return NextResponse.json({ program });
  } catch (err) {
    console.error('[programs] update failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/programs/[id] → remove campaign (and its recruits via cascade)
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const ok = await deleteProgram(id);
    if (!ok) return NextResponse.json({ error: 'program not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[programs] delete failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
