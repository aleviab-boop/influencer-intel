import { NextResponse, type NextRequest } from 'next/server';
import { signInCreatorWithPassword } from '@/lib/creator-auth';
import { setCreatorSession } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * POST /api/creator/auth/login
 *   Body: { email, password }
 *   Verifies credentials against the claimed creator row and sets the
 *   ii_creator session cookie.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as
    | { email?: string; password?: string }
    | null;
  const email = body?.email ?? '';
  const password = body?.password ?? '';

  try {
    const session = await signInCreatorWithPassword(email, password);
    await setCreatorSession(session);
    return NextResponse.json({ ok: true, handle: session.handle });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 401 });
  }
}
