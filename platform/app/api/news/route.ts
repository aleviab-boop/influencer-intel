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

// First embedded image: <media:content url> / <media:thumbnail> / <enclosure>.
function mediaImage(block: string): string {
  const m =
    block.match(/<media:content[^>]*url="([^"]+)"/i) ||
    block.match(/<media:thumbnail[^>]*url="([^"]+)"/i) ||
    block.match(/<enclosure[^>]*url="([^"]+)"/i);
  if (!m) return '';
  const url = m[1]!.replace(/&amp;/g, '&');
  // ET serves a tiny low-res thumb in the feed; swap to the full-res original.
  const id = url.match(/etb2bimg\.com\/.*?\/(\d+)\.cms?(?:[?#]|$)/i);
  return id ? `https://etimg.etb2bimg.com/photo/${id[1]}.cms` : url;
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
  image: string; // real article thumbnail
  logo: string; // publisher favicon (badge)
}
export interface TrendItem {
  title: string;
  traffic: string;
  link: string;
}

// ET BrandEquity is India's marketing/advertising/brand desk — every RSS item
// carries a real article image (media:content), exactly what we want here.
const BE = 'https://brandequity.economictimes.indiatimes.com/rss';
const NEWS_FEEDS = [
  `${BE}/marketing`,
  `${BE}/advertising`,
  `${BE}/digital`,
  `${BE}/media`,
  `${BE}/topstories`,
];
const BE_LOGO = 'https://www.google.com/s2/favicons?domain=brandequity.economictimes.indiatimes.com&sz=128';

// GET /api/news → { news: NewsItem[], trends: TrendItem[] }
export async function GET(): Promise<NextResponse> {
  const [newsXmls, trendsXml] = await Promise.all([
    Promise.all(NEWS_FEEDS.map(fetchRss)),
    fetchRss('https://trends.google.com/trending/rss?geo=IN'),
  ]);

  // ---- News: merge feeds, dedupe by title, newest first, images first ----
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
        source: 'ET BrandEquity',
        date: tag(block, 'pubDate'),
        image: mediaImage(block),
        logo: BE_LOGO,
      });
    }
  }
  news.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  // Prefer items that actually have an image.
  const withImg = news.filter((n) => n.image);
  const list = (withImg.length >= 8 ? withImg : news).slice(0, 14);

  // ---- Trends: daily search trends in India ----
  const trends: TrendItem[] = items(trendsXml)
    .map((block) => ({
      title: tag(block, 'title'),
      traffic: tag(block, 'ht:approx_traffic'),
      link: tag(block, 'ht:news_item_url') || `https://www.google.com/search?q=${encodeURIComponent(tag(block, 'title'))}`,
    }))
    .filter((t) => t.title);

  return NextResponse.json({ news: list, trends: trends.slice(0, 12), updatedAt: new Date().toISOString() });
}
