// ============================================================
// Trend quality — read-side filtering + ranking for the brand-facing trends
// surfaces ("Trending in your space", campaign trend-grounding).
//
// trend_signals is derived from raw crawl captions, so it carries a lot of
// engagement-bait, geo and personal/brand-handle hashtags that are technically
// "trending" by count but tell a brand nothing about what to make. And because a
// brand-new tag has an empty prior window, its velocity ≈ its raw count (~9), so
// ordering by velocity alone floods the top with obscure count-9 tags above
// genuinely large trends. This module drops the junk and ranks by real volume.
// ============================================================

// Generic engagement-bait, platform, geo and filler hashtags. Matched against
// the identifier (lowercased, no leading '#'). Deliberately conservative — real
// niche signals like "fitness", "skincare", "stripes", "gymgirl" are kept.
const JUNK_HASHTAGS = new Set<string>([
  // engagement bait / reach hacking
  'trend', 'trends', 'trending', 'trendingnow', 'trendingreels', 'viral', 'viralpost',
  'viralvideo', 'viralvideos', 'viralreels', 'viralreel', 'goviral', 'reels', 'reel',
  'reelitfeelit', 'reelsinstagram', 'reelsindia', 'reelkarofeelkaro', 'reelsvideo',
  'explore', 'explorepage', 'explored', 'exploremore', 'instagram', 'insta', 'instagood',
  'instadaily', 'instalike', 'instamood', 'instapic', 'igers', 'igdaily', 'love', 'like',
  'likes', 'likeforlike', 'likeforlikes', 'like4like', 'l4l', 'follow', 'followme',
  'follow4follow', 'followforfollow', 'f4f', 'photooftheday', 'picoftheday', 'bhfyp',
  'fyp', 'foryou', 'foryoupage', 'video', 'videos', 'post', 'posts', 'dailypost',
  'share', 'shared', 'repost', 'viralpost2024', 'trend2024', 'trend2025',
  // generic geo / nationality (a place is not a content trend)
  'india', 'indian', 'bharat', 'incredibleindia', 'mumbai', 'delhi', 'newdelhi',
  'bangalore', 'bengaluru', 'kolkata', 'chennai', 'hyderabad', 'pune', 'jaipur',
  'ahmedabad', 'chandigarh', 'lucknow', 'punjabi', 'world', 'worldwide', 'usa', 'uk',
  'dubai', 'kabul', 'unitednations',
  // Tier-2/3 Indian cities & regions — still just a place, not a content trend
  'indore', 'surat', 'nagpur', 'kanpur', 'patna', 'bhopal', 'coimbatore', 'kochi',
  'goa', 'gurgaon', 'gurugram', 'noida', 'thane', 'nashik', 'vadodara', 'rajkot',
  'ludhiana', 'agra', 'varanasi', 'kerala', 'punjab', 'gujarat', 'rajasthan',
  'maharashtra', 'karnataka', 'assam', 'bihar', 'odisha', 'guwahati', 'ranchi',
  // ultra-generic nouns / filler
  'women', 'woman', 'men', 'man', 'girl', 'girls', 'boy', 'boys', 'people', 'life',
  'mood', 'happy', 'happiness', 'funny', 'comedy', 'memes', 'meme', 'relationships',
  'relationship', 'motivation', 'bossbabe', 'goals', 'vibes', 'vibe', 'daily', 'new',
]);

/** Row shape the quality checks need (a subset of TrendSignal). */
export interface TrendQualityRow {
  trend_type: string;
  identifier?: string | null;
  display_name?: string | null;
}

/**
 * True when a trend row is worth showing a brand. Non-hashtag trends (formats,
 * visual motifs) are always kept. Hashtags are dropped when they're too short,
 * contain non-ASCII letters (near-always foreign-language spam on an India-only
 * platform), or match the generic engagement-bait / geo / filler stoplist.
 */
export function isMeaningfulTrend(row: TrendQualityRow): boolean {
  if (row.trend_type !== 'hashtag') return true;
  const raw = String(row.identifier ?? row.display_name ?? '')
    .toLowerCase()
    .replace(/^#+/, '')
    .trim();
  if (raw.length < 3) return false;
  if (/[^\x00-\x7f]/.test(raw)) return false; // foreign-script spam
  if (JUNK_HASHTAGS.has(raw)) return false;
  return true;
}

/**
 * Comparator that ranks trends by real volume (usage in the last 7 days) first,
 * then by momentum. On the current corpus every fresh tag gets velocity ≈ its
 * count (empty prior window), so pure-velocity ordering surfaces obscure count-9
 * tags; volume-first puts the genuinely large, on-trend hashtags at the top.
 */
export function byTrendRelevance(
  a: { usage_count_7d: number | string; velocity: number | string },
  b: { usage_count_7d: number | string; velocity: number | string },
): number {
  const ua = Number(a.usage_count_7d) || 0;
  const ub = Number(b.usage_count_7d) || 0;
  if (ub !== ua) return ub - ua;
  return (Number(b.velocity) || 0) - (Number(a.velocity) || 0);
}
