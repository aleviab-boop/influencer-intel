import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import { igFetch } from '@/lib/ig-fetch';

export const runtime = 'nodejs';
export const maxDuration = 30;

const IG_HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  Referer: 'https://www.instagram.com/',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

// Pull a creator's most-recent caption + hashtag themes for a *warm* opener —
// referencing something they actually posted. Best-effort; never blocks the draft.
async function fetchRecentContext(
  handle: string,
): Promise<{ highlight: string; themes: string[]; langHint: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await igFetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      { headers: IG_HEADERS, signal: ctrl.signal },
    ).finally(() => clearTimeout(timer));
    if (!res.ok) return { highlight: '', themes: [], langHint: '' };
    const u = (await res.json())?.data?.user;
    const edges = u?.edge_owner_to_timeline_media?.edges ?? [];
    const captions: string[] = edges
      .map((e: { node?: { edge_media_to_caption?: { edges?: { node?: { text?: string } }[] } } }) =>
        (e.node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? '').trim(),
      )
      .filter(Boolean);

    // Language hint: Devanagari anywhere in bio/captions → Hindi-speaking creator,
    // for whom a Hinglish DM lands warmer than English.
    const sample = `${u?.biography ?? ''} ${captions.join(' ')}`;
    const langHint = /[\u0900-\u097F]/.test(sample) ? 'hinglish' : '';

    // Themes = most-used hashtags across recent captions.
    const tags = new Map<string, number>();
    for (const c of captions) {
      for (const m of c.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
        const t = m[1]!.toLowerCase();
        tags.set(t, (tags.get(t) ?? 0) + 1);
      }
    }
    const themes = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

    // Highlight = the latest caption, stripped of hashtags/mentions, trimmed.
    const highlight = (captions[0] ?? '')
      .replace(/#[\p{L}\p{N}_]+/gu, '')
      .replace(/@[\w.]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);

    return { highlight, themes, langHint };
  } catch {
    return { highlight: '', themes: [], langHint: '' };
  }
}

const LANG_LABEL: Record<string, string> = {
  hinglish: 'Hinglish (a natural Romanized Hindi-English mix, written in Latin script)',
  hindi: 'Hindi (Devanagari script)',
  english: 'English',
};

// POST /api/discover-live/outreach
//   { handle, prompt, category?, channel?: 'dm' | 'email', brand? }
//   → { message } — an AI-drafted, warm first-touch message for the creator.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const handle = typeof body?.handle === 'string' ? body.handle.trim().replace(/^@/, '') : '';
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!handle) {
    return NextResponse.json({ error: 'handle is required' }, { status: 400 });
  }

  const channel = body?.channel === 'email' ? 'email' : 'ig_dm';
  const brand = typeof body?.brand === 'string' && body.brand.trim() ? body.brand.trim() : 'our brand';
  const category = typeof body?.category === 'string' ? body.category.trim() : '';

  const { highlight, themes, langHint } = await fetchRecentContext(handle);
  // Prefer real post themes; fall back to the search prompt's words.
  const promptTopics = [category, ...prompt.split(/\s+/)].map((t) => t.trim()).filter(Boolean);
  const topics = themes.length > 0 ? themes : promptTopics;

  // Language: explicit client choice wins; 'auto' uses the detected hint.
  const reqLang = typeof body?.language === 'string' ? body.language.trim().toLowerCase() : 'auto';
  const language = reqLang === 'auto' ? (langHint ? LANG_LABEL.hinglish : '') : (LANG_LABEL[reqLang] ?? '');

  try {
    const message = await getOpenAIClient().generateOutreach({
      brand_name: brand,
      brand_voice_samples: [],
      creator_handle: handle,
      creator_recent_topics: Array.from(new Set(topics)).slice(0, 6),
      campaign_summary: prompt || `collaboration with ${handle}`,
      channel,
      recent_highlight: highlight,
      language,
      followup: body?.followup === true,
    });
    return NextResponse.json({ message, language: language ? reqLang === 'auto' ? 'hinglish' : reqLang : 'english' });
  } catch (err) {
    console.error('[outreach] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
