import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { signInAgency } from '@/lib/agency-auth';
import { setAgencySession } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import type { BrandDnaProfile } from '@influencer-intel/shared/llm';

export const runtime = 'nodejs';

// POST /api/brand/auth/login  { email, password }
//   → { account, brands: [{ brand, category, dna }] } + sets cookie
//
// Credentialed brand sign-in. Same agency_accounts backend as the agency login
// (a brand account is just account_type='brand'), so we reuse signInAgency. We
// also return the account's owned brands with full DNA so the client can drop a
// single-brand account straight into its workspace, or show the picker when an
// account owns several (an agency that logs in here still works).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  try {
    const account = await signInAgency(email, password);
    await setAgencySession(account);
    // Record the sign-in for the admin Metrics logins/DAU feed. Keyed by
    // account_id (as brand_id) so each account counts as one distinct user;
    // role tags the surface without tripping the feed's `role='admin'` filter.
    void logActivity({ kind: 'login', brand_id: account.account_id, email: account.email, meta: { method: 'password', name: account.name, role: 'brand' } });

    let brands: { brand: string; category: string | null; dna: BrandDnaProfile }[] = [];
    try {
      const rows = await getBolticClient().query<{
        brand_name: string;
        category: string | null;
        profile: BrandDnaProfile;
      }>(
        `SELECT brand_name, profile->>'category' AS category, profile
           FROM (
             SELECT DISTINCT ON (lower(brand_name)) brand_name, profile, created_at
               FROM brand_dna
              WHERE account_id = $1
              ORDER BY lower(brand_name), created_at DESC
           ) t
          ORDER BY created_at DESC
          LIMIT 48`,
        [account.account_id],
      );
      brands = rows.map((b) => ({ brand: b.brand_name, category: b.category, dna: b.profile }));
    } catch {
      /* no brands yet — the client sends them to set one up */
    }

    return NextResponse.json({ account, brands });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not sign in.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
