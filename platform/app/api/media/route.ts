import { NextRequest, NextResponse } from 'next/server';
import { listAssets, createAsset } from '@/lib/media-service';
import type { AssetType } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

const TYPES: AssetType[] = ['reel', 'image', 'carousel', 'story'];

// GET /api/media → AssetRow[]
export async function GET() {
  try {
    const assets = await listAssets();
    return NextResponse.json({ assets });
  } catch (err) {
    console.error('[media] list failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/media { title, asset_type?, asset_url?, caption?, program_id?, creator_handle? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== 'string' || body.title.trim().length < 2) {
    return NextResponse.json({ error: 'title must be at least 2 characters' }, { status: 400 });
  }
  try {
    const asset = await createAsset({
      title: body.title.trim(),
      asset_type: TYPES.includes(body.asset_type) ? body.asset_type : 'reel',
      asset_url: typeof body.asset_url === 'string' && body.asset_url.trim() ? body.asset_url.trim() : null,
      caption: typeof body.caption === 'string' ? body.caption : null,
      program_id: typeof body.program_id === 'string' && body.program_id ? body.program_id : null,
      creator_handle: typeof body.creator_handle === 'string' && body.creator_handle.trim() ? body.creator_handle.trim() : null,
    });
    return NextResponse.json({ asset });
  } catch (err) {
    console.error('[media] create failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
