import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// GET /api/admin/agency-activity
//   Recent agency lander searches (prompt + how many DB results it returned),
//   plus a small rollup, for the admin Agency page.
export async function GET() {
  const db = getBolticClient();

  let recent: Array<{ id: string; prompt: string; result_count: number; created_at: string }> = [];
  try {
    recent = await db.query(
      `SELECT id, prompt, coalesce(result_count, 0) AS result_count, created_at
       FROM agency_searches ORDER BY created_at DESC LIMIT 50`,
    );
  } catch {
    recent = [];
  }

  const rollup = async (sql: string): Promise<number> => {
    try {
      const r = await db.query<{ n: number | string }>(sql);
      return Number(r[0]?.n ?? 0);
    } catch {
      return 0;
    }
  };
  const [total, last24h, last1h] = await Promise.all([
    rollup(`SELECT count(*)::int AS n FROM agency_searches`),
    rollup(`SELECT count(*)::int AS n FROM agency_searches WHERE created_at > NOW() - INTERVAL '24 hours'`),
    rollup(`SELECT count(*)::int AS n FROM agency_searches WHERE created_at > NOW() - INTERVAL '1 hour'`),
  ]);

  return NextResponse.json({
    recent: recent.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      result_count: Number(r.result_count),
      created_at: r.created_at,
    })),
    totals: { all: total, last_24h: last24h, last_1h: last1h },
  });
}
