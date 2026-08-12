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

import crypto from 'node:crypto';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { Creator } from '@influencer-intel/shared/types';
import { hashPassword, verifyPassword, type CreatorSession } from '@/lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a route handler needs to mint the creator cookie. */
export type CreatorSessionInput = Omit<CreatorSession, 'iat'>;

/** Result of a signup: the session to set + the bio code for optional verification. */
export interface CreatorSignupResult {
  session: CreatorSessionInput;
  claim_code: string;
}

type CreatorRow = Creator & {
  email?: string | null;
  password_hash?: string | null;
  ig_user_id?: string | null;
  claim_code?: string | null;
  claim_verified?: boolean | null;
  bio?: string | null;
};

/** A short, human-typeable token the creator adds to their IG bio to prove ownership. */
function newClaimCode(): string {
  return 'ii-' + crypto.randomBytes(4).toString('hex');
}

const cleanHandle = (h: string) => h.trim().toLowerCase().replace(/^@/, '');

/**
 * Queue a background profile scrape for a handle so a freshly-claimed creator
 * gets enriched (name, followers, recent posts, engagement). Deduped against any
 * already-queued/in-progress job so repeated claims don't pile up. Mirrors the
 * enqueue used by /api/creators/[handle].
 */
async function enqueueProfileScrape(
  db: ReturnType<typeof getBolticClient>,
  handle: string,
): Promise<void> {
  const dup = await db.query<{ id: string }>(
    `SELECT id FROM scrape_jobs
     WHERE target_handle = $1 AND status IN ('queued','in_progress')
     LIMIT 1`,
    [handle],
  );
  if (dup.length > 0) return;
  await db.insert('scrape_jobs', {
    job_type: 'on_demand',
    target_platform: 'instagram',
    target_handle: handle,
    priority: 1,
    status: 'queued',
    attempts: 0,
    queued_at: new Date().toISOString(),
  });
}

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
): Promise<CreatorSignupResult> {
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
  const claim_code = newClaimCode();

  if (existing.length > 0) {
    const row = existing[0]!;
    if (row.password_hash) {
      throw new Error('This profile has already been claimed — please log in.');
    }
    await db.query(
      `UPDATE creators SET email = $1, password_hash = $2, claim_code = $3,
                           claim_verified = false, updated_at = NOW()
       WHERE id = $4`,
      [cleanEmail, password_hash, claim_code, row.id],
    );
    // Refresh their scraped stats on claim so the portal shows current numbers.
    await enqueueProfileScrape(db, h).catch(() => {});
    return { session: sessionFor(row), claim_code };
  }

  // Unknown handle — insert a minimal claimed row. profile_url is NOT NULL.
  // NOTE: no last_scraped_at — the row has never actually been scraped, so
  // stamping it would suppress the enrichment crawler. We queue a scrape instead.
  const inserted = await db.insert<CreatorRow>('creators', {
    handle: h,
    platform: 'instagram',
    profile_url: `https://www.instagram.com/${h}/`,
    is_active: true,
    source: 'manual',
    email: cleanEmail,
    password_hash,
    claim_code,
    claim_verified: false,
  });
  await enqueueProfileScrape(db, h).catch(() => {});
  return { session: sessionFor(inserted), claim_code };
}

/**
 * Check whether a claimed creator has proven ownership by putting their
 * claim_code in their Instagram bio. Reads the latest scraped bio; if it
 * contains the code, flips claim_verified = true. Otherwise queues a fresh
 * scrape so the next check sees an up-to-date bio. Non-blocking, idempotent.
 */
export async function verifyCreatorOwnership(
  creatorId: string,
): Promise<{ verified: boolean; checking: boolean }> {
  const db = getBolticClient();
  const rows = await db.query<CreatorRow>(
    `SELECT id, handle, bio, claim_code, claim_verified FROM creators WHERE id = $1 LIMIT 1`,
    [creatorId],
  );
  const row = rows[0];
  if (!row) throw new Error('Account not found');
  if (row.claim_verified) return { verified: true, checking: false };
  if (!row.claim_code) return { verified: false, checking: false };

  const bio = (row.bio ?? '').toLowerCase();
  if (bio.includes(row.claim_code.toLowerCase())) {
    await db.query(
      `UPDATE creators SET claim_verified = true, updated_at = NOW() WHERE id = $1`,
      [creatorId],
    );
    return { verified: true, checking: false };
  }

  // Not found (or bio not scraped yet) — queue a refresh and ask them to retry.
  await enqueueProfileScrape(db, row.handle).catch(() => {});
  return { verified: false, checking: true };
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
