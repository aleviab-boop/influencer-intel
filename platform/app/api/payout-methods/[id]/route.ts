import { NextRequest, NextResponse } from 'next/server';
import { deletePayoutMethod, setDefaultPayoutMethod } from '@/lib/payout-methods-service';

export const runtime = 'nodejs';

// PATCH /api/payout-methods/[id] { is_default: true } → make default
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (body?.is_default !== true) return NextResponse.json({ error: 'only is_default:true supported' }, { status: 400 });
  const ok = await setDefaultPayoutMethod(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not found' }, { status: 404 });
}

// DELETE /api/payout-methods/[id]
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = await deletePayoutMethod(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
