import { NextResponse } from 'next/server';
import { listRecentPredictions } from '@/lib/reach-prediction-log';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ml/predictions/export
 *
 * The scored forecast ledger as a downloadable CSV — every logged forecast with
 * its predicted likes/views/ER and, where recorded, the actual and the likes
 * error. For offline analysis in a spreadsheet. Gated by the admin middleware.
 */

// RFC-4180-ish escaping: quote when the value contains a comma, quote or newline.
function csvCell(value: string | number | null): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(): Promise<NextResponse> {
  try {
    const rows = await listRecentPredictions(2000);
    const header = [
      'created_at', 'creator_handle', 'format', 'bucket', 'confidence',
      'predicted_likes', 'predicted_views', 'predicted_er',
      'actual_likes', 'actual_views', 'likes_ape', 'scored', 'caption_preview',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        csvCell(r.created_at),
        csvCell(r.creator_handle),
        csvCell(r.format),
        csvCell(r.bucket),
        csvCell(r.confidence),
        csvCell(r.predicted_likes),
        csvCell(r.predicted_views),
        csvCell(r.predicted_er),
        csvCell(r.actual_likes),
        csvCell(r.actual_views),
        csvCell(r.likes_ape),
        csvCell(r.scored ? 'yes' : 'no'),
        csvCell(r.caption_preview),
      ].join(','));
    }
    const csv = lines.join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="forecast-ledger-${stamp}.csv"`,
      },
    });
  } catch (err) {
    console.error('[ml/predictions/export] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
