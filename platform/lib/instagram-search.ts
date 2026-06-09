// ============================================================
// Authenticated Instagram search via instagram-private-api. Logs in ONCE with
// a throwaway account (creds from env), caches the session to disk, and uses
// the blended top-search to find accounts for a parsed query.
//
// ⚠️ Uses a burner Instagram account + IG's private API — against IG ToS, the
// account can get challenged/banned. No proxies → throttle + reuse session.
// Dormant (returns configured:false) until IG_SCRAPER_USER/PASS are set.
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { IgApiClient } from 'instagram-private-api';
import type { ParsedQuery } from './instagram-query';

const USER = process.env.IG_SCRAPER_USER ?? '';
const PASS = process.env.IG_SCRAPER_PASS ?? '';
const SESSION_FILE = path.join(process.cwd(), '.ig-session.json');

export function isScraperConfigured(): boolean {
  return Boolean(USER && PASS);
}

export interface FoundAccount {
  handle: string;
  full_name: string | null;
  follower_count: number | null;
  profile_pic_url: string | null;
  is_verified: boolean;
  is_private: boolean;
  byline: string | null;
}

let ig: IgApiClient | null = null;
let loggedIn = false;

// Set when IG asks for a 2FA code (SMS / authenticator). Holds what
// twoFactorLogin() needs so a later code submission can finish the login.
// NOTE: "approve on another device" push 2FA cannot be satisfied here — only
// numeric SMS/TOTP codes work. For a burner, disabling 2FA is simpler.
let pendingTwoFactor: { identifier: string; method: string } | null = null;

export function isTwoFactorPending(): boolean {
  return Boolean(pendingTwoFactor);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function saveSession(client: IgApiClient): Promise<void> {
  try {
    const serialized = await client.state.serialize();
    delete (serialized as Record<string, unknown>).constants;
    await fs.writeFile(SESSION_FILE, JSON.stringify(serialized));
  } catch { /* session caching is best-effort */ }
}

async function ensureLogin(): Promise<IgApiClient> {
  if (ig && loggedIn) return ig;
  if (!isScraperConfigured()) throw new Error('not_configured');

  ig = new IgApiClient();
  ig.state.generateDevice(USER);

  // Reuse a cached session if we have one (logins are what trigger checkpoints).
  try {
    const saved = await fs.readFile(SESSION_FILE, 'utf8');
    await ig.state.deserialize(JSON.parse(saved));
    loggedIn = true;
    return ig;
  } catch { /* no cached session — log in fresh */ }

  try {
    await ig.account.login(USER, PASS);
  } catch (err) {
    const name = (err as { name?: string }).name ?? '';
    const body = (err as { response?: { body?: {
      error_type?: string;
      message?: string;
      two_factor_required?: boolean;
      two_factor_info?: { two_factor_identifier?: string; totp_two_factor_on?: boolean };
    } } }).response?.body;
    if (name.includes('TwoFactorRequired') || body?.two_factor_required) {
      const info = body?.two_factor_info;
      pendingTwoFactor = {
        identifier: info?.two_factor_identifier ?? '',
        method: info?.totp_two_factor_on ? '0' : '1', // 0 = authenticator app, 1 = SMS
      };
      throw new Error('two_factor_required');
    }
    if (name.includes('Checkpoint') || body?.message?.includes('challenge')) throw new Error('checkpoint');
    if (name.includes('BadPassword') || body?.error_type === 'bad_password') throw new Error('bad_password');
    throw new Error('login_failed');
  }
  await saveSession(ig);
  loggedIn = true;
  return ig;
}

// Finish a 2FA-gated login by submitting the 6-digit SMS/authenticator code.
// Only works after ensureLogin() has thrown 'two_factor_required' (which seeds
// pendingTwoFactor). Push "approve on another device" 2FA can't use this.
export async function submitTwoFactorCode(code: string): Promise<void> {
  if (!ig || !pendingTwoFactor) throw new Error('no_pending_2fa');
  try {
    await ig.account.twoFactorLogin({
      username: USER,
      verificationCode: code.trim(),
      twoFactorIdentifier: pendingTwoFactor.identifier,
      verificationMethod: pendingTwoFactor.method as '0' | '1',
      trustThisDevice: '1',
    });
  } catch (err) {
    const body = (err as { response?: { body?: { message?: string } } }).response?.body;
    if (body?.message?.toLowerCase().includes('invalid')) throw new Error('bad_code');
    throw new Error('two_factor_failed');
  }
  await saveSession(ig);
  loggedIn = true;
  pendingTwoFactor = null;
}

// Run the blended top-search for a few query strings and collect the accounts.
export async function searchInstagram(parsed: ParsedQuery): Promise<FoundAccount[]> {
  const client = await ensureLogin();

  // Query the raw prompt plus a couple of genre+city combinations.
  const queries = [parsed.userSearch, ...parsed.hashtags.slice(0, 3)].filter((q, i, a) => q && a.indexOf(q) === i).slice(0, 4);

  const byHandle = new Map<string, FoundAccount>();
  for (const q of queries) {
    try {
      const res = await client.fbsearch.topsearchFlat(q);
      for (const item of res.list ?? []) {
        const u = item.user;
        if (!u || !u.username) continue;
        if (!byHandle.has(u.username)) {
          byHandle.set(u.username, {
            handle: u.username,
            full_name: u.full_name || null,
            follower_count: typeof u.follower_count === 'number' ? u.follower_count : null,
            profile_pic_url: u.profile_pic_url || null,
            is_verified: !!u.is_verified,
            is_private: !!u.is_private,
            byline: u.byline || null,
          });
        }
      }
    } catch (err) {
      console.warn('[ig-search] query failed:', q, (err as Error).message);
    }
    await sleep(1500); // throttle — be gentle, no proxies
  }

  return [...byHandle.values()].sort((a, b) => (b.follower_count ?? 0) - (a.follower_count ?? 0));
}
