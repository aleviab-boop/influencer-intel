import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

interface BriefListRow {
  id: string;
  status: string;
  raw_text: string;
  category: string | null;
  campaign_type: string | null;
  created_at: string;
  creator_count: number;
  pending_count: number;
}

export async function GET() {
  const db = getBolticClient();
  const session = await getSession();
  // Signed-in users see only their brand's briefs. Unauthenticated callers
  // see ALL briefs (preserves demo / personal-tool mode).
  const where = session ? 'WHERE b.brand_id = $1' : '';
  const params = session ? [session.brand_id] : [];
  const rows = await db.query<BriefListRow>(
    `SELECT
       b.id,
       b.status,
       b.raw_text,
       b.parsed_spec->>'category' AS category,
       b.parsed_spec->>'campaign_type' AS campaign_type,
       b.created_at,
       COALESCE((SELECT COUNT(*)::int FROM brief_creators WHERE brief_id = b.id), 0) AS creator_count,
       COALESCE((SELECT COUNT(*)::int FROM scrape_jobs
                 WHERE brief_id = b.id
                   AND job_type IN ('on_demand','refresh','search_query')
                   AND status IN ('queued','in_progress')), 0) AS pending_count
     FROM briefs b
     ${where}
     ORDER BY b.created_at DESC
     LIMIT 100`,
    params,
  );
  return NextResponse.json({ briefs: rows });
}
