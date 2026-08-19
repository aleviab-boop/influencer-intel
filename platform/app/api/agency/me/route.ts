import { NextResponse } from 'next/server';
import { getAgencySession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/agency/me → { account: { id, email, name } | null }
export async function GET(): Promise<NextResponse> {
  const s = await getAgencySession();
  return NextResponse.json({
    account: s ? { id: s.account_id, email: s.email, name: s.name } : null,
  });
}
