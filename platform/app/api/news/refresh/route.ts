import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export const runtime = 'nodejs';

// POST /api/news/refresh → invalidate the cached news so the next GET re-pulls
// the RSS feeds. Powers the manual "Refresh" button on the Trending page.
export async function POST(): Promise<NextResponse> {
  revalidatePath('/api/news');
  return NextResponse.json({ ok: true });
}
