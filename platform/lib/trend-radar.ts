// ============================================================
// AI "trend radar" — specific consumer trends paired with the marketing category
// they're breaking in (e.g. "polka dot → Fashion", "matcha → Food & Beverage",
// "modak → Festivals"), for the public "What's trending" board.
//
// Spend discipline: the underlying pull is ONE web-search OpenAI call. To keep
// the public /trending page free of per-visit spend, the result is CACHED in
// system_config and served cache-first. It's refreshed on a schedule (the daily
// trends-refresh cron) plus a single lazy fill on a cold cache — so at most ~one
// OpenAI call per day, never one per page load. No Apify, no web_profile_info.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient, type TrendRadarItem } from '@influencer-intel/shared/llm';

const RADAR_KEY = 'ai_trend_radar';           // system_config key holding the JSON snapshot
const TTL_MINUTES = 12 * 60;                   // a snapshot older than this is "stale"

export interface TrendRadar {
  items: TrendRadarItem[];
  generated_at: string | null; // ISO of the cached snapshot
  minutes_old: number | null;  // age of the snapshot (null if never generated)
  stale: boolean;              // true if empty or past the TTL
}

async function readConfig(key: string): Promise<string | null> {
  try {
    const rows = await getBolticClient().query<{ value: string | null }>(
      `SELECT value FROM system_config WHERE key = $1`,
      [key],
    );
    return rows[0]?.value?.trim() || null;
  } catch {
    return null;
  }
}

async function writeConfig(key: string, value: string): Promise<void> {
  try {
    await getBolticClient().query(
      `INSERT INTO system_config (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, value],
    );
  } catch {
    /* best-effort — a failed cache write must never break the caller */
  }
}

// Read the cached radar. Read-only, no spend. Reports the snapshot's age and
// whether it's past the TTL so the cron can decide to refresh.
export async function readTrendRadar(): Promise<TrendRadar> {
  const raw = await readConfig(RADAR_KEY);
  if (!raw) return { items: [], generated_at: null, minutes_old: null, stale: true };
  try {
    const parsed = JSON.parse(raw) as { generated_at?: string; items?: TrendRadarItem[] };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const gen = parsed.generated_at ?? null;
    const minutesOld = gen
      ? Math.max(0, Math.round((Date.now() - new Date(gen).getTime()) / 60_000))
      : null;
    return {
      items,
      generated_at: gen,
      minutes_old: minutesOld,
      stale: minutesOld == null || minutesOld >= TTL_MINUTES,
    };
  } catch {
    return { items: [], generated_at: null, minutes_old: null, stale: true };
  }
}

// Regenerate via ONE web-search OpenAI call and cache it. This is the only place
// that spends an OpenAI call for the radar. Best-effort: on failure (or an empty
// result) it leaves the existing cache untouched and returns the old snapshot, so
// a hiccup never wipes a good board with nothing.
export async function refreshTrendRadar(max = 12): Promise<TrendRadar> {
  let items: TrendRadarItem[] = [];
  try {
    items = await getOpenAIClient().suggestTrendRadar(max);
  } catch {
    items = [];
  }
  if (items.length === 0) return readTrendRadar(); // keep whatever good cache exists
  const payload = { generated_at: new Date().toISOString(), items };
  await writeConfig(RADAR_KEY, JSON.stringify(payload));
  return { items, generated_at: payload.generated_at, minutes_old: 0, stale: false };
}

// Serve the radar for the page: cache-first, with a single lazy fill on a COLD
// cache (first ever call) so the board isn't empty before the first cron run. A
// warm-but-stale cache is served as-is — the daily cron refreshes it — so the
// public page never triggers per-visit OpenAI spend.
export async function getTrendRadar(): Promise<TrendRadar> {
  const cached = await readTrendRadar();
  if (cached.items.length > 0) return cached;
  return refreshTrendRadar();
}
