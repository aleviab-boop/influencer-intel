// ============================================================
// Brand-match — "brands you should pitch". Ranks the DB's active recruitment
// programs against a creator's niche so the portal can surface warm leads,
// impact.com-marketplace style.
//
// TRANSPARENT keyword/category matching (no ML): we score each program on how
// well its brand category + name + description overlap the creator's niche and
// audience interests, and return a plain reason for each suggestion. The DB
// query (in the route) handles filtering/exclusions; the scoring here is pure.
// ============================================================

export interface ProgramCandidate {
  program_id: string;
  program_name: string;
  description: string | null;
  brand_name: string | null;
  brand_category: string | null;
}

export interface BrandMatch {
  program_id: string;
  brand_name: string;
  program_name: string;
  category: string | null;   // brand category — powers audience-fit scoring
  score: number;         // 0..100
  fit: 'strong' | 'good' | 'possible';
  reason: string;
}

// Light stopword list so generic words don't create false overlaps.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'our', 'are', 'this', 'that',
  'campaign', 'program', 'brand', 'creators', 'creator', 'influencer', 'influencers',
  'india', 'indian', 'new', 'best', 'top', 'get', 'all', 'from', 'into', 'looking',
]);

function tokens(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  const t = s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(t.filter((w) => w.length >= 3 && !STOP.has(w)));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n += 1;
  return n;
}

const fitFor = (score: number): BrandMatch['fit'] =>
  score >= 70 ? 'strong' : score >= 45 ? 'good' : 'possible';

/**
 * Rank program candidates for a creator. `niche` is the creator's primary
 * category/niche string; `interests` are extra signal words (e.g. top hashtags
 * or bio keywords) that broaden the match. Returns the top `limit`, best first.
 */
export function matchBrands(
  niche: string | null,
  interests: string[],
  candidates: ProgramCandidate[],
  limit = 6,
): BrandMatch[] {
  const nicheTokens = tokens(niche);
  const interestTokens = new Set<string>();
  for (const i of interests) for (const w of tokens(i)) interestTokens.add(w);

  const matches: BrandMatch[] = candidates.map((c) => {
    const catTokens = tokens(c.brand_category);
    const textTokens = new Set<string>([...tokens(c.program_name), ...tokens(c.description)]);

    let score = 0;
    const reasons: string[] = [];

    // Strongest signal: brand category vs creator niche.
    if (niche && c.brand_category) {
      const n = niche.toLowerCase().trim();
      const cat = c.brand_category.toLowerCase().trim();
      if (n === cat) { score += 55; reasons.push(`a ${cat} brand — your exact niche`); }
      else if (n.includes(cat) || cat.includes(n)) { score += 40; reasons.push(`in ${cat}, close to your niche`); }
      else {
        const o = overlap(nicheTokens, catTokens);
        if (o > 0) { score += Math.min(30, o * 20); reasons.push(`overlaps your ${niche} focus`); }
      }
    }

    // Niche/interest words appearing in the program copy.
    const copyOverlapNiche = overlap(nicheTokens, textTokens);
    const copyOverlapInterest = overlap(interestTokens, textTokens);
    if (copyOverlapNiche > 0) { score += Math.min(25, copyOverlapNiche * 12); reasons.push('matches the campaign brief'); }
    if (copyOverlapInterest > 0) { score += Math.min(20, copyOverlapInterest * 8); reasons.push('aligns with your content topics'); }

    // Everything active gets a small floor so we can still suggest something
    // when categories are sparse — but clearly lower down.
    score = Math.min(100, score + 8);

    const reason = reasons.length
      ? `${c.brand_name ?? 'This brand'} is ${reasons[0]}${reasons.length > 1 ? `; also ${reasons[1]}` : ''}.`
      : `${c.brand_name ?? 'This brand'} is actively recruiting creators right now.`;

    return {
      program_id: c.program_id,
      brand_name: c.brand_name ?? 'Brand',
      program_name: c.program_name,
      category: c.brand_category ?? null,
      score: Math.round(score),
      fit: fitFor(score),
      reason,
    };
  });

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
