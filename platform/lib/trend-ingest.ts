// ============================================================
// Trend ingestion — fills `trend_signals` from our OWN crawl data.
//
// Every creator row carries `recent_posts` (JSONB RecentPost[]) with a caption,
// posted_at and post_type. This walks those posts over a rolling window and
// derives which HASHTAGS and content FORMATS are gaining or losing momentum,
// then upserts them into trend_signals so /api/trends, the prediction engine
// and the brand campaign-ideas feature all read real, first-party trends.
//
// First-party only, derived from our own crawl: hashtag + format (plus visual
// and topic when those passes are enabled). Idempotent — upserts on
// (trend_type, identifier); first_seen_at is preserved across runs.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import type { RecentPost } from '@influencer-intel/shared/types';

export interface TrendIngestReport {
  creators_scanned: number;   // creators whose posts we read this run
  posts_scanned: number;      // posts inside the 2×window range
  hashtags_tracked: number;   // distinct hashtags that cleared the threshold
  formats_tracked: number;    // distinct post formats
  visual_tracked: number;     // distinct visual motifs (only when withVisual)
  topics_tracked: number;     // distinct caption topics (only when withTopics)
  posts_visually_tagged: number; // post images sent to the vision model this run
  posts_topically_tagged: number; // captions sent to the topic model this run
  signals_upserted: number;   // rows written to trend_signals
  window_days: number;        // the current-vs-prior comparison window
}

// Split an array into fixed-size chunks (batching DB param lists + vision calls).
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// "pastel palette" -> "Pastel Palette" for a readable trend display_name.
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface CreatorRow {
  id: string;
  primary_category: string | null;
  genre: string | null;
  niche: string | null;
  recent_posts: RecentPost[] | null;
}

// Rolling accumulator for one trend identifier across all creators/posts.
interface Bucket {
  display_name: string;
  count_current: number; // posts in the current window (0..windowDays)
  count_prior: number;   // posts in the prior window (windowDays..2×windowDays)
  count_24h: number;     // posts in the last 24h (subset of current)
  categories: Set<string>;
}

const HASHTAG_RE = /#([\p{L}0-9_]{2,60})/gu;
const MS_PER_DAY = 86_400_000;

// First-party FASHION-MOTIF lexicon. Patterns/prints + a few named aesthetics we
// mine straight from post CAPTIONS (no images, no vision cost), so the "Visual
// aesthetics" board shows real momentum even before post thumbnails are
// backfilled. The optional vision pass (withVisual) augments the SAME buckets
// when thumbnails exist, so text + image signal combine into one trend.
const MOTIF_LEXICON: { id: string; label: string; re: RegExp }[] = [
  { id: 'polka dots', label: 'Polka dots', re: /polka[\s-]?dots?/i },
  { id: 'stripes', label: 'Stripes', re: /\bstripe[sd]?\b|\bpinstripe|\bbreton\b/i },
  { id: 'floral print', label: 'Floral print', re: /\bfloral[s]?\b/i },
  { id: 'checks', label: 'Checks', re: /\bcheck(?:s|ed|ered)?\b/i },
  { id: 'gingham', label: 'Gingham', re: /\bgingham\b/i },
  { id: 'plaid', label: 'Plaid / tartan', re: /\bplaid\b|\btartan\b/i },
  { id: 'houndstooth', label: 'Houndstooth', re: /\bhoundstooth\b/i },
  { id: 'paisley', label: 'Paisley', re: /\bpaisley\b/i },
  { id: 'animal print', label: 'Animal print', re: /\banimal print\b|\bleopard\b|\bcheetah print\b|\bzebra print\b|\bsnake ?skin\b/i },
  { id: 'tie dye', label: 'Tie dye', re: /\btie[\s-]?dye\b/i },
  { id: 'camo', label: 'Camo', re: /\bcamo(?:uflage)?\b/i },
  { id: 'sequins', label: 'Sequins', re: /\bsequin(?:s|ned)?\b/i },
  { id: 'metallic', label: 'Metallic', re: /\bmetallic\b|\bchrome\b/i },
  { id: 'denim', label: 'Denim', re: /\bdenim\b/i },
  { id: 'pastel palette', label: 'Pastel palette', re: /\bpastel[s]?\b/i },
  { id: 'monochrome', label: 'Monochrome', re: /\bmonochrome\b|\bmonochromatic\b/i },
  { id: 'y2k', label: 'Y2K', re: /\by2k\b/i },
  { id: 'cottagecore', label: 'Cottagecore', re: /\bcottagecore\b/i },
  { id: 'old money', label: 'Old money', re: /\bold[\s-]?money\b|\bquiet luxury\b/i },
  { id: 'streetwear', label: 'Streetwear', re: /\bstreetwear\b/i },
  { id: 'athleisure', label: 'Athleisure', re: /\bathleisure\b/i },
  { id: 'coquette', label: 'Coquette', re: /\bcoquette\b/i },
  { id: 'boho', label: 'Boho', re: /\bboho\b|\bbohemian\b/i },
];

