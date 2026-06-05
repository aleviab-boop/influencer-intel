import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { runCommentEvent } from '@/lib/automations-service';

export const runtime = 'nodejs';

// GET — Meta webhook verification handshake.
//   ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = process.env.IG_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && expected && token === expected) {
    return new NextResponse(challenge ?? '', { status: 200 });
  }
  return new NextResponse('forbidden', { status: 403 });
}

// POST — receive comment/message events.
//   Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app
//   secret), then dispatches `comments` changes to the automation runner.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('invalid signature', { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // Acknowledge fast; process events best-effort.
  void handle(payload).catch((e) => console.error('[webhook] handle failed:', e));
  return NextResponse.json({ ok: true });
}

function verifySignature(raw: string, header: string | null): boolean {
  const secret = process.env.IG_APP_SECRET;
  // No secret configured yet (Phase-2 scaffold / local dev) → accept.
  if (!secret) {
    console.warn('[webhook] IG_APP_SECRET not set — skipping signature check');
    return true;
  }
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface WebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        id?: string;
        text?: string;
        media?: { id?: string };
        from?: { id?: string; username?: string };
      };
    }>;
  }>;
}

async function handle(payload: WebhookPayload): Promise<void> {
  if (payload.object !== 'instagram') return;
  for (const entry of payload.entry ?? []) {
    const igUserId = entry.id;
    if (!igUserId) continue;
    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments' || !change.value) continue;
      const v = change.value;
      if (!v.text) continue;
      await runCommentEvent({
        ig_user_id: igUserId,
        media_id: v.media?.id ?? null,
        comment_id: v.id ?? null,
        comment_text: v.text,
        commenter: v.from?.username ?? v.from?.id ?? null,
      });
    }
  }
}
