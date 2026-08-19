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
import { creatorWantsEmail } from './creator-email-prefs';

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
function shell(
  heading: string,
  bodyHtml: string,
  ctaLabel: string,
  ctaHref: string,
  footerNote = "You're receiving this because you have a creator account on Influencer Intel.",
): string {
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
    <div style="color:#9ca3af;font-size:12px;padding:16px 0;">${footerNote}</div>
  </td></tr></table>
</body></html>`;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

// Denormalised send context, recorded in email_log to power the agency-side
// "Email Activity" page. Every field but `kind` is best-effort.
export interface EmailLogMeta {
  kind: string; // invite | invite_accepted | invite_declined | payment | review_changes | review_approved | deadline | digest | message
  creator_id?: string | null;
  program_id?: string | null;
  brand_id?: string | null;
}

// Best-effort audit row — never throws, never blocks the send it records.
async function logEmail(
  meta: EmailLogMeta,
  recipient: string,
  subject: string,
  status: 'sent' | 'failed',
  error?: string | null,
): Promise<void> {
  try {
    await getBolticClient().query(
      `INSERT INTO email_log (creator_id, program_id, brand_id, kind, recipient, subject, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        meta.creator_id ?? null, meta.program_id ?? null, meta.brand_id ?? null,
        meta.kind, recipient, subject.slice(0, 300), status, error ? error.slice(0, 500) : null,
      ],
    );
  } catch (err) {
    console.error('[email] log write failed:', (err as Error).message);
  }
}

/** Low-level send. Returns true on accept, false on any no-op/failure. Never throws. */
export async function sendEmail({ to, subject, html }: SendArgs, meta?: EmailLogMeta): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;                 // unconfigured → silent no-op (nothing attempted)
  if (!to || !EMAIL_RE.test(to)) return false;
  // Respect the recipient's opt-out for this category (invite/payment/review/
  // deadline). Unknown creator or unmapped kind always sends. This one gate
  // covers every notify path, since they all flow through here with meta.
  if (meta && !(await creatorWantsEmail(meta.creator_id, meta.kind))) return false;
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress(), to, subject, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[email] send failed:', res.status, detail);
      if (meta) await logEmail(meta, to, subject, 'failed', `HTTP ${res.status} ${detail}`);
      return false;
    }
    if (meta) await logEmail(meta, to, subject, 'sent');
    return true;
  } catch (err) {
    console.error('[email] send error:', (err as Error).message);
    if (meta) await logEmail(meta, to, subject, 'failed', (err as Error).message);
    return false;
  }
}

// One row of the agency-side "Email Activity" feed. Joins the denormalised
// email_log back to live creator/program rows for display (both may be null if
// the underlying row was deleted — the log survives regardless).
export interface EmailLogRow {
  id: string;
  kind: string;
  recipient: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: string;
  creator_handle: string | null;
  creator_name: string | null;
  program_name: string | null;
}

// Brand-scoped email history. Mirrors listPrograms' scoping: a signed-in brand
// sees its own sends PLUS unassigned/legacy ones (brand_id IS NULL) so the
// shared demo data stays visible; called with no id it returns everything.
export async function listEmailLog(brandId?: string | null, limit = 200): Promise<EmailLogRow[]> {
  const db = getBolticClient();
  const where = brandId ? `WHERE (e.brand_id = $1 OR e.brand_id IS NULL)` : '';
  return db.query<EmailLogRow>(
    `SELECT e.id, e.kind, e.recipient, e.subject, e.status, e.error,
            e.created_at::text AS created_at,
            c.handle       AS creator_handle,
            COALESCE(NULLIF(c.display_name, ''), c.handle) AS creator_name,
            p.name         AS program_name
     FROM email_log e
     LEFT JOIN creators c ON c.id = e.creator_id
     LEFT JOIN programs p ON p.id = e.program_id
     ${where}
     ORDER BY e.created_at DESC
     LIMIT ${Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 200}`,
    brandId ? [brandId] : undefined,
  );
}

