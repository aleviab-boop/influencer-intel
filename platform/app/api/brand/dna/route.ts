import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient, type BrandDnaProfile } from '@influencer-intel/shared/llm';
import { getAgencySession } from '@/lib/auth';
import { scrapeBrandSite, scrapeBrandInstagram } from '@/lib/brand-scrape';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface Collaborator {
  username: string;
  full_name: string;
  followers: number;
  engagement: number;
  profile_pic_url: string | null;
  in_db: boolean;
}

// Enrich a list of collaborator handles from the creators table (photo, reach,
// ER) so the workspace can render real cards. Handles not in the DB still come
// back with a minimal shell so the brand can still open them on Instagram.
async function enrichCollaborators(handles: string[]): Promise<Collaborator[]> {
  if (handles.length === 0) return [];
  const lower = handles.map((h) => h.toLowerCase());
  let rows: Array<{
    handle: string;
    display_name: string | null;
    follower_count: number | string | null;
    engagement_rate: number | string | null;
    profile_photo_url: string | null;
  }> = [];
  try {
    rows = await getBolticClient().query(
      `SELECT handle, display_name, follower_count, engagement_rate, profile_photo_url
         FROM creators
        WHERE platform = 'instagram' AND lower(handle) = ANY($1)`,
      [lower],
    );
  } catch {
    rows = [];
  }
  const byHandle = new Map(rows.map((r) => [r.handle.toLowerCase(), r]));
  return handles.map((h) => {
    const r = byHandle.get(h.toLowerCase());
    return {
      username: h,
      full_name: r?.display_name ?? '',
      followers: Number(r?.follower_count ?? 0),
      engagement: r?.engagement_rate != null ? Math.round(Number(r.engagement_rate) * 1000) / 10 : 0,
      profile_pic_url: r?.profile_photo_url ?? null,
      in_db: Boolean(r),
    };
  });
}

// POST /api/brand/dna
//   { brand, url?, social?, notes? }
//   → { profile: BrandDnaProfile, saved: boolean, collaborators: Collaborator[] }
//
// The front of the brand flow. We ACTUALLY scrape the brand's website + Instagram
// (lib/brand-scrape), feed that real content to the web-search model to build a
// grounded Brand DNA, persist it to brand_dna for the campaign step, and — using
// the creators the brand tags in its own posts plus an AI web search — surface
// real creators who have worked with the brand before.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const brand = typeof body?.brand === 'string' ? body.brand.trim() : '';
  if (brand.length < 2) {
    return NextResponse.json({ error: 'A brand name is required (min 2 characters).' }, { status: 400 });
  }
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  const social = typeof body?.social === 'string' ? body.social.trim() : '';
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';

  // Scrape the real website + Instagram in parallel (both best-effort → null).
  const [site, ig] = await Promise.all([
    url ? scrapeBrandSite(url) : Promise.resolve(null),
    social ? scrapeBrandInstagram(social) : Promise.resolve(null),
  ]);

  let profile: BrandDnaProfile;
  try {
    profile = await getOpenAIClient().analyzeBrandDna({
      brand,
      url: url || null,
      social: social || null,
      notes: notes || null,
      siteText: site?.text ?? null,
      siteTitle: site?.title ?? null,
      siteDescription: site?.description ?? null,
      igBio: ig?.biography ?? null,
      igCategory: ig?.category ?? null,
      igFollowers: ig?.followers ?? null,
      igCaptions: ig?.captions ?? null,
    });
  } catch (err) {
    console.error('[brand/dna] analysis failed:', err);
    return NextResponse.json({ error: 'Could not analyse the brand. Try again.' }, { status: 502 });
  }

  // Creators who have worked with the brand: seed with the handles the brand
  // tags in its own captions (first-party), then let AI web-search add more.
  let collaborators: Collaborator[] = [];
  try {
    const handles = await getOpenAIClient().suggestBrandCollaborators(brand, {
      category: profile.category || ig?.category || undefined,
      seedHandles: (ig?.mentions ?? []).map((m) => m.handle),
    });
    collaborators = await enrichCollaborators(handles);
  } catch (err) {
    console.error('[brand/dna] collaborators failed:', err);
    // Fall back to the raw first-party mentions if the AI step fails.
    if (ig?.mentions?.length) {
      collaborators = await enrichCollaborators(ig.mentions.map((m) => m.handle));
    }
  }

  // Stamp ownership when an agency is signed in, so this brand joins their roster.
  const account = await getAgencySession();

  // Persist the analysis (best-effort — the DNA is still returned if the write
  // fails, e.g. before the migration is applied).
  let saved = false;
  try {
    await getBolticClient().query(
      `INSERT INTO brand_dna (brand_name, url, social, profile, account_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [brand, url || null, social || null, JSON.stringify(profile), account?.account_id ?? null],
    );
    saved = true;
  } catch (err) {
    console.error('[brand/dna] save failed:', err);
  }

  return NextResponse.json({ profile, saved, collaborators });
}

// GET /api/brand/dna
//   ?brand=NAME → { profile: BrandDnaProfile | null, created_at }
//   (no brand)  → { brands: [{ brand_name, category, created_at }] }  (recent, distinct)
//
// With a brand: the latest saved DNA for it (case-insensitive) — used to sign a
// returning brand back in / reuse an earlier analysis. With no brand: the recent
// distinct brands we've analysed, so the login page can list them to pick from.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const brand = req.nextUrl.searchParams.get('brand')?.trim() ?? '';

  // List mode — recent distinct brands for the login picker. When an agency is
  // signed in, scope to the brands they own; otherwise (anonymous) show recent
  // brands so the localStorage flow still works.
  if (brand.length < 2) {
    const account = await getAgencySession();
    try {
      const brands = await getBolticClient().query<{ brand_name: string; category: string | null; created_at: string }>(
        `SELECT brand_name, category, created_at FROM (
           SELECT DISTINCT ON (lower(brand_name))
                  brand_name, profile->>'category' AS category, created_at
             FROM brand_dna
            WHERE ($1::uuid IS NULL OR account_id = $1)
            ORDER BY lower(brand_name), created_at DESC
         ) t
         ORDER BY created_at DESC
         LIMIT 24`,
        [account?.account_id ?? null],
      );
      return NextResponse.json({ brands: brands.map((b) => ({ ...b, created_at: String(b.created_at) })) });
    } catch {
      return NextResponse.json({ brands: [] });
    }
  }

  try {
    const rows = await getBolticClient().query<{ profile: BrandDnaProfile; created_at: string }>(
      `SELECT profile, created_at::text AS created_at
         FROM brand_dna
        WHERE lower(brand_name) = lower($1)
        ORDER BY created_at DESC
        LIMIT 1`,
      [brand],
    );
    const row = rows[0];
    return NextResponse.json({ profile: row?.profile ?? null, created_at: row?.created_at ?? null });
  } catch {
    // Table not created yet → nothing saved.
    return NextResponse.json({ profile: null, created_at: null });
  }
}
