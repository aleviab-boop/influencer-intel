// ============================================================
// Import API — accepts Excel/CSV with influencer handles,
// looks them up in our creators table, optionally ranks them
// against a campaign brief, and returns an enriched shortlist.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type { Brief, BriefCreator, Creator } from '@influencer-intel/shared/types';
import { rankCreators } from '@/lib/ranker';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

// Column names we recognize as "handle" columns (case-insensitive).
const HANDLE_COLUMN_NAMES = new Set([
  'handle',
  'username',
  'instagram handle',
  '@handle',
  'ig handle',
  'ig_handle',
  'creator',
  'influencer',
]);

/**
 * Extract handles from an Excel (.xlsx) buffer.
 * Strategy: find a column whose header matches a known handle-name,
 * or fall back to the first column.
 */
async function parseExcel(buffer: ArrayBuffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet || sheet.rowCount === 0) return [];

  // Determine which column holds handles.
  let handleCol = 1;
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    const val = String(cell.value ?? '').trim().toLowerCase();
    if (HANDLE_COLUMN_NAMES.has(val)) handleCol = colNumber;
  });

  const handles: string[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      // Skip header if it matches a known column name.
      const first = String(row.getCell(handleCol).value ?? '').trim().toLowerCase();
      if (HANDLE_COLUMN_NAMES.has(first)) return;
    }
    const raw = String(row.getCell(handleCol).value ?? '').trim();
    if (raw) handles.push(raw);
  });
  return handles;
}

/**
 * Parse a CSV string into handles from the first column (or named column).
 */
function parseCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  // Check if first line is a header.
  const headerCells = lines[0]!.split(',').map((c) => c.trim().toLowerCase().replace(/^["']|["']$/g, ''));
  let handleIdx = 0;
  for (let i = 0; i < headerCells.length; i++) {
    if (HANDLE_COLUMN_NAMES.has(headerCells[i]!)) {
      handleIdx = i;
      break;
    }
  }

  const startRow = HANDLE_COLUMN_NAMES.has(headerCells[handleIdx]!) ? 1 : 0;
  const handles: string[] = [];
  for (let i = startRow; i < lines.length; i++) {
    const cells = lines[i]!.split(',');
    const raw = (cells[handleIdx] ?? '').trim().replace(/^["']|["']$/g, '');
    if (raw) handles.push(raw);
  }
  return handles;
}

/** Clean a raw handle string: trim, lowercase, strip @ prefix. */
function cleanHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart/form-data request' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file uploaded — attach a .xlsx or .csv file' }, { status: 400 });
  }

  const briefText = (formData.get('brief_text') as string | null)?.trim() || null;

  // Determine file type from name or content type.
  const fileName = (file as File).name?.toLowerCase() ?? '';
  const isExcel = fileName.endsWith('.xlsx') || file.type.includes('spreadsheet');
  const isCsv = fileName.endsWith('.csv') || file.type === 'text/csv';

  if (!isExcel && !isCsv) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload .xlsx or .csv.' },
      { status: 400 },
    );
  }

  // Parse handles from file.
  const buffer = await file.arrayBuffer();
  let rawHandles: string[];
  try {
    rawHandles = isExcel ? await parseExcel(buffer) : parseCsv(new TextDecoder().decode(buffer));
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse file: ${err instanceof Error ? err.message : 'unknown error'}` },
      { status: 400 },
    );
  }

  // Clean & deduplicate.
  const cleaned = [...new Set(rawHandles.map(cleanHandle).filter((h) => h.length > 0))];
  if (cleaned.length === 0) {
    return NextResponse.json({ error: 'No valid handles found in file' }, { status: 400 });
  }

  const totalUploaded = cleaned.length;

  // Look up creators in DB.
  const db = getBolticClient();
  const creators = cleaned.length > 0
    ? await db.query<Creator>(
        `SELECT * FROM creators WHERE LOWER(handle) = ANY($1)`,
        [cleaned],
      )
    : [];

  const foundMap = new Map(creators.map((c) => [c.handle.toLowerCase(), c]));
  const foundHandles = new Set(foundMap.keys());
  const notFound = cleaned.filter((h) => !foundHandles.has(h));

  // Optionally rank against a brief.
  let briefId: string | undefined;
  type CreatorResult = {
    handle: string;
    display_name: string | null;
    follower_count: number | null;
    engagement_rate: number | null;
    primary_category: string | null;
    primary_city: string | null;
    credibility_score: number | null;
    match_score?: number;
    profile_photo_url: string | null;
    is_verified: boolean;
    signals: string[];
  };

  let results: CreatorResult[];

  if (briefText && briefText.length >= 10) {
    // Create a real brief — same flow as /api/briefs POST.
    const session = await getSession();
    const brandId = session?.brand_id ?? await getOrCreateDefaultBrand(db);

    const llm = getOpenAIClient();
    const parsed = await llm.parseBrief(briefText);
    const briefEmbedding = await llm.embed(
      [briefText, parsed.category ?? '', (parsed.target_cities ?? []).join(' ')].join(' '),
    );

    const brief = await db.insert<Brief>('briefs', {
      brand_id: brandId,
      raw_text: briefText,
      parsed_spec: parsed,
      brief_embedding: briefEmbedding,
      status: 'shortlisted',
      parsed_at: new Date().toISOString(),
    });
    briefId = brief.id;

    // Rank found creators against the brief.
    const ranked = rankCreators(brief, creators);

    // Persist as brief_creators.
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i]!;
      await db.insert<BriefCreator>('brief_creators', {
        brief_id: brief.id,
        brand_id: brandId,
        creator_id: r.creator.id,
        rank: i + 1,
        match_score: r.match_score,
        reasoning: r.signals.join(' | '),
        freshness: 'fresh',
        brand_action: 'pending',
      });
    }

    results = ranked.map((r) => ({
      handle: r.creator.handle,
      display_name: r.creator.display_name,
      follower_count: r.creator.follower_count,
      engagement_rate: r.creator.engagement_rate,
      primary_category: r.creator.primary_category,
      primary_city: r.creator.primary_city,
      credibility_score: r.creator.credibility?.overall_score ?? null,
      match_score: r.match_score,
      profile_photo_url: r.creator.profile_photo_url,
      is_verified: r.creator.is_verified,
      signals: r.signals,
    }));
  } else {
    // No brief — just return enriched creator data sorted by credibility.
    const sorted = [...creators].sort((a, b) => {
      const aScore = a.credibility?.overall_score ?? 0;
      const bScore = b.credibility?.overall_score ?? 0;
      return bScore - aScore;
    });

    results = sorted.map((c) => ({
      handle: c.handle,
      display_name: c.display_name,
      follower_count: c.follower_count,
      engagement_rate: c.engagement_rate,
      primary_category: c.primary_category,
      primary_city: c.primary_city,
      credibility_score: c.credibility?.overall_score ?? null,
      profile_photo_url: c.profile_photo_url,
      is_verified: c.is_verified,
      signals: buildBasicSignals(c),
    }));
  }

  return NextResponse.json({
    total_uploaded: totalUploaded,
    found: creators.length,
    not_found: notFound,
    creators: results,
    ...(briefId ? { brief_id: briefId } : {}),
  });
}

/** Build informational signals for a creator when no brief is provided. */
function buildBasicSignals(c: Creator): string[] {
  const signals: string[] = [];
  if (c.primary_category) signals.push(c.primary_category);
  if (c.primary_city) signals.push(`based in ${c.primary_city}`);
  if (c.is_verified) signals.push('verified');
  if (c.credibility?.badge === 'green') signals.push(`credibility ${c.credibility.overall_score}%`);
  if (c.credibility?.badge === 'red') signals.push(`low credibility (${c.credibility.overall_score}%)`);
  if (c.follower_count !== null) {
    if (c.follower_count >= 1_000_000) signals.push(`${(c.follower_count / 1_000_000).toFixed(1)}M followers`);
    else if (c.follower_count >= 1_000) signals.push(`${(c.follower_count / 1_000).toFixed(1)}K followers`);
  }
  return signals;
}

async function getOrCreateDefaultBrand(db: ReturnType<typeof getBolticClient>): Promise<string> {
  const rows = await db.query<{ id: string }>(`SELECT id FROM brands WHERE slug = 'trends' LIMIT 1`);
  if (rows[0]) return rows[0].id;
  const created = await db.insert<{ id: string }>('brands', {
    name: 'Trends',
    slug: 'trends',
    category: 'fashion',
    plan: 'design_partner',
    research_quota_used: 0,
    research_quota_max: 50,
    onboarded_at: new Date().toISOString(),
  });
  return created.id;
}
