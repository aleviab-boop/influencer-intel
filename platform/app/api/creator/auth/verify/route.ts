import { NextResponse } from 'next/server';
import { verifyCreatorOwnership } from '@/lib/creator-auth';
import { getCreatorSession } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * POST /api/creator/auth/verify
 *   Confirms the signed-in creator owns their handle by checking that their
 *   claim_code appears in their scraped Instagram bio. Flips claim_verified when
 *   found; otherwise queues a refresh and asks them to retry shortly.
 */
export async function POST(): Promise<NextResponse> {
  const session = await getCreatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }
  try {
    const result = await verifyCreatorOwnership(session.creator_id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
