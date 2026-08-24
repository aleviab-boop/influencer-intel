import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { sendEmail, emailEnabled } from '@/lib/email';
import { getAgencySession } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/outreach/send
//   { handle, message, subject?, channel?, creator_id?, program_id?, recipient? }
//   → { ok: true, id }
//
// One-click first-contact outreach. Today this drives the EMAIL channel: it
// sends the drafted message via Resend and logs the attempt to outreach_messages
// so the (later) response tracker has a record of who we've reached. Replaces the
// old `mailto:` hand-off — no copy-paste, no leaving the app.
//
// Deliberately channel-guarded: dm/whatsapp are accepted into the log but NOT
// auto-sent here (there's no compliant one-click cold-DM path), so the client
// only calls this for `channel: 'email'`. Reply detection is a separate phase —
// this route never reads replies, it only records sends.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Wrap a plain-text draft in the same minimal, client-safe shell the rest of our
// mail uses (inline styles only). Newlines → paragraph breaks.
function outreachHtml(message: string): string {
  const bodyHtml = escapeHtml(message.trim())
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 12px;">${para.replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:28px 32px;color:#374151;font-size:15px;line-height:1.55;">
        ${bodyHtml}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const handle = typeof body?.handle === 'string' ? body.handle.trim().replace(/^@/, '') : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const channel = typeof body?.channel === 'string' ? body.channel.trim() : 'email';
  const recipient = typeof body?.recipient === 'string' ? body.recipient.trim() : '';
  const subject =
    typeof body?.subject === 'string' && body.subject.trim() ? body.subject.trim() : 'Collaboration with you';
  const creatorId = typeof body?.creator_id === 'string' && body.creator_id ? body.creator_id : null;
  const programId = typeof body?.program_id === 'string' && body.program_id ? body.program_id : null;

  if (!handle || message.length < 2) {
    return NextResponse.json({ error: 'handle and message are required' }, { status: 400 });
  }
  // Only email is a real one-click send today.
  if (channel !== 'email') {
    return NextResponse.json({ error: `channel '${channel}' is not sendable here` }, { status: 400 });
  }
  if (!EMAIL_RE.test(recipient)) {
    return NextResponse.json({ error: 'a valid recipient email is required' }, { status: 400 });
  }
  // Stamp the sending agency (when signed in) so the pipeline can scope each
  // creator's outreach history to the account that sent it. Null for the
  // anonymous discovery flow — those sends just aren't account-attributed.
  const account = await getAgencySession();
  const accountId = account?.account_id ?? null;
  const db = getBolticClient();

  if (!emailEnabled()) {
    // No server-side sender configured — the client hands the draft off to the
    // user's own mail app (Gmail compose / mailto). The draft goes out from the
    // user's real address, so this IS a tracked contact, but not a confirmed
    // 'sent' (we can't know they hit send) — log it as 'handoff' so it shows up
    // in the outreach history with honest state, then signal the client.
    let id: string | null = null;
    try {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO outreach_messages
           (handle, creator_id, program_id, account_id, channel, recipient, subject, body, status)
         VALUES ($1, $2, $3, $4, 'email', $5, $6, $7, 'handoff')
         RETURNING id`,
        [handle, creatorId, programId, accountId, recipient, subject.slice(0, 300), message],
      );
      id = rows[0]?.id ?? null;
    } catch (err) {
      console.error('[outreach/send] handoff log write failed:', err);
    }
    return NextResponse.json(
      { ok: false, needs_handoff: true, id, error: 'Email sending is not configured — open in your mail app instead.' },
      { status: 503 },
    );
  }

  // Send first (no meta → skips the creator opt-out gate + email_log; this is
  // first-contact outreach, not a subscribed notification). We keep our own
  // audit in outreach_messages instead.
  const sent = await sendEmail({ to: recipient, subject, html: outreachHtml(message) });

  try {
    const rows = await db.query<{ id: string }>(
      `INSERT INTO outreach_messages
         (handle, creator_id, program_id, account_id, channel, recipient, subject, body, status, error)
       VALUES ($1, $2, $3, $4, 'email', $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        handle,
        creatorId,
        programId,
        accountId,
        recipient,
        subject.slice(0, 300),
        message,
        sent ? 'sent' : 'failed',
        sent ? null : 'Resend send returned false',
      ],
    );
    if (!sent) {
      return NextResponse.json(
        { ok: false, id: rows[0]?.id ?? null, error: 'Email could not be delivered.' },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, id: rows[0]?.id ?? null });
  } catch (err) {
    console.error('[outreach/send] log write failed:', err);
    // The mail may already have gone out; report success but note the log gap.
    return NextResponse.json({ ok: sent, id: null, logged: false });
  }
}
