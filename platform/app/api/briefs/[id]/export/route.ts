// ============================================================
// Excel export — branded XLSX of a brief's shortlist.
// Sheet 1: Summary (brief text, parsed spec, totals)
// Sheet 2: Creators (rich per-creator fields with vision insights)
// Sheet 3: Outreach drafts (if generated)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { Brief, BriefCreator, Creator } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getBolticClient();

  const brief = await db.findById<Brief>('briefs', id);
  if (!brief) return NextResponse.json({ error: 'brief not found' }, { status: 404 });

  const briefCreators = await db.query<BriefCreator>(
    `SELECT * FROM brief_creators WHERE brief_id = $1 ORDER BY rank ASC`,
    [id],
  );
  const ids = briefCreators.map((bc) => bc.creator_id);
  const creators = ids.length === 0
    ? []
    : await db.query<Creator>(`SELECT * FROM creators WHERE id = ANY($1)`, [ids]);
  const cmap = new Map(creators.map((c) => [c.id, c]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Influencer Intel';
  wb.created = new Date();

  // ---------------- Sheet 1: Summary ----------------
  const summary = wb.addWorksheet('Summary', {
    properties: { defaultColWidth: 28 },
  });
  summary.mergeCells('A1:D1');
  summary.getCell('A1').value = 'Influencer Intel — Campaign Brief';
  summary.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF111111' } };

  let row = 3;
  const writeKV = (k: string, v: string | number | null | undefined) => {
    summary.getCell(`A${row}`).value = k;
    summary.getCell(`A${row}`).font = { bold: true, color: { argb: 'FF666666' } };
    summary.getCell(`B${row}`).value = (v as string | number) ?? '—';
    summary.mergeCells(`B${row}:D${row}`);
    row++;
  };

  const spec = brief.parsed_spec ?? null;
  writeKV('Brief ID', brief.id);
  writeKV('Submitted', brief.created_at ? String(brief.created_at) : '—');
  writeKV('Status', brief.status);
  writeKV('Brief text', brief.raw_text);
  writeKV('Category', spec?.category ?? '—');
  writeKV('Campaign type', spec?.campaign_type ?? '—');
  writeKV('Target gender', spec?.target_gender ?? '—');
  writeKV('Target age', `${spec?.target_age_min ?? '?'}–${spec?.target_age_max ?? '?'}`);
  writeKV('Target cities', (spec?.target_cities ?? []).join(', ') || '—');
  writeKV('Target languages', (spec?.target_languages ?? []).join(', ') || '—');
  writeKV('Vibe', spec?.vibe ?? '—');
  writeKV('Total shortlisted', briefCreators.length);

  summary.getColumn('A').width = 22;
  summary.getColumn('B').width = 60;

  // ---------------- Sheet 2: Creators ----------------
  const sheet = wb.addWorksheet('Creators', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols: { header: string; key: string; width: number }[] = [
    { header: 'Rank', key: 'rank', width: 6 },
    { header: 'Match %', key: 'match', width: 8 },
    { header: 'Handle', key: 'handle', width: 24 },
    { header: 'Display name', key: 'display_name', width: 24 },
    { header: 'Verified', key: 'verified', width: 10 },
    { header: 'Followers', key: 'followers', width: 12 },
    { header: 'Following', key: 'following', width: 10 },
    { header: 'Posts', key: 'posts', width: 8 },
    { header: 'Tier', key: 'tier', width: 8 },
    { header: 'Category', key: 'category', width: 14 },
    { header: 'Niche', key: 'niche', width: 16 },
    { header: 'Themes', key: 'themes', width: 30 },
    { header: 'Vibe', key: 'vibe', width: 24 },
    { header: 'City', key: 'city', width: 16 },
    { header: 'Language', key: 'language', width: 10 },
    { header: 'Credibility', key: 'cred', width: 12 },
    { header: 'Visual quality', key: 'vq', width: 12 },
    { header: 'Bio', key: 'bio', width: 50 },
    { header: 'Profile URL', key: 'url', width: 40 },
    { header: 'Reasoning', key: 'reasoning', width: 60 },
  ];
  sheet.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 22;

  for (const bc of briefCreators) {
    const c = cmap.get(bc.creator_id);
    if (!c) continue;
    const vision = (c.raw_metadata as { vision?: Record<string, unknown> } | undefined)?.vision ?? {};
    sheet.addRow({
      rank: Number(bc.rank),
      match: bc.match_score,
      handle: '@' + c.handle,
      display_name: c.display_name ?? '',
      verified: c.is_verified ? 'YES' : '',
      followers: c.follower_count ?? null,
      following: c.following_count ?? null,
      posts: c.posts_count ?? null,
      tier: (c.raw_metadata as { tier?: string } | undefined)?.tier ?? '',
      category: c.primary_category ?? '',
      niche: (vision.niche as string | null) ?? '',
      themes: ((vision.content_themes as unknown[]) ?? []).join(', '),
      vibe: ((vision.vibe_tags as unknown[]) ?? []).join(', '),
      city: c.primary_city ?? '',
      language: (c.content_languages ?? []).join('/'),
      cred: c.credibility?.overall_score ?? '',
      vq: (vision.visual_quality_score as number | string | null) ?? '',
      bio: (c.bio ?? '').replace(/\n/g, ' • '),
      url: c.profile_url ?? `https://www.instagram.com/${c.handle}/`,
      reasoning: (bc.reasoning ?? '').replace(/\n/g, ' • '),
    });
  }
  // Wrap text on long columns
  ['themes', 'vibe', 'bio', 'reasoning'].forEach((key) => {
    sheet.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
  });

  // ---------------- Sheet 3: Outreach (if any drafts exist) ----------------
  // Look for outreach drafts persisted under brief_creators.outreach
  const draftsRow = await db.query<{ creator_id: string; outreach: unknown }>(
    `SELECT creator_id, outreach FROM brief_creators WHERE brief_id = $1 AND outreach IS NOT NULL`,
    [id],
  );
  if (draftsRow.length > 0) {
    const sh3 = wb.addWorksheet('Outreach drafts', { views: [{ state: 'frozen', ySplit: 1 }] });
    sh3.columns = [
      { header: 'Handle', key: 'handle', width: 24 },
      { header: 'Channel', key: 'channel', width: 10 },
      { header: 'Subject', key: 'subject', width: 30 },
      { header: 'Body', key: 'body', width: 100 },
    ];
    sh3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sh3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };

    for (const r of draftsRow) {
      const c = cmap.get(r.creator_id);
      if (!c) continue;
      const o = r.outreach as { dm?: string; email?: { subject?: string; body?: string } };
      if (o.dm) {
        sh3.addRow({ handle: '@' + c.handle, channel: 'DM', subject: '', body: o.dm });
      }
      if (o.email?.body) {
        sh3.addRow({ handle: '@' + c.handle, channel: 'Email', subject: o.email.subject ?? '', body: o.email.body });
      }
    }
    sh3.getColumn('body').alignment = { wrapText: true, vertical: 'top' };
  }

  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const safeName = (spec?.campaign_type ?? 'shortlist').replace(/[^a-z0-9_]/gi, '');
  const dateStr = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="influencer_intel_${safeName}_${dateStr}.xlsx"`,
    },
  });
}
