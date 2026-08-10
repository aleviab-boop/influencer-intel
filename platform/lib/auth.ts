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
import { logActivity } from '@/lib/activity';
import crypto from 'node:crypto';

const COOKIE_NAME = 'ii_session';
const CREATOR_COOKIE_NAME = 'ii_creator';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

interface SessionPayload {
  email: string;
  brand_id: string;
  brand_name: string;
  ig_handle: string | null;
  iat: number;
}

// A creator's session — established when they connect Instagram (OAuth). Kept in
// a SEPARATE cookie from the brand session so the two identities never collide
// and the working brand auth is untouched. `creator_id` is the source of truth;
// `handle` is carried for display + backwards-compatible query fallbacks.
export interface CreatorSession {
  creator_id: string;
  handle: string;
  ig_user_id: string | null;
  iat: number;
}

export { CREATOR_COOKIE_NAME };

function getSecret(): string {
  return process.env.SESSION_SECRET ?? 'change-me-in-prod-influencer-intel-dev';
}

// ---- password hashing (scrypt, no external dep) ----
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(computed, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const slugFor = (email: string) => email.replace(/[^a-z0-9]/g, '_');

type BrandRow = Brand & { ig_handle?: string | null; password_hash?: string | null };

function payloadFor(brand: BrandRow, email: string): SessionPayload {
  return {
    email,
    brand_id: brand.id,
    brand_name: brand.name,
    ig_handle: brand.ig_handle ?? null,
    iat: Math.floor(Date.now() / 1000),
  };
}
async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const c = await cookies();
  c.set(COOKIE_NAME, sign(payload), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
  });
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
  void logActivity({ kind: 'login', brand_id: payload.brand_id, email: payload.email, meta: { method: 'email', name: payload.brand_name } });
  return payload;
}

/**
 * Create a real account: email + password. Hashes the password, stores it on
 * the brand row, and signs the user in. Rejects if an account already exists.
 */
export async function createAccount(email: string, password: string, brandName?: string): Promise<SessionPayload> {
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) throw new Error('Enter a valid email address');
  if (!password || password.length < 4) throw new Error('Password must be at least 4 characters');
  const db = getBolticClient();
  const slug = slugFor(cleanEmail);
  const display = (brandName?.trim() || cleanEmail.split('@')[0]!.replace(/[^a-z0-9]/gi, ' ')).slice(0, 80);
  const existing = await db.query<BrandRow>(`SELECT * FROM brands WHERE slug = $1 LIMIT 1`, [slug]);
  let brand = existing[0];
  const password_hash = hashPassword(password);
  if (brand) {
    if (brand.password_hash) throw new Error('An account with this email already exists — please log in.');
    await db.query(`UPDATE brands SET password_hash = $1, name = $2, updated_at = NOW() WHERE id = $3`, [password_hash, display, brand.id]);
    brand.name = display;
  } else {
    brand = await db.insert<BrandRow>('brands', {
      name: display,
      slug,
      category: null,
      plan: 'design_partner',
      research_quota_used: 0,
      research_quota_max: 50,
      onboarded_at: new Date().toISOString(),
      password_hash,
    });
  }
  const payload = payloadFor(brand, cleanEmail);
  await setSessionCookie(payload);
  void logActivity({ kind: 'signup', brand_id: payload.brand_id, email: payload.email, meta: { method: 'password', name: payload.brand_name } });
  return payload;
}

/**
 * Sign in with email + password, verifying against the stored hash.
 */
export async function signInWithPassword(email: string, password: string, name?: string): Promise<SessionPayload> {
  const cleanEmail = email.trim().toLowerCase();
  const db = getBolticClient();
  const rows = await db.query<BrandRow>(`SELECT * FROM brands WHERE slug = $1 LIMIT 1`, [slugFor(cleanEmail)]);
  const brand = rows[0];
  if (!brand || !brand.password_hash) throw new Error('No account found for this email — create one first.');
  if (!verifyPassword(password, brand.password_hash)) throw new Error('Incorrect email or password.');
  // Optional: let the user attach/refresh their display name at login. Handy for
  // demo/shared accounts that never set one — it then shows in the admin Metrics
  // logins feed. Only overwrite when a non-empty, changed name is supplied.
  const cleanName = name?.trim().slice(0, 80);
  if (cleanName && cleanName !== brand.name) {
    await db.query(`UPDATE brands SET name = $1, updated_at = NOW() WHERE id = $2`, [cleanName, brand.id]);
    brand.name = cleanName;
  }
  const payload = payloadFor(brand, cleanEmail);
  await setSessionCookie(payload);
  void logActivity({ kind: 'login', brand_id: payload.brand_id, email: payload.email, meta: { method: 'password', name: payload.brand_name } });
  return payload;
}

export async function signOut(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

// ---- creator session (Instagram-login) ----------------------------------
// Signed the same way as the brand session (HMAC-SHA256 over base64url JSON),
// just a different payload + cookie name.

function signCreator(payload: CreatorSession): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyCreator(token: string | undefined): CreatorSession | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CreatorSession;
  } catch {
    return null;
  }
}

/** Read the current creator session from cookies. Null if unauthenticated. */
export async function getCreatorSession(): Promise<CreatorSession | null> {
  const c = await cookies();
  return verifyCreator(c.get(CREATOR_COOKIE_NAME)?.value);
}

/** Mint a signed creator-session token (pure — caller decides where to set it). */
export function mintCreatorSessionToken(input: Omit<CreatorSession, 'iat'>): string {
  return signCreator({ ...input, iat: Math.floor(Date.now() / 1000) });
}

/**
 * Cookie descriptor for a creator session — name/value/options. Returned rather
 * than set directly so a route handler can attach it to a redirect NextResponse
 * (the reliable pattern when the same response also redirects).
 */
export function buildCreatorSessionCookie(input: Omit<CreatorSession, 'iat'>): {
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: 'lax'; path: string; secure: boolean; maxAge: number };
} {
  return {
    name: CREATOR_COOKIE_NAME,
    value: mintCreatorSessionToken(input),
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: COOKIE_MAX_AGE,
    },
  };
}

/** Set the creator session cookie directly (non-redirect contexts). */
export async function setCreatorSession(input: Omit<CreatorSession, 'iat'>): Promise<void> {
  const { name, value, options } = buildCreatorSessionCookie(input);
  const c = await cookies();
  c.set(name, value, options);
}

export async function signOutCreator(): Promise<void> {
  const c = await cookies();
  c.delete(CREATOR_COOKIE_NAME);
}
