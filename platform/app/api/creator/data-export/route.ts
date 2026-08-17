import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { resolveCreatorId } from '@/lib/creator-identity';
import { parseInstagramExport, type DataExportSummary } from '@/lib/ig-data-export';

export const runtime = 'nodejs';
export const maxDuration = 60; // unzip + parse of a multi-MB export

// A creator's DYI export can be large (media metadata for years of posts). Cap
// the upload we'll accept into memory so a hostile/huge file can't OOM the route.
const MAX_BYTES = 80 * 1024 * 1024; // 80 MB

interface CreatorRow {
  id: string;
  display_name: string | null;
  bio: string | null;
  recent_posts: unknown;
  verification_tier: string | null;
}

/**
 * GET /api/creator/data-export?handle=|account=
 *
 * Return the creator's last import summary (or available:false if none). DB-only,
 * always 200 — lets the setup UI show "last imported N followers on <date>".
 */
export async function GET(request: Request): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    const [c] = await db.query<{ data_export_summary: DataExportSummary | null; data_export_imported_at: string | null }>(
      `SELECT data_export_summary,
              data_export_imported_at::text AS data_export_imported_at
         FROM creators WHERE id = $1 LIMIT 1`,
      [creatorId],
    );
    if (!c) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    return NextResponse.json({
      available: true,
      imported: !!c.data_export_imported_at,
      imported_at: c.data_export_imported_at,
      summary: c.data_export_summary ?? null,
    });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * POST /api/creator/data-export?handle=|account=
 *
 * Accept the creator's Instagram "Download your information" ZIP (JSON format),
 * parse it in-memory, and fold the results into their creator row:
 *   - follower/following/posts counts (exact, Instagram-generated)
 *   - posting cadence + first/last post dates
 *   - bio / display name (only if we don't already have them)
 *   - recent_posts (only if empty — never clobbers engagement-bearing scraped posts)
 * Lifts verification_tier to 'public' when nothing stronger is on file. Always 200.
 *
 * Returns { ok, summary } or { ok:false, reason }.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ ok: false, reason: 'no_creator' }, { status: 200 });

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 200 });
    }
    const file = form.get('file');
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ ok: false, reason: 'no_file' }, { status: 200 });
    }
    const name = (file as File).name?.toLowerCase() ?? '';
    if (!name.endsWith('.zip') && file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed') {
      return NextResponse.json({ ok: false, reason: 'not_zip' }, { status: 200 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, reason: 'too_large', max_mb: MAX_BYTES / (1024 * 1024) }, { status: 200 });
    }

    const buffer = await file.arrayBuffer();
    const parsed = await parseInstagramExport(buffer);
    if (!parsed) {
      // Most common cause: an HTML-format export instead of JSON.
      return NextResponse.json({ ok: false, reason: 'unparseable' }, { status: 200 });
    }

    const [c] = await db.query<CreatorRow>(
      `SELECT id, display_name, bio, recent_posts, verification_tier
         FROM creators WHERE id = $1 LIMIT 1`,
      [creatorId],
    );
    if (!c) return NextResponse.json({ ok: false, reason: 'no_creator' }, { status: 200 });

    const s = parsed.summary;
    const patch: Record<string, unknown> = {
      data_export_summary: s,
      data_export_imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Exact, Instagram-generated reach numbers — always trust these.
    if (typeof s.followers === 'number' && s.followers > 0) patch.follower_count = s.followers;
    if (typeof s.following === 'number' && s.following > 0) patch.following_count = s.following;
    if (typeof s.posts === 'number' && s.posts > 0) patch.posts_count = s.posts;

    // Fill display name / bio only if we don't already have them.
    if (!c.display_name?.trim() && s.display_name) patch.display_name = s.display_name;
    if (!c.bio?.trim() && s.bio) patch.bio = s.bio;

    // Only seed recent_posts if empty — the scrape provides engagement-bearing
    // posts we don't want to overwrite with metric-less export posts.
    const hasPosts = Array.isArray(c.recent_posts) && c.recent_posts.length > 0;
    if (!hasPosts && parsed.posts.length > 0) {
      patch.recent_posts = parsed.posts.map((p) => ({
        platform_post_id: null,
        post_url: null,
        post_type: 'unknown',
        caption: p.caption,
        posted_at: p.posted_at,
        view_count: null,
        like_count: null,
        comment_count: null,
        source: 'data_export',
      }));
    }

    // A creator-supplied Instagram export is a real reach signal — lift a bare
    // profile to the 'public' rung (sits alongside a public-fetch verification).
    if (!c.verification_tier || c.verification_tier === 'self_reported' || c.verification_tier === 'none') {
      patch.verification_tier = 'public';
      patch.verified_at = new Date().toISOString();
    }

    await db.update('creators', { id: creatorId }, patch);

    return NextResponse.json({ ok: true, summary: s });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: 'error', error: (err as Error).message }, { status: 200 });
  }
}
