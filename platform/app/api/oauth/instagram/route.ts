import { NextResponse } from 'next/server';
import { buildAuthUrl, isOAuthConfigured } from '@/lib/oauth-service';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const flow = url.searchParams.get('flow'); // 'creator' for the creator portal, else brand connect
  if (!isOAuthConfigured()) {
    // Don't bounce the user to Instagram with an empty client_id — fail clearly,
    // back to whichever surface started the flow.
    const dest = flow === 'creator' ? '/creator?oauth_error=not_configured' : '/connect?error=not_configured';
    return NextResponse.redirect(new URL(dest, request.url));
  }
  const brandId = url.searchParams.get('brand_id');
  const state = Buffer.from(JSON.stringify({ brand_id: brandId, flow, ts: Date.now() })).toString('base64url');
  return NextResponse.redirect(buildAuthUrl(state));
}
