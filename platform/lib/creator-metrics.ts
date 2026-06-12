// Pure creator-metric helpers (no React) — shared by the profile snapshot and
// the self-serve media kit. All derived from a public profile + recent posts.

export interface RecentPost {
  likes: number;
  comments: number;
  taken_at?: number | null;
  caption?: string;
}

export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function inr(n: number): string {
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(n >= 10_00_000 ? 0 : 1)}L`;
  if (n >= 1_000) return `₹${Math.round(n / 1_000)}K`;
  return `₹${Math.round(n / 100) * 100}`;
}

export function expectedErFloor(followers: number): number {
  if (followers >= 1_000_000) return 0.7;
  if (followers >= 100_000) return 1.0;
  if (followers >= 10_000) return 1.5;
  return 2.0;
}

export function engagementRate(recent: RecentPost[], followers: number): number | null {
  if (followers <= 0 || recent.length === 0) return null;
  const total = recent.reduce((s, p) => s + p.likes + p.comments, 0);
  return Math.round((total / recent.length / followers) * 1000) / 10;
}

export function estimatedRate(followers: number, engagement: number | null): { low: number; high: number } | null {
  if (followers < 500) return null;
  const per1k =
    followers >= 500_000 ? [300, 600]
    : followers >= 100_000 ? [400, 750]
    : followers >= 50_000 ? [500, 900]
    : [600, 1100];
  const floor = expectedErFloor(followers);
  const factor = engagement == null ? 1 : engagement >= floor * 1.5 ? 1.25 : engagement >= floor ? 1.1 : 0.8;
  const k = followers / 1000;
  return { low: Math.round(k * per1k[0]! * factor), high: Math.round(k * per1k[1]! * factor) };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function postingInsight(recent: RecentPost[]): { cadence: string; bestDay: string; bestWindow: string } | null {
  const ts = recent.filter((p) => p.taken_at && p.taken_at > 0);
  if (ts.length < 3) return null;
  const times = ts.map((p) => p.taken_at!).sort((a, b) => b - a);
  const spanDays = (times[0]! - times[times.length - 1]!) / 86_400;
  const perWeek = spanDays > 0 ? (times.length - 1) / (spanDays / 7) : 0;
  const cadence =
    perWeek >= 6 ? 'Posts daily'
    : perWeek >= 1 ? `~${Math.round(perWeek)}× / week`
    : `~${Math.max(1, Math.round(perWeek * 4))}× / month`;
  const dayEng = new Array(7).fill(0);
  const hourEng = new Array(24).fill(0);
  for (const p of ts) {
    const d = new Date((p.taken_at! + 5.5 * 3600) * 1000);
    const eng = p.likes + p.comments;
    dayEng[d.getUTCDay()] += eng;
    hourEng[d.getUTCHours()] += eng;
  }
  const bestHour = hourEng.indexOf(Math.max(...hourEng));
  const fmtHr = (h: number) => {
    const hh = (h + 24) % 24;
    const ap = hh < 12 ? 'am' : 'pm';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}${ap}`;
  };
  return {
    cadence,
    bestDay: DAYS[dayEng.indexOf(Math.max(...dayEng))]!,
    bestWindow: `${fmtHr(bestHour - 1)}–${fmtHr(bestHour + 2)} IST`,
  };
}

export function contentThemes(recent: RecentPost[], limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const p of recent) {
    for (const raw of p.caption?.match(/#[\p{L}\p{N}_]+/gu) ?? []) {
      const tag = raw.toLowerCase();
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

export function tierWord(f: number): string {
  return f >= 1_000_000 ? 'Mega' : f >= 500_000 ? 'Macro' : f >= 100_000 ? 'Mid-tier' : f >= 10_000 ? 'Micro' : 'Nano';
}

// Brand-safety scan: keyword-match recent captions + bio against categories
// brands typically screen for. Conservative word-boundary matching to limit
// false positives. High-risk categories escalate to a "flag", others "review".
const RISK_TERMS: Record<string, string[]> = {
  Profanity: ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'chutiya', 'bhenchod', 'madarchod', 'randi'],
  'Alcohol/Drugs': ['vodka', 'whisky', 'whiskey', 'tequila', 'cocaine', 'weed', 'marijuana', 'ganja', 'stoned', 'lsd', 'mdma'],
  Tobacco: ['cigarette', 'cigarettes', 'vape', 'vaping', 'hookah', 'tobacco', 'cigar'],
  Gambling: ['casino', 'betting', 'gambling', 'satta', 'teenpatti', 'rummy', 'bet365', 'dream11'],
  Politics: ['election', 'bjp', 'congress', 'protest', 'rally', 'vote for'],
  Adult: ['nsfw', 'onlyfans', 'porn', 'xxx', 'escort'],
};
const HIGH_RISK = new Set(['Profanity', 'Adult', 'Alcohol/Drugs']);

export function brandSafety(texts: string[]): {
  level: 'clean' | 'review' | 'flag';
  hits: { category: string; terms: string[] }[];
} {
  const hay = ` ${texts.join('  ').toLowerCase()} `;
  const hits: { category: string; terms: string[] }[] = [];
  for (const [category, words] of Object.entries(RISK_TERMS)) {
    const terms = words.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/ /g, '[^a-z]+')}([^a-z]|$)`, 'i').test(hay));
    if (terms.length) hits.push({ category, terms });
  }
  if (hits.length === 0) return { level: 'clean', hits };
  return { level: hits.some((h) => HIGH_RISK.has(h.category)) ? 'flag' : 'review', hits };
}
