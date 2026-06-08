import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// POST /api/demo-leads { name, email, company, team_size?, goal? } → stores a lead
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const company = typeof body?.company === 'string' ? body.company.trim() : '';
  if (!name || !/.+@.+\..+/.test(email) || !company) {
    return NextResponse.json({ error: 'name, valid email and company are required' }, { status: 400 });
  }
  try {
    const db = getBolticClient();
    await db.insert('demo_leads', {
      name,
      email,
      company,
      team_size: typeof body.team_size === 'string' && body.team_size ? body.team_size : null,
      goal: typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[demo-leads] insert failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
