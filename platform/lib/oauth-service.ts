import { getBolticClient } from '@influencer-intel/shared/db';
import { IGGraphClient } from '@influencer-intel/shared/ig-graph';
import type { ConnectedAccount, Creator } from '@influencer-intel/shared/types';

const IG_APP_ID = process.env.IG_APP_ID ?? '';
const IG_APP_SECRET = process.env.IG_APP_SECRET ?? '';
const IG_REDIRECT_URI =
  process.env.IG_REDIRECT_URI ?? 'http://localhost:3030/api/oauth/instagram/callback';

// "Instagram API with Instagram Login" scopes. The token exchange + Graph
// client (shared/ig-graph) already target this flow (api.instagram.com +
// graph.instagram.com + ig_exchange_token), so the authorize step must too —
// NOT the Facebook-Login (facebook.com/dialog/oauth + pages_* scopes) product.
const OAUTH_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_insights',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
].join(',');

const IG_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';

/** True when the IG app credentials + redirect are all configured. */
export function isOAuthConfigured(): boolean {
  return Boolean(IG_APP_ID && IG_APP_SECRET && IG_REDIRECT_URI);
}

export function oauthConfigStatus(): {
  configured: boolean;
  has_app_id: boolean;
  has_app_secret: boolean;
  redirect_uri: string;
  scopes: string;
} {
  return {
    configured: isOAuthConfigured(),
    has_app_id: Boolean(IG_APP_ID),
    has_app_secret: Boolean(IG_APP_SECRET),
    redirect_uri: IG_REDIRECT_URI,
    scopes: OAUTH_SCOPES,
  };
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: IG_APP_ID,
    redirect_uri: IG_REDIRECT_URI,
    scope: OAUTH_SCOPES,
    response_type: 'code',
    state,
  });
  return `${IG_AUTHORIZE_URL}?${params}`;
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

  // Store the token ENCRYPTED AT REST via boltic_encrypt() (bytea column).
  // Raw SQL because the generic client helper can't wrap a value in a SQL
  // function, and `scopes` is a real text[] column. The token is never
  // returned to the caller (redacted in RETURNING).
  const rows = await db.query<ConnectedAccount>(
    `INSERT INTO connected_accounts
       (creator_id, brand_id, ig_user_id, ig_username, access_token_encrypted,
        token_expires_at, scopes, connection_status, last_sync_status, updated_at)
     VALUES ($1, $2, $3, $4, boltic_encrypt($5), $6, $7::text[], 'active', 'pending', NOW())
     ON CONFLICT (ig_user_id) DO UPDATE SET
       creator_id             = EXCLUDED.creator_id,
       brand_id               = EXCLUDED.brand_id,
       ig_username            = EXCLUDED.ig_username,
       access_token_encrypted = boltic_encrypt($5),
       token_expires_at       = EXCLUDED.token_expires_at,
       scopes                 = EXCLUDED.scopes,
       connection_status      = 'active',
       last_sync_status       = 'pending',
       updated_at             = NOW()
     RETURNING id, creator_id, brand_id, ig_user_id, ig_username,
               token_expires_at, scopes, connection_status, last_sync_status,
               posts_synced_count, last_sync_at, sync_error, connected_at, updated_at,
               ''::text AS access_token_encrypted`,
    [creator.id, brandId, profile.id, profile.username, longToken.access_token, expiresAt, OAUTH_SCOPES.split(',')],
  );
  return rows[0]!;
}

/** Fetch + decrypt a connected account's IG access token for Graph API calls. */
export async function getAccessToken(accountId: string): Promise<string> {
  const db = getBolticClient();
  const rows = await db.query<{ token: string }>(
    `SELECT boltic_decrypt(access_token_encrypted) AS token
     FROM connected_accounts WHERE id = $1`,
    [accountId],
  );
  const token = rows[0]?.token;
  if (!token) throw new Error(`No access token for connected account ${accountId}`);
  return token;
}
