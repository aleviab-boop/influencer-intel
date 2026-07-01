import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE, adminPassword, adminToken, isValidAdminToken } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// POST /api/admin/auth  { password }            → sign in (sets the admin cookie)
// POST /api/admin/auth  { action: 'sign_out' }  → sign out
// GET  /api/admin/auth                          → { authenticated }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { password?: string; action?: string } | null;
  const c = await cookies();

  if (body?.action === 'sign_out') {
    c.delete(ADMIN_COOKIE);
    return NextResponse.json({ ok: true });
  }

  if (!body?.password || body.password !== adminPassword()) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  c.set(ADMIN_COOKIE, await adminToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const c = await cookies();
  const authed = await isValidAdminToken(c.get(ADMIN_COOKIE)?.value);
  return NextResponse.json({ authenticated: authed });
}
