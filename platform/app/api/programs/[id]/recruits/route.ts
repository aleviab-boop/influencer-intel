import { NextRequest, NextResponse } from 'next/server';
import { recruitToProgram, updateRecruit, removeRecruit, guardBrandProgram } from '@/lib/programs-service';
import type { RecruitStatus } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

const STATUSES: RecruitStatus[] = ['invited', 'contacted', 'recruited', 'declined'];

// A signed-in brand may only manage recruits on its own (or unassigned demo)
// campaigns; logged-out preview is unaffected. Cross-brand → treated as absent.
async function denyCrossBrand(id: string): Promise<NextResponse | null> {
  return (await guardBrandProgram(id)) === 'ok'
    ? null
    : NextResponse.json({ error: 'program not found' }, { status: 404 });
}

// POST /api/programs/[id]/recruits  { creator_id, source_prompt?, relevance_score?, confidence_score?, note? }
//   → recruit a creator into the program (status starts at 'invited')
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.creator_id !== 'string') {
    return NextResponse.json({ error: 'creator_id is required' }, { status: 400 });
  }
  try {
    const denied = await denyCrossBrand(id);
    if (denied) return denied;
    const recruit = await recruitToProgram({
      program_id: id,
      creator_id: body.creator_id,
      source_prompt: typeof body.source_prompt === 'string' ? body.source_prompt : null,
      relevance_score: typeof body.relevance_score === 'number' ? body.relevance_score : null,
      confidence_score: typeof body.confidence_score === 'number' ? body.confidence_score : null,
      note: typeof body.note === 'string' ? body.note : null,
    });
    return NextResponse.json({ recruit });
  } catch (err) {
    console.error('[programs] recruit failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH /api/programs/[id]/recruits
//   { creator_id, status?, note?, deliverables?, due_date?, rate? }
//   → update a recruit's pipeline stage and/or deal details
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.creator_id !== 'string') {
    return NextResponse.json({ error: 'creator_id is required' }, { status: 400 });
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 });
  }
  try {
    const denied = await denyCrossBrand(id);
    if (denied) return denied;
    const recruit = await updateRecruit({
      program_id: id,
      creator_id: body.creator_id,
      status: body.status,
      note: typeof body.note === 'string' ? body.note : undefined,
      deliverables: typeof body.deliverables === 'string' ? body.deliverables : undefined,
      due_date: typeof body.due_date === 'string' ? body.due_date : body.due_date === null ? null : undefined,
      rate: typeof body.rate === 'number' ? body.rate : body.rate === null ? null : undefined,
      paid: typeof body.paid === 'boolean' ? body.paid : undefined,
      payout_upi: typeof body.payout_upi === 'string' ? body.payout_upi : body.payout_upi === null ? null : undefined,
    });
    if (!recruit) return NextResponse.json({ error: 'recruit not found' }, { status: 404 });
    return NextResponse.json({ recruit });
  } catch (err) {
    console.error('[programs] recruit update failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/programs/[id]/recruits  { creator_id }  (or ?creator_id=…)
//   → remove a creator from this program (keeps the creator + other campaigns)
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const creatorId =
    body && typeof body.creator_id === 'string'
      ? body.creator_id
      : new URL(req.url).searchParams.get('creator_id');
  if (!creatorId) {
    return NextResponse.json({ error: 'creator_id is required' }, { status: 400 });
  }
  try {
    const denied = await denyCrossBrand(id);
    if (denied) return denied;
    const removed = await removeRecruit({ program_id: id, creator_id: creatorId });
    if (!removed) return NextResponse.json({ error: 'recruit not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[programs] recruit remove failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
