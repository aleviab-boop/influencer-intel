import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import { verifyPhylloWebhook, fetchAccount, fetchProfile } from '@/lib/phyllo-connector';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Phyllo / InsightIQ webhook receiver.
//
// Phyllo POSTs events as the creator moves through the Connect flow. We care
// about account connect/disconnect: on connect we pull the normalised profile
// and fold real Instagram reach into the creator row (and mark the connector
// 'connected'); on disconnect we mark it so trust degrades gracefully.
// Signature is HMAC-SHA256 over the raw body (PHYLLO_WEBHOOK_SECRET).

interface PhylloEvent {
  event?: string; // 'ACCOUNTS.CONNECTED' | 'ACCOUNTS.DISCONNECTED' | 'PROFILES.ADDED' | …
  data?: {
    account_id?: string;
    user_id?: string;
    [k: string]: unknown;
  };
}

async function foldConnected(accountId: string): Promise<void> {
  const db = getBolticClient();

  // Which of our creators owns this connector? (recorded at init via provider_user_id)
  const account = await fetchAccount(accountId).catch(() => null);
  if (!account) return;

  const providerUserId = account.user?.id ?? null;
  const [conn] = await db.query<{ id: string; creator_id: string }>(
    `SELECT id, creator_id FROM creator_connectors
      WHERE provider = 'phyllo' AND provider_user_id = $1
      ORDER BY updated_at DESC LIMIT 1`,
    [providerUserId],
  );
  if (!conn) return;

  const profile = await fetchProfile(accountId).catch(() => null);
  const followers = Number(profile?.reputation?.follower_count) || 0;

  // Upsert the connector to 'connected' with the concrete account + platform.
  await db.query(
    `UPDATE creator_connectors
        SET provider_account_id = $2,
            work_platform       = $3,
            username            = $4,
            status              = 'connected',
            raw                 = $5,
            connected_at        = COALESCE(connected_at, NOW()),
            last_sync_at        = NOW(),
            updated_at          = NOW()
      WHERE id = $1`,
    [
      conn.id,
      accountId,
      (account.work_platform?.name ?? 'instagram').toLowerCase(),
      profile?.platform_username ?? account.username ?? null,
      JSON.stringify({ account, profile }),
    ],
  );

  // Fold real reach into the creator. This is live platform data via a reviewed
  // aggregator — the top verification rung, so lift the tier accordingly.
  const patch: Record<string, unknown> = {
    verification_tier: 'oauth',
    verified_at: new Date().toISOString(),
    data_tier: 'tier_a',
    updated_at: new Date().toISOString(),
  };
  if (followers > 0) patch.follower_count = followers;
  const following = Number(profile?.reputation?.following_count) || 0;
  const posts = Number(profile?.reputation?.content_count) || 0;
  if (following > 0) patch.following_count = following;
  if (posts > 0) patch.posts_count = posts;
  if (profile?.full_name) patch.display_name = profile.full_name;
  if (profile?.introduction) patch.bio = profile.introduction;
  if (profile?.image_url) patch.profile_photo_url = profile.image_url;
  if (typeof profile?.is_verified === 'boolean') patch.is_verified = profile.is_verified;

  await db.update('creators', { id: conn.creator_id }, patch);
}

async function markDisconnected(accountId: string): Promise<void> {
  const db = getBolticClient();
  await db.query(
    `UPDATE creator_connectors
        SET status = 'disconnected', updated_at = NOW()
      WHERE provider = 'phyllo' AND provider_account_id = $1`,
    [accountId],
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const raw = await request.text();
  const signature = request.headers.get('phyllo-signature') ?? request.headers.get('x-phyllo-signature');

  if (!verifyPhylloWebhook(raw, signature)) {
    // Reject forged / misconfigured calls. 401 so Phyllo retries after config.
    return NextResponse.json({ ok: false, reason: 'bad_signature' }, { status: 401 });
  }

  let event: PhylloEvent;
  try {
    event = JSON.parse(raw) as PhylloEvent;
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 200 });
  }

  const name = (event.event ?? '').toUpperCase();
  const accountId = event.data?.account_id ?? '';

  try {
    if (accountId && (name === 'ACCOUNTS.CONNECTED' || name === 'PROFILES.ADDED' || name === 'PROFILES.AUDIENCE.ADDED')) {
      await foldConnected(accountId);
    } else if (accountId && name === 'ACCOUNTS.DISCONNECTED') {
      await markDisconnected(accountId);
    }
  } catch (err) {
    // Ack anyway (200) so Phyllo doesn't hammer retries; we reconcile internally.
    console.error('[webhooks/phyllo] handler error:', (err as Error).message);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
