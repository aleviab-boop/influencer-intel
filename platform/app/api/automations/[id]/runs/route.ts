import { NextRequest, NextResponse } from 'next/server';
import { listRuns } from '@/lib/automations-service';

export const runtime = 'nodejs';

// GET /api/automations/[id]/runs → recent AutomationRun[]
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const runs = await listRuns(id, 12);
    return NextResponse.json({ runs });
  } catch (err) {
    console.error('[automations] runs failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