// ── Curated topic vocabulary ────────────────────────────────────────────────
// The caption topic model returns free-text micro-trends; this lexicon keeps the
// board ON-DOMAIN (fashion / beauty / fitness / food / travel / wellness that a
// creator-marketing brand cares about) and CANONICAL (merges "coord set" /
// "co-ord set" → one "Co-ord Set"). A topic that matches NO entry is dropped, so
// one-off subjects (telescope launches, supplements, real estate) never rank.
// Add entries here to admit new trends. Order doesn't matter — first match wins.
const TOPIC_LEXICON: { id: string; label: string; re: RegExp }[] = [
  // Western fashion
  { id: 'oversized blazer', label: 'Oversized Blazer', re: /oversized blazer|power blazer|\bblazer\b/i },
  { id: 'co-ord set', label: 'Co-ord Set', re: /co[\s-]?ord|coordinate set/i },
  { id: 'cargo pants', label: 'Cargo Pants', re: /cargo pant/i },
  { id: 'baggy jeans', label: 'Baggy Jeans', re: /baggy jean|wide[\s-]?leg/i },
  { id: 'corset top', label: 'Corset Top', re: /corset/i },
  { id: 'cutout dress', label: 'Cut-out Dress', re: /cut[\s-]?out dress/i },
  { id: 'slip dress', label: 'Slip Dress', re: /slip dress/i },
  { id: 'summer dress', label: 'Summer Dress', re: /summer dress|sundress|summer outfit/i },
  { id: 'linen outfit', label: 'Linen Outfit', re: /linen (shirt|coord|co[\s-]?ord|set|outfit|dress)/i },
  { id: 'oversized shirt', label: 'Oversized Shirt', re: /oversized shirt|boyfriend shirt|tunic/i },
  { id: 'high heels', label: 'High Heels', re: /high heel|stiletto|\bpumps?\b/i },
  { id: 'chunky sneakers', label: 'Chunky Sneakers', re: /chunky sneaker|dad shoe|\bsneaker/i },
  { id: 'double denim', label: 'Double Denim', re: /denim on denim|double denim/i },
  { id: 'y2k style', label: 'Y2K / 2000s Style', re: /\by2k\b|2000s|2k style|noughties/i },
  { id: 'old money', label: 'Old Money', re: /old[\s-]?money|quiet luxury|clean girl/i },
  { id: 'monochrome fit', label: 'Monochrome Fit', re: /monochrome/i },
  { id: 'streetwear', label: 'Streetwear', re: /streetwear/i },
  { id: 'athleisure', label: 'Athleisure', re: /athleisure/i },
  { id: 'fashion week', label: 'Fashion Week', re: /fashion week/i },
  // Indian / ethnic wear
  { id: 'saree draping', label: 'Saree Draping', re: /saree drap|sari drap|drape.*sar[ei]/i },
  { id: 'kurta set', label: 'Kurta Set', re: /\bkurt[ai]/i },
  { id: 'lehenga', label: 'Lehenga', re: /leh[en]?ga/i },
  { id: 'anarkali', label: 'Anarkali', re: /anarkali/i },
  { id: 'farshi salwar', label: 'Farshi Salwar', re: /farshi|salwar|shalwar/i },
  { id: 'indo western', label: 'Indo-Western', re: /indo[\s-]?western/i },
  { id: 'bandhani', label: 'Bandhani', re: /bandhani|bandhej/i },
  { id: 'banarasi', label: 'Banarasi', re: /banarasi/i },
  { id: 'festive wear', label: 'Festive Wear', re: /festive (wear|outfit|look|collection)|diwali outfit|pujo|navratri/i },
  { id: 'bridal wear', label: 'Bridal Wear', re: /bridal (lehenga|collection|wear|outfit)|wedding (outfit|guest|look)/i },
  // Beauty / makeup
  { id: 'glass skin', label: 'Glass Skin', re: /glass skin/i },
  { id: 'glazed donut', label: 'Glazed Donut Skin', re: /glazed donut|donut skin/i },
  { id: 'latte makeup', label: 'Latte Makeup', re: /latte makeup/i },
  { id: 'sunkissed makeup', label: 'Sun-kissed Makeup', re: /sun[\s-]?kissed/i },
  { id: 'blush draping', label: 'Blush Draping', re: /blush drap/i },
  { id: 'underpainting', label: 'Underpainting', re: /underpaint/i },
  { id: 'bridal makeup', label: 'Bridal Makeup', re: /bridal makeup/i },
  { id: 'soft glam', label: 'Soft Glam', re: /soft glam/i },
  { id: 'no makeup makeup', label: 'No-makeup Makeup', re: /no[\s-]?makeup[\s-]?makeup/i },
  { id: 'lip combo', label: 'Lip Combo', re: /lip combo/i },
  { id: 'lip liner', label: 'Lip Liner', re: /lip liner|lip pencil/i },
  { id: 'lip gloss', label: 'Lip Gloss', re: /lip gloss|lip oil/i },
  { id: 'contouring', label: 'Contouring', re: /contour/i },
  { id: 'makeup masterclass', label: 'Makeup Masterclass', re: /makeup (masterclass|class)/i },
  { id: 'korean beauty', label: 'Korean Beauty', re: /korean (makeup|beauty)|k[\s-]?beauty/i },
  // Skincare
  { id: 'retinol', label: 'Retinol', re: /retinol/i },
  { id: 'vitamin c serum', label: 'Vitamin C Serum', re: /vitamin c|vit[\s.]?c serum/i },
  { id: 'niacinamide', label: 'Niacinamide', re: /niacinamide/i },
  { id: 'sunscreen', label: 'Sunscreen / SPF', re: /sunscreen|\bspf\b/i },
  { id: 'double cleansing', label: 'Double Cleansing', re: /double cleans/i },
  { id: 'face yoga', label: 'Face Yoga', re: /face yoga/i },
  { id: 'skin cycling', label: 'Skin Cycling', re: /skin cycling/i },
  { id: 'gua sha', label: 'Gua Sha', re: /gua sha/i },
  // Hair / nails
  { id: 'hair oiling', label: 'Hair Oiling', re: /hair oil/i },
  { id: 'rice water', label: 'Rice Water Hair', re: /rice water/i },
  { id: 'heatless curls', label: 'Heatless Curls', re: /heatless curl/i },
  { id: 'chrome nails', label: 'Chrome Nails', re: /chrome nail/i },
  { id: 'gel nails', label: 'Gel Nails', re: /gel (nails|extension|manicure)/i },
  { id: 'french tips', label: 'French Tips', re: /french (tip|manicure)/i },
  // Fitness
  { id: 'pilates', label: 'Pilates', re: /pilates/i },
  { id: 'calisthenics', label: 'Calisthenics', re: /calisthenic/i },
  { id: 'strength training', label: 'Strength Training', re: /strength train|weight train/i },
  { id: 'hyrox', label: 'Hyrox', re: /hyrox/i },
  { id: 'mobility', label: 'Mobility Work', re: /mobility (drill|training|work|routine)/i },
  { id: 'meal prep', label: 'Meal Prep', re: /meal prep/i },
  { id: 'protein recipe', label: 'Protein Recipe', re: /protein (shake|recipe|smoothie|bowl)/i },
  { id: 'home workout', label: 'Home Workout', re: /home workout/i },
  { id: 'yoga flow', label: 'Yoga Flow', re: /yoga (flow|routine|practice)/i },
  // Food
  { id: 'high protein', label: 'High-protein Meals', re: /high[\s-]?protein/i },
  { id: 'street food', label: 'Street Food', re: /street food/i },
  { id: 'pasta recipe', label: 'Pasta Recipe', re: /one[\s-]?pot pasta|pasta recipe/i },
  { id: 'millet recipe', label: 'Millet Recipe', re: /millet/i },
  { id: 'matcha', label: 'Matcha', re: /matcha/i },
  { id: 'vegan recipe', label: 'Vegan Recipe', re: /vegan (cake|recipe|dessert|food)/i },
  { id: 'gluten free', label: 'Gluten-free', re: /gluten[\s-]?free/i },
  { id: 'air fryer', label: 'Air Fryer', re: /air fryer/i },
  { id: 'healthy breakfast', label: 'Healthy Breakfast', re: /healthy breakfast|breakfast recipe/i },
  { id: 'sourdough', label: 'Sourdough', re: /sourdough/i },
  // Travel
  { id: 'budget travel', label: 'Budget Travel', re: /budget travel/i },
  { id: 'solo travel', label: 'Solo Travel', re: /solo (trip|travel)/i },
  { id: 'cafe hopping', label: 'Cafe Hopping', re: /cafe hop/i },
  { id: 'trekking', label: 'Trekking', re: /\btrek|himalaya/i },
  { id: 'hidden gems', label: 'Hidden Gems', re: /hidden gem/i },
  { id: 'staycation', label: 'Staycation', re: /staycation/i },
  { id: 'road trip', label: 'Road Trip', re: /road trip/i },
  // Wellness / lifestyle
  { id: 'essential oils', label: 'Essential Oils', re: /essential oil/i },
  { id: 'gut health', label: 'Gut Health', re: /gut health/i },
  { id: 'cold plunge', label: 'Cold Plunge', re: /cold plunge|ice bath/i },
  { id: 'journaling', label: 'Journaling', re: /journal/i },
  { id: 'digital detox', label: 'Digital Detox', re: /digital detox/i },
  // Home / creative
  { id: 'home decor', label: 'Home Decor', re: /home decor|room (makeover|decor|tour)/i },
  { id: 'cinematic edit', label: 'Cinematic Edit', re: /cinematic (portrait|reel|edit|shot)/i },
];

