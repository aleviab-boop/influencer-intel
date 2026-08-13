// ============================================================
// Transactional email — turns the pull-based creator notification feed into
// real out-of-app delivery (an invite lands → the creator gets an email).
//
// Uses Resend's REST API over plain `fetch` — no SDK dependency, nothing to
// install. The whole module is gated behind RESEND_API_KEY: with no key set
// (dev, preview, or before the key is added to Vercel) every send is a no-op
// that resolves, so callers can fire-and-forget without ever breaking their
// own write path.
//
// Callers should invoke these as `void notifyInvite(...).catch(() => {})` —
// a mail failure must never surface as a recruit/payment failure.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Is email delivery configured? Everything below no-ops when false. */
export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY;
}

// Verified sender. Until you verify your own domain in Resend, their shared
// `onboarding@resend.dev` sender works for testing (low deliverability, fine
// for a demo). Set EMAIL_FROM to `Name <notify@yourdomain.com>` once verified.
function fromAddress(): string {
  return process.env.EMAIL_FROM || 'Influencer Intel <onboarding@resend.dev>';
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://influencer-intel-platform.vercel.app').replace(/\/$/, '');
}

const money = (n: number): string => (n > 0 ? '₹' + Number(n).toLocaleString('en-IN') : '');

/** Minimal, client-safe HTML shell — inline styles only (email clients strip <style>). */
function shell(heading: string, bodyHtml: string, ctaLabel: string, ctaHref: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:28px 32px 8px;">
        <div style="font-weight:700;font-size:15px;color:#6d28d9;letter-spacing:-0.2px;">Influencer Intel</div>
      </td></tr>
      <tr><td style="padding:8px 32px 4px;">
        <h1 style="margin:0;font-size:20px;line-height:1.3;color:#111827;">${heading}</h1>
      </td></tr>
      <tr><td style="padding:8px 32px 20px;color:#374151;font-size:15px;line-height:1.55;">
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:0 32px 32px;">
        <a href="${ctaHref}" style="display:inline-block;background:#6d28d9;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:9px;">${ctaLabel}</a>
      </td></tr>
    </table>
    <div style="color:#9ca3af;font-size:12px;padding:16px 0;">You're receiving this because you have a creator account on Influencer Intel.</div>
  </td></tr></table>
</body></html>`;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

/** Low-level send. Returns true on accept, false on any no-op/failure. Never throws. */
export async function sendEmail({ to, subject, html }: SendArgs): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;                 // unconfigured → silent no-op
  if (!to || !EMAIL_RE.test(to)) return false;
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress(), to, subject, html }),
    });
    if (!res.ok) {
      console.error('[email] send failed:', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] send error:', (err as Error).message);
    return false;
  }
}

interface RecruitContext {
  email: string | null;
  creator_name: string;
  brand: string;
  program: string;
  rate: number;
}

// One query to gather everything an invite/payment email needs. Prefers the
// claimed-account email, falls back to the OAuth-verified one.
async function loadRecruitContext(programId: string, creatorId: string): Promise<RecruitContext | null> {
  const db = getBolticClient();
  const rows = await db.query<{
    email: string | null; creator_name: string | null;
    brand: string | null; program: string | null; rate: string | number | null;
  }>(
    `SELECT COALESCE(NULLIF(c.email, ''), c.verified_oauth_data->>'email') AS email,
            COALESCE(NULLIF(c.display_name, ''), c.handle)                 AS creator_name,
            b.name  AS brand,
            p.name  AS program,
            pr.rate AS rate
     FROM program_recruits pr
     JOIN programs p ON p.id = pr.program_id
     LEFT JOIN brands b ON b.id = p.brand_id
     JOIN creators c ON c.id = pr.creator_id
     WHERE pr.program_id = $1 AND pr.creator_id = $2
     LIMIT 1`,
    [programId, creatorId],
  );
  const r = rows[0];
  if (!r) return null;
  const rate = Number(r.rate);
  return {
    email: r.email,
    creator_name: r.creator_name ?? 'there',
    brand: r.brand ?? 'A brand',
    program: r.program ?? 'a campaign',
    rate: Number.isFinite(rate) ? rate : 0,
  };
}

/** A brand just invited this creator into a campaign. */
export async function notifyInvite(programId: string, creatorId: string): Promise<void> {
  if (!emailEnabled()) return;
  const ctx = await loadRecruitContext(programId, creatorId);
  if (!ctx?.email) return;
  const rateStr = money(ctx.rate);
  const href = `${appBaseUrl()}/creator/notifications`;
  await sendEmail({
    to: ctx.email,
    subject: `${ctx.brand} wants you for ${ctx.program}`,
    html: shell(
      `${ctx.brand} wants you for ${ctx.program}`,
      `<p style="margin:0 0 12px;">Hi ${ctx.creator_name},</p>
       <p style="margin:0;">You've been invited to collaborate${rateStr ? ` at <strong>${rateStr}</strong>` : ''}. Review the brief and confirm to get started.</p>`,
      'Review invite',
      href,
    ),
  });
}

/** A brand just marked this creator's deal as paid. */
export async function notifyPayment(programId: string, creatorId: string): Promise<void> {
  if (!emailEnabled()) return;
  const ctx = await loadRecruitContext(programId, creatorId);
  if (!ctx?.email) return;
  const rateStr = money(ctx.rate);
  const href = `${appBaseUrl()}/creator/statement`;
  await sendEmail({
    to: ctx.email,
    subject: `${rateStr || 'Payment'} received from ${ctx.brand}`,
    html: shell(
      `${rateStr ? `${rateStr} received` : 'Payment received'} 🎉`,
      `<p style="margin:0 0 12px;">Hi ${ctx.creator_name},</p>
       <p style="margin:0;">${ctx.brand} has marked your payment for <strong>${ctx.program}</strong> as paid${rateStr ? ` — <strong>${rateStr}</strong>` : ''}. It'll show up in your earnings statement.</p>`,
      'View statement',
      href,
    ),
  });
}
