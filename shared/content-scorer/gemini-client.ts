import type { ContentScores, ContentScoreRequest, ContentScoreResponse, PerformanceBucket, InsightConfidence } from '../types/growth-engine.js';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const SCORING_PROMPT = `You are an expert Instagram content analyst. Score this content on 12 dimensions, each from 0.0 to 1.0.

Dimensions:
1. hook_strength — How compelling is the first 1-3 seconds? Does it stop the scroll?
2. retention_design — Does the content maintain attention throughout? Pacing, pattern interrupts, curiosity gaps.
3. information_density — Value delivered per second of watch time.
4. emotional_trigger — Does it evoke strong emotion? Surprise, humor, inspiration, outrage, nostalgia.
5. production_quality — Lighting, framing, audio clarity, editing polish.
6. trend_leverage — Does it use trending audio, formats, or cultural references?
7. brand_integration — If branded, how naturally is the product/brand woven in? (1.0 = seamless, 0.3 = forced)
8. cta_effectiveness — Does it prompt saves, shares, comments, or follows?
9. audio_fit — Does the audio enhance the content? Music-content sync, voiceover quality.
10. shareability — Would someone DM this to a friend?
11. comment_magnetism — Does it provoke opinions, questions, tags?
12. niche_authority — Does the creator demonstrate expertise in their niche?

Respond ONLY with valid JSON:
{
  "hook_strength": 0.0, "retention_design": 0.0, "information_density": 0.0,
  "emotional_trigger": 0.0, "production_quality": 0.0, "trend_leverage": 0.0,
  "brand_integration": 0.0, "cta_effectiveness": 0.0, "audio_fit": 0.0,
  "shareability": 0.0, "comment_magnetism": 0.0, "niche_authority": 0.0,
  "improvement_suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]
}`;

const DIMENSION_WEIGHTS: Record<string, number> = {
  hook_strength: 0.15, retention_design: 0.12, information_density: 0.08,
  emotional_trigger: 0.10, production_quality: 0.07, trend_leverage: 0.10,
  brand_integration: 0.08, cta_effectiveness: 0.05, audio_fit: 0.07,
  shareability: 0.08, comment_magnetism: 0.05, niche_authority: 0.05,
};

// Fetch an image URL and return it as Gemini inlineData, so the model actually
// sees the pixels rather than just being told a URL string. Returns null on any
// failure (non-image, too big, network error) — the caller then falls back to a
// text-only score. Bounded to ~5MB to keep the request small.
async function fetchInlineImage(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 5_000_000) return null;
    return { mimeType: ct, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

export async function scoreContent(req: ContentScoreRequest): Promise<ContentScoreResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  // Prefer an explicit thumbnail; else the media itself if it's an image.
  const imageCandidate = req.thumbnail_url
    || (req.media_type === 'IMAGE' ? req.media_url : undefined);
  const inline = imageCandidate ? await fetchInlineImage(imageCandidate) : null;
  const vision = inline != null;

  const prompt = `${SCORING_PROMPT}\n\nContent type: ${req.media_type}\nCaption: ${req.caption ?? '(no caption)'}\nCreator category: ${req.creator_category ?? 'unknown'}\n\n${vision ? 'Analyze the attached image (a frame/cover of the content).' : `Analyze the content at: ${req.media_url}`}`;

  const parts: Array<Record<string, unknown>> = [];
  if (inline) parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.data } });
  parts.push({ text: prompt });

  const res = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    },
  );

  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);

  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  const text = data.candidates[0]?.content?.parts[0]?.text;
  if (!text) throw new Error('Empty Gemini response');

  const raw = JSON.parse(text) as Record<string, unknown>;

  const scores: ContentScores = {
    hook_strength: Number(raw.hook_strength ?? 0),
    retention_design: Number(raw.retention_design ?? 0),
    information_density: Number(raw.information_density ?? 0),
    emotional_trigger: Number(raw.emotional_trigger ?? 0),
    production_quality: Number(raw.production_quality ?? 0),
    trend_leverage: Number(raw.trend_leverage ?? 0),
    brand_integration: Number(raw.brand_integration ?? 0),
    cta_effectiveness: Number(raw.cta_effectiveness ?? 0),
    audio_fit: Number(raw.audio_fit ?? 0),
    shareability: Number(raw.shareability ?? 0),
    comment_magnetism: Number(raw.comment_magnetism ?? 0),
    niche_authority: Number(raw.niche_authority ?? 0),
    overall_weighted: 0,
    improvement_suggestions: (raw.improvement_suggestions as string[] | undefined) ?? [],
  };

  let weighted = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    weighted += (scores[dim as keyof ContentScores] as number) * weight;
  }
  scores.overall_weighted = Math.round(weighted * 1000) / 1000;

  let bucket: PerformanceBucket = 'average';
  if (scores.overall_weighted >= 0.75) bucket = 'breakout';
  else if (scores.overall_weighted >= 0.55) bucket = 'above_average';
  else if (scores.overall_weighted < 0.35) bucket = 'below_average';

  return {
    scores,
    overall_bucket_estimate: bucket,
    // Seeing the image lifts confidence above a caption-only guess.
    confidence: (vision ? 'medium' : 'low') as InsightConfidence,
    vision,
  };
}
