import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// Meta / Instagram Data Deletion Callback.
//
// When a user removes our app from their Instagram, Meta POSTs a `signed_request`
// (form-urlencoded) here. We verify it with the app secret, delete the data tied
// to that Instagram user, and respond with the { url, confirmation_code } that
// Meta requires so the user can track the request. See:
// https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback

const APP_SECRET = process.env.IG_APP_SECRET ?? '';

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

interface SignedPayload {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
}

// Verify + parse Meta's signed_request. Returns the payload, or null if the
// signature is missing/invalid (never trust an unverified body).
function parseSignedRequest(signedRequest: string): SignedPayload | null {
  if (!APP_SECRET) return null;
  const parts = signedRequest.split('.');
  if (parts.length !== 2) return null;
  const [encodedSig, payload] = parts as [string, string];

  const expected = crypto.createHmac('sha256', APP_SECRET).update(payload).digest();
  const actual = base64UrlDecode(encodedSig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const data = JSON.parse(base64UrlDecode(payload).toString('utf8')) as SignedPayload;
    if (data.algorithm && data.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
    return data;
  } catch {
    return null;
  }
}

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
  const userId = data?.user_id;

  // A short, user-facing tracking code (also lets us correlate in logs).
  const confirmationCode = 'del_' + crypto.randomBytes(9).toString('hex');
  const origin = new URL(request.url).origin;
  const statusUrl = `${origin}/data-deletion?code=${confirmationCode}`;

  if (userId) {
    try {
      const db = getBolticClient();
      // Remove the connection (and its encrypted token) for this IG user.
      await db.query(`DELETE FROM connected_accounts WHERE ig_user_id = $1`, [userId]);
      console.log(`[data-deletion] ${confirmationCode}: removed connection(s) for ig_user_id=${userId}`);
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
