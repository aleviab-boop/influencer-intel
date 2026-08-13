import { NextResponse } from 'next/server';
import { emailEnabled, sendEmail } from '@/lib/email';

export const runtime = 'nodejs';

/**
 * GET /api/creator/email-diag[?send=1]
 *
 * Diagnostic only. Reports whether the RUNNING deployment has RESEND_API_KEY
 * loaded (`enabled`), and — with `?send=1` — performs one real send to Resend's
 * SAFE simulator inbox (delivered@resend.dev). The recipient is hard-coded to
 * that fixed test address, so this endpoint can never be used to send arbitrary
 * mail. Returns booleans only; no secrets. Always 200.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const enabled = emailEnabled();

  if (url.searchParams.get('send') !== '1') {
    return NextResponse.json({ enabled });
  }

  const sent = await sendEmail({
    to: 'delivered@resend.dev', // Resend's simulator — never reaches a real person
    subject: 'Influencer Intel — email diagnostic',
    html: '<p>Diagnostic send confirming RESEND_API_KEY works in this deployment.</p>',
  });

  return NextResponse.json({ enabled, sent });
}