interface RecruitContext {
  recruit_id: string;
  email: string | null;
  creator_name: string;
  brand: string;
  program: string;
  rate: number;
  brand_id: string | null;
  brand_email: string | null;
}

// One query to gather everything an invite/payment/review email needs. Prefers
// the claimed-account email, falls back to the OAuth-verified one.
async function loadRecruitContext(programId: string, creatorId: string): Promise<RecruitContext | null> {
  const db = getBolticClient();
  const rows = await db.query<{
    recruit_id: string;
    email: string | null; creator_name: string | null;
    brand: string | null; program: string | null; rate: string | number | null;
    brand_id: string | null; brand_email: string | null;
  }>(
    `SELECT pr.id AS recruit_id,
            COALESCE(NULLIF(c.email, ''), c.verified_oauth_data->>'email') AS email,
            COALESCE(NULLIF(c.display_name, ''), c.handle)                 AS creator_name,
            b.name  AS brand,
            p.name  AS program,
            pr.rate AS rate,
            p.brand_id AS brand_id,
            b.email AS brand_email
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
    recruit_id: r.recruit_id,
    email: r.email,
    creator_name: r.creator_name ?? 'there',
    brand: r.brand ?? 'A brand',
    program: r.program ?? 'a campaign',
    rate: Number.isFinite(rate) ? rate : 0,
    brand_id: r.brand_id ?? null,
    brand_email: r.brand_email ?? null,
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
  }, { kind: 'invite', creator_id: creatorId, program_id: programId, brand_id: ctx.brand_id });
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
  }, { kind: 'payment', creator_id: creatorId, program_id: programId, brand_id: ctx.brand_id });
}

const BRAND_FOOTER = "You're receiving this because you manage campaigns on Influencer Intel.";

/**
 * A creator responded to a campaign invite — tell the BRAND (recipient is the
 * brand's contact email, not the creator). No-ops silently if the brand has no
 * email on file (older accounts backfill theirs on next sign-in).
 */
export async function notifyInviteResponse(
  programId: string,
  creatorId: string,
  response: 'accepted' | 'declined',
): Promise<void> {
  if (!emailEnabled()) return;
  const ctx = await loadRecruitContext(programId, creatorId);
  if (!ctx?.brand_email) return;
  const rateStr = money(ctx.rate);
  const href = `${appBaseUrl()}/campaign-management`;
  const accepted = response === 'accepted';
  const kind = accepted ? 'invite_accepted' : 'invite_declined';
  await sendEmail({
    to: ctx.brand_email,
    subject: accepted
      ? `${ctx.creator_name} accepted ${ctx.program}`
      : `${ctx.creator_name} declined ${ctx.program}`,
    html: shell(
      accepted ? `${ctx.creator_name} is in ✅` : `${ctx.creator_name} passed on ${ctx.program}`,
      accepted
        ? `<p style="margin:0 0 12px;">Good news —</p>
           <p style="margin:0;"><strong>${ctx.creator_name}</strong> accepted your invite to <strong>${ctx.program}</strong>${rateStr ? ` at <strong>${rateStr}</strong>` : ''}. Line up the brief and deliverables to get them started.</p>`
        : `<p style="margin:0 0 12px;">Heads up —</p>
           <p style="margin:0;"><strong>${ctx.creator_name}</strong> declined your invite to <strong>${ctx.program}</strong>. No action needed — you may want to recruit another creator to fill the slot.</p>`,
      'Open campaign',
      href,
      BRAND_FOOTER,
    ),
  }, { kind, creator_id: creatorId, program_id: programId, brand_id: ctx.brand_id });
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A brand recorded a verdict on a submitted link: 'changes' (revise) or 'approved'. */
export async function notifyReview(
  programId: string,
  creatorId: string,
  state: 'changes' | 'approved',
  comment?: string | null,
): Promise<void> {
  if (!emailEnabled()) return;
  const ctx = await loadRecruitContext(programId, creatorId);
  if (!ctx?.email) return;
  const rateStr = money(ctx.rate);
  const href = `${appBaseUrl()}/creator/deals/${ctx.recruit_id}/submit`;

  if (state === 'changes') {
    const note = comment ? `<p style="margin:0 0 12px;padding:12px 14px;background:#faf5ff;border-radius:9px;color:#4c1d95;">“${escapeHtml(comment)}”</p>` : '';
    await sendEmail({
      to: ctx.email,
      subject: `${ctx.brand} requested changes on ${ctx.program}`,
      html: shell(
        `Changes requested on ${ctx.program}`,
        `<p style="margin:0 0 12px;">Hi ${ctx.creator_name},</p>
         ${note}<p style="margin:0;">${ctx.brand} sent your submission back for changes. Revise your link and re-submit to keep the deal moving.</p>`,
        'Revise & re-submit',
        href,
      ),
    }, { kind: 'review_changes', creator_id: creatorId, program_id: programId, brand_id: ctx.brand_id });
  } else {
    await sendEmail({
      to: ctx.email,
      subject: `${ctx.brand} approved your work on ${ctx.program}`,
      html: shell(
        `Your work was approved ✅`,
        `<p style="margin:0 0 12px;">Hi ${ctx.creator_name},</p>
         <p style="margin:0;">${ctx.brand} approved your submission for <strong>${ctx.program}</strong>${rateStr ? ` — <strong>${rateStr}</strong> due` : ''}. Nice work.</p>`,
        'View deal',
        href,
      ),
    }, { kind: 'review_approved', creator_id: creatorId, program_id: programId, brand_id: ctx.brand_id });
  }
}

// Deadline reminder — driven by the daily cron, which loads the rows once and
// passes each creator's context in (no per-row re-query). Fires the day before
// a deliverable is due, so it lands exactly once per deal.
export interface DeadlineReminder {
  email: string | null;
  creator_name: string;
  brand: string;
  program: string;
  recruit_id: string;
  due_label: string; // e.g. "tomorrow, 18 Aug"
  rate: number;
  creator_id?: string | null;
  program_id?: string | null;
  brand_id?: string | null;
}

export async function sendDeadlineReminder(r: DeadlineReminder): Promise<boolean> {
  if (!emailEnabled() || !r.email) return false;
  const rateStr = money(r.rate);
  const href = `${appBaseUrl()}/creator/deals/${r.recruit_id}`;
  return sendEmail({
    to: r.email,
    subject: `Due ${r.due_label}: ${r.program}`,
    html: shell(
      `${r.program} is due ${r.due_label}`,
      `<p style="margin:0 0 12px;">Hi ${r.creator_name},</p>
       <p style="margin:0;">Your deliverable for <strong>${r.brand}</strong> is due <strong>${r.due_label}</strong>${rateStr ? ` — ${rateStr}` : ''}. Get it over the line to stay on track.</p>`,
      'Open deal',
      href,
    ),
  }, { kind: 'deadline', creator_id: r.creator_id ?? null, program_id: r.program_id ?? null, brand_id: r.brand_id ?? null });
}

// Weekly brand digest — driven by the weekly cron, which builds each brand's
// notification feed (via buildBrandNotifications) and passes the top items in.
// A roll-up of what needs the brand across every campaign, so they don't have
// to open the app to know. Recipient is the brand's contact email; uses the
// BRAND_FOOTER. Only meaningful items are passed in, so an empty week sends
// nothing (the cron decides that, not this function).
export interface BrandDigestItem {
  title: string;
  body: string;
  when_label: string;
  severity: 'action' | 'info';
}
export interface BrandDigest {
  to: string;
  brand_id: string | null;
  brand_name: string;
  action_count: number;
  total: number;
  items: BrandDigestItem[]; // already trimmed + ordered by the caller
}

export async function sendBrandDigest(d: BrandDigest): Promise<boolean> {
  if (!emailEnabled() || !d.to) return false;
  const href = `${appBaseUrl()}/notifications`;

  const rows = d.items.map((it) => {
    const dot = it.severity === 'action' ? '#dc2626' : '#9ca3af';
    return `<tr><td style="padding:11px 0;border-bottom:1px solid #f0f0f3;">
        <div style="font-size:14px;font-weight:600;color:#111827;line-height:1.35;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dot};margin-right:8px;vertical-align:middle;"></span>${escapeHtml(it.title)}${it.when_label ? `<span style="font-weight:400;color:#9ca3af;font-size:12px;"> &middot; ${escapeHtml(it.when_label)}</span>` : ''}
        </div>
        <div style="font-size:13px;color:#4b5563;margin-top:3px;padding-left:15px;line-height:1.45;">${escapeHtml(it.body)}</div>
      </td></tr>`;
  }).join('');

  const hasAction = d.action_count > 0;
  const heading = hasAction
    ? `${d.action_count} thing${d.action_count === 1 ? '' : 's'} need${d.action_count === 1 ? 's' : ''} you`
    : 'Your weekly campaign digest';
  const intro = hasAction
    ? `<strong>${d.action_count} thing${d.action_count === 1 ? '' : 's'}</strong> need${d.action_count === 1 ? 's' : ''} your attention across your campaigns this week.`
    : `Here\u2019s what moved across your campaigns this week.`;
  const more = d.total > d.items.length ? `<p style="margin:14px 0 0;font-size:13px;color:#9ca3af;">+ ${d.total - d.items.length} more in the app.</p>` : '';

  const body = `<p style="margin:0 0 14px;">Hi ${escapeHtml(d.brand_name)},</p>
    <p style="margin:0 0 6px;">${intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${rows}</table>${more}`;

  return sendEmail({
    to: d.to,
    subject: hasAction
      ? `${d.action_count} thing${d.action_count === 1 ? '' : 's'} need you on Influencer Intel`
      : 'Your weekly campaign digest',
    html: shell(heading, body, 'Open notifications', href, BRAND_FOOTER),
  }, { kind: 'digest', brand_id: d.brand_id });
}

// ---- weekly brand pulse (niche discovery digest) -------------------------
// A retention-driving roll-up for a signed-in AGENCY account: for each brand in
// their roster, the freshest trends in that brand's niche + new creators worth
// reaching. Distinct from sendBrandDigest (which is a campaign-OPERATIONS feed
// for the legacy brands table) — this is a "here's what's new for your brands,
// come back in" discovery email built from Brand DNA + trend_signals + the
// creator DB. Recipient is the agency account email; grouped one mail per account.

export interface PulseTrend {
  display_name: string;
  phase: string;
  growth_label: string; // e.g. "+42% wk-on-wk"
}
export interface PulseCreator {
  handle: string;
  name: string;
  followers: number;
  engagement: number | null; // ER %, null if unknown
}
// The agency's OWN funnel for this brand — a personal, actionable nudge
// (e.g. "3 awaiting reply") that complements the discovery content below.
export interface PulsePipeline {
  saved: number;       // not yet contacted
  contacted: number;   // reached out, awaiting reply
  replied: number;     // they replied — act now
  negotiating: number;
  won: number;
  pending: number;     // saved+contacted+replied+negotiating — the "worth-emailing" signal
}
export interface PulseBrandSection {
  brand_name: string;
  category: string;
  trends: PulseTrend[];
  creators: PulseCreator[];
  pipeline?: PulsePipeline | null;
  top_opportunity?: string | null;
}
export interface BrandPulse {
  to: string;
  account_id: string | null;
  account_name: string;
  brands: PulseBrandSection[]; // already trimmed by the caller; only non-empty ones
}

const fmtFollowers = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n || 0);

// "5 saved · 3 awaiting reply · 1 negotiating" — non-zero stages only.
function pipelineWords(p: PulsePipeline): string {
  const parts: string[] = [];
  if (p.saved) parts.push(`${p.saved} saved`);
  if (p.contacted) parts.push(`${p.contacted} awaiting reply`);
  if (p.replied) parts.push(`${p.replied} replied`);
  if (p.negotiating) parts.push(`${p.negotiating} negotiating`);
  if (p.won) parts.push(`${p.won} won`);
  return parts.join(' &middot; ');
}

function pulseSectionHtml(s: PulseBrandSection): string {
  const pipe = s.pipeline && s.pipeline.pending > 0
    ? `<div style="margin:0 0 12px;padding:10px 12px;background:#f5f3ff;border-radius:9px;font-size:13px;color:#4c1d95;line-height:1.45;"><strong>Your pipeline:</strong> ${pipelineWords(s.pipeline)}</div>`
    : '';

  const trendRows = s.trends.length
    ? `<div style="font-size:12px;font-weight:700;color:#6d28d9;text-transform:uppercase;letter-spacing:0.4px;margin:0 0 6px;">Trending in ${escapeHtml(s.category || 'your niche')}</div>` +
      s.trends.map((t) =>
        `<div style="font-size:14px;color:#111827;margin:0 0 4px;">${escapeHtml(t.display_name)}
          <span style="color:#9ca3af;font-size:12px;"> &middot; ${escapeHtml(t.phase)}${t.growth_label ? ` &middot; ${escapeHtml(t.growth_label)}` : ''}</span>
        </div>`,
      ).join('')
    : '';

  const creatorRows = s.creators.length
    ? `<div style="font-size:12px;font-weight:700;color:#6d28d9;text-transform:uppercase;letter-spacing:0.4px;margin:14px 0 6px;">Fresh creators to reach</div>` +
      s.creators.map((c) =>
        `<div style="font-size:14px;color:#111827;margin:0 0 4px;">@${escapeHtml(c.handle)}
          <span style="color:#9ca3af;font-size:12px;"> &middot; ${fmtFollowers(c.followers)} followers${c.engagement ? ` &middot; ${c.engagement.toFixed(1)}% ER` : ''}</span>
        </div>`,
      ).join('')
    : '';

  const opp = s.top_opportunity
    ? `<div style="margin-top:14px;padding:11px 13px;background:#faf5ff;border-radius:9px;color:#4c1d95;font-size:13px;line-height:1.45;"><strong>Try this:</strong> ${escapeHtml(s.top_opportunity)}</div>`
    : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
    <tr><td style="padding:16px 18px;border:1px solid #ececf1;border-radius:12px;">
      <div style="font-size:16px;font-weight:700;color:#111827;margin:0 0 10px;">${escapeHtml(s.brand_name)}</div>
      ${pipe}${trendRows}${creatorRows}${opp}
    </td></tr></table>`;
}

export async function sendBrandPulse(d: BrandPulse): Promise<boolean> {
  if (!emailEnabled() || !d.to || d.brands.length === 0) return false;
  const href = `${appBaseUrl()}/brand/login`;
  const brandWord = d.brands.length === 1 ? d.brands[0]!.brand_name : `${d.brands.length} brands`;
  const body = `<p style="margin:0 0 14px;">Hi ${escapeHtml(d.account_name || 'there')},</p>
    <p style="margin:0 0 16px;">Here\u2019s this week\u2019s pulse for ${escapeHtml(brandWord)} \u2014 the freshest trends in each niche and new creators worth reaching out to.</p>
    ${d.brands.map(pulseSectionHtml).join('')}`;
  return sendEmail({
    to: d.to,
    subject: d.brands.length === 1 ? `This week for ${d.brands[0]!.brand_name}` : `Your weekly brand pulse — ${d.brands.length} brands`,
    html: shell('Your weekly brand pulse', body, 'Open your workspace', href, BRAND_FOOTER),
  }, { kind: 'digest', brand_id: null });
}

// A short, single-line preview of a message body for the email teaser.
function messagePreview(body: string, max = 140): string {
  const one = body.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}\u2026` : one;
}

interface DealMessageContext {
  recruit_id: string;
  program_id: string;
  creator_id: string;
  brand_id: string | null;
  creator_email: string | null;
  creator_name: string;
  brand: string;
  brand_email: string | null;
  program: string;
}

// Everything a new-message email needs, keyed by the recruit (deal) id — the id
// both message routes already hold. Prefers the claimed-account email, falls
// back to the OAuth-verified one, same as loadRecruitContext.
async function loadDealMessageContext(recruitId: string): Promise<DealMessageContext | null> {
  const rows = await getBolticClient().query<{
    recruit_id: string; program_id: string; creator_id: string; brand_id: string | null;
    creator_email: string | null; creator_name: string | null;
    brand: string | null; brand_email: string | null; program: string | null;
  }>(
    `SELECT pr.id AS recruit_id, pr.program_id, pr.creator_id, p.brand_id,
            COALESCE(NULLIF(c.email, ''), c.verified_oauth_data->>'email') AS creator_email,
            COALESCE(NULLIF(c.display_name, ''), c.handle)                 AS creator_name,
            b.name  AS brand,
            b.email AS brand_email,
            p.name  AS program
     FROM program_recruits pr
     JOIN programs p ON p.id = pr.program_id
     LEFT JOIN brands b ON b.id = p.brand_id
     JOIN creators c ON c.id = pr.creator_id
     WHERE pr.id = $1 LIMIT 1`,
    [recruitId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    recruit_id: r.recruit_id,
    program_id: r.program_id,
    creator_id: r.creator_id,
    brand_id: r.brand_id ?? null,
    creator_email: r.creator_email,
    creator_name: r.creator_name ?? 'there',
    brand: r.brand ?? 'A brand',
    brand_email: r.brand_email ?? null,
    program: r.program ?? 'a campaign',
  };
}

/**
 * A new message landed on a deal thread — email the OTHER party. `sender` is who
 * spoke, so the recipient is the counterpart. Anti-spam: only sends when the
 * just-inserted message is the SOLE unread one from that sender (i.e. the
 * counterpart had caught up) — rapid follow-ups while a thread is still unread
 * don't re-notify. Fire-and-forget from the POST routes.
 */
export async function notifyDealMessage(
  recruitId: string,
  sender: 'brand' | 'creator',
  body: string,
): Promise<void> {
  if (!emailEnabled()) return;
  const db = getBolticClient();

  // Only the first unread message from this sender triggers a mail.
  const guard = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM deal_messages
     WHERE recruit_id = $1 AND sender = $2 AND read_at IS NULL`,
    [recruitId, sender],
  );
  if (Number(guard[0]?.n) !== 1) return;

  const ctx = await loadDealMessageContext(recruitId);
  if (!ctx) return;

  const previewHtml = `<p style="margin:0 0 12px;padding:12px 14px;background:#faf5ff;border-radius:9px;color:#4c1d95;">\u201c${escapeHtml(messagePreview(body))}\u201d</p>`;

  if (sender === 'brand') {
    // Recipient is the creator.
    if (!ctx.creator_email) return;
    const href = `${appBaseUrl()}/creator/deals/${ctx.recruit_id}/messages`;
    await sendEmail({
      to: ctx.creator_email,
      subject: `New message from ${ctx.brand}`,
      html: shell(
        `${ctx.brand} sent you a message`,
        `<p style="margin:0 0 12px;">Hi ${ctx.creator_name},</p>
         ${previewHtml}<p style="margin:0;">About <strong>${escapeHtml(ctx.program)}</strong>. Open the thread to reply.</p>`,
        'Open conversation',
        href,
      ),
    }, { kind: 'message', creator_id: ctx.creator_id, program_id: ctx.program_id, brand_id: ctx.brand_id });
  } else {
    // Recipient is the brand.
    if (!ctx.brand_email) return;
    const href = `${appBaseUrl()}/campaigns/${ctx.program_id}/messages?creator=${ctx.creator_id}`;
    await sendEmail({
      to: ctx.brand_email,
      subject: `New message from ${ctx.creator_name}`,
      html: shell(
        `${ctx.creator_name} sent you a message`,
        `<p style="margin:0 0 12px;">Hi there,</p>
         ${previewHtml}<p style="margin:0;">About <strong>${escapeHtml(ctx.program)}</strong>. Open the thread to reply.</p>`,
        'Open conversation',
        href,
        BRAND_FOOTER,
      ),
    }, { kind: 'message', creator_id: ctx.creator_id, program_id: ctx.program_id, brand_id: ctx.brand_id });
  }
}
