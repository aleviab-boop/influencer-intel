import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { PostInsight } from '@influencer-intel/shared/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ creatorId: string }> },
): Promise<NextResponse> {
  const { creatorId } = await params;
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const bucket = url.searchParams.get('bucket');

  const db = getBolticClient();
  let whereClause = 'WHERE creator_id = $1';
  const queryParams: unknown[] = [creatorId];

  if (bucket) {
    queryParams.push(bucket);
    whereClause += ` AND performance_bucket = $${queryParams.length}`;
  }

  const posts = await db.query<PostInsight>(
    `SELECT * FROM post_insights ${whereClause} ORDER BY posted_at DESC LIMIT ${limit} OFFSET ${offset}`,
    queryParams,
  );
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM post_insights ${whereClause}`,
    queryParams,
  );

  return NextResponse.json({ posts, total: Number(countResult[0]?.count ?? 0), limit, offset });
}
