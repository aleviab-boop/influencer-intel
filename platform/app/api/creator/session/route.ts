import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getCreatorSession, signOutCreator } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * GET /api/creator/session — who is the signed-in creator (from the ii_creator
 * cookie)? Returns { authenticated, creator_id, handle, claim_verified } so the
 * client can tell a real logged-in creator from a query-param preview and show
 * an ownership-verified badge. Always 200.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 200 });

  // Ownership badge state lives on the creators row (may be absent for OAuth-only
  // sessions predating claim verification — treat missing as not-applicable).
  let claim_verified: boolean | null = null;
  let claim_code: string | null = null;
  try {
    const db = getBolticClient();
    const rows = await db.query<{ claim_verified: boolean | null; claim_code: string | null }>(
      `SELECT claim_verified, claim_code FROM creators WHERE id = $1 LIMIT 1`,
      [session.creator_id],
    );
    // Only surface a badge for accounts that went through the claim flow (have a code).
    if (rows[0]?.claim_code) {
      claim_verified = Boolean(rows[0].claim_verified);
      // Surface the (own) bio code only while still unverified, so settings can
      // re-show the verification instructions.
      if (!claim_verified) claim_code = rows[0].claim_code;
    }
  } catch {
    /* column may not exist pre-migration; ignore */
  }

  return NextResponse.json({
    authenticated: true,
    creator_id: session.creator_id,
    handle: session.handle,
    claim_verified,
    claim_code,
  });
}

/** DELETE /api/creator/session — log the creator out (clears the cookie). */
export async function DELETE(): Promise<NextResponse> {
  await signOutCreator();
  return NextResponse.json({ ok: true });
}
