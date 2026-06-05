import { NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/oauth-service';
import { syncConnectedAccount } from '@/lib/sync-worker';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const error = url.searchParams.get('error');

  let flow: string | null = null;
  try { flow = JSON.parse(Buffer.from(state, 'base64url').toString()).flow ?? null; } catch { /* optional */ }

  if (error || !code) {
    const reason = url.searchParams.get('error_reason') ?? 'unknown';
    const back = flow === 'creator' ? `/creator?oauth_error=${encodeURIComponent(reason)}` : `/?oauth_error=${encodeURIComponent(reason)}`;
    return NextResponse.redirect(new URL(back, request.url));
  }

  try {
    const account = await handleOAuthCallback(code, state);
    // Fire-and-forget initial sync
    void syncConnectedAccount(account.id).catch((err) =>
      console.error('[oauth] initial sync failed:', err),
    );
    const dest = flow === 'creator'
      ? `/creator?handle=${encodeURIComponent(account.ig_username)}&connected=true`
      : `/insights/${account.ig_username}?connected=true`;
    return NextResponse.redirect(new URL(dest, request.url));
  } catch (err) {
    console.error('[oauth] callback failed:', err);
    const back = flow === 'creator' ? `/creator?oauth_error=token_exchange_failed` : `/?oauth_error=token_exchange_failed`;
    return NextResponse.redirect(new URL(back, request.url));
  }
}
