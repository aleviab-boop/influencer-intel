import type { MetadataRoute } from 'next';

const SITE_URL = 'https://influencer-intel-platform.vercel.app';

// robots.txt — allow crawling of public marketing/tool pages, but keep app
// internals, auth-gated workspaces and API routes out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin',
        '/agency',
        '/brand',
        '/brand-campaigns',
        '/brand-dna',
        '/campaigns',
        '/checkout',
        '/connect',
        '/creator',
        '/email-activity',
        '/inbox',
        '/insights',
        '/monitor',
        '/notifications',
        '/predict',
        '/report',
        '/research',
        '/saved',
        '/shortlist',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
