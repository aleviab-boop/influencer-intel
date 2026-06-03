import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { reRankAfterScrape } from '@/lib/shortlist-service';
import type { ScrapeCompletionEvent } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-signature') ?? '';
  const secret = process.env.SCRAPER_CALLBACK_SECRET ?? '';

  if (secret) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!safeEqual(signature, expected)) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }
  }

  let event: ScrapeCompletionEvent;
  try {
    event = JSON.parse(rawBody) as ScrapeCompletionEvent;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  console.log(
    `[scrape-callback] job=${event.job_id?.slice(0, 8)} type=${event.job_type} ` +
    `handle=${event.target_handle} success=${event.success} brief=${event.brief_id?.slice(0, 8) ?? '-'}`,
  );

  if (!event.success) {
    return NextResponse.json({ ok: true, skipped: 'scrape failed' });
  }
  if (!event.brief_id) {
    return NextResponse.json({ ok: true, skipped: 'no brief association' });
  }

  try {
    await reRankAfterScrape({
      brief_id: event.brief_id,
      newly_scraped_creator_id: event.creator_id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[scrape-callback] reRankAfterScrape failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
