// ============================================================
// Outreach drafting API — generates personalised DM + email per
// selected creator, persists to brief_creators.outreach.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type { Brief, BriefCreator, Brand, Creator } from '@influencer-intel/shared/types';

export const runtime = 'nodejs';

interface OutreachDraft {
  dm: string;
  email: { subject: string; body: string };
  generated_at: string;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { brief_creator_ids?: string[] } | null;
  if (!body || !Array.isArray(body.brief_creator_ids) || body.brief_creator_ids.length === 0) {
    return NextResponse.json({ error: 'brief_creator_ids required' }, { status: 400 });
  }
  if (body.brief_creator_ids.length > 25) {
    return NextResponse.json({ error: 'max 25 drafts per request' }, { status: 400 });
  }

  const db = getBolticClient();
  const brief = await db.findById<Brief>('briefs', id);
  if (!brief) return NextResponse.json({ error: 'brief not found' }, { status: 404 });

  const brand = await db.findById<Brand>('brands', brief.brand_id);

  const briefCreators = await db.query<BriefCreator>(
    `SELECT * FROM brief_creators WHERE brief_id = $1 AND id = ANY($2)`,
    [id, body.brief_creator_ids],
  );
  const creators = briefCreators.length === 0
    ? []
    : await db.query<Creator>(
        `SELECT * FROM creators WHERE id = ANY($1)`,
        [briefCreators.map((bc) => bc.creator_id)],
      );
  const cmap = new Map(creators.map((c) => [c.id, c]));

  const llm = getOpenAIClient();
  const drafts: Array<{ brief_creator_id: string; handle: string; outreach: OutreachDraft }> = [];

  for (const bc of briefCreators) {
    const c = cmap.get(bc.creator_id);
    if (!c) continue;

    // Build creator's "recent topics" from vision + bio
    const vision = (c.raw_metadata as { vision?: Record<string, unknown> } | undefined)?.vision ?? {};
    const topics: string[] = [];
    const themes = (vision.content_themes as unknown[] | undefined) ?? [];
    for (const t of themes.slice(0, 3)) if (typeof t === 'string') topics.push(t);
    const subNiches = (vision.sub_niches as unknown[] | undefined) ?? [];
    for (const t of subNiches.slice(0, 2)) if (typeof t === 'string') topics.push(t);
    if (vision.niche && typeof vision.niche === 'string') topics.push(vision.niche);
    if (topics.length === 0 && c.primary_category) topics.push(c.primary_category);

    const campaignSummary = brief.raw_text;
    const brandName = brand?.name ?? 'Trends';
    const voiceSamples: string[] = [
      'Premium but accessible. Indian D2C, modern.',
      'Always credit creator authenticity over polished sales pitch.',
    ];

    let dm = '';
    let emailBody = '';
    try {
      [dm, emailBody] = await Promise.all([
        llm.generateOutreach({
          brand_name: brandName,
          brand_voice_samples: voiceSamples,
          creator_handle: c.handle,
          creator_recent_topics: topics,
          campaign_summary: campaignSummary,
          channel: 'ig_dm',
        }),
        llm.generateOutreach({
          brand_name: brandName,
          brand_voice_samples: voiceSamples,
          creator_handle: c.handle,
          creator_recent_topics: topics,
          campaign_summary: campaignSummary,
          channel: 'email',
        }),
      ]);
    } catch (err) {
      console.error('[outreach] generation failed for', c.handle, err);
      continue;
    }

    // Email format we asked for: "Subject: X\n\nBody". Split it.
    let subject = `Collab idea — ${brandName} × @${c.handle}`;
    let bodyText = emailBody;
    const subjMatch = emailBody.match(/^Subject:\s*(.+?)\n+([\s\S]*)$/i);
    if (subjMatch) {
      subject = subjMatch[1]!.trim();
      bodyText = subjMatch[2]!.trim();
    }

    const draft: OutreachDraft = {
      dm,
      email: { subject, body: bodyText },
      generated_at: new Date().toISOString(),
    };
    await db.update('brief_creators', { id: bc.id }, { outreach: draft });
    drafts.push({ brief_creator_id: bc.id, handle: c.handle, outreach: draft });
  }

  return NextResponse.json({ drafts, count: drafts.length });
}

// GET — return existing drafts for this brief
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getBolticClient();
  const rows = await db.query<{ id: string; creator_id: string; outreach: unknown }>(
    `SELECT id, creator_id, outreach FROM brief_creators
     WHERE brief_id = $1 AND outreach IS NOT NULL ORDER BY rank ASC`,
    [id],
  );
  if (rows.length === 0) return NextResponse.json({ drafts: [] });

  const creators = await db.query<{ id: string; handle: string; display_name: string | null }>(
    `SELECT id, handle, display_name FROM creators WHERE id = ANY($1)`,
    [rows.map((r) => r.creator_id)],
  );
  const cmap = new Map(creators.map((c) => [c.id, c]));

  const drafts = rows.map((r) => ({
    brief_creator_id: r.id,
    handle: cmap.get(r.creator_id)?.handle ?? '?',
    display_name: cmap.get(r.creator_id)?.display_name ?? null,
    outreach: r.outreach,
  }));
  return NextResponse.json({ drafts });
}
