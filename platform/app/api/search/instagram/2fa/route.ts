import { NextRequest, NextResponse } from 'next/server';
import { submitTwoFactorCode, isTwoFactorPending } from '@/lib/instagram-search';

export const runtime = 'nodejs';

// POST /api/search/instagram/2fa  { code: "123456" }
// Finishes a 2FA-gated burner login. Only valid right after a search call
// returned { twoFactorRequired: true }.
export async function POST(req: NextRequest) {
  if (!isTwoFactorPending()) {
    return NextResponse.json({ error: 'No pending 2FA. Run a search first to trigger login.' }, { status: 409 });
  }
  const body = await req.json().catch(() => ({}));
  const code = String(body?.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 });
  }

  try {
    await submitTwoFactorCode(code);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    const friendly = msg === 'bad_code'
      ? 'That code was rejected — double-check it and try again (codes expire fast).'
      : msg === 'no_pending_2fa'
      ? 'No pending 2FA. Run a search first to trigger login.'
      : 'Couldn’t complete two-factor login. Try the search again.';
    return NextResponse.json({ ok: false, error: friendly }, { status: 400 });
  }
}
