import { NextRequest, NextResponse } from 'next/server';
import { createAgencyAccount } from '@/lib/agency-auth';
import { setAgencySession } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';

// POST /api/agency/signup  { email, password, name? } → { account } + sets cookie
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const name = typeof body?.name === 'string' ? body.name : undefined;
  try {
    const account = await createAgencyAccount(email, password, name);
    await setAgencySession(account);
    void logActivity({ kind: 'signup', brand_id: account.account_id, email: account.email, meta: { method: 'password', name: account.name, role: 'agency' } });
    return NextResponse.json({ account });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create the account.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
