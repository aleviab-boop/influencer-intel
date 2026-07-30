import { NextRequest, NextResponse } from 'next/server';
import { apifyProfile } from '@/lib/apify';
import { resolveHashtagToSeeds, hashtagCandidates } from '@/lib/live-discovery';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/apify-health
//   Diagnostics for the Apify paid fallback. Three modes:
//
//   (default, FREE — no credit)
//     /api/apify-health
//       configured — is APIFY_TOKEN set in this deploy's env?
//       valid      — does that token authenticate? (free users/me probe)
//       account    — the Apify username the token belongs to
//
//   (?profile=<handle>  — SPENDS a little credit, runs the profile actor)
//       Exercises the REAL apifyProfile() the fetch fallback uses and returns the
//       mapped ScrapedProfile fields, proving enrichment works end-to-end.
//
//   (?hashtag=<prompt>  — SPENDS a little credit, runs the hashtag actor)
//       Exercises the REAL resolveHashtagToSeeds() the cold-prompt discovery
//       fallback uses and returns the seed handles it found.
export async function GET(req: NextRequest) {
  const token = process.env.APIFY_TOKEN?.trim();
  const { searchParams } = new URL(req.url);
  const profile = searchParams.get('profile');
  const hashtag = searchParams.get('hashtag');

  if (!token) return NextResponse.json({ configured: false, valid: false });

  // --- Test mode: run the profile actor (paid) ---------------------------
  if (profile) {
    try {
      const p = await apifyProfile(profile);
      return NextResponse.json({
        ok: true,
        source: 'apify-profile-scraper',
        profile: {
          handle: p.handle,
          display_name: p.display_name,
          follower_count: p.follower_count,
          engagement_rate: p.engagement_rate,
          category: p.category,
          posts_sampled: p.recent_posts.length,
        },
      });
    } catch (err) {
      return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
    }
  }

  // --- Test mode: run the hashtag actor (paid) ---------------------------
  if (hashtag) {
    try {
      const seeds = await resolveHashtagToSeeds(hashtag);
      return NextResponse.json({
        ok: true,
        source: 'apify-hashtag-scraper',
        hashtags_tried: hashtagCandidates(hashtag).slice(0, 2),
        seed_count: seeds.length,
        proven_collaborators: seeds.filter((s) => s.collab_signal).length,
        seeds: seeds.map((s) => ({
          handle: s.handle,
          followers: s.followers,
          collab_signal: !!s.collab_signal,
        })),
      });
    } catch (err) {
      return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
    }
  }

  // --- Default: free config/auth check -----------------------------------
  try {
    const res = await fetch(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ configured: true, valid: false, code: res.status });
    const d = (await res.json()) as { data?: { username?: string } };
    return NextResponse.json({ configured: true, valid: true, account: d?.data?.username ?? null });
  } catch {
    return NextResponse.json({ configured: true, valid: false, error: 'probe_failed' });
  }
}
