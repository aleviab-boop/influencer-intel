import { NextRequest, NextResponse } from 'next/server';
import { emailEnabled, sendBrandPulse, type PulseBrandSection } from '@/lib/email';
import { loadPulseTargets, buildBrandSection, sectionHasContent } from '@/lib/brand-pulse';

export const runtime = 'nodejs';
export const maxDuration = 120; // building sections runs a trend query + creator search per brand

const MAX_BRANDS_PER_EMAIL = 5; // keep the email digestible; the rest live in the app

/**
 * GET /api/cron/brand-pulse   (?dry=1 to build without sending)
 *
 * Weekly retention digest for signed-in AGENCY accounts. For every brand an
 * agency owns (brand_dna.account_id) we build a "pulse" — the freshest trends in
 * that brand's niche + new creators worth reaching — then group by account and
 * email one roll-up per agency. Only sections with content are included, and an
 * account with nothing new mails nothing. Complements /api/cron/brand-digest
 * (campaign OPERATIONS) — this one is discovery/"come back in".
 * No-ops when email isn't configured. Optional CRON_SECRET guard.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get('dry') === '1';

  if (!emailEnabled() && !dry) {
    return NextResponse.json({ skipped: 'email_disabled', sent: 0 });
  }

  try {
    const targets = await loadPulseTargets();

    // Group brands by account, so each agency gets ONE email covering its roster.
    const byAccount = new Map<string, { email: string; account_name: string; sections: PulseBrandSection[] }>();
    for (const t of targets) {
      const g = byAccount.get(t.account_id) ?? { email: t.email, account_name: t.account_name, sections: [] };
      if (g.sections.length < MAX_BRANDS_PER_EMAIL) {
        const section = await buildBrandSection(t.account_id, t.brand_name, t.dna);
        if (sectionHasContent(section)) g.sections.push(section);
      }
      byAccount.set(t.account_id, g);
    }

    let sent = 0;
    let quiet = 0;
    let skipped = 0;
    const preview: Array<{ account: string; brands: number; trends: number; creators: number }> = [];

    for (const [account_id, g] of byAccount) {
      if (g.sections.length === 0) { quiet++; continue; }
      if (dry) {
        preview.push({
          account: g.email,
          brands: g.sections.length,
          trends: g.sections.reduce((n, s) => n + s.trends.length, 0),
          creators: g.sections.reduce((n, s) => n + s.creators.length, 0),
        });
        continue;
      }
      const ok = await sendBrandPulse({
        to: g.email,
        account_id,
        account_name: g.account_name,
        brands: g.sections,
      });
      if (ok) sent++; else skipped++;
    }

    return NextResponse.json(
      dry
        ? { dry: true, accounts: byAccount.size, would_send: preview.length, quiet, preview }
        : { accounts: byAccount.size, sent, quiet, skipped },
    );
  } catch (err) {
    console.error('[cron] brand-pulse failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
