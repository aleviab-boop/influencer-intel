// ============================================================
// Creator identity resolution for /api/creator/* routes.
//
// Single source of truth for "which creator is this request for", in priority
// order:
//   1. The signed ii_creator session cookie (authoritative — set when the
//      creator connects Instagram). A logged-in creator can ONLY ever see their
//      own data; any ?handle in the URL is ignored.
//   2. ?account=<connected_account_id>  — legacy/preview.
//   3. ?handle=<ig_handle>              — legacy/preview.
//   4. Most-recent active connected account — demo fallback.
//
// Fallbacks 2–4 preserve the pre-auth preview behaviour so shared demo links
// keep working; once a real session exists it always wins.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { getCreatorSession } from './auth';

export interface ResolvedCreator {
  creator_id: string;
  handle: string | null;
  via: 'session' | 'account' | 'handle' | 'fallback';
}

export async function resolveCreator(request: Request): Promise<ResolvedCreator | null> {
  // 1. Authoritative: the signed session cookie.
  const session = await getCreatorSession();
  if (session?.creator_id) {
    return { creator_id: session.creator_id, handle: session.handle ?? null, via: 'session' };
  }

  // 2–4. Preview fallbacks (unchanged behaviour).
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account');
  const handle = url.searchParams.get('handle')?.replace(/^@/, '') ?? null;
  const db = getBolticClient();

  if (accountId) {
    const rows = await db.query<{ creator_id: string }>(
      `SELECT creator_id FROM connected_accounts WHERE id = $1 LIMIT 1`,
      [accountId],
    );
    if (rows[0]?.creator_id) return { creator_id: rows[0].creator_id, handle, via: 'account' };
  }

  if (handle) {
    const rows = await db.query<{ id: string; handle: string }>(
      `SELECT id, handle FROM creators WHERE LOWER(handle) = LOWER($1) ORDER BY updated_at DESC LIMIT 1`,
      [handle],
    );
    if (rows[0]?.id) return { creator_id: rows[0].id, handle: rows[0].handle, via: 'handle' };
  }

  const rows = await db.query<{ creator_id: string }>(
    `SELECT creator_id FROM connected_accounts WHERE connection_status = 'active'
     ORDER BY connected_at DESC LIMIT 1`,
  );
  if (rows[0]?.creator_id) return { creator_id: rows[0].creator_id, handle, via: 'fallback' };

  return null;
}

/** Convenience: just the creator_id (or null). */
export async function resolveCreatorId(request: Request): Promise<string | null> {
  return (await resolveCreator(request))?.creator_id ?? null;
}

/**
 * Ownership gate for resource-id-keyed routes (a single deal, invoice, or
 * submission thread addressed by recruit id rather than by creator).
 *
 * Returns true when the request may act on a row owned by `ownerCreatorId`:
 *   - no creator session  → preview mode, behaviour unchanged (true);
 *   - creator session     → only their own rows (session.creator_id === owner).
 *
 * This never tightens the pre-auth preview flow — it only stops a *logged-in*
 * creator from reaching another creator's row by guessing/enumerating ids.
 */
export async function creatorMayAccess(ownerCreatorId: string | null | undefined): Promise<boolean> {
  const session = await getCreatorSession();
  if (!session?.creator_id) return true;
  return session.creator_id === ownerCreatorId;
}
