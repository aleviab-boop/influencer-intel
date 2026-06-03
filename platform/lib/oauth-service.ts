import { getBolticClient } from '@influencer-intel/shared/db';
import { IGGraphClient } from '@influencer-intel/shared/ig-graph';
import type { ConnectedAccount, Creator } from '@influencer-intel/shared/types';

const IG_APP_ID = process.env.IG_APP_ID ?? '';
const IG_APP_SECRET = process.env.IG_APP_SECRET ?? '';
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI ?? 'http://localhost:3000/api/oauth/instagram/callback';

const OAUTH_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
].join(',');

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: IG_APP_ID,
    redirect_uri: IG_REDIRECT_URI,
    scope: OAUTH_SCOPES,
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

export async function handleOAuthCallback(
  code: string,
  state: string,
): Promise<ConnectedAccount> {
  const db = getBolticClient();

  const shortToken = await IGGraphClient.exchangeCodeForToken(code, IG_APP_ID, IG_APP_SECRET, IG_REDIRECT_URI);
  const longToken = await IGGraphClient.exchangeForLongLived(shortToken.access_token, IG_APP_SECRET);
  const client = new IGGraphClient(longToken.access_token);
  const profile = await client.getProfile();

  const creators = await db.query<Creator>(
    `SELECT * FROM creators WHERE platform = 'instagram' AND handle = $1 LIMIT 1`,
    [profile.username],
  );

  let creator: Creator;
  if (creators.length === 0) {
    creator = await db.insert<Creator>('creators', {
      platform: 'instagram',
      handle: profile.username,
      profile_url: `https://www.instagram.com/${profile.username}/`,
      display_name: profile.name ?? null,
      bio: profile.biography ?? null,
      profile_photo_url: profile.profile_picture_url ?? null,
      is_verified: false,
      follower_count: profile.followers_count ?? null,
      following_count: profile.follows_count ?? null,
      posts_count: profile.media_count ?? null,
      is_active: true,
      data_tier: 'tier_a',
    });
  } else {
    creator = creators[0]!;
    await db.update<Creator>('creators', { id: creator.id }, {
      data_tier: 'tier_a',
      follower_count: profile.followers_count ?? creator.follower_count,
      display_name: profile.name ?? creator.display_name,
    });
  }

  let brandId: string | null = null;
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
    brandId = parsed.brand_id ?? null;
  } catch { /* optional */ }

  const expiresAt = new Date(Date.now() + longToken.expires_in * 1000).toISOString();

  return db.upsert<ConnectedAccount>('connected_accounts', {
    creator_id: creator.id,
    brand_id: brandId,
    ig_user_id: profile.id,
    ig_username: profile.username,
    access_token_encrypted: longToken.access_token,
    token_expires_at: expiresAt,
    scopes: OAUTH_SCOPES.split(','),
    connection_status: 'active',
    last_sync_status: 'pending',
    updated_at: new Date().toISOString(),
  }, ['ig_user_id']);
}
