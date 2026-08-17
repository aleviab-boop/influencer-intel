// ============================================================
// Instagram DYI data-export parser
//
// Turns a creator's own "Download your information" ZIP (JSON format) into the
// reach + posting-history signals we care about, with ZERO Meta involvement.
// Instagram's export layout drifts between versions (files move between
// `content/`, `your_instagram_activity/`, `connections/…`), so we DON'T rely on
// exact paths — we walk every JSON file in the archive and match on filename
// keywords + structural shape, with fallbacks. Everything is best-effort: a
// missing section just leaves that field null rather than failing the import.
//
// NOTE: the DYI export does NOT carry per-post engagement (likes / views), so
// this complements the login-free public fetch (which gives engagement) instead
// of replacing it. What it uniquely gives us: exact follower/following counts
// and the creator's FULL post history → real posting cadence.
// ============================================================

import JSZip from 'jszip';

export interface DataExportSummary {
  username: string | null;
  display_name: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  posts_last_30d: number | null;
  posts_last_90d: number | null;
  avg_gap_days: number | null;   // mean days between consecutive posts (recent window)
  first_post_at: string | null;  // ISO
  last_post_at: string | null;   // ISO
  imported_at: string;           // ISO
}

export interface ParsedPost {
  caption: string | null;
  posted_at: string; // ISO
}

export interface DataExportResult {
  summary: DataExportSummary;
  posts: ParsedPost[]; // newest-first, capped
}

const MAX_POSTS = 36;

