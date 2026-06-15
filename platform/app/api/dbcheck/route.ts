import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Temporary diagnostic: confirms whether the DB is reachable from this server
// and, if not, surfaces the error type (no credentials). Delete after debugging.
export async function GET(): Promise<NextResponse> {
  const hasUrl = Boolean(process.env.BOLTIC_DATABASE_URL);
  try {
    const rows = await getBolticClient().query<{ ok: number }>('SELECT 1 AS ok');
    return NextResponse.json({ ok: true, hasUrl, rows });
  } catch (e) {
    const err = e as { name?: string; code?: string; message?: string };
    return NextResponse.json({
      ok: false,
      hasUrl,
      name: err?.name ?? null,
      code: err?.code ?? null,
      message: (err?.message ?? '').slice(0, 300),
    });
  }
}
