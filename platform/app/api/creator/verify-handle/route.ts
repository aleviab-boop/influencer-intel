import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { resolveCreatorId } from '@/lib/creator-identity';

export const runtime = 'nodejs';
export const maxDuration = 25;

interface CreatorRow {
  id: string;
  handle: string | null;
  handle_challenge_code: string | null;
  handle_verified_at: string | null;
  verification_tier: string | null;
}

interface PublicProfile {
  biography?: string;
  source?: string; // 'live' | 'db' | 'pending'
}

// A short, unambiguous code the creator pastes into their bio. Base32-ish
// (no 0/1/O/I) so it's easy to copy without confusion.
function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `icmp-${s}`;
}

// Strip everything but letters/digits and lowercase, so bio formatting (spaces,
// emoji, line breaks around the code) never defeats the match.
const canon = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function loadCreator(db: ReturnType<typeof getBolticClient>, id: string) {
  const [c] = await db.query<CreatorRow>(
    `SELECT id, handle, handle_challenge_code, handle_verified_at, verification_tier
       FROM creators WHERE id = $1 LIMIT 1`,
    [id],
  );
  return c ?? null;
}

const handleOk = (h: string): boolean => /^[a-z0-9._]{1,30}$/i.test(h);

/**
 * GET /api/creator/verify-handle?handle=|account=
 *
 * Issue (or return) the bio-code challenge for the logged-in creator. Proves
 * handle ownership with zero Meta involvement: they add this code to their
 * public Instagram bio, then POST to confirm. Always 200.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });
    const c = await loadCreator(db, creatorId);
    if (!c) return NextResponse.json({ available: false, reason: 'no_creator' }, { status: 200 });

    const handle = (c.handle ?? '').trim().replace(/^@/, '');
    let code = c.handle_challenge_code;
    if (!code) {
      code = newCode();
      await db.update('creators', { id: creatorId }, { handle_challenge_code: code, updated_at: new Date().toISOString() });
    }

    return NextResponse.json({
      available: true,
      handle: handle || null,
      code,
      verified: !!c.handle_verified_at,
      verified_at: c.handle_verified_at,
    });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'error', error: (err as Error).message }, { status: 200 });
  }
}

/**
 * POST /api/creator/verify-handle?handle=|account=
 *
 * Confirm the challenge: re-read the creator's PUBLIC profile (login-free) and
 * check their bio contains the issued code. On a match we stamp
 * handle_verified_at and, if they weren't already at a stronger rung, lift
 * verification_tier to 'public'. Requires a LIVE read — a cached/stale bio
 * can't confirm a code they just added. Always 200.
 *
 * Returns { ok, verified, reason? }.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ ok: false, reason: 'no_creator' }, { status: 200 });
    const c = await loadCreator(db, creatorId);
    if (!c) return NextResponse.json({ ok: false, reason: 'no_creator' }, { status: 200 });

    const handle = (c.handle ?? '').trim().replace(/^@/, '');
    if (!handleOk(handle)) return NextResponse.json({ ok: false, reason: 'no_handle' }, { status: 200 });

    // Ensure a code exists (in case POST is hit before GET).
    let code = c.handle_challenge_code;
    if (!code) {
      code = newCode();
      await db.update('creators', { id: creatorId }, { handle_challenge_code: code, updated_at: new Date().toISOString() });
    }

    // Live public read — a cached bio can't prove a just-added code.
    const origin = new URL(request.url).origin;
    let profile: PublicProfile | null = null;
    try {
      const res = await fetch(`${origin}/api/ig-profile?handle=${encodeURIComponent(handle)}`, {
        headers: { accept: 'application/json' },
      });
      if (res.ok) profile = (await res.json()) as PublicProfile;
    } catch {
      profile = null;
    }

    if (profile?.source !== 'live') {
      return NextResponse.json({ ok: false, reason: 'fetch_failed', source: profile?.source ?? 'unavailable' }, { status: 200 });
    }

    const found = canon(profile.biography ?? '').includes(canon(code));
    if (!found) {
      return NextResponse.json({ ok: false, reason: 'code_not_found' }, { status: 200 });
    }

    const bumpTier = !c.verification_tier || c.verification_tier === 'self_reported';
    await db.update(
      'creators',
      { id: creatorId },
      {
        handle_verified_at: new Date().toISOString(),
        ...(bumpTier ? { verification_tier: 'public', verified_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      },
    );

    return NextResponse.json({ ok: true, verified: true });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: 'error', error: (err as Error).message }, { status: 200 });
  }
}
