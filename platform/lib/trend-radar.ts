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
import type { TrendSignal } from '@influencer-intel/shared/types';
import { isMeaningfulTrend, byTrendRelevance, cleanTrendCategories } from './trend-quality';

const RADAR_KEY = 'ai_trend_radar';           // system_config key holding the JSON snapshot
const TTL_MINUTES = 12 * 60;                   // a snapshot older than this is "stale"
const RADAR_TARGET = 12;                        // how many cards we want the board to show
const PER_CATEGORY_CAP = 2;                     // don't let any one category flood the mix

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

// Map a first-party trend signal's messy `categories[]` to ONE clean marketing
// bucket for the radar. cleanTrendCategories already strips hashtags/handles/
// junk; we then match the first survivor to a known consumer bucket (so "beauty"
// → "Beauty", "food" → "Food & Beverage"), Title-casing anything unmatched.
const CATEGORY_BUCKETS: Array<[RegExp, string]> = [
  [/fashion|apparel|style|outfit|ootd|wear|footwear|accessor|co-?ord|dress|saree|sari|kurta|lehenga|ethnic|denim|streetwear|cottagecore|aesthetic|y2k|old ?money|quiet ?luxury|shirt|jeans|jacket|blazer|trouser|cargo|oversized|jumpsuit/, 'Fashion'],
  [/beauty|makeup|skincare|grooming|hair|nails?|sunscreen|spf|fragrance|perfume|lipstick|lip ?liner|lip ?gloss|mascara|kajal/, 'Beauty'],
  [/food|beverage|drink|recipe|cook|snack|coffee|cafe|vegan|gluten|keto|matcha|dessert|baking|makhana/, 'Food & Beverage'],
  [/fitness|gym|workout|yoga|running|hyrox|pilates|crossfit|marathon/, 'Fitness'],
  [/wellness|health|mindful|selfcare|self-care|meditation|ayurved/, 'Wellness'],
  [/travel|wanderlust|trip|vacation|tourism|trek|getaway|staycation|hidden gem/, 'Travel'],
  [/home|decor|interior|furniture|garden|kitchen/, 'Home & Decor'],
  [/entertainment|music|film|movie|ott|series|dance|cinematic|edit\b/, 'Entertainment'],
  [/festival|wedding|festive|bridal/, 'Festivals'],
  [/tech|gadget|smartphone|device|wearable|gaming/, 'Tech'],
];

// Map a signal to ONE bucket: match the identifier first (most specific), then
// each clean category in order — the FIRST that maps to a known bucket wins, so
// "#skincare" with categories [beauty, …, fashion] correctly reads Beauty, not
// Fashion. If nothing maps confidently we return 'Lifestyle' rather than leak a
// raw category value (which can be a creator handle or a non-consumer label).
function matchBucket(s: string): string | null {
  for (const [re, label] of CATEGORY_BUCKETS) if (re.test(s)) return label;
  return null;
}

function bucketFor(signal: TrendSignal): string {
  const byId = matchBucket((signal.identifier ?? '').toLowerCase());
  if (byId) return byId;
  for (const cat of cleanTrendCategories(signal.categories)) {
    const m = matchBucket(cat.toLowerCase());
    if (m) return m;
  }
  return 'Lifestyle';
}

// A short "why it's moving" note from the signal's phase + real 7-day volume.
function signalNote(signal: TrendSignal): string {
  const phase = signal.phase.charAt(0).toUpperCase() + signal.phase.slice(1);
  const n = Number(signal.usage_count_7d) || 0;
  return n > 0 ? `${phase} · ${n} posts/wk across creators` : `${phase} across creators`;
}

// Backfill the radar with our OWN first-party crawl signals so the board is
// always full (a thin AI run can return only ~6). Pure DB read — no OpenAI, no
// Apify. Respects the same per-category cap as the AI items and dedupes against
// them, and tags each `origin:'creators'` so the UI can badge it distinctly (an
// IG hashtag is not a sourced news trend, so we never pass it off as one).
async function backfillFromTrendSignals(
  existing: TrendRadarItem[],
  target: number,
): Promise<TrendRadarItem[]> {
  if (existing.length >= target) return existing;
  let rows: TrendSignal[] = [];
  try {
    // topic/visual/format only — these are clean aesthetic/format/caption trends
    // ("Cottagecore", "Bridal Makeup", "Carousels") that read as real "item →
    // category" cards. Raw hashtags are left to their own dedicated column below.
    rows = await getBolticClient().query<TrendSignal>(
      `SELECT * FROM trend_signals
       WHERE trend_type IN ('topic','visual','format')
       ORDER BY usage_count_7d DESC, velocity DESC
       LIMIT 200`,
    );
  } catch {
    return existing; // DB hiccup — just serve the AI items we already have
  }

  // Per-category counts already used by the AI items, so the blended board still
  // honours the cap across BOTH sources.
  const perCat = new Map<string, number>();
  const seenItems = new Set<string>();
  for (const it of existing) {
    seenItems.add(it.item.toLowerCase());
    const k = it.category.toLowerCase();
    perCat.set(k, (perCat.get(k) ?? 0) + 1);
  }

  const out = [...existing];
  const candidates = rows.filter(isMeaningfulTrend).sort(byTrendRelevance);
  for (const sig of candidates) {
    if (out.length >= target) break;
    const item = (sig.display_name || sig.identifier || '').trim();
    if (!item || item.length > 60) continue;
    const key = item.toLowerCase();
    if (seenItems.has(key)) continue;
    const category = bucketFor(sig);
    const catKey = category.toLowerCase();
    if ((perCat.get(catKey) ?? 0) >= PER_CATEGORY_CAP) continue;
    seenItems.add(key);
    perCat.set(catKey, (perCat.get(catKey) ?? 0) + 1);
    out.push({ item, category, note: signalNote(sig), source: 'Creators we track', origin: 'creators' });
  }
  return out;
}

// Serve the radar for the page: cache-first for the AI-sourced items (with a
// single lazy fill on a COLD cache so the board isn't empty before the first
// cron run), then TOP UP from our first-party trend_signals so the board is
// always full — at zero extra spend. A warm-but-stale AI cache is served as-is;
// the daily cron refreshes it, so the public page never triggers OpenAI spend.
export async function getTrendRadar(): Promise<TrendRadar> {
  const cached = await readTrendRadar();
  const base = cached.items.length > 0 ? cached : await refreshTrendRadar();
  const items = await backfillFromTrendSignals(base.items, RADAR_TARGET);
  return { ...base, items };
}
