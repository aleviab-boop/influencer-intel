import { NextRequest, NextResponse } from 'next/server';
import { listAutomations, createAutomation } from '@/lib/automations-service';

export const runtime = 'nodejs';

// GET /api/automations → Automation[]
export async function GET() {
  try {
    const automations = await listAutomations();
    return NextResponse.json({ automations });
  } catch (err) {
    console.error('[automations] list failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/automations { name, dm_message, post_label?, trigger_type?, keyword?, comment_reply? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || body.name.trim().length < 2) {
    return NextResponse.json({ error: 'name must be at least 2 characters' }, { status: 400 });
  }
  if (typeof body.dm_message !== 'string' || body.dm_message.trim().length < 2) {
    return NextResponse.json({ error: 'dm_message is required' }, { status: 400 });
  }
  const trigger_type = body.trigger_type === 'any' ? 'any' : 'keyword';
  if (trigger_type === 'keyword' && (typeof body.keyword !== 'string' || !body.keyword.trim())) {
    return NextResponse.json({ error: 'keyword is required for keyword triggers' }, { status: 400 });
  }
  try {
    const automation = await createAutomation({
      name: body.name.trim(),
      post_label: typeof body.post_label === 'string' ? body.post_label : null,
      trigger_type,
      keyword: trigger_type === 'keyword' ? body.keyword.trim() : null,
      dm_message: body.dm_message.trim(),
      comment_reply: typeof body.comment_reply === 'string' && body.comment_reply.trim() ? body.comment_reply.trim() : null,
    });
    return NextResponse.json({ automation });
  } catch (err) {
    console.error('[automations] create failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
