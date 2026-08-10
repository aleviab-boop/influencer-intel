import { NextResponse } from 'next/server';
import { getCreatorSession, signOutCreator } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * GET /api/creator/session — who is the signed-in creator (from the ii_creator
 * cookie)? Returns { authenticated, creator_id, handle } so the client can tell
 * a real logged-in creator from a query-param preview. Always 200.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 200 });
  return NextResponse.json({
    authenticated: true,
    creator_id: session.creator_id,
    handle: session.handle,
  });
}

/** DELETE /api/creator/session — log the creator out (clears the cookie). */
export async function DELETE(): Promise<NextResponse> {
  await signOutCreator();
  return NextResponse.json({ ok: true });
}
