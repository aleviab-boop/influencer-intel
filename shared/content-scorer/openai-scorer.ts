import type { ContentScoreRequest, ContentScoreResponse } from '../types/growth-engine.js';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

// Content-quality scoring now runs on OpenAI gpt-4o vision (the same key the
// rest of the platform uses), rather than Gemini. The 12-dimension prompt,
// weights and image byte-inlining live in OpenAIClient.scoreContentQuality.
// This module keeps the stable `scoreContent(req)` API so callers don't change.
export async function scoreContent(req: ContentScoreRequest): Promise<ContentScoreResponse> {
  return getOpenAIClient().scoreContentQuality(req);
}
