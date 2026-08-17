// ============================================================
// Phyllo / InsightIQ connector — env-gated scaffold
//
// Phyllo (rebranded InsightIQ) is a creator-data aggregator. The creator links
// their Instagram through Phyllo's Connect SDK; Phyllo — which carries its OWN
// platform app review — then exposes normalised profile / audience / content
// data over a REST API. So this gives us real, verified Instagram metrics
// WITHOUT our own Meta App Review as the gate.
//
// This whole module is DORMANT until the env keys are set, so it ships safely
// behind a flag:
//   PHYLLO_CLIENT_ID       — API client id
//   PHYLLO_CLIENT_SECRET   — API client secret (Basic auth)
//   PHYLLO_ENV             — 'sandbox' | 'staging' | 'production' (default sandbox)
//   PHYLLO_WEBHOOK_SECRET  — HMAC secret for webhook signature verification
//
// Every network call throws a clear "not configured" error when the keys are
// absent; callers translate that into a graceful "coming soon" for the UI.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

const CLIENT_ID = process.env.PHYLLO_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.PHYLLO_CLIENT_SECRET ?? '';
const ENV = (process.env.PHYLLO_ENV ?? 'sandbox').toLowerCase();
const WEBHOOK_SECRET = process.env.PHYLLO_WEBHOOK_SECRET ?? '';

const BASE_BY_ENV: Record<string, string> = {
  sandbox: 'https://api.sandbox.getphyllo.com',
  staging: 'https://api.staging.getphyllo.com',
  production: 'https://api.getphyllo.com',
};

// Phyllo's stable work-platform UUID for Instagram (same across environments).
export const INSTAGRAM_WORK_PLATFORM_ID = '9bb8913b-ddd9-430b-a66a-d74d846e6c66';

export function isPhylloConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export interface PhylloStatus {
  configured: boolean;
  env: string;
  work_platform_id: string;
}

export function phylloStatus(): PhylloStatus {
  return { configured: isPhylloConfigured(), env: ENV, work_platform_id: INSTAGRAM_WORK_PLATFORM_ID };
}

function baseUrl(): string {
  return BASE_BY_ENV[ENV] ?? BASE_BY_ENV.sandbox!;
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

async function phylloFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isPhylloConfigured()) throw new Error('phyllo_not_configured');
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`phyllo_${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ── users + SDK token ────────────────────────────────────────────────────────

interface PhylloUser { id: string; name: string; external_id: string }

/**
 * Create (or return) a Phyllo user for this creator. `external_id` is our own
 * creator id so we can correlate webhooks back. Phyllo 409s on a duplicate
 * external_id; we surface the existing id in that case.
 */
export async function ensurePhylloUser(creatorId: string, name: string): Promise<PhylloUser> {
  try {
    return await phylloFetch<PhylloUser>('/v1/users', {
      method: 'POST',
      body: JSON.stringify({ name: name || `creator-${creatorId.slice(0, 8)}`, external_id: creatorId }),
    });
  } catch (err) {
    // On a duplicate external_id, look the user up rather than failing the flow.
    if ((err as Error).message.startsWith('phyllo_409')) {
      const list = await phylloFetch<{ data: PhylloUser[] }>(
        `/v1/users?external_id=${encodeURIComponent(creatorId)}&limit=1`,
      );
      const existing = list.data?.[0];
      if (existing) return existing;
    }
    throw err;
  }
}

interface SDKToken { sdk_token: string; expires_at: string }

/** Mint a short-lived SDK token the frontend Connect widget consumes. */
export async function createSDKToken(userId: string): Promise<SDKToken> {
  return phylloFetch<SDKToken>('/v1/sdk-tokens', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      products: ['IDENTITY', 'IDENTITY.AUDIENCE', 'ENGAGEMENT', 'ENGAGEMENT.AUDIENCE'],
    }),
  });
}

// ── data pulls (used by the webhook once an account connects) ────────────────

export interface PhylloAccount {
  id: string;
  user: { id: string };
  work_platform: { id: string; name: string };
  username?: string;
  status?: string;
}

export interface PhylloProfile {
  platform_username?: string;
  full_name?: string;
  introduction?: string;
  image_url?: string;
  is_verified?: boolean;
  reputation?: { follower_count?: number; following_count?: number; content_count?: number };
}

export async function fetchAccount(accountId: string): Promise<PhylloAccount> {
  return phylloFetch<PhylloAccount>(`/v1/accounts/${encodeURIComponent(accountId)}`);
}

export async function fetchProfile(accountId: string): Promise<PhylloProfile | null> {
  const r = await phylloFetch<{ data?: PhylloProfile[] }>(
    `/v1/profiles?account_id=${encodeURIComponent(accountId)}&limit=1`,
  );
  return r.data?.[0] ?? null;
}

// ── webhook verification ─────────────────────────────────────────────────────

/**
 * Verify a Phyllo webhook signature (HMAC-SHA256 of the raw body, hex). Returns
 * false on any missing/mismatched signature so the route can reject. Constant-time.
 */
export function verifyPhylloWebhook(rawBody: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  try {
    const expected = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest();
    const given = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  } catch {
    return false;
  }
}
