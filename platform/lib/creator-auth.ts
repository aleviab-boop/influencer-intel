// ============================================================
// Creator email/password auth — claim a scraped profile, no Meta App Review.
//
// A creator identity was previously only mintable via Instagram OAuth, which is
// gated behind Advanced Access (App Review). This lets any creator sign up with
// email + password and CLAIM the `creators` row we already scraped for their
// handle — or create a fresh minimal row if we haven't seen them yet. Either
// way the caller gets a CreatorSession input to set the `ii_creator` cookie.
//
// Credentials are stored ON the creators row (email + password_hash, added in
// migration 027) so the login identity and the scraped profile are one record.
// Hashing reuses lib/auth's scrypt helpers — one scheme across brand + creator.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import type { Creator } from '@influencer-intel/shared/types';
import { hashPassword, verifyPassword, type CreatorSession } from '@/lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a route handler needs to mint the creator cookie. */
export type CreatorSessionInput = Omit<CreatorSession, 'iat'>;

type CreatorRow = Creator & {
  email?: string | null;
  password_hash?: string | null;
  ig_user_id?: string | null;
};

const cleanHandle = (h: string) => h.trim().toLowerCase().replace(/^@/, '');

function sessionFor(row: CreatorRow): CreatorSessionInput {
  return {
    creator_id: row.id,
    handle: row.handle,
    // Scraped-only creators have no ig_user_id; that's fine — OAuth isn't in play.
    ig_user_id: row.ig_user_id ?? null,
  };
}

/**
 * Create a creator account by claiming a profile.
 *   • If a creator row exists for the handle and is unclaimed → attach email +
 *     password to it (the common case: we already scraped them).
 *   • If it exists and is already claimed → reject (log in instead).
 *   • If no row exists → insert a minimal one (source 'manual') with credentials.
 * Rejects if the email is already used by another creator.
 */
export async function createCreatorAccount(
  email: string,
  password: string,
  handle: string,
): Promise<CreatorSessionInput> {
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) throw new Error('Enter a valid email address');
  if (!password || password.length < 4) throw new Error('Password must be at least 4 characters');
  const h = cleanHandle(handle);
  if (!/^[a-z0-9._]{1,30}$/.test(h)) throw new Error('Enter a valid Instagram handle');

  const db = getBolticClient();

  // Email must be globally unique among claimed accounts.
  const emailOwner = await db.query<{ id: string }>(
    `SELECT id FROM creators WHERE lower(email) = lower($1) LIMIT 1`,
    [cleanEmail],
  );
  if (emailOwner.length > 0) {
    throw new Error('An account with this email already exists — please log in.');
  }

  const existing = await db.query<CreatorRow>(
    `SELECT * FROM creators WHERE platform = 'instagram' AND lower(handle) = lower($1) LIMIT 1`,
    [h],
  );

  const password_hash = hashPassword(password);

  if (existing.length > 0) {
    const row = existing[0]!;
    if (row.password_hash) {
      throw new Error('This profile has already been claimed — please log in.');
    }
    await db.query(
      `UPDATE creators SET email = $1, password_hash = $2, updated_at = NOW() WHERE id = $3`,
      [cleanEmail, password_hash, row.id],
    );
    return sessionFor(row);
  }

  // Unknown handle — insert a minimal claimed row. profile_url is NOT NULL.
  const inserted = await db.insert<CreatorRow>('creators', {
    handle: h,
    platform: 'instagram',
    profile_url: `https://www.instagram.com/${h}/`,
    is_active: true,
    source: 'manual',
    email: cleanEmail,
    password_hash,
    last_scraped_at: new Date().toISOString(),
  });
  return sessionFor(inserted);
}

/** Sign in an existing creator account with email + password. */
export async function signInCreatorWithPassword(
  email: string,
  password: string,
): Promise<CreatorSessionInput> {
  const cleanEmail = email.trim().toLowerCase();
  const db = getBolticClient();
  const rows = await db.query<CreatorRow>(
    `SELECT * FROM creators WHERE lower(email) = lower($1) LIMIT 1`,
    [cleanEmail],
  );
  const row = rows[0];
  if (!row || !row.password_hash) {
    throw new Error('No account found for this email — create one first.');
  }
  if (!verifyPassword(password, row.password_hash)) {
    throw new Error('Incorrect email or password.');
  }
  return sessionFor(row);
}
