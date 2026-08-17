import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { resolveCreatorId } from '@/lib/creator-identity';

export const runtime = 'nodejs';
export const maxDuration = 25;

interface CreatorRow {
  id: string;
  verification_tier: string | null;
}

// Accepted screenshot formats and the inline-storage cap. We keep the image as a
// base64 data-URL (no object storage in this app), so the cap is deliberately
// tight — an Insights screenshot is a phone screen, not a photo library.
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB of raw image → ~4 MB base64

// data:image/png;base64,AAAA...  → { mime, bytes }
function inspectDataUrl(dataUrl: string): { mime: string; bytes: number } | null {
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m || !m[1] || !m[2]) return null;
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  // base64 → byte length without decoding the whole thing
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - padding;
  return { mime, bytes };
}

/**
 * POST /api/creator/profile/insights-proof
 *
 * The 'screenshot' rung of the no-Meta verification ladder. The creator uploads
 * an Instagram Insights screenshot; we store it inline (base64 data-URL — this
 * app has no object storage) as proof and stamp verification_tier = 'screenshot',
 * a step above the login-free public auto-fill. Never downgrades a live OAuth
 * connection. Body: { image: "data:image/png;base64,..." }. Always 200 on the
 * happy path; 400 only for a malformed/oversized upload.
 *
 * Returns { ok, verified, tier?, reason? }.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ ok: false, reason: 'no_creator' }, { status: 200 });

    const body = (await request.json().catch(() => null)) as { image?: unknown } | null;
    const image = typeof body?.image === 'string' ? body.image : '';
    if (!image) return NextResponse.json({ ok: false, reason: 'no_image' }, { status: 400 });

    const meta = inspectDataUrl(image);
    if (!meta || !ALLOWED_MIME.has(meta.mime)) {
      return NextResponse.json({ ok: false, reason: 'bad_format' }, { status: 400 });
    }
    if (meta.bytes > MAX_BYTES) {
      return NextResponse.json({ ok: false, reason: 'too_large' }, { status: 400 });
    }

    const [c] = await db.query<CreatorRow>(
      `SELECT id, verification_tier FROM creators WHERE id = $1 LIMIT 1`,
      [creatorId],
    );
    if (!c) return NextResponse.json({ ok: false, reason: 'no_creator' }, { status: 200 });

    // Latest upload wins — one proof row per creator.
    await db.query(
      `INSERT INTO creator_insight_proofs (creator_id, image_data, mime_type, byte_size, status, uploaded_at, reviewed_at, note)
       VALUES ($1, $2, $3, $4, 'submitted', now(), NULL, NULL)
       ON CONFLICT (creator_id) DO UPDATE SET
         image_data = EXCLUDED.image_data,
         mime_type = EXCLUDED.mime_type,
         byte_size = EXCLUDED.byte_size,
         status = 'submitted',
         uploaded_at = now(),
         reviewed_at = NULL,
         note = NULL`,
      [creatorId, image, meta.mime, meta.bytes],
    );

    // Bump the trust rung. Never downgrade a live OAuth connection.
    const keepStronger = c.verification_tier === 'oauth';
    await db.update(
      'creators',
      { id: creatorId },
      {
        ...(keepStronger ? {} : { verification_tier: 'screenshot' }),
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    );

    return NextResponse.json({
      ok: true,
      verified: true,
      tier: keepStronger ? c.verification_tier : 'screenshot',
    });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
