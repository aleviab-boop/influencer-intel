import { NextRequest, NextResponse } from 'next/server';
import { createAgencyAccount } from '@/lib/agency-auth';
import { setAgencySession } from '@/lib/auth';

export const runtime = 'nodejs';

// POST /api/brand/auth/signup  { email, password, brand? } → { account } + cookie
//
// Dedicated brand login: a single brand signs up for ITSELF. Under the hood it's
// an agency_accounts row tagged account_type='brand' (migration 043), so every
// account_id-scoped surface (brand DNA, pipeline, outreach) works unchanged — the
// brand simply owns exactly one brand: its own. After this sets the session
// cookie, the client runs the existing /api/brand/dna analysis (which stamps the
// new account_id) so the brand lands in a fully-personalised workspace.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  // A brand account is named after the brand itself (falls back to email local part).
  const name = typeof body?.brand === 'string' && body.brand.trim() ? body.brand.trim() : undefined;
  try {
    const account = await createAgencyAccount(email, password, name, 'brand');
    await setAgencySession(account);
    return NextResponse.json({ account });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create the account.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
