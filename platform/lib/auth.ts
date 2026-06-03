// ============================================================
// Lightweight email-based session auth.
//
// MVP: a signed cookie holds the user's email + brand_id. No password,
// no magic-link yet — design-partner-grade. We isolate briefs/creators
// by brand so two users on different brands don't see each other's data.
//
// To upgrade to magic-link / OAuth later: keep this signature shape,
// just swap how the cookie is minted.
// ============================================================

import { cookies } from 'next/headers';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { Brand } from '@influencer-intel/shared/types';
import crypto from 'node:crypto';

const COOKIE_NAME = 'ii_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

interface SessionPayload {
  email: string;
  brand_id: string;
  brand_name: string;
  ig_handle: string | null;
  iat: number;
}

function getSecret(): string {
  return process.env.SESSION_SECRET ?? 'change-me-in-prod-influencer-intel-dev';
}

function sign(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token: string): SessionPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Read the current session from cookies. Returns null if unauthenticated.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verify(token);
}

/**
 * Create or fetch the brand row for an email, then mint a session cookie.
 * Convention: brand_name = email's local part (e.g. "shyam@gofynd.com" → "Shyam").
 */
export async function signIn(email: string, brandName?: string, igHandle?: string): Promise<SessionPayload> {
  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Invalid email address');
  }
  const db = getBolticClient();
  // Use email as a deterministic slug.
  const slug = cleanEmail.replace(/[^a-z0-9]/g, '_');
  const display = brandName ?? cleanEmail.split('@')[0]!.replace(/[^a-z0-9]/gi, ' ');

  const cleanHandle = igHandle?.trim().replace(/^@/, '') || null;

  const existing = await db.query<Brand & { ig_handle?: string }>(`SELECT * FROM brands WHERE slug = $1 LIMIT 1`, [slug]);
  let brand = existing[0];
  if (!brand) {
    brand = await db.insert<Brand & { ig_handle?: string }>('brands', {
      name: display,
      slug,
      category: null,
      ig_handle: cleanHandle,
      plan: 'design_partner',
      research_quota_used: 0,
      research_quota_max: 50,
      onboarded_at: new Date().toISOString(),
    });
  } else if (cleanHandle && brand.ig_handle !== cleanHandle) {
    await db.query(`UPDATE brands SET ig_handle = $1, updated_at = NOW() WHERE id = $2`, [cleanHandle, brand.id]);
    brand.ig_handle = cleanHandle;
  }

  const payload: SessionPayload = {
    email: cleanEmail,
    brand_id: brand.id,
    brand_name: brand.name,
    ig_handle: brand.ig_handle ?? null,
    iat: Math.floor(Date.now() / 1000),
  };
  const token = sign(payload);
  const c = await cookies();
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
  });
  return payload;
}

export async function signOut(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}
