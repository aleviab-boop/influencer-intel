import { NextRequest, NextResponse } from 'next/server';
import { updateAutomation, deleteAutomation } from '@/lib/automations-service';
import type { AutomationStatus, TriggerType } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

// PATCH /api/automations/[id] { name?, status?, keyword?, dm_message?, ... }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  try {
    const automation = await updateAutomation(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      post_label: typeof body.post_label === 'string' ? body.post_label : undefined,
      trigger_type: body.trigger_type as TriggerType | undefined,
      keyword: typeof body.keyword === 'string' ? body.keyword : undefined,
      dm_message: typeof body.dm_message === 'string' ? body.dm_message : undefined,
      comment_reply: typeof body.comment_reply === 'string' ? body.comment_reply : undefined,
      status: body.status as AutomationStatus | undefined,
    });
    if (!automation) return NextResponse.json({ error: 'automation not found' }, { status: 404 });
    return NextResponse.json({ automation });
  } catch (err) {
    console.error('[automations] update failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/automations/[id]
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await deleteAutomation(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[automations] delete failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
