// ============================================================
// Distribution signals — likes and comments are vanity-adjacent; the actions
// that actually tell Instagram to PUSH a post into more feeds and Explore are
// saves and shares. They signal "this was worth keeping / worth sending to a
// friend", and the algorithm treats them as the strongest intent. This pulls the
// per-post save and share counts (from media insights) and reframes them as
// rates a creator can act on: saves and shares per 1,000 accounts reached, plus
// a "per 100 likes+comments" framing for when reach isn't available. It names the
// stronger of the two signals and points at the content lever that moves it.
//
// Pure and deterministic: plain rates over the saved/shares/reach fields the
// route already fetched from insights. No ML, no LLM. Falls silent when the
// insight fields aren't populated (older posts / limited API scope). The tier
// thresholds are rough platform norms, labelled directional.
// ============================================================

export interface SignalPost {
  saved: number | null;
  shares: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
}

export interface SignalMetric {
  key: 'saves' | 'shares';
  label: string;
  avg_per_post: number | null;
  rate_per_1k_reach: number | null;      // primary when reach is present
  per_100_interactions: number | null;   // fallback framing (per 100 likes+comments)
  tier: 'strong' | 'solid' | 'low' | null;
  sample: number;                         // posts with this metric present
}

export interface DistributionSignals {
  available: boolean;
  sample_size: number;
  saves: SignalMetric | null;
  shares: SignalMetric | null;
  strongest: 'saves' | 'shares' | null;
  headline: string | null;
  tip: string | null;
}

const MIN_SAMPLE = 4;   // posts with a given signal before we report it

// Rough Instagram norms, expressed per 1,000 accounts reached.
const SAVE_TIERS = { strong: 20, solid: 8 };    // ≥2% / ≥0.8% of reach saving
const SHARE_TIERS = { strong: 10, solid: 3 };   // ≥1% / ≥0.3% of reach sharing

const mean = (n: number[]): number | null => (n.length ? n.reduce((s, v) => s + v, 0) / n.length : null);

function tierFor(ratePer1k: number | null, t: { strong: number; solid: number }): SignalMetric['tier'] {
  if (ratePer1k == null) return null;
  return ratePer1k >= t.strong ? 'strong' : ratePer1k >= t.solid ? 'solid' : 'low';
}

function buildMetric(
  key: 'saves' | 'shares',
  label: string,
  posts: SignalPost[],
  pick: (p: SignalPost) => number | null,
  tiers: { strong: number; solid: number },
): SignalMetric | null {
  const withMetric = posts.filter((p) => {
    const v = Number(pick(p));
    return Number.isFinite(v) && v >= 0;
  });
  if (withMetric.length < MIN_SAMPLE) return null;

  const counts = withMetric.map((p) => Number(pick(p)));
  const avg = mean(counts);

  // Rate per 1,000 reach — only over posts that have BOTH the metric and reach.
  const withReach = withMetric.filter((p) => Number.isFinite(Number(p.reach)) && Number(p.reach) > 0);
  const ratePer1k = withReach.length >= MIN_SAMPLE
    ? (mean(withReach.map((p) => (Number(pick(p)) / Number(p.reach)) * 1000)) ?? null)
    : null;

  // Fallback framing: per 100 (likes + comments), always computable here.
  const withInteractions = withMetric.filter((p) => {
    const i = Number(p.likes ?? 0) + Number(p.comments ?? 0);
    return i > 0;
  });
  const per100 = withInteractions.length
    ? (mean(withInteractions.map((p) => (Number(pick(p)) / (Number(p.likes ?? 0) + Number(p.comments ?? 0))) * 100)) ?? null)
    : null;

  return {
    key,
    label,
    avg_per_post: avg != null ? Math.round(avg) : null,
    rate_per_1k_reach: ratePer1k != null ? Math.round(ratePer1k * 10) / 10 : null,
    per_100_interactions: per100 != null ? Math.round(per100 * 10) / 10 : null,
    tier: tierFor(ratePer1k, tiers),
    sample: withMetric.length,
  };
}

export function analyzeDistributionSignals(posts: SignalPost[]): DistributionSignals {
  const empty: DistributionSignals = {
    available: false, sample_size: posts.length, saves: null, shares: null,
    strongest: null, headline: null, tip: null,
  };

  const saves = buildMetric('saves', 'Saves', posts, (p) => p.saved, SAVE_TIERS);
  const shares = buildMetric('shares', 'Shares', posts, (p) => p.shares, SHARE_TIERS);
  if (!saves && !shares) return empty;

  // Pick the standout signal by tier, then by rate.
  const rank = (m: SignalMetric | null): number => {
    if (!m) return -1;
    const tierScore = m.tier === 'strong' ? 2 : m.tier === 'solid' ? 1 : 0;
    return tierScore * 1000 + (m.rate_per_1k_reach ?? m.per_100_interactions ?? 0);
  };
  const strongest: DistributionSignals['strongest'] =
    rank(saves) >= rank(shares) ? (saves ? 'saves' : shares ? 'shares' : null)
      : (shares ? 'shares' : 'saves');

  const std = strongest === 'saves' ? saves : shares;
  const rateStr = (m: SignalMetric | null): string | null =>
    m == null ? null
      : m.rate_per_1k_reach != null ? `${m.rate_per_1k_reach} per 1k reached`
        : m.per_100_interactions != null ? `${m.per_100_interactions} per 100 likes+comments`
          : m.avg_per_post != null ? `${m.avg_per_post} per post` : null;

  const strongTierCopy: Record<NonNullable<SignalMetric['tier']>, string> = {
    strong: 'well above what most posts earn — Instagram is getting a strong "push this" signal',
    solid: 'a healthy signal that helps distribution',
    low: 'on the light side, so posts lean on likes for reach',
  };
  const tierClause = std?.tier ? ` — ${strongTierCopy[std.tier]}` : '';
  const headline = std
    ? `${std.label} are your strongest distribution signal (${rateStr(std)})${tierClause}.`
    : 'Save and share data is coming through — here is how your content is travelling.';

  const tip = strongest === 'saves'
    ? 'Saves come from reference-worthy posts — checklists, how-tos, "swipe to save this", strong carousels. Add an explicit "save this for later" to your best educational posts.'
    : 'Shares come from relatable or useful-to-a-friend posts. Add a soft "send this to someone who needs it" and make the first frame screenshot-worthy.';

  return {
    available: true,
    sample_size: posts.length,
    saves,
    shares,
    strongest,
    headline,
    tip,
  };
}
