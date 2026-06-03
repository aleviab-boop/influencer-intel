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

export async function scoreContent(req: ContentScoreRequest): Promise<ContentScoreResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const prompt = `${SCORING_PROMPT}\n\nContent type: ${req.media_type}\nCaption: ${req.caption ?? '(no caption)'}\nCreator category: ${req.creator_category ?? 'unknown'}\n\nAnalyze the content at: ${req.media_url}`;

  const res = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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
    confidence: 'low' as InsightConfidence,
  };
}
