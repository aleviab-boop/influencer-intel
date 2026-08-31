import { NextRequest, NextResponse } from 'next/server';
import { requestPasswordReset } from '@/lib/agency-reset';
import { sendPasswordResetEmail } from '@/lib/email';

export const runtime = 'nodejs';

// POST /api/brand/auth/reset/request  { email }  → { ok: true }
//
// Always returns { ok: true } regardless of whether the email maps to an
// account — this is deliberate (anti-enumeration): an attacker can't probe which
// emails are registered. When an account does exist we mint a single-use,
// 1-hour reset token and email a link; when email delivery is unconfigured the
// send is a silent no-op and the response is unchanged.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';
  try {
    const reset = await requestPasswordReset(email);
    if (reset) {
      const origin = new URL(req.url).origin;
      const url = `${origin}/brand/reset?token=${encodeURIComponent(reset.token)}`;
      // Fire-and-forget: a mail failure must never leak (via error or timing)
      // whether the account exists.
      void sendPasswordResetEmail(reset.email, reset.name, url).catch(() => {});
    }
  } catch {
    /* never surface internal errors to the caller */
  }
  return NextResponse.json({ ok: true });
}
