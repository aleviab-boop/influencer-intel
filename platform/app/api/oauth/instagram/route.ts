import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/oauth-service';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand_id');
  const state = Buffer.from(JSON.stringify({ brand_id: brandId, ts: Date.now() })).toString('base64url');
  return NextResponse.redirect(buildAuthUrl(state));
}
