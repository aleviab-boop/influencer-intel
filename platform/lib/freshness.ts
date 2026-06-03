import type { Creator, Freshness } from '@influencer-intel/shared/types';

export function freshnessBadge(
  creator: Pick<Creator, 'last_scraped_at'>,
  scrapedThisSession = false,
): Freshness {
  if (scrapedThisSession) return 'just_scraped';
  if (!creator.last_scraped_at) return 'refreshing';
  const ageMs = Date.now() - new Date(creator.last_scraped_at).getTime();
  if (ageMs < 14 * 24 * 60 * 60 * 1000) return 'fresh';
  if (ageMs < 30 * 24 * 60 * 60 * 1000) return 'stale';
  return 'refreshing';
}
