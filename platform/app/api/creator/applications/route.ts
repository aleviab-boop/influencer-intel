import { NextRequest, NextResponse } from 'next/server';
import { getCreatorApplications, applyToProgram } from '@/lib/creator-portal-service';
import { getCreatorSession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/creator/applications?handle=foo → this creator's applications.
// Session-first: a logged-in creator always reads their own; ?handle is a
// preview fallback only.
export async function GET(req: NextRequest) {
  const session = await getCreatorSession();
  const handle = (session?.handle ?? new URL(req.url).searchParams.get('handle') ?? '').trim();
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
  try {
    const applications = await getCreatorApplications(handle);
    return NextResponse.json({ applications });
  } catch (err) {
    console.error('[creator] applications failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/creator/applications { handle?, program_id } → self-apply to a
// campaign. Session-first: the logged-in creator's handle wins over any body handle.
export async function POST(req: NextRequest) {
  const session = await getCreatorSession();
  const body = await req.json().catch(() => null);
  const handle = (session?.handle ?? (typeof body?.handle === 'string' ? body.handle : '')).trim();
  if (!handle || !body || typeof body.program_id !== 'string') {
    return NextResponse.json({ error: 'handle and program_id required' }, { status: 400 });
  }
  try {
    const result = await applyToProgram(handle, body.program_id);
    return NextResponse.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === 'creator not found' ? 404 : 500 });
  }
}