// Map a free-text topic tag to a curated canonical trend, or null to drop it.
function canonicalTopic(tag: string): { id: string; label: string } | null {
  for (const t of TOPIC_LEXICON) if (t.re.test(tag)) return { id: t.id, label: t.label };
  return null;
}

// Map an Instagram post_type to a small, stable set of format identifiers so
// "Reel", "CLIPS", "video" etc. don't fragment into separate trends.
function normaliseFormat(postType: string | null): { id: string; label: string } | null {
  const t = (postType ?? '').toLowerCase();
  if (!t) return null;
  if (/reel|clip|video|igtv/.test(t)) return { id: 'reel', label: 'Reels' };
  if (/carousel|sidecar|album/.test(t)) return { id: 'carousel', label: 'Carousels' };
  if (/image|photo|feed|graph_?image/.test(t)) return { id: 'image', label: 'Single image' };
  if (/story|stories/.test(t)) return { id: 'story', label: 'Stories' };
  return null;
}

function classifyPhase(current: number, prior: number, velocity: number): string {
  if (prior === 0) return 'emerging';         // brand-new this window
  if (velocity >= 0.5) return 'growing';       // ≥50% more usage than last window
  if (velocity <= -0.5) return 'declining';    // usage more than halved
  if (velocity < 0) return 'saturated';        // gently fading
  return 'peak';                               // high, roughly flat
}

