import { NextRequest, NextResponse } from 'next/server';
import { updateAsset, deleteAsset } from '@/lib/media-service';
import type { AssetStatus, AssetType } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

// PATCH /api/media/[id] { title?, asset_type?, asset_url?, caption?, status?, note? }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  try {
    const asset = await updateAsset(id, {
      title: typeof body.title === 'string' ? body.title : undefined,
      asset_type: body.asset_type as AssetType | undefined,
      asset_url: typeof body.asset_url === 'string' ? body.asset_url : undefined,
      caption: typeof body.caption === 'string' ? body.caption : undefined,
      status: body.status as AssetStatus | undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
    });
    if (!asset) return NextResponse.json({ error: 'asset not found' }, { status: 404 });
    return NextResponse.json({ asset });
  } catch (err) {
    console.error('[media] update failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/media/[id]
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await deleteAsset(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[media] delete failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
