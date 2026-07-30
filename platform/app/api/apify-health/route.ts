import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// GET /api/apify-health
//   Confirms the Apify paid-fallback is wired in THIS environment without ever
//   exposing the token:
//     configured — is APIFY_TOKEN set in this deploy's env?
//     valid      — does that token authenticate against Apify? (free users/me
//                  probe — no actor run, no credit spent)
//     account    — the Apify username the token belongs to (sanity check)
export async function GET() {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return NextResponse.json({ configured: false, valid: false });
  try {
    const res = await fetch(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ configured: true, valid: false, code: res.status });
    const d = (await res.json()) as { data?: { username?: string } };
    return NextResponse.json({ configured: true, valid: true, account: d?.data?.username ?? null });
  } catch {
    return NextResponse.json({ configured: true, valid: false, error: 'probe_failed' });
  }
}
