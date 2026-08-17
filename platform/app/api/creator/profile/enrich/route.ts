import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { resolveCreatorId } from '@/lib/creator-identity';

export const runtime = 'nodejs';
export const maxDuration = 25;

interface CreatorRow {
  id: string;
  handle: string | null;
  follower_count: number | string | null;
  verification_tier: string | null;
}

// The public-profile response shape we consume from /api/ig-profile (login-free
// web_profile_info fetch). We only need the headline reach numbers here.
interface PublicProfile {
  followers?: number;
  engagement?: number | null;
  full_name?: string;
  source?: string; // 'live' | 'db' | 'pending'
}

/**
 * POST /api/creator/profile/enrich?handle=|account=
 *
 * Self-serve verification WITHOUT the Meta App Review gate: pulls the creator's
 * own PUBLIC Instagram profile via the existing login-free fetch (web_profile_info
 * through /api/ig-profile — no OAuth, no Graph API, no review), which persists
 * the fresh follower count / engagement / bio / photo back onto the creators row.
 * On a live hit we stamp verification_tier = 'public' so the profile carries a
 * trust signal a brand can see. Always 200.
 *
 * Returns { ok, verified, tier?, followers?, engagement?, reason? }.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const creatorId = await resolveCreatorId(request);
    if (!creatorId) return NextResponse.json({ ok: false, reason: 'no_creator' }, { status: 200 });

    const [c] = await db.query<CreatorRow>(
      `SELECT id, handle, follower_count, verification_tier
       FROM creators WHERE id = $1 LIMIT 1`,
      [creatorId],
    );
    if (!c) return NextResponse.json({ ok: false, reason: 'no_creator' }, { status: 200 });

    const handle = (c.handle ?? '').trim().replace(/^@/, '');
    if (!/^[a-z0-9._]{1,30}$/i.test(handle)) {
      return NextResponse.json({ ok: false, reason: 'no_handle' }, { status: 200 });
    }

    // Reuse the shared login-free profile fetch. Same-origin so it works in every
    // environment; that endpoint already persists the fresh numbers by handle.
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

    const followers = Number(profile?.followers) || 0;
    const live = profile?.source === 'live' && followers > 0;

    if (!live) {
      // Couldn't reach Instagram (relay down / throttled / private / bad handle).
      // Leave any prior tier untouched — the creator can retry or enter manually.
      return NextResponse.json(
        { ok: false, reason: 'fetch_failed', source: profile?.source ?? 'unavailable' },
        { status: 200 },
      );
    }

    // Public data landed and was persisted by /api/ig-profile. Record the trust
    // rung + when we last confirmed it. Never downgrade a stronger existing tier.
    const keepStronger = c.verification_tier === 'oauth' || c.verification_tier === 'screenshot';
    await db.update(
      'creators',
      { id: creatorId },
      {
        ...(keepStronger ? {} : { verification_tier: 'public' }),
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    );

    return NextResponse.json({
      ok: true,
      verified: true,
      tier: keepStronger ? c.verification_tier : 'public',
      followers,
      engagement: profile?.engagement ?? null,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: 'db_error', error: (err as Error).message }, { status: 200 });
  }
}