/**
 * Scan up to `creatorLimit` creators' recent posts and (re)compute hashtag +
 * format trend signals over a rolling `windowDays` window. Best-effort: bad rows
 * are skipped, never aborting the run. Only identifiers with enough volume in
 * either window are written, so we don't flood the table with one-off tags.
 */
export async function ingestTrendSignals(
  opts: {
    creatorLimit?: number;
    windowDays?: number;
    minCount?: number;
    // Also derive VISUAL/aesthetic trends by vision-tagging post thumbnails.
    // Off by default — it makes (budgeted) OpenAI vision calls.
    withVisual?: boolean;
    // Max NEW post images to send to the vision model this run (cached posts are
    // free). Bounds cost/latency; coverage grows across runs as the cache fills.
    visualBudget?: number;
    // Also derive TOPIC trends by LLM-tagging the SUBJECT of each caption
    // ("grwm", "budget travel"). Text-only, so far cheaper than the visual pass.
    withTopics?: boolean;
    // Max NEW captions to send to the topic model this run (cached ones are free).
    topicBudget?: number;
  } = {},
): Promise<TrendIngestReport> {
  const creatorLimit = Math.max(1, Math.min(opts.creatorLimit ?? 5000, 50_000));
  // Default to a 7-day rolling window for live daily crawling, but allow up to
  // 180 so trend math still works on batch/historical corpora where posts are
  // spread over months rather than a fresh daily feed.
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? 7, 180));
  const minCount = Math.max(2, opts.minCount ?? 3);
  const withVisual = opts.withVisual === true;
  const visualBudget = Math.max(0, Math.min(opts.visualBudget ?? 120, 500));
  const withTopics = opts.withTopics === true;
  const topicBudget = Math.max(0, Math.min(opts.topicBudget ?? 400, 2000));
  const db = getBolticClient();

  const now = Date.now();
  const currentCutoff = now - windowDays * MS_PER_DAY;
  const priorCutoff = now - 2 * windowDays * MS_PER_DAY;
  const dayCutoff = now - MS_PER_DAY;

  const creators = await db.query<CreatorRow>(
    `SELECT id, primary_category, genre, niche, recent_posts
       FROM creators
      WHERE recent_posts IS NOT NULL
        AND jsonb_typeof(recent_posts::jsonb) = 'array'
        AND jsonb_array_length(recent_posts::jsonb) > 0
      ORDER BY updated_at DESC NULLS LAST
      LIMIT ${creatorLimit}`,
  );

  const hashtags = new Map<string, Bucket>();
  const formats = new Map<string, Bucket>();
  // Fashion motifs (patterns/aesthetics). Seeded from caption keywords below and
  // augmented by the optional vision pass, so both text and image signal land in
  // the same buckets and surface as one `visual` trend.
  const visuals = new Map<string, Bucket>();
  // Posts (with a thumbnail, in the 2×window range) that are candidates for
  // visual tagging. Deduped by post id; keeps the timing + categories so the
  // motif aggregation uses the same current-vs-prior windowing as hashtags.
  const visualPosts = new Map<string, { imageUrl: string; when: number; cats: string[] }>();
  // Posts (with a caption) that are candidates for topic tagging. Deduped by post
  // id; keeps timing + categories so topic aggregation uses the same windowing.
  const topicPosts = new Map<string, { caption: string; when: number; cats: string[] }>();
  let postsScanned = 0;

  const bump = (
    map: Map<string, Bucket>,
    id: string,
    label: string,
    when: number,
    cats: string[],
  ) => {
    let b = map.get(id);
    if (!b) {
      b = { display_name: label, count_current: 0, count_prior: 0, count_24h: 0, categories: new Set() };
      map.set(id, b);
    }
    if (when >= currentCutoff) {
      b.count_current += 1;
      if (when >= dayCutoff) b.count_24h += 1;
    } else {
      b.count_prior += 1;
    }
    for (const c of cats) if (c) b.categories.add(c);
  };

  for (const cr of creators) {
    const posts = Array.isArray(cr.recent_posts) ? cr.recent_posts : [];
    if (posts.length === 0) continue;
    const cats = [cr.primary_category, cr.genre, cr.niche]
      .filter((c): c is string => !!c && c.trim().length > 0)
      .map((c) => c.trim().toLowerCase());

    for (const p of posts) {
      const ts = p.posted_at ? Date.parse(p.posted_at) : NaN;
      if (!Number.isFinite(ts) || ts < priorCutoff || ts > now) continue;
      postsScanned += 1;

      // Hashtags from the caption.
      if (p.caption) {
        const seen = new Set<string>();
        for (const m of p.caption.matchAll(HASHTAG_RE)) {
          const tag = (m[1] ?? '').toLowerCase();
          if (!tag || seen.has(tag)) continue; // count a tag once per post
          seen.add(tag);
          bump(hashtags, tag, `#${m[1]}`, ts, cats);
        }
      }

      // Fashion motifs straight from the caption text — first-party pattern
      // signal that works today (most posts have a caption, few have a thumbnail).
      if (p.caption) {
        for (const m of MOTIF_LEXICON) {
          if (m.re.test(p.caption)) bump(visuals, m.id, m.label, ts, cats);
        }
      }

      // Content format from post_type.
      const fmt = normaliseFormat(p.post_type);
      if (fmt) bump(formats, fmt.id, fmt.label, ts, cats);

      // Queue the post image for visual-motif tagging (deduped by post id).
      if (withVisual && p.thumbnail_url && p.platform_post_id && !visualPosts.has(p.platform_post_id)) {
        visualPosts.set(p.platform_post_id, { imageUrl: p.thumbnail_url, when: ts, cats });
      }

      // Queue the caption for topic tagging (deduped by post id). Needs a real
      // caption; a bare handle or a couple of emojis carries no topic.
      if (withTopics && p.platform_post_id && p.caption && p.caption.trim().length >= 8 && !topicPosts.has(p.platform_post_id)) {
        topicPosts.set(p.platform_post_id, { caption: p.caption, when: ts, cats });
      }
    }
  }

  // Upsert the identifiers that cleared the volume threshold in either window.
  const upsert = async (
    trendType: 'hashtag' | 'format' | 'visual' | 'topic',
    map: Map<string, Bucket>,
    limits: { minCount: number; cap: number },
  ): Promise<number> => {
    let written = 0;
    // Rank by current usage so we cap the write volume to the liveliest trends.
    const ranked = [...map.entries()]
      .filter(([, b]) => b.count_current >= limits.minCount || b.count_prior >= limits.minCount)
      .sort((a, b) => b[1].count_current - a[1].count_current)
      .slice(0, limits.cap);

    for (const [id, b] of ranked) {
      const velocity = (b.count_current - b.count_prior) / Math.max(b.count_prior, 1);
      const clamped = Math.max(-9999, Math.min(9999, Number(velocity.toFixed(4))));
      const phase = classifyPhase(b.count_current, b.count_prior, velocity);
      const categories = [...b.categories].slice(0, 12);
      try {
        await db.query(
          `INSERT INTO trend_signals
             (trend_type, identifier, display_name, phase, velocity,
              usage_count_24h, usage_count_7d, categories, peak_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (trend_type, identifier) DO UPDATE SET
             display_name    = EXCLUDED.display_name,
             phase           = EXCLUDED.phase,
             velocity        = EXCLUDED.velocity,
             usage_count_24h = EXCLUDED.usage_count_24h,
             usage_count_7d  = EXCLUDED.usage_count_7d,
             categories      = EXCLUDED.categories,
             peak_at         = COALESCE(trend_signals.peak_at, EXCLUDED.peak_at),
             updated_at      = NOW()`,
          [
            trendType,
            id,
            b.display_name,
            phase,
            clamped,
            b.count_24h,
            b.count_current,
            categories,
            phase === 'peak' ? new Date().toISOString() : null,
          ],
        );
        written += 1;
      } catch (err) {
        console.error(`[trend-ingest] upsert failed for ${trendType}:${id}`, err);
      }
    }
    return written;
  };

  const hashtagsWritten = await upsert('hashtag', hashtags, { minCount, cap: 300 });
  const formatsWritten = await upsert('format', formats, { minCount, cap: 20 });

  // ── Visual / aesthetic motifs ────────────────────────────────────────────
  // Caption-derived motifs are already in `visuals` (above). When enabled, the
  // vision pass tags post thumbnails (budgeted + cached) and bumps the SAME
  // buckets, so text + image signal combine before we compute velocity + phase.
  let postsVisuallyTagged = 0;
  let visualsWritten = 0;
  if (withVisual && visualPosts.size > 0) {
    const ids = [...visualPosts.keys()];
    const cachedTags = new Map<string, string[]>();

    // 1. Load already-tagged posts from the cache (chunked to bound param count).
    for (const idChunk of chunk(ids, 500)) {
      try {
        const rows = await db.query<{ platform_post_id: string; tags: string[] }>(
          `SELECT platform_post_id, tags FROM post_visual_tags
            WHERE platform_post_id = ANY($1::text[])`,
          [idChunk],
        );
        for (const r of rows) cachedTags.set(r.platform_post_id, Array.isArray(r.tags) ? r.tags : []);
      } catch (err) {
        console.error('[trend-ingest] visual cache read failed', err);
      }
    }

    // 2. Tag NEW posts up to the budget — newest first, so fresh trends get
    //    covered before we spend on backfill. Cache every result (empty too).
    const untagged = ids.filter((id) => !cachedTags.has(id));
    untagged.sort((a, b) => visualPosts.get(b)!.when - visualPosts.get(a)!.when);
    const toTag = untagged.slice(0, visualBudget);
    const openai = getOpenAIClient();
    for (const batch of chunk(toTag, 8)) {
      const items = batch.map((id) => ({ postId: id, imageUrl: visualPosts.get(id)!.imageUrl }));
      let res: Record<string, string[]> = {};
      try {
        res = await openai.extractVisualMotifs(items);
      } catch (err) {
        console.error('[trend-ingest] visual tagging failed', err);
      }
      for (const id of batch) {
        const tags = res[id] ?? [];
        cachedTags.set(id, tags);
        postsVisuallyTagged += 1;
        try {
          await db.query(
            `INSERT INTO post_visual_tags (platform_post_id, tags, tagged_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (platform_post_id) DO UPDATE SET tags = EXCLUDED.tags, tagged_at = NOW()`,
            [id, tags],
          );
        } catch (err) {
          console.error(`[trend-ingest] visual cache write failed for ${id}`, err);
        }
      }
    }

    // 3. Aggregate every candidate that has tags (cached or newly tagged).
    for (const id of ids) {
      const tags = cachedTags.get(id);
      if (!tags || tags.length === 0) continue;
      const p = visualPosts.get(id)!;
      for (const tag of tags) bump(visuals, tag, titleCase(tag), p.when, p.cats);
    }

  }

  // Write the combined caption+vision motif buckets. Runs regardless of the
  // vision pass so caption-derived pattern trends surface on their own. Gentler
  // threshold than hashtags since coverage is thinner.
  if (visuals.size > 0) {
    visualsWritten = await upsert('visual', visuals, { minCount: 2, cap: 80 });
  }

  // ── Topics ────────────────────────────────────────────────────────────────
  // LLM-tag each caption's SUBJECT (budgeted + cached), then aggregate exactly
  // like hashtags so genuine "what's trending right now" topics surface with
  // velocity + phase. Text-only, so the per-run budget can be much higher than
  // the vision pass.
  const topics = new Map<string, Bucket>();
  let postsTopicallyTagged = 0;
  let topicsWritten = 0;
  if (withTopics && topicPosts.size > 0) {
    const ids = [...topicPosts.keys()];
    const cachedTags = new Map<string, string[]>();

    // 1. Load already-tagged captions from the cache (chunked to bound params).
    for (const idChunk of chunk(ids, 500)) {
      try {
        const rows = await db.query<{ platform_post_id: string; tags: string[] }>(
          `SELECT platform_post_id, tags FROM post_topic_tags
            WHERE platform_post_id = ANY($1::text[])`,
          [idChunk],
        );
        for (const r of rows) cachedTags.set(r.platform_post_id, Array.isArray(r.tags) ? r.tags : []);
      } catch (err) {
        console.error('[trend-ingest] topic cache read failed', err);
      }
    }

    // 2. Tag NEW captions up to the budget — newest first, so fresh trends get
    //    covered before we spend on backfill. Cache every result (empty too).
    const untagged = ids.filter((id) => !cachedTags.has(id));
    untagged.sort((a, b) => topicPosts.get(b)!.when - topicPosts.get(a)!.when);
    const toTag = untagged.slice(0, topicBudget);
    const openai = getOpenAIClient();
    for (const batch of chunk(toTag, 25)) {
      const items = batch.map((id) => ({ postId: id, caption: topicPosts.get(id)!.caption }));
      let res: Record<string, string[]> = {};
      try {
        res = await openai.extractCaptionTopics(items);
      } catch (err) {
        console.error('[trend-ingest] topic tagging failed', err);
      }
      for (const id of batch) {
        const tags = res[id] ?? [];
        cachedTags.set(id, tags);
        postsTopicallyTagged += 1;
        try {
          await db.query(
            `INSERT INTO post_topic_tags (platform_post_id, tags, tagged_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (platform_post_id) DO UPDATE SET tags = EXCLUDED.tags, tagged_at = NOW()`,
            [id, tags],
          );
        } catch (err) {
          console.error(`[trend-ingest] topic cache write failed for ${id}`, err);
        }
      }
    }

    // 3. Aggregate every candidate that has tags (cached or newly tagged).
    for (const id of ids) {
      const tags = cachedTags.get(id);
      if (!tags || tags.length === 0) continue;
      const p = topicPosts.get(id)!;
      for (const tag of tags) {
        // Keep only curated, on-domain trends; merge variants to one canonical id.
        const canon = canonicalTopic(tag);
        if (canon) bump(topics, canon.id, canon.label, p.when, p.cats);
      }
    }

    topicsWritten = await upsert('topic', topics, { minCount: 2, cap: 120 });
  }

  return {
    creators_scanned: creators.length,
    posts_scanned: postsScanned,
    hashtags_tracked: hashtagsWritten,
    formats_tracked: formatsWritten,
    visual_tracked: visualsWritten,
    topics_tracked: topicsWritten,
    posts_visually_tagged: postsVisuallyTagged,
    posts_topically_tagged: postsTopicallyTagged,
    signals_upserted: hashtagsWritten + formatsWritten + visualsWritten + topicsWritten,
    window_days: windowDays,
  };
}
