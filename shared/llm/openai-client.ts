// ============================================================
// OpenAI client — wraps embedding + classification + generation
// Uses gpt-4o-mini for high-volume classification, gpt-4o for
// outreach + reasoning where quality matters.
// ============================================================

import OpenAI from 'openai';

export class OpenAIClient {
  private readonly client: OpenAI;
  private readonly embeddingModel: string;
  private readonly classificationModel: string;
  private readonly outreachModel: string;

  constructor(opts: {
    apiKey: string;
    embeddingModel?: string;
    classificationModel?: string;
    outreachModel?: string;
  }) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.embeddingModel = opts.embeddingModel ?? 'text-embedding-3-small';
    this.classificationModel = opts.classificationModel ?? 'gpt-4o-mini';
    this.outreachModel = opts.outreachModel ?? 'gpt-4o';
  }

  /** Embed a single string. Returns 1536-dim vector by default. */
  async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return res.data[0]!.embedding;
  }

  /** Embed many strings in one call. */
  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: texts,
    });
    return res.data.map((d) => d.embedding);
  }

  /**
   * Parse a free-text brief to structured spec via gpt-4o-mini with JSON mode.
   */
  async parseBrief(rawText: string): Promise<{
    campaign_type: string | null;
    category: string | null;
    target_gender: string | null;
    target_age_min: number | null;
    target_age_max: number | null;
    target_cities: string[];
    target_languages: string[];
    budget_amount: number | null;
    vibe: string | null;
    reference_creators: string[];
    excluded_creators: string[];
    genre: string | null;
    niche: string | null;
    region: string | null;
    keywords: string[];
  }> {
    const res = await this.client.chat.completions.create({
      model: this.classificationModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You parse Indian D2C brand campaign briefs into structured JSON. The input is often telegraphic ("campaign for holi in UP for trends"). Be intelligent: expand abbreviations, infer category from campaign type + vibe + festival, infer language from region.

Output ONLY a JSON object with these fields:

- campaign_type: one of "brand_launch" | "festive" | "important_days" | "travel" | null
  → Holi/Diwali/Raksha-Bandhan/Eid/Christmas/Onam/Pongal/Navratri = "festive"
  → Mother's Day / Women's Day / Father's Day = "important_days"

- category: one of "skincare" | "fashion" | "beauty" | "food" | "fitness" | "home" | "wellness" | "travel" | "other" | null
  → Brand name "Trends" / "Westside" / "Reliance Trends" → "fashion"
  → "ethnic wear" / "outfit" / "OOTD" / "sari" / "kurta" → "fashion"
  → If festive without explicit category, default to "fashion" (most festive campaigns are apparel)
  → If purely creative (Holi colours / experiences) without product hint, leave null

- target_gender: "male" | "female" | "all" | null

- target_age_min, target_age_max: integers or null

- target_cities: array of Indian CITY names (NOT state abbreviations).
  EXPAND state abbreviations into their major cities:
  - "UP" / "U.P." / "Uttar Pradesh" → ["Lucknow","Kanpur","Varanasi","Noida","Agra"]
  - "MP" / "Madhya Pradesh" → ["Indore","Bhopal","Jabalpur"]
  - "AP" / "Andhra Pradesh" → ["Hyderabad","Visakhapatnam","Vijayawada"]
  - "TN" / "Tamil Nadu" → ["Chennai","Coimbatore","Madurai"]
  - "KA" / "Karnataka" → ["Bangalore","Mysore","Mangalore"]
  - "MH" / "Maharashtra" → ["Mumbai","Pune","Nagpur"]
  - "GJ" / "Gujarat" → ["Ahmedabad","Surat","Vadodara"]
  - "WB" / "West Bengal" → ["Kolkata"]
  - "PB" / "Punjab" → ["Chandigarh","Ludhiana","Amritsar"]
  - "DL" / "NCR" → ["Delhi","Gurgaon","Noida"]
  - "RJ" / "Rajasthan" → ["Jaipur","Udaipur","Jodhpur"]
  - "Tier 1 / metro" without specifics → ["Mumbai","Delhi","Bangalore","Chennai","Hyderabad","Kolkata","Pune"]
  - "Tier 2" → ["Lucknow","Jaipur","Indore","Nagpur","Surat","Coimbatore","Bhopal","Chandigarh"]

- target_languages: array of ISO codes ("hi", "en", "ta", "te", "mr", "kn", "bn", "gu", "pa", "ml", "or").
  INFER from region when not stated:
  - UP / Bihar / MP / Rajasthan / Haryana / Delhi → ["hi","en"]
  - Maharashtra → ["mr","hi","en"]
  - Tamil Nadu → ["ta","en"]
  - Karnataka → ["kn","en"]
  - Telangana / AP → ["te","en"]
  - West Bengal → ["bn","en"]
  - Gujarat → ["gu","hi","en"]
  - Punjab → ["pa","hi","en"]
  - Kerala → ["ml","en"]
  - National / metro / unspecified → ["en","hi"]

- budget_amount: number in INR or null

- vibe: free-form ("premium", "mass", "festive-bright", "minimalist", "trendy")

- reference_creators / excluded_creators: arrays of handles (without @)

- genre: broad content vertical in plain words ("fashion", "beauty", "travel", "food", "fitness", "lifestyle"). Usually mirrors category but stays human-readable. null if unclear.

- niche: the FINE-GRAINED sub-specialty implied by the prompt ("resortwear", "linen styling", "festive ethnic", "street food", "skincare routines"). Be specific. null if the prompt is too generic.

- region: the geographic region/locale the campaign targets in plain words ("Goa", "West India", "South India", "Mumbai metro", "pan-India"). Broader than a single city — derive from the cities/state cues. null if unspecified.

- keywords: 4-10 short lowercase keywords/phrases lifted from or implied by the prompt, used for tag matching ("summer", "goa", "lookbook", "resortwear", "beachwear"). Always return at least 3 when possible.

When uncertain about a single field, infer reasonably from context — DON'T leave critical fields like target_cities or target_languages null when a reasonable inference exists (especially for region/festival cues).`,
        },
        { role: 'user', content: rawText },
      ],
    });
    const content = res.choices[0]?.message?.content ?? '{}';
    return JSON.parse(content);
  }

  /**
   * Generate candidate creator handles for a brief using gpt-4o.
   * Returns ~30-50 plausible Indian IG handles. Caller should de-dupe and verify.
   */
  async generateCandidateHandles(briefSpec: {
    category: string | null;
    target_gender: string | null;
    target_age_min: number | null;
    target_age_max: number | null;
    target_cities: string[];
    target_languages: string[];
    vibe: string | null;
  }): Promise<string[]> {
    const res = await this.client.chat.completions.create({
      model: this.classificationModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You generate plausible Instagram handles of Indian content creators matching a brief.
Output JSON: { "handles": ["handle1", "handle2", ...] }
Up to 50 handles. No @ prefix. Only handles you have reasonable confidence exist.
Prefer creators with 50K-1M followers in the target category. Mix Tier-1 metro and Tier-2 cities. Include vernacular creators where languages are specified.`,
        },
        {
          role: 'user',
          content: `Brief:
- Category: ${briefSpec.category ?? 'general'}
- Audience: ${briefSpec.target_gender ?? 'all'} ${briefSpec.target_age_min ?? '?'}-${briefSpec.target_age_max ?? '?'}
- Cities: ${briefSpec.target_cities.join(', ') || 'pan-India'}
- Languages: ${briefSpec.target_languages.join(', ') || 'en/hi'}
- Vibe: ${briefSpec.vibe ?? 'any'}

Generate 30-50 candidate Instagram handles.`,
        },
      ],
    });
    const content = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.handles)
      ? parsed.handles
          .filter((h: unknown) => typeof h === 'string')
          .map((h: string) => h.replace(/^@/, '').toLowerCase().trim())
          .filter((h: string) => /^[a-z0-9._]+$/i.test(h))
      : [];
  }

  /**
   * Generate 12-15 diverse natural-language search queries from a brief.
   * These run against IG's topsearch endpoint to surface real, IG-ranked
   * users — way better than hallucinated handles. Mix:
   *   - broad category + India queries
   *   - city + category combos
   *   - audience-specific queries (women 25-34, men)
   *   - campaign-type slang ("diwali fashion", "festive look")
   *   - vernacular hashtag-style queries when languages are specified
   */
  async generateDiscoveryQueries(briefSpec: {
    category: string | null;
    target_gender: string | null;
    target_age_min: number | null;
    target_age_max: number | null;
    target_cities: string[];
    target_languages: string[];
    campaign_type: string | null;
    vibe: string | null;
    raw_text?: string;
  }): Promise<string[]> {
    const res = await this.client.chat.completions.create({
      model: this.classificationModel,
      response_format: { type: 'json_object' },
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `You generate Instagram-search queries that surface Indian creators matching a brand brief.
Output JSON: { "queries": ["q1", "q2", ...] }
Generate 12-15 distinct queries.

CRITICAL: IG search matches against usernames + display names + bios. Long descriptive phrases ("ingredient focused skincare india") return zero results. Bias HEAVILY toward SHORT queries (1-3 words) that real creator usernames or bios contain.

Mix MUST include all of these dimensions when relevant:
- 1-word seeds: "skincare", "beauty", "fashion", "lifestyle"
- 2-word combos: "indian skincare", "fashion blogger", "ootd india", "lucknow influencer"
- City alone (USE the cities from target_cities): "lucknow", "kanpur", "noida", etc.
- City × niche: "lucknow fashion", "kanpur ootd", "varanasi creator"
- Festival/campaign slang from campaign_type: "holi outfit", "holi colors", "diwali fashion", "rakhi"
- Vernacular cues from target_languages — for Hindi audiences: "hindi vlogger", "desi creator", "indian girl"; for Marathi: "marathi blogger"; for Tamil: "tamil creator"
- Audience-specific: "indian women", "indian men fashion"

Avoid: "ingredient focused", "premium luxury", "expert", "specialist", "stories", multi-word abstract phrases.

No hashtags. No @s. Lowercase. Make each query distinct.`,
        },
        {
          role: 'user',
          content: `Brief:
- Category: ${briefSpec.category ?? 'general'}
- Campaign type: ${briefSpec.campaign_type ?? 'none'}
- Audience: ${briefSpec.target_gender ?? 'all'} ${briefSpec.target_age_min ?? '?'}-${briefSpec.target_age_max ?? '?'}
- Cities: ${briefSpec.target_cities.join(', ') || 'pan-India'}
- Languages: ${briefSpec.target_languages.join(', ') || 'english/hindi'}
- Vibe: ${briefSpec.vibe ?? 'any'}
${briefSpec.raw_text ? `\nFull brief:\n${briefSpec.raw_text}` : ''}

Generate 12-15 distinct, natural-language search queries.`,
        },
      ],
    });
    const content = res.choices[0]?.message?.content ?? '{}';
    try {
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed.queries)) return [];
      return parsed.queries
        .filter((q: unknown): q is string => typeof q === 'string')
        .map((q: string) => q.trim().toLowerCase().replace(/^[#@]/, ''))
        .filter((q: string) => q.length >= 3 && q.length <= 60);
    } catch {
      return [];
    }
  }

  /**
   * Vision extraction — given a profile screenshot, ask gpt-4o to identify
   * everything visible: bio, niche, content themes, brand collabs, audience
   * hints, vibe, post types. Returns structured JSON with 20+ fields.
   */
  async extractFromProfileScreenshot(imageBase64: string): Promise<Record<string, unknown>> {
    const res = await this.client.chat.completions.create({
      model: this.outreachModel, // gpt-4o has vision
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are analyzing an Instagram profile screenshot. Extract everything visible into structured JSON.
Respond with ONLY a JSON object containing these fields (use null if not visible):
- bio_text: full bio as visible
- niche: one of "fashion","beauty","food","travel","fitness","tech","lifestyle","comedy","education","music","sports","art","family","business","other"
- sub_niches: array of more specific tags (e.g. "ethnic wear", "skincare", "vegan food")
- content_themes: array of recurring themes you can spot from post thumbnails (e.g. "outfit reels", "OOTD flatlays", "city travel")
- post_types_visible: array of types you see — "reel" / "carousel" / "static" / "story_highlight"
- brand_mentions: array of brand names visible in bio or posts
- has_paid_partnership: boolean — any "paid partnership" indicators visible
- has_collab_tag: boolean — any "Collab" tags
- visible_external_link: string or null
- contact_button_visible: boolean (Email / DM button)
- highlights: array of visible story highlight names (max 8)
- visible_post_count: integer count of post thumbnails visible
- estimated_audience_age_band: one of "18-24", "25-34", "35-44", "45+", "mixed"
- estimated_audience_gender_skew: one of "female-heavy", "male-heavy", "balanced", "unknown"
- vibe_tags: array of aesthetic descriptors (e.g. "minimal", "bold", "premium", "playful", "earthy")
- tier_signal: one of "nano (<10k)", "micro (10k-100k)", "macro (100k-1M)", "mega (>1M)"
- india_signal: boolean — anything indicating Indian audience/origin (city, language, flag, currency)
- language_signal: array of detected languages from visible text (e.g. ["en", "hi"])
- safety_concerns: array of any flagged content (e.g. "explicit", "political", "controversial")
- engagement_quality_signal: one of "high", "medium", "low", "unknown" — based on visible like/view counts vs follower count
- profile_completeness_score: integer 0-100 — how complete is the profile (bio, link, photo, posts, highlights all present?)
- visual_quality_score: integer 0-100 — how curated/aesthetic do the posts look
- entity_type: one of "creator" / "shop" / "brand_account" / "agency" / "celebrity" / "publication" / "unknown"
  — "shop" means a retailer / product seller (storefront posts, "DM to order", catalogue, prices, WhatsApp orders)
  — "brand_account" is an official brand account (e.g. Nike India, Sephora India)
  — "agency" is an influencer-management or talent agency
  — "publication" is a media outlet
  — "creator" is an individual human content creator (the type brands hire for influencer marketing)
- entity_type_confidence: one of "high" / "medium" / "low"
Be conservative — when unsure, use null or "unknown".`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract everything you can see from this Instagram profile.' },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'high' },
            },
          ],
        },
      ],
    });
    const content = res.choices[0]?.message?.content ?? '{}';
    return JSON.parse(content);
  }

  /**
   * Generate per-creator reasoning for a shortlist position.
   * Uses gpt-4o (quality matters here for brand trust).
   */
  async generateReasoning(input: {
    brief_summary: string;
    creator_summary: string;
    rank: number;
    match_signals: string[];
  }): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.outreachModel,
      messages: [
        {
          role: 'system',
          content: `You explain why a creator was ranked in a specific position for a brand campaign brief.
Output 3-5 short bulleted reasons, each on its own line, prefixed with "·". Be specific, cite numbers from the data, mention caveats. No hype, no fluff. Indian D2C marketing context.`,
        },
        {
          role: 'user',
          content: `Brief: ${input.brief_summary}
Creator: ${input.creator_summary}
Ranked #${input.rank}
Signals: ${input.match_signals.join('; ')}

Write the reasoning.`,
        },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Generate ONE concrete reel/content concept to ask a creator to make for a
   * campaign — Phase 3 "what video should they make". Fits the creator's style.
   */
  async generateContentBrief(input: {
    handle: string;
    display_name: string | null;
    niche: string | null;
    genre: string | null;
    content_themes: string[];
    campaign: string | null;
  }): Promise<{
    concept: string;
    format: string;
    hook: string;
    rationale: string;
    cta: string;
  }> {
    const res = await this.client.chat.completions.create({
      model: this.outreachModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a short-form content strategist for Indian D2C brand campaigns. Given an influencer and a campaign, propose ONE concrete, production-ready Instagram concept that fits the creator's existing style and reaches their audience.
Respond ONLY with JSON:
{ "concept": "1-2 sentence description of the video", "format": "reel | carousel | story", "hook": "the literal first-3-seconds hook", "rationale": "why this fits THIS creator's audience", "cta": "the call to action" }
Be specific. No hype, no filler.`,
        },
        {
          role: 'user',
          content: `Creator: @${input.handle}${input.display_name ? ` (${input.display_name})` : ''}
Niche: ${input.niche ?? 'general'}
Genre: ${input.genre ?? '—'}
Recurring content themes: ${input.content_themes.join(', ') || 'unknown'}
Campaign: ${input.campaign ?? 'general brand awareness'}

Propose one content concept.`,
        },
      ],
    });
    return JSON.parse(res.choices[0]?.message?.content ?? '{}');
  }

  /**
   * Generate a quick campaign brief from a one-line prompt.
   */
  async generateCampaignBrief(prompt: string): Promise<{
    hook: string;
    format: string;
    cta: string;
    best_window: string;
  }> {
    const res = await this.client.chat.completions.create({
      model: this.outreachModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a short-form content strategist for Indian D2C brand campaigns. Given a one-line campaign brief, produce a concrete, production-ready Instagram brief.
Respond ONLY with JSON:
{ "hook": "the literal first-3-seconds hook, in quotes", "format": "e.g. 15s reel · trending audio", "cta": "the call to action", "best_window": "best posting window, e.g. Thu 7-9pm" }
Be specific and punchy. No hype, no filler.`,
        },
        { role: 'user', content: `Campaign: ${prompt}\n\nWrite the brief.` },
      ],
    });
    return JSON.parse(res.choices[0]?.message?.content ?? '{}');
  }

  /**
   * Turn a few tokens (e.g. "summer pastel 15s body wash") into a full
   * content-ideas pack: a scene-by-scene script, alternative concepts, and a
   * ready-to-post caption + hashtags.
   */
  async generateContentIdeas(prompt: string): Promise<{
    concept: string;
    format: string;
    best_window: string;
    script: { scene: string; onscreen: string; voiceover: string }[];
    ideas: { title: string; desc: string }[];
    caption: string;
    hashtags: string[];
  }> {
    const res = await this.client.chat.completions.create({
      model: this.outreachModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a short-form content director for Indian D2C brands. Given a few tokens describing a post (vibe, duration, product), produce a concrete, production-ready content pack for an Instagram reel.
Respond ONLY with JSON in this exact shape:
{
  "concept": "one-line creative concept",
  "format": "e.g. 15s reel · trending pastel audio",
  "best_window": "best posting window, e.g. Thu 7-9pm",
  "script": [ { "scene": "0-3s", "onscreen": "on-screen text", "voiceover": "what's said / audio cue" } ],
  "ideas": [ { "title": "alt idea title", "desc": "one-line description" } ],
  "caption": "ready-to-post caption with 1-2 emojis",
  "hashtags": ["#tag1", "#tag2"]
}
Rules: 4-6 script scenes covering hook -> body -> CTA with concrete shot/voiceover direction; 3-5 alternative ideas; 6-10 relevant hashtags. Be specific and punchy, no hype or filler.`,
        },
        { role: 'user', content: `Tokens: ${prompt}\n\nWrite the content pack.` },
      ],
    });
    return JSON.parse(res.choices[0]?.message?.content ?? '{}');
  }

  /**
   * Generate a personalised outreach DM for a creator.
   */
  async generateOutreach(input: {
    brand_name: string;
    brand_voice_samples: string[];
    creator_handle: string;
    creator_recent_topics: string[];
    campaign_summary: string;
    channel: 'ig_dm' | 'email';
  }): Promise<string> {
    const isDM = input.channel === 'ig_dm';
    const res = await this.client.chat.completions.create({
      model: this.outreachModel,
      messages: [
        {
          role: 'system',
          content: `You write first-touch outreach messages from a brand to a creator.
${isDM ? 'Format: Instagram DM. 2-3 sentences, casual, no formal greeting beyond "hi @handle".' : 'Format: cold email. Subject line then 4-6 sentence body.'}
Tone: matches the brand voice samples. Never claim things not in the brief. Always reference the creator's recent content (the "topics") to show you actually looked. End with a soft CTA. No emojis unless the brand voice uses them.`,
        },
        {
          role: 'user',
          content: `Brand: ${input.brand_name}
Brand voice samples:
${input.brand_voice_samples.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Creator: @${input.creator_handle}
Recent topics they post about: ${input.creator_recent_topics.join(', ')}

Campaign: ${input.campaign_summary}

Write the ${isDM ? 'DM' : 'email'}.`,
        },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }
}

let cached: OpenAIClient | null = null;

export function getOpenAIClient(): OpenAIClient {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  cached = new OpenAIClient({
    apiKey,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
    classificationModel: process.env.OPENAI_CLASSIFICATION_MODEL,
    outreachModel: process.env.OPENAI_OUTREACH_MODEL,
  });
  return cached;
}
