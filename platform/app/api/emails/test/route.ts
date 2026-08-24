import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ADMIN_COOKIE, isValidAdminToken } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// POST /api/emails/test  { to }  → fires ONE test email through Resend and
// returns the raw provider response, so you can confirm RESEND_API_KEY works
// end-to-end (and see exactly why it fails — e.g. the onboarding@resend.dev
// sender can only reach your own account email until a domain is verified).
//
// Admin-gated (the /admin superadmin cookie) so it isn't an open mail relay.
// Deliberately bypasses lib/email's swallow-and-log wrapper: we want the real
// HTTP status + Resend error body surfaced to the caller for diagnosis.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const c = await cookies();
  if (!(await isValidAdminToken(c.get(ADMIN_COOKIE)?.value))) {
    return NextResponse.json({ error: 'Admin sign-in required.' }, { status: 401 });
  }

  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Influencer Intel <onboarding@resend.dev>';
  if (!key) {
    return NextResponse.json(
      { ok: false, configured: false, error: 'RESEND_API_KEY is not set on this environment.' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const to = typeof body?.to === 'string' ? body.to.trim() : '';
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ ok: false, error: 'A valid `to` email is required.' }, { status: 400 });
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: 'Influencer Intel — test email',
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;">
          <h2 style="margin:0 0 8px;color:#6d28d9;">It works ✅</h2>
          <p style="margin:0;color:#374151;">Your Resend key is live — transactional email is now sending from Influencer Intel.</p>
        </div>`,
      }),
    });
    const detail = await res.json().catch(() => ({}));
    return NextResponse.json(
      { ok: res.ok, configured: true, from, status: res.status, resend: detail },
      { status: res.ok ? 200 : 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, configured: true, from, error: (err as Error).message },
      { status: 500 },
    );
  }
}
