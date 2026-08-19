import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getAgencySession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/outreach/history?handle=x
//   → { items: [{ id, channel, recipient, subject, preview, status, sent_at }] }
//
// This agency's own outreach to one creator, newest first — the record that
// powers the pipeline row's history disclosure. Strictly scoped to the signed-in
// account_id (mig 042) so no agency ever sees another's sends to the same handle.
// 401 when signed out. Returns a short body preview, never the whole email.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const s = await getAgencySession();
  if (!s) return NextResponse.json({ error: 'Not signed in.', needsAuth: true }, { status: 401 });

  const handle = (req.nextUrl.searchParams.get('handle') || '').trim().replace(/^@/, '');
  if (!handle) return NextResponse.json({ error: 'handle is required' }, { status: 400 });

  try {
    const rows = await getBolticClient().query<{
      id: string;
      channel: string;
      recipient: string | null;
      subject: string | null;
      body: string;
      status: string;
      sent_at: string;
    }>(
      `SELECT id, channel, recipient, subject, body, status, sent_at::text AS sent_at
         FROM outreach_messages
        WHERE account_id = $1 AND lower(handle) = lower($2)
        ORDER BY sent_at DESC
        LIMIT 10`,
      [s.account_id, handle],
    );
    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        recipient: r.recipient,
        subject: r.subject,
        preview: (r.body || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        status: r.status,
        sent_at: String(r.sent_at),
      })),
    });
  } catch (err) {
    console.error('[outreach/history] failed:', err);
    return NextResponse.json({ items: [] });
  }
}
