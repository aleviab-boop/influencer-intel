import { NextResponse } from 'next/server';
import { computeCreatorInsights, computeScrapedInsights } from '@/lib/insights-service';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ creatorId: string }> },
): Promise<NextResponse> {
  const { creatorId } = await params;

  const connected = await computeCreatorInsights(creatorId);
  if (connected) return NextResponse.json({ source: 'connected', ...connected });

  const scraped = await computeScrapedInsights(creatorId);
  if (scraped) return NextResponse.json(scraped);

  return NextResponse.json({ error: 'No data available for this creator' }, { status: 404 });
}
