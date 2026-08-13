import { NextResponse } from 'next/server';
import { listEmailLog, emailEnabled } from '@/lib/email';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/emails → { enabled, emails: EmailLogRow[] }
// The agency-side "Email Activity" feed: every transactional email the platform
// sent on behalf of this brand's campaigns (invite / payment / review / deadline),
// newest first. Scoped to the signed-in brand (+ shared/unassigned demo rows).
export async function GET() {
  try {
    const session = await getSession();
    const emails = await listEmailLog(session?.brand_id);
    return NextResponse.json({ enabled: emailEnabled(), emails });
  } catch (err) {
    console.error('[emails] list failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
