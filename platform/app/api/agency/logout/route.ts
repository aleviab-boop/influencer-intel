import { NextResponse } from 'next/server';
import { signOutAgency } from '@/lib/auth';

export const runtime = 'nodejs';

// POST /api/agency/logout → clears the agency session cookie
export async function POST(): Promise<NextResponse> {
  await signOutAgency();
  return NextResponse.json({ ok: true });
}
