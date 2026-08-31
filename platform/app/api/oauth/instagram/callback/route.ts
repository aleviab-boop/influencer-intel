import { NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/oauth-service';
import { syncConnectedAccount } from '@/lib/sync-worker';
import { buildCreatorSessionCookie } from '@/lib/auth';

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
    // Land the just-connected account on the rich analytics dashboard so the
    // granted insights permission is visibly used end-to-end (reach, reel plays,
    // saves, audience demographics) the moment the OAuth flow returns — this is
    // the exact use-case surface a Meta App reviewer needs to see on the
    // screencast. It resolves via ?handle (the live Graph pull is synchronous,
    // so no sync-polling wait) and is middleware-exempt for shared viewing.
    const dest = flow === 'creator'
      ? `/creator?handle=${encodeURIComponent(account.ig_username)}&connected=true`
      : `/creator/analytics-preview?handle=${encodeURIComponent(account.ig_username)}&connected=true`;
    const res = NextResponse.redirect(new URL(dest, request.url));
    // A successful Instagram connect IS the creator's login: mint a signed
    // creator session so every /creator/* view can trust who's viewing instead
    // of relying on the (spoofable) ?handle query param. The handle stays on the
    // redirect for backwards-compat until all routes read the session.
    if (flow === 'creator') {
      const cookie = buildCreatorSessionCookie({
        creator_id: account.creator_id,
        handle: account.ig_username,
        ig_user_id: account.ig_user_id ?? null,
      });
      res.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    return res;
  } catch (err) {
    console.error('[oauth] callback failed:', err);
    const back = flow === 'creator' ? `/creator?oauth_error=token_exchange_failed` : `/?oauth_error=token_exchange_failed`;
    return NextResponse.redirect(new URL(back, request.url));
  }
}
