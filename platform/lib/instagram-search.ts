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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    if (name.includes('Checkpoint')) throw new Error('checkpoint');
    throw new Error('login_failed');
  }
  try {
    const serialized = await ig.state.serialize();
    delete (serialized as Record<string, unknown>).constants;
    await fs.writeFile(SESSION_FILE, JSON.stringify(serialized));
  } catch { /* session caching is best-effort */ }
  loggedIn = true;
  return ig;
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
