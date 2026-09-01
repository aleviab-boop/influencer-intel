import { NextRequest, NextResponse } from 'next/server';
import { signInAgency } from '@/lib/agency-auth';
import { setAgencySession } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';

// POST /api/agency/login  { email, password } → { account } + sets cookie
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  try {
    const account = await signInAgency(email, password);
    await setAgencySession(account);
    void logActivity({ kind: 'login', brand_id: account.account_id, email: account.email, meta: { method: 'password', name: account.name, role: 'agency' } });
    return NextResponse.json({ account });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not sign in.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
