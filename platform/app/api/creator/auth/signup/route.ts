import { NextResponse, type NextRequest } from 'next/server';
import { createCreatorAccount } from '@/lib/creator-auth';
import { setCreatorSession } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * POST /api/creator/auth/signup
 *   Body: { email, password, handle }
 *   Claims (or creates) the creator profile for `handle`, attaches credentials,
 *   and sets the ii_creator session cookie. No Meta App Review required.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as
    | { email?: string; password?: string; handle?: string }
    | null;
  const email = body?.email ?? '';
  const password = body?.password ?? '';
  const handle = body?.handle ?? '';

  try {
    const session = await createCreatorAccount(email, password, handle);
    await setCreatorSession(session);
    return NextResponse.json({ ok: true, handle: session.handle });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
