import { NextResponse } from 'next/server';
import { buildAuthUrl, isOAuthConfigured } from '@/lib/oauth-service';

export async function GET(request: Request): Promise<NextResponse> {
  if (!isOAuthConfigured()) {
    // Don't bounce the user to Instagram with an empty client_id — fail clearly.
    return NextResponse.redirect(new URL('/connect?error=not_configured', request.url));
  }
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand_id');
  const state = Buffer.from(JSON.stringify({ brand_id: brandId, ts: Date.now() })).toString('base64url');
  return NextResponse.redirect(buildAuthUrl(state));
}
