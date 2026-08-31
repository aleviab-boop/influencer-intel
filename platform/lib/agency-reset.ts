// ============================================================
// Self-serve password reset for agency / brand accounts.
//
// Stateless, single-use reset tokens — no schema change, no stored tokens.
// A token is an HMAC over { account id, expiry } keyed by SESSION_SECRET *plus
// the account's CURRENT password_hash*. Binding to the hash makes it single-use:
// the instant the password changes (a successful reset, or any other update)
// the hash changes, so every previously-issued token stops verifying. Expiry
// bounds the window independently.
// ============================================================

import crypto from 'node:crypto';
import { getBolticClient } from '@influencer-intel/shared/db';
import { hashPassword } from '@/lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_TTL_SEC = 60 * 60; // 1 hour

function secret(): string {
  return process.env.SESSION_SECRET ?? 'change-me-in-prod-influencer-intel-dev';
}

// Key deliberately folds in the current password hash so a token dies the moment
// the password rotates (single-use), on top of the explicit expiry in the body.
function tokenKey(passwordHash: string | null): string {
  return `${secret()}$reset$${passwordHash ?? ''}`;
}

function signReset(accountId: string, exp: number, passwordHash: string | null): string {
  const body = Buffer.from(JSON.stringify({ aid: accountId, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', tokenKey(passwordHash)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

interface ResetRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
}

/**
 * Begin a reset for `email`. Returns the token + account details when a
 * resettable account exists, else null. Callers MUST treat null and success
 * identically to the end user (anti-enumeration) — only the presence of an
 * email delivery differs.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ token: string; account_id: string; email: string; name: string | null } | null> {
  const clean = email.trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) return null;
  const rows = await getBolticClient().query<ResetRow>(
    `SELECT id, email, name, password_hash FROM agency_accounts WHERE lower(email) = lower($1) LIMIT 1`,
    [clean],
  );
  const row = rows[0];
  // Only accounts that already have a password can be "reset". (Every account
  // created via signup has one; this just guards odd/legacy rows.)
  if (!row || !row.password_hash) return null;
  const exp = Math.floor(Date.now() / 1000) + DEFAULT_TTL_SEC;
  return {
    token: signReset(row.id, exp, row.password_hash),
    account_id: row.id,
    email: row.email,
    name: row.name,
  };
}

/**
 * Verify a reset token against the account's live password hash + expiry.
 * Returns the account id when valid, else null. Constant-time on the signature.
 */
export async function verifyResetToken(token: string): Promise<{ account_id: string } | null> {
  const [body, sig] = (token ?? '').split('.');
  if (!body || !sig) return null;
  let parsed: { aid?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const aid = typeof parsed.aid === 'string' ? parsed.aid : null;
  const exp = typeof parsed.exp === 'number' ? parsed.exp : 0;
  if (!aid || exp < Math.floor(Date.now() / 1000)) return null;

  const rows = await getBolticClient().query<{ password_hash: string | null }>(
    `SELECT password_hash FROM agency_accounts WHERE id = $1 LIMIT 1`,
    [aid],
  );
  const row = rows[0];
  if (!row || !row.password_hash) return null;

  const expected = crypto.createHmac('sha256', tokenKey(row.password_hash)).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { account_id: aid };
}

/**
 * Complete a reset: verify the token, then set the new password. Throws on a
 * too-weak password (surfaced to the user); returns false when the token is
 * invalid/expired/already-used (the token binds to the old hash, so re-using one
 * after a successful reset fails here).
 */
export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters');
  const ok = await verifyResetToken(token);
  if (!ok) return false;
  await getBolticClient().query(
    `UPDATE agency_accounts SET password_hash = $1 WHERE id = $2`,
    [hashPassword(newPassword), ok.account_id],
  );
  return true;
}
