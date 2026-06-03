// ============================================================
// Sign-in / sign-out / current-session API.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSession, signIn, signOut } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: string; brand_name?: string; ig_handle?: string; action?: string } | null;
  if (!body) return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  if (body.action === 'sign_out') {
    await signOut();
    return NextResponse.json({ ok: true });
  }
  if (!body.email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  try {
    const payload = await signIn(body.email, body.brand_name, body.ig_handle);
    return NextResponse.json({
      email: payload.email,
      brand_id: payload.brand_id,
      brand_name: payload.brand_name,
      ig_handle: payload.ig_handle,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    email: s.email,
    brand_id: s.brand_id,
    brand_name: s.brand_name,
    ig_handle: s.ig_handle,
  });
}
