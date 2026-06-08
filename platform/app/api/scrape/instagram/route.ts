import { NextRequest, NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { fetchInstagramProfile } from '@/lib/instagram-scraper';

export const runtime = 'nodejs';

// GET /api/scrape/instagram?handle=foo[&save=1]
// Scrapes a public Instagram profile (free, no login) and optionally upserts
// it into the creators database.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const handle = (url.searchParams.get('handle') ?? '').trim();
  const save = url.searchParams.get('save') === '1';
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });

  let profile;
  try {
    profile = await fetchInstagramProfile(handle);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === 'not_found' ? 404 : msg === 'blocked' ? 429 : 502;
    const friendly = msg === 'not_found' ? 'Profile not found or is private.'
      : msg === 'blocked' ? 'Instagram is rate-limiting this server right now — try again in a bit.'
      : 'Couldn’t reach Instagram. Try again.';
    return NextResponse.json({ error: friendly }, { status });
  }

  if (!save) return NextResponse.json({ profile });

  // upsert into creators (insert new, or refresh an existing manual/scraped row)
  try {
    const db = getBolticClient();
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM creators WHERE platform='instagram' AND LOWER(handle)=LOWER($1) LIMIT 1`,
      [profile.handle],
    );
    const fields = {
      display_name: profile.display_name,
      bio: profile.biography,
      profile_photo_url: profile.profile_photo_url,
      primary_category: profile.category,
      follower_count: profile.follower_count,
      following_count: profile.following_count,
      posts_count: profile.posts_count,
      avg_likes: profile.avg_likes,
      avg_comments: profile.avg_comments,
      engagement_rate: profile.engagement_rate,
      is_verified: profile.is_verified,
      recent_posts: JSON.stringify(profile.recent_posts),
      data_tier: 'tier_a',
      source: 'scrape',
      last_scraped_at: new Date().toISOString(),
    };
    if (existing[0]) {
      await db.update('creators', { id: existing[0].id }, fields);
      return NextResponse.json({ profile, saved: 'updated' });
    }
    await db.insert('creators', {
      platform: 'instagram',
      handle: profile.handle,
      profile_url: `https://www.instagram.com/${profile.handle}/`,
      is_active: true,
      is_indian: true,
      ...fields,
    });
    return NextResponse.json({ profile, saved: 'created' });
  } catch (err) {
    console.error('[scrape] save failed:', err);
    return NextResponse.json({ profile, error: 'scraped but failed to save: ' + (err as Error).message }, { status: 200 });
  }
}
