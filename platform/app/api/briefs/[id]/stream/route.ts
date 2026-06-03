import { NextRequest } from 'next/server';
import { getBroadcaster } from '@/lib/sse-broadcaster';
import type { ShortlistEvent } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: briefId } = await ctx.params;
  const broadcaster = getBroadcaster();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (evt: ShortlistEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15_000);
      const unsubscribe = broadcaster.subscribe(briefId, send);
      controller.enqueue(encoder.encode(`event: ready\ndata: {"brief_id":"${briefId}"}\n\n`));
      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch {}
      };
      req.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
