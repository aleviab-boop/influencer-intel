import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';

// GET /api/admin/db            → list every base table (public schema) with an
//                                estimated row count + column count.
// GET /api/admin/db?table=X    → that table's columns (name/type/nullable), its
//                                exact row count, and up to 50 sample rows.
//
// READ-ONLY by construction: the only place a caller-supplied value touches a
// query is the table name, and that is validated against the live list of real
// tables before it's ever interpolated — so there's no SQL-injection surface and
// no write path. Gated by the admin middleware (401 without a valid admin token).

// Columns we never echo back in sample rows (hashes / secrets / session material).
const REDACT = /pass|secret|token|cookie|hash|salt|credential|api[_-]?key/i;

async function listTableNames(db: ReturnType<typeof getBolticClient>): Promise<string[]> {
  const rows = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const db = getBolticClient();
  const table = (req.nextUrl.searchParams.get('table') ?? '').trim();

  try {
    // ---- table listing --------------------------------------------------
    if (!table) {
      const rows = await db.query<{ table_name: string; est_rows: string; col_count: string }>(
        `SELECT t.table_name,
                COALESCE(s.n_live_tup, 0)::text AS est_rows,
                (SELECT COUNT(*) FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = t.table_name)::text AS col_count
           FROM information_schema.tables t
           LEFT JOIN pg_stat_user_tables s
             ON s.relname = t.table_name AND s.schemaname = 'public'
          WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          ORDER BY t.table_name`,
      );
      return NextResponse.json({
        tables: rows.map((r) => ({
          name: r.table_name,
          est_rows: Number(r.est_rows) || 0,
          col_count: Number(r.col_count) || 0,
        })),
      });
    }

    // ---- single-table detail --------------------------------------------
    // Validate the requested name against the REAL table list — this is what
    // makes the interpolation below safe.
    const allowed = await listTableNames(db);
    if (!allowed.includes(table)) {
      return NextResponse.json({ error: 'unknown table' }, { status: 404 });
    }
    const safe = `"${table.replace(/"/g, '')}"`; // now provably one of our own tables

    const columns = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table],
    );

    const countRows = await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${safe}`);
    const rowCount = Number(countRows[0]?.n) || 0;

    const sample = await db.query<Record<string, unknown>>(`SELECT * FROM ${safe} LIMIT 50`);
    // Redact sensitive columns before they leave the server.
    const redactCols = columns.filter((c) => REDACT.test(c.column_name)).map((c) => c.column_name);
    const rows = sample.map((r) => {
      const out: Record<string, unknown> = { ...r };
      for (const col of redactCols) if (out[col] != null) out[col] = '••••••';
      return out;
    });

    return NextResponse.json({
      table,
      row_count: rowCount,
      columns: columns.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        redacted: REDACT.test(c.column_name),
      })),
      rows,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
