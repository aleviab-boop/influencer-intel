import { NextRequest, NextResponse } from 'next/server';
import { simulateComment } from '@/lib/automations-service';

export const runtime = 'nodejs';

// POST /api/automations/[id]/simulate { comment, commenter? }
//   Runs the automation against a test comment and logs the (simulated) result.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.comment !== 'string' || !body.comment.trim()) {
    return NextResponse.json({ error: 'comment is required' }, { status: 400 });
  }
  try {
    const result = await simulateComment(id, {
      comment: body.comment.trim(),
      commenter: typeof body.commenter === 'string' ? body.commenter : null,
    });
    if (!result) return NextResponse.json({ error: 'automation not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[automations] simulate failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
