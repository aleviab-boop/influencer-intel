import type { MetadataRoute } from 'next';

const SITE_URL = 'https://influencer-intel-platform.vercel.app';

// Public, indexable pages only — marketing surfaces, feature/tool landings and
// legal. Auth-gated workspaces, dynamic profile pages and API routes are
// deliberately excluded (see robots.ts). Priority roughly tracks importance.
const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '/lander', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/pricing', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/for-influencers', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/trending', priority: 0.8, changeFrequency: 'daily' },
  // Feature landings
  { path: '/influencer-search', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/influencer-database', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/influencer-payouts', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/campaign-management', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/campaign-analytics', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/media-management', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/comment-to-dm', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/brand-mentions', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/competitor-analysis', priority: 0.7, changeFrequency: 'monthly' },
  // Free tools
  { path: '/tools/content-ideas', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/tools/reply-assistant', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/tools/fake-follower-checker', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/tools/er-calculator', priority: 0.7, changeFrequency: 'monthly' },
  // Entry & legal
  { path: '/start', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/book-demo', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/data-deletion', priority: 0.3, changeFrequency: 'yearly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
