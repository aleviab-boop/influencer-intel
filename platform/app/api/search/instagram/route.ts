import { NextRequest, NextResponse } from 'next/server';
import { parseInstagramQuery } from '@/lib/instagram-query';
import { searchInstagram, isScraperConfigured } from '@/lib/instagram-search';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/search/instagram?q=fashion+nagpur
// Parses the prompt and searches Instagram (authenticated, via the burner
// account). Returns { configured:false } until IG_SCRAPER_USER/PASS are set.
export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });

  const parsed = parseInstagramQuery(q);

  if (!isScraperConfigured()) {
    return NextResponse.json({ configured: false, parsed, accounts: [] });
  }

  try {
    const accounts = await searchInstagram(parsed);
    return NextResponse.json({ configured: true, parsed, accounts });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'two_factor_required') {
      return NextResponse.json({
        configured: true,
        parsed,
        accounts: [],
        twoFactorRequired: true,
        error: 'The scraper account needs a 2FA code. Enter the SMS/authenticator code to finish signing in. (Push “approve on another device” 2FA won’t work — disable it or switch to a code.)',
      }, { status: 401 });
    }
    const friendly = msg === 'checkpoint'
      ? 'Instagram flagged the scraper account (checkpoint). Log into it once in a browser to clear it, then retry.'
      : msg === 'bad_password'
      ? 'Instagram says the scraper account’s password is incorrect — double-check IG_SCRAPER_USER / IG_SCRAPER_PASS.'
      : msg === 'login_failed'
      ? 'Couldn’t log in the scraper account — Instagram rejected the login.'
      : 'Search failed. Instagram may be rate-limiting — try again shortly.';
    return NextResponse.json({ configured: true, parsed, accounts: [], error: friendly }, { status: 502 });
  }
}
