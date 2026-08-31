import { NextRequest, NextResponse } from 'next/server';
import { resetPassword } from '@/lib/agency-reset';

export const runtime = 'nodejs';

// POST /api/brand/auth/reset/confirm  { token, password }  → { ok: true }
//
// Completes a reset. The token is single-use (bound to the old password hash)
// and 1-hour-lived; a bad/expired/already-used token returns 400. On success the
// password is replaced — the user then signs in fresh (no session is minted
// here, so a stolen link can't also grant a live session).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  try {
    const ok = await resetPassword(token, password);
    if (!ok) {
      return NextResponse.json(
        { error: 'This reset link is invalid or has expired. Request a new one.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not reset password.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
