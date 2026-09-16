import { NextResponse } from 'next/server';
import { readOgProxyHealth } from '@/lib/og-proxy-health';
import { emailEnabled } from '@/lib/email';

export const runtime = 'nodejs';

// GET /api/health — lightweight, read-only status snapshot. No side effects, no
// Apify, no web_profile_info. Surfaces whether the home-IP og proxy is serving
// data (and how stale that signal is) so a silent tunnel death is visible at a
// glance instead of via empty avatars. `og_proxy.ok` reflects the last canary
// run by /api/cron/engagement-fetch; `minutes_stale` is time since it last
// succeeded.
export async function GET(): Promise<NextResponse> {
  try {
    const ogProxy = await readOgProxyHealth();
    return NextResponse.json({
      ok: true,
      email_delivery: emailEnabled() ? 'automated' : 'manual', // manual by design
      og_proxy: ogProxy,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
