// ============================================================
// Quality scorer smoke test — pure, no DB / no keys.
//   npm run score-smoke
//
// Exercises scoreCreatorQuality against three synthetic creators and asserts
// the drop-below-80 gate behaves: a strong creator passes, a weak one fails,
// and one with no engagement data is flagged insufficient_data.
// ============================================================

import type { Creator } from '../types/index.js';
import { scoreCreatorQuality, QUALITY_THRESHOLD } from './quality.js';

function base(over: Partial<Creator>): Creator {
  return {
    id: 'x',
    platform: 'instagram',
    handle: 'x',
    profile_url: 'https://instagram.com/x',
    display_name: null,
    bio: null,
    profile_photo_url: null,
    is_verified: false,
    follower_count: null,
    following_count: null,
    posts_count: null,
    avg_views: null,
    avg_likes: null,
    avg_comments: null,
    engagement_rate: null,
    primary_category: null,
    content_languages: null,
    primary_city: null,
    city_tier: null,
    data_tier: 'tier_c',
    genre: null,
    niche: null,
    region: null,
    tags: null,
    source: null,
    source_url: null,
    confidence_score: null,
    is_active: true,
    is_indian: null,
    is_verified_creator: false,
    recent_posts: null,
    audience_demographics: null,
    credibility: null,
    verified_oauth_data: null,
    raw_metadata: null,
    content_embedding: null,
    first_indexed_at: new Date().toISOString(),
    last_scraped_at: null,
    last_full_refresh: null,
    ...over,
  } as Creator;
}

function posts(n: number, likes: number, comments: number, jitter = 0.1) {
  return Array.from({ length: n }, (_, i) => {
    const f = 1 + (i % 2 === 0 ? jitter : -jitter);
    return {
      platform_post_id: `p${i}`,
      post_url: `https://instagram.com/p/${i}`,
      post_type: 'reel',
      caption: null,
      posted_at: null,
      view_count: null,
      like_count: Math.round(likes * f),
      comment_count: Math.round(comments * f),
    };
  });
}

// Strong: 80k followers, ~4% ER, healthy comment ratio, consistent, real ff ratio
const strong = base({
  follower_count: 80_000,
  following_count: 800,
  recent_posts: posts(8, 3000, 60),
  credibility: { overall_score: 85, badge: 'green', signals: {} as never, flags: [], computed_at: '' },
});

// Weak: 80k followers, ~0.5% ER, low comments, follows-back-heavy
const weak = base({
  follower_count: 80_000,
  following_count: 90_000,
  recent_posts: posts(8, 380, 2),
});

// Insufficient: no engagement data at all
const empty = base({ follower_count: 50_000 });

let ok = true;
function check(label: string, c: Creator, expectPass: boolean | 'insufficient') {
  const q = scoreCreatorQuality(c);
  const got =
    q.band === 'insufficient_data' ? 'insufficient' : q.passed ? true : false;
  const good = got === expectPass;
  ok &&= good;
  console.log(
    `${good ? '✓' : '✗'} ${label}: score=${q.score} band=${q.band} ` +
      `(eng=${q.breakdown.engagement} comm=${q.breakdown.comment_quality} ` +
      `cons=${q.breakdown.consistency} auth=${q.breakdown.authenticity})`,
  );
}

console.log(`Quality smoke (threshold ${QUALITY_THRESHOLD})\n`);
check('strong creator passes', strong, true);
check('weak creator dropped', weak, false);
check('no-data creator flagged', empty, 'insufficient');

console.log(ok ? '\nAll checks passed.' : '\nSome checks failed.');
process.exit(ok ? 0 : 1);
