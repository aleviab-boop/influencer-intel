import { NextResponse } from 'next/server';
import { buildAuthUrl, isOAuthConfigured } from '@/lib/oauth-service';
import { isBetaOpen, isHandleAllowed } from '@/lib/oauth-beta';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const flow = url.searchParams.get('flow'); // 'creator' for the creator portal, else brand connect
  const handle = url.searchParams.get('handle');
  if (!isOAuthConfigured()) {
    // Don't bounce the user to Instagram with an empty client_id — fail clearly,
    // back to whichever surface started the flow.
    const dest = flow === 'creator' ? '/creator?oauth_error=not_configured' : '/connect?error=not_configured';
    return NextResponse.redirect(new URL(dest, request.url));
  }
  // Beta gate: while the app is pre-approval, Instagram Login only works for the
  // handles we've added as testers. Bounce a non-allowlisted handle back to a
  // friendly waitlist prompt rather than into Instagram's opaque error wall.
  if (!isBetaOpen() && handle && !isHandleAllowed(handle)) {
    const q = `oauth_error=beta&handle=${encodeURIComponent(handle.replace(/^@/, ''))}`;
    const dest = flow === 'creator' ? `/creator?${q}` : `/connect?error=beta&handle=${encodeURIComponent(handle.replace(/^@/, ''))}`;
    return NextResponse.redirect(new URL(dest, request.url));
  }
  const brandId = url.searchParams.get('brand_id');
  const state = Buffer.from(JSON.stringify({ brand_id: brandId, flow, ts: Date.now() })).toString('base64url');
  return NextResponse.redirect(buildAuthUrl(state));
}
