import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { parseSignedRequest, deleteInstagramUserData } from '@/lib/oauth-service';

export const runtime = 'nodejs';

// Meta / Instagram Data Deletion Callback.
//
// When a user asks Meta to delete the data an app holds about them, Meta POSTs a
// `signed_request` (form-urlencoded) here. We verify it with the app secret,
// delete the data tied to that Instagram user, and respond with the
// { url, confirmation_code } Meta requires so the user can track the request.
// Signature verification + deletion are shared with the deauthorize callback via
// oauth-service. See:
// https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback

export async function POST(request: Request): Promise<NextResponse> {
  let signedRequest = '';
  try {
    const form = await request.formData();
    signedRequest = String(form.get('signed_request') ?? '');
  } catch {
    // Some senders use JSON; fall back to that.
    try {
      const body = (await request.json()) as { signed_request?: string };
      signedRequest = body.signed_request ?? '';
    } catch { /* ignore */ }
  }

  const data = signedRequest ? parseSignedRequest(signedRequest) : null;
  const userId = typeof data?.user_id === 'string' ? data.user_id : '';

  // A short, user-facing tracking code (also lets us correlate in logs).
  const confirmationCode = 'del_' + crypto.randomBytes(9).toString('hex');
  const origin = new URL(request.url).origin;
  const statusUrl = `${origin}/data-deletion?code=${confirmationCode}`;

  if (userId) {
    try {
      const removed = await deleteInstagramUserData(userId);
      console.log(`[data-deletion] ${confirmationCode}: removed ${removed} connection(s) for ig_user_id=${userId}`);
    } catch (err) {
      console.error(`[data-deletion] ${confirmationCode}: delete failed:`, err);
      // Still return 200 with a code — Meta expects the ack; we retry/repair internally.
    }
  } else {
    console.warn('[data-deletion] received request with no valid signed_request/user_id');
  }

  // Meta requires exactly this JSON shape.
  return NextResponse.json({ url: statusUrl, confirmation_code: confirmationCode }, { status: 200 });
}