// ---- small helpers -----------------------------------------------------------

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// IG stores timestamps as unix SECONDS. Guard against ms just in case.
function tsToIso(ts: unknown): string | null {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Instagram JSON exports mojibake unicode (e.g. emoji) as latin1-decoded UTF-8.
// Re-decode so captions/bios read correctly.
function fixMojibake(s: string): string {
  try {
    // Only attempt if it looks mojibaked (contains the tell-tale Â/Ã sequences).
    if (!/[\u00c2-\u00c3][\u0080-\u00bf]/.test(s)) return s;
    const bytes = Uint8Array.from(Array.from(s, (ch) => ch.charCodeAt(0) & 0xff));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return s;
  }
}

// ---- section detectors -------------------------------------------------------

// Count entries in a followers/following file. Handles both the top-level-array
// shape and the `{ relationships_following: [...] }` / `{ <key>: [...] }` object
// shape, counting the array of `string_list_data` entries.
function countRelationships(json: unknown): number {
  if (Array.isArray(json)) return json.length;
  if (isObj(json)) {
    // Find the first array-valued property (relationships_following, etc.).
    for (const v of Object.values(json)) {
      if (Array.isArray(v)) return v.length;
    }
  }
  return 0;
}

// Pull posts out of a posts_*.json file. Each entry is either a single post with
// `creation_timestamp` + `title`, or a carousel wrapper `{ media: [...], title }`
// where the post time is the earliest media timestamp.
function extractPosts(json: unknown): ParsedPost[] {
  const entries = Array.isArray(json)
    ? json
    : isObj(json)
      // Some versions wrap posts under a keyed array.
      ? (Object.values(json).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? []
      : [];

  const out: ParsedPost[] = [];
  for (const raw of entries) {
    if (!isObj(raw)) continue;

    let iso = tsToIso(raw.creation_timestamp);
    const media = asArray(raw.media);
    if (!iso && media.length > 0) {
      // Use the earliest media timestamp in the carousel.
      const times = media
        .map((m) => (isObj(m) ? tsToIso(m.creation_timestamp) : null))
        .filter((x): x is string => !!x)
        .sort();
      iso = times[0] ?? null;
    }
    if (!iso) continue;

    // Caption: post-level `title`, else first media `title`.
    let caption: string | null = typeof raw.title === 'string' && raw.title.trim() ? raw.title : null;
    if (!caption && media.length > 0 && isObj(media[0]) && typeof media[0].title === 'string' && media[0].title.trim()) {
      caption = media[0].title as string;
    }
    out.push({ caption: caption ? fixMojibake(caption).slice(0, 500) : null, posted_at: iso });
  }
  return out;
}

// Personal info: `profile_user[0].string_map_data` maps human labels → values.
function extractProfile(json: unknown): { username: string | null; name: string | null; bio: string | null } {
  const empty = { username: null, name: null, bio: null };
  const users = isObj(json) ? asArray(json.profile_user) : [];
  const first = users[0];
  if (!isObj(first)) return empty;
  const map = first.string_map_data;
  if (!isObj(map)) return empty;

  const get = (...keys: string[]): string | null => {
    for (const k of keys) {
      const cell = map[k];
      if (isObj(cell) && typeof cell.value === 'string' && cell.value.trim()) {
        return fixMojibake(cell.value).trim();
      }
    }
    return null;
  };

  return {
    username: get('Username'),
    name: get('Name'),
    bio: get('Bio', 'Biography'),
  };
}

// ---- main --------------------------------------------------------------------

/**
 * Parse an Instagram DYI export ZIP buffer into a reach + cadence summary.
 * Returns null when the archive contains none of the sections we recognise
 * (e.g. an HTML-format export, or the wrong ZIP entirely).
 */
export async function parseInstagramExport(buffer: ArrayBuffer): Promise<DataExportResult | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }

  let followers: number | null = null;
  let following: number | null = null;
  let profile = { username: null as string | null, name: null as string | null, bio: null as string | null };
  const allPosts: ParsedPost[] = [];
  let sawFollowersFile = false;

  const files = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith('.json'));

  for (const file of files) {
    const lower = file.name.toLowerCase();
    const base = lower.split('/').pop() ?? lower;

    // Cheap filename routing before we spend cycles decoding JSON.
    const isFollowers = /followers(_\d+)?\.json$/.test(base) || (base.includes('follower') && !base.includes('following'));
    const isFollowing = base === 'following.json' || base.startsWith('following');
    const isPosts = /^posts(_\d+)?\.json$/.test(base) || base === 'posts.json';
    const isProfile = base === 'personal_information.json' || base.includes('personal_information');

    if (!isFollowers && !isFollowing && !isPosts && !isProfile) continue;

    let text: string;
    try {
      text = await file.async('string');
    } catch {
      continue;
    }
    const json = safeJson(text);
    if (json === null) continue;

    if (isFollowers) {
      // followers can be split across followers_1.json, followers_2.json, …
      followers = (followers ?? 0) + countRelationships(json);
      sawFollowersFile = true;
    } else if (isFollowing) {
      following = (following ?? 0) + countRelationships(json);
    } else if (isPosts) {
      allPosts.push(...extractPosts(json));
    } else if (isProfile) {
      const p = extractProfile(json);
      profile = {
        username: p.username ?? profile.username,
        name: p.name ?? profile.name,
        bio: p.bio ?? profile.bio,
      };
    }
  }

  // If we saw nothing recognisable, treat as an unparseable export.
  if (!sawFollowersFile && following === null && allPosts.length === 0 && !profile.username) {
    return null;
  }

  // Sort posts newest-first and derive cadence.
  allPosts.sort((a, b) => b.posted_at.localeCompare(a.posted_at));
  const now = Date.now();
  const DAY = 86_400_000;
  const times = allPosts.map((p) => new Date(p.posted_at).getTime()).filter((t) => Number.isFinite(t));

  const posts_last_30d = times.length ? times.filter((t) => now - t <= 30 * DAY).length : null;
  const posts_last_90d = times.length ? times.filter((t) => now - t <= 90 * DAY).length : null;

  // Average gap over the most recent 12 posts (a stable read of current cadence).
  let avg_gap_days: number | null = null;
  const recent = times.slice(0, 12);
  if (recent.length >= 2) {
    let sum = 0;
    for (let i = 0; i < recent.length - 1; i++) sum += (recent[i]! - recent[i + 1]!);
    avg_gap_days = Math.round((sum / (recent.length - 1) / DAY) * 10) / 10;
  }

  const first_post_at = times.length ? new Date(Math.min(...times)).toISOString() : null;
  const last_post_at = times.length ? new Date(Math.max(...times)).toISOString() : null;

  const summary: DataExportSummary = {
    username: profile.username,
    display_name: profile.name,
    bio: profile.bio,
    followers,
    following,
    posts: allPosts.length || null,
    posts_last_30d,
    posts_last_90d,
    avg_gap_days,
    first_post_at,
    last_post_at,
    imported_at: new Date().toISOString(),
  };

  return { summary, posts: allPosts.slice(0, MAX_POSTS) };
}
