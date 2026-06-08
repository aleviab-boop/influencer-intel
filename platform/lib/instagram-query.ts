// ============================================================
// Prompt tokenizer for Instagram discovery. Turns a natural-language query
// like "fashion nagpur" into structured search queries (location + genre +
// hashtags + a user-search string) — pure logic, no network, no creds.
// The authenticated search layer (instagram-private-api) consumes this.
// ============================================================

// Major Indian cities (lowercase) used to pull a location out of the prompt.
const CITIES = [
  'new delhi', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'hyderabad', 'ahmedabad', 'chennai',
  'kolkata', 'surat', 'pune', 'jaipur', 'lucknow', 'kanpur', 'nagpur', 'indore', 'thane', 'bhopal',
  'visakhapatnam', 'patna', 'vadodara', 'ghaziabad', 'ludhiana', 'agra', 'nashik', 'ranchi', 'faridabad',
  'meerut', 'rajkot', 'varanasi', 'srinagar', 'amritsar', 'prayagraj', 'coimbatore', 'jodhpur',
  'guwahati', 'chandigarh', 'mysore', 'mysuru', 'goa', 'kochi', 'cochin', 'trivandrum', 'shillong',
  'dehradun', 'noida', 'gurgaon', 'gurugram', 'udaipur',
];

// Common creator genres → also used to build hashtags.
const GENRES = [
  'fashion', 'beauty', 'makeup', 'skincare', 'lifestyle', 'fitness', 'gym', 'travel', 'food', 'foodie',
  'comedy', 'dance', 'music', 'art', 'photography', 'tech', 'gaming', 'finance', 'education',
  'wedding', 'bridal', 'parenting', 'mom', 'pets', 'auto', 'cars', 'bikes', 'wellness', 'yoga', 'vlog',
  'streetwear', 'thrift', 'home', 'decor', 'business', 'startup', 'motivation', 'books', 'reading',
];

const STOP = new Set(['in', 'on', 'the', 'a', 'an', 'of', 'and', 'for', 'creators', 'creator', 'influencers', 'influencer', 'from', 'near', 'around', 'based']);

export interface ParsedQuery {
  raw: string;
  location: string | null;   // detected city
  genres: string[];          // detected genres
  keywords: string[];        // remaining meaningful tokens
  hashtags: string[];        // hashtags to search
  userSearch: string;        // string for IG user search
}

export function parseInstagramQuery(prompt: string): ParsedQuery {
  const raw = prompt.trim();
  const lower = raw.toLowerCase();
  const tokens = lower.split(/[\s,]+/).filter((t) => t && !STOP.has(t));

  // location — prefer a two-word city ("new delhi") then single tokens
  let location: string | null = null;
  for (const c of CITIES.filter((c) => c.includes(' '))) {
    if (lower.includes(c)) { location = c; break; }
  }
  if (!location) location = tokens.find((t) => CITIES.includes(t)) ?? null;

  const genres = tokens.filter((t) => GENRES.includes(t));
  const locTokens = new Set((location ?? '').split(' '));
  const keywords = tokens.filter((t) => !locTokens.has(t) && !genres.includes(t));

  // Build hashtags: genre+city combos, plain genres, genre+india, and bare keywords.
  const cityTag = location ? location.replace(/\s+/g, '') : null;
  const hashtags = new Set<string>();
  for (const g of genres.length ? genres : keywords) {
    hashtags.add(g);
    if (cityTag) { hashtags.add(`${g}${cityTag}`); hashtags.add(`${cityTag}${g}`); }
    hashtags.add(`${g}india`);
  }
  if (cityTag && genres.length === 0 && keywords.length === 0) hashtags.add(cityTag);

  return {
    raw,
    location,
    genres,
    keywords,
    hashtags: [...hashtags].slice(0, 8),
    userSearch: raw,
  };
}
