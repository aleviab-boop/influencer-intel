import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import type { LiveProfile } from '@/lib/live-discovery';

export const runtime = 'nodejs';

// POST /api/discover-live/export  { prompt, results: LiveProfile[] }
//   → an .xlsx download of the ranked live-search results.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : 'search';
  const results: LiveProfile[] = Array.isArray(body?.results) ? body.results : [];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Influencer Intel';
  wb.created = new Date();

  const ws = wb.addWorksheet('Results');
  ws.columns = [
    { header: 'Rank', key: 'rank', width: 6 },
    { header: 'Username', key: 'username', width: 24 },
    { header: 'Name', key: 'full_name', width: 26 },
    { header: 'Followers', key: 'followers', width: 12 },
    { header: 'Engagement %', key: 'engagement', width: 13 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Score', key: 'score', width: 7 },
    { header: 'Verified', key: 'is_verified', width: 9 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Link', key: 'link', width: 30 },
    { header: 'Bio', key: 'biography', width: 40 },
    { header: 'URL', key: 'url', width: 36 },
  ];

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6C4DF6' } };

  results.forEach((p, i) => {
    ws.addRow({
      rank: i + 1,
      username: p.username,
      full_name: p.full_name,
      followers: p.followers,
      engagement: p.engagement ?? 0,
      category: p.category,
      score: p.score,
      is_verified: p.is_verified ? 'yes' : 'no',
      email: p.email ?? '',
      phone: p.phone ?? '',
      link: p.link ?? '',
      biography: p.biography,
      url: `https://instagram.com/${p.username}`,
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const safe = prompt.replace(/[^a-z0-9]+/gi, '_').slice(0, 40) || 'search';
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${safe}.xlsx"`,
    },
  });
}
