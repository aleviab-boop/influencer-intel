// Client-side prompt autocomplete. As the user types a place/word, suggest
// "<text> + category" combos (e.g. "bombay fashion") or complete a half-typed
// category. Instagram's own search is login-walled, so this is intentionally
// local and instant.

export const SUGGEST_CATEGORIES = [
  'fashion', 'food', 'travel', 'beauty', 'fitness', 'lifestyle', 'photography',
  'streetwear', 'cafe', 'jewellery', 'wedding', 'comedy', 'vlogs', 'art',
  'music', 'dance', 'beach', 'tech', 'gaming', 'skincare',
];

export function buildSuggestions(input: string): string[] {
  const q = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [];
  const tokens = q.split(' ');
  const last = tokens[tokens.length - 1]!;

  // Already formed "<place> <category>" → nothing useful to add.
  if (tokens.length >= 2 && SUGGEST_CATEGORIES.includes(last)) return [];

  // Half-typed category → complete it (e.g. "bombay fa" → "bombay fashion").
  const completions = SUGGEST_CATEGORIES.filter((c) => c.startsWith(last) && c !== last).map(
    (c) => [...tokens.slice(0, -1), c].join(' '),
  );
  if (completions.length > 0) {
    return Array.from(new Set(completions)).slice(0, 7);
  }

  // Otherwise append categories (e.g. "bombay" → "bombay fashion", "bombay food").
  return SUGGEST_CATEGORIES.filter((c) => !tokens.includes(c))
    .map((c) => `${q} ${c}`)
    .slice(0, 7);
}
