import { NextResponse } from 'next/server';
import { getBolticClient } from '@influencer-intel/shared/db';
import type { RecentPost } from '@influencer-intel/shared/types';
import { resolveCreator } from '@/lib/creator-identity';
import { isMeaningfulTrend, byTrendRelevance, cleanTrendCategories } from '@/lib/trend-quality';

export const runtime = 'nodejs';

// GET /api/creator/what-to-post?handle=<h>|?account=<id>
//
// The creator-facing "what to post now" board. It doesn't just echo trends — it
// diffs what's RISING in the creator's niche (trend_signals) against what the
// creator THEMSELVES already posts (their recent_posts formats + the cached
// topic tags for those posts), and surfaces the gap: rising topics/formats they
// under-use. That's advice, not a horoscope. All DB-derived (no IG token),
// always 200 — `{ available:false, reason }` when there's nothing to resolve.

interface CreatorRow {
  id: string;
  primary_category: string | null;
  genre: string | null;
  niche: string | null;
  recent_posts: RecentPost[] | string | null;
}

interface TrendRow {
  identifier: string;
  display_name: string;
  trend_type: string;
  phase: string;
  velocity: string | number;
  usage_count_7d: string | number;
  categories: string[] | null;
}

export interface PostSuggestion {
  type: 'topic' | 'format';
  label: string;
  phase: string;
  velocity: number;
  usage_count_7d: number;
  why_now: string;      // why this trend, right now
  rationale: string;    // why it's for THIS creator (the gap)
  you_do_it: boolean;   // does the creator already post this?
  prompt: string;       // seed for /tools/content-ideas?prompt=
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Same small, stable format map the trend ingest uses, so a creator's own
// post_type mix lines up with the 'format' trend identifiers.
function normFormat(pt: string | null): { id: string; label: string } | null {
  const t = (pt ?? '').toLowerCase();
  if (!t) return null;
  if (/reel|clip|video|igtv/.test(t)) return { id: 'reel', label: 'Reels' };
  if (/carousel|sidecar|album/.test(t)) return { id: 'carousel', label: 'Carousels' };
  if (/image|photo|feed|graph_?image/.test(t)) return { id: 'image', label: 'Single image' };
  if (/story|stories/.test(t)) return { id: 'story', label: 'Stories' };
  return null;
}

function parsePosts(v: CreatorRow['recent_posts']): RecentPost[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function growthLabel(velocity: number, phase: string): string {
  const pct = Math.round(velocity * 100);
  return Number.isFinite(pct) ? `${pct >= 0 ? '+' : ''}${pct}% wk-on-wk` : phase;
}

export async function GET(request: Request): Promise<NextResponse> {
  const db = getBolticClient();
  try {
    const resolved = await resolveCreator(request);
    if (!resolved) return NextResponse.json({ available: false, reason: 'no_creator', suggestions: [] });

    const rows = await db.query<CreatorRow>(
      `SELECT id, primary_category, genre, niche, recent_posts
         FROM creators WHERE id = $1 LIMIT 1`,
      [resolved.creator_id],
    );
    const creator = rows[0] ?? null;

    // The creator's niche → category tokens for filtering trends to their space.
    const nicheParts = [creator?.primary_category, creator?.genre, creator?.niche]
      .filter((c): c is string => !!c && c.trim().length > 0)
      .map((c) => c.trim().toLowerCase());
    const category = (creator?.primary_category || creator?.genre || creator?.niche || '').trim();
    const tokens = Array.from(
      new Set(nicheParts.flatMap((p) => p.split(/[^a-z0-9]+/)).filter((t) => t.length > 2)),
    );

    // ---- What the creator ALREADY does (their own recent posts) --------------
    const posts = parsePosts(creator?.recent_posts ?? null);
    const postIds = posts.map((p) => p.platform_post_id).filter((id): id is string => !!id);

    // Format mix from post_type.
    const formatCounts = new Map<string, number>();
    for (const p of posts) {
      const f = normFormat(p.post_type);
      if (f) formatCounts.set(f.id, (formatCounts.get(f.id) ?? 0) + 1);
    }
    const totalFormatted = [...formatCounts.values()].reduce((a, b) => a + b, 0);

    // Topics the creator posts about — from the cached topic tags for their posts.
    const ownTopics = new Set<string>();
    if (postIds.length > 0) {
      try {
        const tagRows = await db.query<{ tags: string[] }>(
          `SELECT tags FROM post_topic_tags WHERE platform_post_id = ANY($1::text[])`,
          [postIds],
        );
        for (const r of tagRows) for (const t of r.tags ?? []) if (t) ownTopics.add(t.toLowerCase());
      } catch {
        /* cache table may be empty — fall through with no own-topic signal */
      }
    }

    // ---- What's RISING in their niche (trend_signals) ------------------------
    const trendRows = await db.query<TrendRow>(
      `SELECT identifier, display_name, trend_type, phase, velocity::text AS velocity,
              usage_count_7d, categories
         FROM trend_signals
        WHERE trend_type IN ('topic', 'format')
          AND phase IN ('emerging', 'growing', 'peak')
          ${tokens.length ? 'AND (categories && $1::text[] OR categories IS NULL OR cardinality(categories) = 0)' : ''}
        ORDER BY usage_count_7d DESC, velocity DESC
        LIMIT 80`,
      tokens.length ? [tokens] : undefined,
    );
    const trends = trendRows.filter(isMeaningfulTrend).sort(byTrendRelevance);

    // ---- Topic suggestions: rising niche topics the creator under-uses -------
    const topicSuggestions: PostSuggestion[] = trends
      .filter((t) => t.trend_type === 'topic')
      .map((t) => {
        const velocity = num(t.velocity);
        const wk = num(t.usage_count_7d);
        const youDoIt = ownTopics.has(t.identifier.toLowerCase()) || ownTopics.has(t.display_name.toLowerCase());
        const nicheLabel = cleanTrendCategories(t.categories)[0] || category || 'your niche';
        return {
          type: 'topic' as const,
          label: t.display_name,
          phase: t.phase,
          velocity,
          usage_count_7d: wk,
          why_now: `Rising in ${nicheLabel} — ${growthLabel(velocity, t.phase)}, ${wk} posts/7d`,
          rationale: youDoIt
            ? "You already post this — a fresh take keeps your momentum up"
            : "You haven't posted this lately, and it's climbing in your niche",
          you_do_it: youDoIt,
          prompt: `Instagram content ideas about "${t.display_name}"${category ? ` for a ${category} creator` : ''}`,
        };
      })
      // Under-used first, then by momentum (already relevance-sorted).
      .sort((a, b) => Number(a.you_do_it) - Number(b.you_do_it))
      .slice(0, 4);

    // ---- Format suggestion: a rising format the creator under-uses -----------
    const formatSuggestions: PostSuggestion[] = [];
    for (const t of trends.filter((x) => x.trend_type === 'format')) {
      const share = totalFormatted > 0 ? (formatCounts.get(t.identifier) ?? 0) / totalFormatted : 0;
      if (share >= 0.35) continue; // they already lean on this format enough
      const velocity = num(t.velocity);
      const wk = num(t.usage_count_7d);
      const sharePct = Math.round(share * 100);
      formatSuggestions.push({
        type: 'format',
        label: t.display_name,
        phase: t.phase,
        velocity,
        usage_count_7d: wk,
        why_now: `${t.display_name} are ${growthLabel(velocity, t.phase)} across creators like you`,
        rationale:
          totalFormatted > 0
            ? `Only ${sharePct}% of your recent posts are ${t.display_name.toLowerCase()} — room to lean in`
            : `A format worth trying more of`,
        you_do_it: sharePct >= 15,
        prompt: `${t.display_name} content ideas${category ? ` for a ${category} creator` : ''}`,
      });
      if (formatSuggestions.length >= 2) break;
    }

    const suggestions = [...topicSuggestions, ...formatSuggestions].slice(0, 5);

    return NextResponse.json({
      available: suggestions.length > 0,
      reason: suggestions.length > 0 ? null : tokens.length ? 'no_trends_for_niche' : 'no_niche',
      niche: category || null,
      personalised: postIds.length > 0 && (ownTopics.size > 0 || totalFormatted > 0),
      suggestions,
    });
  } catch (err) {
    return NextResponse.json(
      { available: false, reason: 'db_error', error: (err as Error).message, suggestions: [] },
      { status: 200 },
    );
  }
}
