import { NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/oauth-service';
import { syncConnectedAccount } from '@/lib/sync-worker';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const error = url.searchParams.get('error');

  if (error || !code) {
    const reason = url.searchParams.get('error_reason') ?? 'unknown';
    return NextResponse.redirect(new URL(`/?oauth_error=${encodeURIComponent(reason)}`, request.url));
  }

  try {
    const account = await handleOAuthCallback(code, state);
    // Fire-and-forget initial sync
    void syncConnectedAccount(account.id).catch((err) =>
      console.error('[oauth] initial sync failed:', err),
    );
    return NextResponse.redirect(new URL(`/insights/${account.ig_username}?connected=true`, request.url));
  } catch (err) {
    console.error('[oauth] callback failed:', err);
    return NextResponse.redirect(new URL(`/?oauth_error=token_exchange_failed`, request.url));
  }
}
