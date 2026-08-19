// ============================================================
// Agency email/password auth — real accounts that OWN a roster of brands.
//
// The brand workspace was purely client-side (localStorage). This backs it with
// a real account: an agency signs up with email + password, and every brand DNA
// it analyses is stamped with its account_id (see migration 040), so "your
// brands" is a server-side truth scoped to the account — not every brand ever
// analysed on the platform.
//
// Credentials live on the agency_accounts row. Hashing + the signed-cookie
// session reuse lib/auth's helpers — one scheme across brand, creator and agency.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { hashPassword, verifyPassword, type AgencySession } from '@/lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a route handler needs to mint the agency cookie. */
export type AgencySessionInput = Omit<AgencySession, 'iat'>;

interface AgencyRow {
  id: string;
  email: string;
  password_hash: string | null;
  name: string | null;
}

const sessionFor = (row: AgencyRow): AgencySessionInput => ({
  account_id: row.id,
  email: row.email,
  name: row.name,
});

/**
 * Create an agency account. Rejects if the email is already registered.
 */
export async function createAgencyAccount(
  email: string,
  password: string,
  name?: string,
): Promise<AgencySessionInput> {
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) throw new Error('Enter a valid email address');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');
  const display = name?.trim().slice(0, 120) || cleanEmail.split('@')[0]!.replace(/[^a-z0-9]/gi, ' ');

  const db = getBolticClient();
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM agency_accounts WHERE lower(email) = lower($1) LIMIT 1`,
    [cleanEmail],
  );
  if (existing.length > 0) throw new Error('An account with this email already exists — please log in.');

  const row = await db.insert<AgencyRow>('agency_accounts', {
    email: cleanEmail,
    password_hash: hashPassword(password),
    name: display,
  });
  return sessionFor(row);
}

/** Sign in an existing agency account with email + password. */
export async function signInAgency(email: string, password: string): Promise<AgencySessionInput> {
  const cleanEmail = email.trim().toLowerCase();
  const db = getBolticClient();
  const rows = await db.query<AgencyRow>(
    `SELECT id, email, password_hash, name FROM agency_accounts WHERE lower(email) = lower($1) LIMIT 1`,
    [cleanEmail],
  );
  const row = rows[0];
  if (!row || !row.password_hash) throw new Error('No account found for this email — create one first.');
  if (!verifyPassword(password, row.password_hash)) throw new Error('Incorrect email or password.');
  return sessionFor(row);
}
