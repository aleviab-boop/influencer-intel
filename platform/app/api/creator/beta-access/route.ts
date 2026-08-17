import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { betaStatus, isHandleAllowed, isOnWaitlist, joinWaitlist, canonHandle } from '@/lib/oauth-beta';

export const runtime = 'nodejs';

/**
 * GET /api/creator/beta-access?handle=
 *
 * Tell the UI whether Instagram Connect is open, and — for a given handle —
 * whether that account can connect right now (tester allowlist) or is already
 * on the waitlist. No DB unless a handle is supplied. Always 200.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const handle = url.searchParams.get('handle');
  const status = betaStatus();

  // When the gate is open, everyone's allowed — skip the DB entirely.
  if (status.open) {
    return NextResponse.json({ ...status, allowed: true, on_waitlist: false });
  }

  const allowed = isHandleAllowed(handle);
  let on_waitlist = false;
  if (!allowed && handle && canonHandle(handle)) {
    try {
      on_waitlist = await isOnWaitlist(getBolticClient(), handle);
    } catch {
      on_waitlist = false;
    }
  }
  return NextResponse.json({ ...status, allowed, on_waitlist });
}

/**
 * POST /api/creator/beta-access
 *
 * Join the Instagram Connect waitlist. Body: { handle, email?, note? }.
 * Idempotent per handle. Always 200 with { ok } (or { ok:false, reason }).
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { handle?: string; email?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 200 });
  }

  const handle = canonHandle(body.handle ?? '');
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
    return NextResponse.json({ ok: false, reason: 'invalid_handle' }, { status: 200 });
  }

  // Already allowlisted? Nothing to do — they can connect directly.
  if (isHandleAllowed(handle)) {
    return NextResponse.json({ ok: true, allowed: true, waitlisted: false });
  }

  try {
    await joinWaitlist(getBolticClient(), handle, body.email, body.note);
    return NextResponse.json({ ok: true, allowed: false, waitlisted: true });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
