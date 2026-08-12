import { NextResponse, type NextRequest } from 'next/server';
import { parseSignedRequest, deleteInstagramUserData } from '@/lib/oauth-service';

export const runtime = 'nodejs';

/**
 * POST /api/oauth/instagram/deauthorize
 *
 * Meta's Deauthorize callback — fired when a user removes our app from their
 * Instagram settings. Meta sends a form-encoded `signed_request` (HMAC-signed
 * with the app secret) carrying the user's Instagram-scoped id. Our published
 * data-deletion policy states that removing the app deletes the data tied to
 * that connection, so we verify the request and delete the user's connected
 * account(s) (cascading to their post insights). Required for App Review.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    let signed = '';
    try {
      const form = await req.formData();
      signed = String(form.get('signed_request') ?? '');
    } catch {
      // Some senders use JSON — fall back to that.
      const body = (await req.json().catch(() => null)) as { signed_request?: string } | null;
      signed = body?.signed_request ?? '';
    }

    const payload = parseSignedRequest(signed);
    if (!payload) {
      // Bad signature → reject so a forged deauth can't delete accounts.
      return NextResponse.json({ error: 'invalid signed_request' }, { status: 400 });
    }
    const igUserId = typeof payload.user_id === 'string' ? payload.user_id : '';
    const deleted = await deleteInstagramUserData(igUserId).catch((err) => {
      console.error('[oauth/deauthorize] delete failed:', err);
      return 0;
    });
    console.log(`[oauth] deauthorize for ig_user ${igUserId || 'unknown'}: removed ${deleted} connection(s)`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[oauth/deauthorize] error:', err);
    // Still 200 — a 5xx makes Meta retry, and there's nothing to recover.
    return NextResponse.json({ ok: true });
  }
}
