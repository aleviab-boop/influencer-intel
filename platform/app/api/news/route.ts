import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
// Cache the upstream RSS for 30 min so the page is fast and we never hammer the source.
export const revalidate = 1800;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]!) : '';
}

function items(xml: string): string[] {
  return xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
}

async function fetchRss(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, next: { revalidate } });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  date: string;
  image: string;
}

// Publisher logo via Google's free favicon service (the source's own site image).
function logoFor(block: string): string {
  const m = block.match(/<source[^>]*url="([^"]+)"/i);
  if (!m) return '';
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(m[1]!).hostname}&sz=128`;
  } catch {
    return '';
  }
}
export interface TrendItem {
  title: string;
  traffic: string;
  link: string;
}

// GET /api/news → { news: NewsItem[], trends: TrendItem[] }
export async function GET(): Promise<NextResponse> {
  const NEWS_QUERIES = [
    'influencer marketing india campaign',
    'brand creator collaboration india',
    'social media marketing trends',
  ];

  const [newsXmls, trendsXml] = await Promise.all([
    Promise.all(
      NEWS_QUERIES.map((q) =>
        fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`),
      ),
    ),
    fetchRss('https://trends.google.com/trending/rss?geo=IN'),
  ]);

  // ---- News: merge queries, dedupe by title, newest first ----
  const seen = new Set<string>();
  const news: NewsItem[] = [];
  for (const xml of newsXmls) {
    for (const block of items(xml)) {
      const title = tag(block, 'title');
      if (!title || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      news.push({
        title,
        link: tag(block, 'link'),
        source: tag(block, 'source') || 'News',
        date: tag(block, 'pubDate'),
        image: logoFor(block),
      });
    }
  }
  news.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // ---- Trends: daily search trends in India ----
  const trends: TrendItem[] = items(trendsXml)
    .map((block) => ({
      title: tag(block, 'title'),
      traffic: tag(block, 'ht:approx_traffic'),
      link: tag(block, 'ht:news_item_url') || `https://www.google.com/search?q=${encodeURIComponent(tag(block, 'title'))}`,
    }))
    .filter((t) => t.title);

  return NextResponse.json({ news: news.slice(0, 18), trends: trends.slice(0, 12) });
}
