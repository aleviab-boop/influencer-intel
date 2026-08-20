import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getAgencySession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/agency/me → { account: { id, email, name, account_type } | null }
//
// account_type ('agency' | 'brand', mig 043) lets the workspace label itself
// correctly — a single-brand account reads as a "Brand workspace", an agency as
// an "Agency workspace" with the roster switcher. It's not in the signed cookie
// (kept minimal), so we read it from the row; default 'agency' on any hiccup.
export async function GET(): Promise<NextResponse> {
  const s = await getAgencySession();
  if (!s) return NextResponse.json({ account: null });

  let accountType = 'agency';
  try {
    const rows = await getBolticClient().query<{ account_type: string }>(
      `SELECT account_type FROM agency_accounts WHERE id = $1 LIMIT 1`,
      [s.account_id],
    );
    accountType = rows[0]?.account_type ?? 'agency';
  } catch {
    /* column/row missing → treat as agency */
  }

  return NextResponse.json({
    account: { id: s.account_id, email: s.email, name: s.name, account_type: accountType },
  });
}
