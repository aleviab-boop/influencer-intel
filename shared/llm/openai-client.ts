// ============================================================
// OpenAI client — wraps embedding + classification + generation
// Uses gpt-4o-mini for high-volume classification, gpt-4o for
// outreach + reasoning where quality matters.
// ============================================================

import OpenAI from 'openai';
import type {
  ContentScoreRequest,
  ContentScoreResponse,
  ContentScores,
  PerformanceBucket,
  InsightConfidence,
} from '../types/growth-engine.js';

// ── Brand campaign ideation ───────────────────────────────────────────────
// Input a brand profile → the web-search model browses for what's trending in
// that niche RIGHT NOW and drafts campaign concepts a brand could run. Each
// concept carries a `creator_query` the caller turns into a DB creator search,
// so trend → campaign → creator shortlist is one flow.
export interface BrandCampaignInput {
  brand: string;              // brand name
  category: string;           // niche, e.g. "skincare", "fitness apparel"
  audience?: string | null;   // free text, e.g. "women 18-34, metro + tier-2"
  cities?: string[];          // target cities
  budget?: string | null;     // 'low' | 'mid' | 'high' or free text
  goals?: string | null;      // free text, e.g. "festive sales push"
  // First-party trends measured from our OWN crawl data (trend_signals), passed
  // in by the caller. When present the model anchors to THESE (with the live web
  // search adding freshness) instead of guessing trends purely from the web.
  measuredTrends?: string[];
  // Distilled Brand DNA context (positioning, values, voice, content pillars,
  // fitting creator types) so concepts sound on-brand. Filled server-side from
  // the saved brand_dna analysis when available.
  brandContext?: string | null;
}

export interface BrandCampaignConcept {
  title: string;              // short campaign name
  angle: string;              // one-line description of the idea
  trend: {
    name: string;             // the trend it rides, e.g. "#MonsoonSkincare"
    type: string;             // 'audio' | 'hashtag' | 'topic' | 'format'
    why_now: string;          // why this trend is hot right now
  };
  format: string;             // 'Reel series', 'GRWM', 'Talking-head', …
  campaign_type: string;      // 'barter' | 'paid' | 'UGC' | 'ambassador'
  hashtags: string[];         // suggested campaign hashtags
  deliverables: string;       // what each creator delivers
  creator_query: string;      // plain-English query to shortlist creators
}

// ── Brand DNA ─────────────────────────────────────────────────────────────
// Point the web-search model at a brand's website + socials and distil a
// structured "DNA" profile — who they are, how they sound, who they sell to and
// what kind of creators fit. This front-loads the campaign flow: DNA → campaign
// suggestions → creator shortlist → outreach.
export interface BrandDnaInput {
  brand: string;              // brand name
  url?: string | null;        // website URL to analyse
  social?: string | null;     // Instagram handle or profile URL
  notes?: string | null;      // any extra context the user typed
  // Real scraped content (from lib/brand-scrape). When present the model grounds
  // the DNA on the ACTUAL site + IG rather than guessing from the name alone.
  siteText?: string | null;   // visible copy scraped from the website
  siteTitle?: string | null;  // <title> / og:title
  siteDescription?: string | null; // meta description
  igBio?: string | null;      // Instagram bio
  igCategory?: string | null; // Instagram category label
  igFollowers?: number | null;// Instagram follower count
  igCaptions?: string[] | null; // recent post captions
}

export interface BrandDnaProfile {
  brand: string;              // echoed brand name
  summary: string;            // 1–2 line "who they are"
  category: string;           // primary niche, e.g. "ayurvedic skincare"
  positioning: string;        // premium/value/etc + market stance
  values: string[];           // core brand values
  personality: string[];      // tone/voice adjectives
  target_audience: string;    // who they sell to
  aesthetic: string;          // visual style / look & feel
  content_pillars: string[];  // recurring content themes
  keywords: string[];         // discovery keywords for search
  creator_archetypes: string[]; // creator types that fit the brand
  competitors: string[];      // named competitors / peers
  opportunities: string[];    // concrete ways the brand could market/grow better
}

// ── Content-quality scoring (vision) ──────────────────────────────────────
// Score a post's creative on 12 dimensions from the actual image (a photo, or a
// reel's cover frame). Powers the reach predictor's content-quality multiplier.

const CONTENT_SCORING_PROMPT = `You are an expert Instagram content analyst. Score this content on 12 dimensions, each from 0.0 to 1.0.

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

const CONTENT_DIMENSION_WEIGHTS: Record<string, number> = {
  hook_strength: 0.15, retention_design: 0.12, information_density: 0.08,
  emotional_trigger: 0.10, production_quality: 0.07, trend_leverage: 0.10,
  brand_integration: 0.08, cta_effectiveness: 0.05, audio_fit: 0.07,
  shareability: 0.08, comment_magnetism: 0.05, niche_authority: 0.05,
};

// Fetch an image URL and return it as a base64 data URL, so the model actually
// sees the pixels rather than being handed a URL string it may not fetch.
// Returns null on any failure (non-image, too big, network error) — the caller
// then falls back to a caption-only score. Bounded to ~5MB to keep the request small.
async function fetchInlineImageDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 5_000_000) return null;
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

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
   * Infer each creator's gender from their handle + display name + bio, in ONE
   * batched call. Returns a map handle -> 'female' | 'male' | 'unknown'. Uses bio
   * context (pronouns, "makeup artist", etc.), not just the name — and returns
   * 'unknown' for brands / ambiguous cases rather than guessing.
   */
  async inferGenders(
    items: Array<{ handle: string; name?: string | null; bio?: string | null }>,
  ): Promise<Record<string, 'female' | 'male' | 'unknown'>> {
    if (items.length === 0) return {};
    const payload = items.slice(0, 60).map((i) => ({
      handle: i.handle,
      name: (i.name ?? '').slice(0, 60),
      bio: (i.bio ?? '').slice(0, 200),
    }));
    try {
      const res = await this.client.chat.completions.create({
        model: this.classificationModel,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You label the GENDER OF THE CREATOR (the account owner/person), not their audience, for Indian Instagram creators. Signals, strongest first:
1. Explicit pronouns (she/her, he/him) or self-descriptors ("makeup artist", "bridal", "girl", "mom", "dad", "boy", "himself/herself").
2. The person's FIRST NAME in the display name or handle — the great majority of Indian first names are reliably gendered (e.g. Priya, Sneha, Ananya, Pooja, Riya, Neha, Aditi, Kavya → female; Rahul, Amit, Arjun, Rohit, Vikram, Sahil → male). A recognizable gendered first name IS enough to commit.
COMMIT to "female" or "male" whenever any signal above gives a reasonable read — prefer committing over "unknown". Only return "unknown" for brands / businesses / shops / couples / groups / fan pages, or when there is genuinely no name and no other signal. Do not sit on the fence for a clearly-gendered name just because you lack a photo.

Output ONLY JSON: { "results": [ { "handle": "...", "gender": "female"|"male"|"unknown" } ] } — one entry per input handle.`,
          },
          { role: 'user', content: JSON.stringify({ creators: payload }) },
        ],
      });
      const raw = res.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as { results?: Array<{ handle?: string; gender?: string }> };
      const out: Record<string, 'female' | 'male' | 'unknown'> = {};
      for (const r of parsed.results ?? []) {
        const g = r.gender === 'female' || r.gender === 'male' ? r.gender : 'unknown';
        if (r.handle) out[r.handle.toLowerCase()] = g;
      }
      return out;
    } catch {
      return {};
    }
  }

  /**
   * Verify whether each candidate creator genuinely matches a search brief
   * (right NICHE + India-based / right city). Used to filter the noise that
   * slips through AI web-search suggestions — e.g. a makeup artist or a foreign
   * account surfacing for an "aquascaping in bangalore" query. Judges from the
   * bio/name/category we already fetched (NOT an existence check — Instagram
   * validation handles that). Returns handle → keep?. Fail-OPEN: on any error
   * the map is empty and the caller keeps everything; a thin/empty bio also
   * defaults to keep, so we never discard an unenriched account we can't judge.
   */
  async verifyProfileRelevance(
    prompt: string,
    items: Array<{ handle: string; name?: string | null; bio?: string | null; category?: string | null }>,
  ): Promise<Record<string, boolean>> {
    if (items.length === 0) return {};
    const payload = items.slice(0, 30).map((i) => ({
      handle: i.handle,
      name: (i.name ?? '').slice(0, 60),
      bio: (i.bio ?? '').slice(0, 220),
      category: (i.category ?? '').slice(0, 40),
    }));
    try {
      const res = await this.client.chat.completions.create({
        model: this.classificationModel,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You verify whether each Instagram creator genuinely MATCHES a search brief for an INDIAN influencer-marketing platform. Given the brief and a list of creators (handle, name, bio, category), decide for EACH whether they are a real fit.
Mark relevant = true ONLY if BOTH hold:
1. NICHE — their bio / name / category clearly shows they create content in the brief's niche or topic. A merely ADJACENT or different field is NOT a match (e.g. a MAKEUP artist is NOT relevant to an "aquascaping" brief; a generic "fishing/angler" page is NOT "aquascaping").
2. LOCATION — they are based in India, and (if the brief names a city/region) plausibly in or near it. An empty / unknown location is acceptable. A clearly FOREIGN creator (bio in another language, or based in e.g. France, Spain, the US) is NOT relevant.
When the bio is empty or too thin to judge, default relevant = true — never discard an unenriched account we simply can't assess yet.
Output ONLY JSON: { "results": [ { "handle": "...", "relevant": true|false, "reason": "<=6 words" } ] } — one entry per input handle.`,
          },
          { role: 'user', content: JSON.stringify({ brief: prompt, creators: payload }) },
        ],
      });
      const raw = res.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as { results?: Array<{ handle?: string; relevant?: boolean }> };
      const out: Record<string, boolean> = {};
      for (const r of parsed.results ?? []) {
        if (r.handle) out[r.handle.toLowerCase()] = r.relevant !== false; // default keep
      }
      return out;
    } catch {
      return {}; // fail-open — caller keeps everything on any error
    }
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
   * Web-search-grounded completion via the Responses API. OpenAI deprecated the
   * chat `gpt-4o-mini-search-preview` model (404 model_not_found), so we now run
   * gpt-4o-mini with the built-in `web_search` tool — same live-browsing power,
   * current API. Returns the assistant's text; callers parse JSON leniently.
   */
  private async webSearch(system: string, user: string, model = 'gpt-4o-mini'): Promise<string> {
    const res = await this.client.responses.create({
      model,
      tools: [{ type: 'web_search_preview' }],
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return res.output_text ?? '';
  }

  /**
   * Suggest REAL Instagram handles for a plain-English prompt (e.g. "fashion
   * influencer in guwahati"). Instagram blocks keyword search for our session,
   * so we let the model name creators it knows; every handle is validated
   * against Instagram afterwards, so hallucinations are dropped downstream.
   * Prefers genuine local / mid-tier creators over global celebrities.
   */
  async suggestHandlesFromPrompt(prompt: string, max = 15): Promise<string[]> {
    // Uses a web-search-enabled model so it actually BROWSES the web (creator
    // lists, blogs, directories) for current, real handles — far better than a
    // plain model guessing from training memory. Search models don't accept
    // temperature / json response_format, so we prompt for JSON and parse
    // leniently (they often reply with prose + citations).

    // FESTIVAL / occasion briefs ("durga puja campaign", "diwali creators") are
    // ambiguous to the model on their own — it drifts to food or accounts that
    // merely have the festival's NAME in the handle. Steer it explicitly toward
    // festive-FASHION / ethnic-wear / lifestyle creators (who a brand actually
    // hires for a festive campaign), and warn it off name-matches and event pages.
    const isFestival =
      /\b(durga\s*puja|durgapujo?|pujo|navratri|navaratri|garba|dandiya|diwali|deepavali|onam|ganesh\s*chaturthi|pongal|holi|raksha\s*bandhan|rakhi|karwa\s*chauth|eid|christmas|festive|festival)\b/i.test(
        prompt,
      );
    const userContent = isFestival
      ? `${prompt}

This is a FESTIVE / occasion campaign brief. Suggest Indian FASHION, ethnic-wear, styling, beauty and lifestyle creators who post festive OUTFIT / look / celebration content for this occasion (saree & ethnic-wear styling, festive GRWM, traditional-wear hauls, celebration lifestyle). Do NOT suggest: accounts that merely contain the festival's name in their handle, event / community / pandal / temple pages, brands or sarees shops, or people simply named after a deity. Real, currently-active Indian creators only.`
      : prompt;

    const content = await this.webSearch(
      `You are an Instagram creator-research assistant for an INDIAN influencer-marketing platform. Search the web to find REAL Instagram creators that match BOTH the niche and the location in the query.
Rules:
- INDIA ONLY. Only creators based in India, who are Indian and post for an Indian audience. NEVER suggest foreign / international / non-Indian creators or accounts based outside India. If unsure whether a creator is Indian, do not include them.
- If the query names an Indian city, prioritise creators actually from that city; if no location is given, assume India-wide.
- Prefer genuine local / mid-tier Indian creators (nano to ~1M followers) over big celebrities.
- Exclude brands, news outlets, agencies, marketplaces, meme/fan pages.
- Only real, existing handles you can find via search — never invent or guess.
Respond with ONLY a JSON object, no prose and no markdown fences: {"handles":["username1","username2"]} with at most ${max} handles, no @ prefix.`,
      userContent,
    );
    return this.parseHandles(content, max);
  }

  /**
   * Draft trend-driven campaign concepts for a brand. Uses the web-search model
   * so it grounds ideas in what's ACTUALLY trending for the niche right now
   * (seasonal moments, hot hashtags/audio, cultural events) rather than guessing
   * from stale training memory. Each concept includes a `creator_query` the
   * caller feeds into the DB creator search to attach a shortlist. Search models
   * reply with prose + citations, so we parse the embedded JSON leniently.
   */
  async suggestBrandCampaigns(input: BrandCampaignInput, max = 4): Promise<BrandCampaignConcept[]> {
    const cities = (input.cities ?? []).filter(Boolean).slice(0, 8);
    const measured = (input.measuredTrends ?? []).filter(Boolean).slice(0, 15);
    const brief = [
      `Brand: ${input.brand}`,
      `Category / niche: ${input.category}`,
      input.audience ? `Target audience: ${input.audience}` : '',
      cities.length ? `Target cities: ${cities.join(', ')}` : '',
      input.budget ? `Budget: ${input.budget}` : '',
      input.goals ? `Goals: ${input.goals}` : '',
      input.brandContext ? `Brand DNA (keep every concept on-brand with this):\n${input.brandContext}` : '',
      measured.length
        ? `Trends we measured from real creator activity in this niche (prefer these — they are first-party and current):\n- ${measured.join('\n- ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const content = await this.webSearch(
      `You are an influencer-marketing strategist for an INDIAN brand platform. Search the web for what is trending RIGHT NOW on Instagram reels for the brand's niche in India — hot hashtags, trending audio, seasonal/cultural moments (festivals, cricket, weather), and content formats — and design ${max} distinct campaign concepts the brand could run this month.
Rules:
- Ground every concept in a REAL, current trend — name it and say why it's hot now. Prefer emerging/growing trends over saturated ones.
- If the brief lists "Trends we measured from real creator activity", treat those as the strongest signal and build most concepts around them; use web search to confirm why each is hot and to fill any gaps.
- Concepts must be practical for creator marketing in India (barter drops, UGC, paid reels, ambassador programs).
- Keep it India-relevant: Indian festivals, cities, audience.
- For each concept include a "creator_query": a short plain-English search string (niche + audience + city words) that a creator-database search would use to find the right influencers — e.g. "skincare micro influencer mumbai women".
Respond with ONLY a JSON object, no prose and no markdown fences:
{"campaigns":[{"title":"...","angle":"one line","trend":{"name":"#Tag or audio/topic","type":"hashtag|audio|topic|format","why_now":"..."},"format":"Reel series|GRWM|Talking-head|...","campaign_type":"barter|paid|UGC|ambassador","hashtags":["#a","#b"],"deliverables":"what each creator posts","creator_query":"niche audience city words"}]}
At most ${max} campaigns.`,
      brief,
    );
    return this.parseCampaignConcepts(content, max);
  }

  /** Pull the campaign array out of an LLM reply (clean JSON, else the first
   *  {...} block containing "campaigns"), normalising each concept's shape. */
  private parseCampaignConcepts(content: string, max: number): BrandCampaignConcept[] {
    const asStr = (v: unknown, fallback = ''): string =>
      typeof v === 'string' ? v.trim() : fallback;
    const asArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : [];
    const normalise = (c: Record<string, unknown>): BrandCampaignConcept | null => {
      const title = asStr(c.title);
      if (!title) return null;
      const t = (c.trend && typeof c.trend === 'object' ? c.trend : {}) as Record<string, unknown>;
      return {
        title,
        angle: asStr(c.angle),
        trend: { name: asStr(t.name), type: asStr(t.type, 'topic'), why_now: asStr(t.why_now) },
        format: asStr(c.format),
        campaign_type: asStr(c.campaign_type),
        hashtags: asArr(c.hashtags),
        deliverables: asStr(c.deliverables),
        creator_query: asStr(c.creator_query),
      };
    };
    const fromParsed = (parsed: unknown): BrandCampaignConcept[] | null => {
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { campaigns?: unknown }).campaigns)
          ? (parsed as { campaigns: unknown[] }).campaigns
          : null;
      if (!arr) return null;
      const out = arr
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map(normalise)
        .filter((c): c is BrandCampaignConcept => c !== null);
      return out.length ? out.slice(0, max) : null;
    };

    // 1. Whole content is JSON.
    try {
      const whole = fromParsed(JSON.parse(content));
      if (whole) return whole;
    } catch {
      /* fall through */
    }
    // 2. First {...} block that mentions "campaigns".
    const objMatch = content.match(/\{[\s\S]*"campaigns"[\s\S]*\}/);
    if (objMatch) {
      try {
        const out = fromParsed(JSON.parse(objMatch[0]));
        if (out) return out;
      } catch {
        /* fall through */
      }
    }
    // 3. First bare [...] array.
    const arrMatch = content.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        const out = fromParsed(JSON.parse(arrMatch[0]));
        if (out) return out;
      } catch {
        /* give up */
      }
    }
    return [];
  }

  /**
   * Build a structured Brand DNA profile from a brand's name + website + social.
   * Uses the web-search model so it reads the ACTUAL site/socials (positioning,
   * tone, products, audience) rather than hallucinating from the name alone.
   * Search models reply with prose + citations, so the JSON is parsed leniently.
   */
  async analyzeBrandDna(input: BrandDnaInput): Promise<BrandDnaProfile> {
    const igCaptions = (input.igCaptions ?? []).filter(Boolean).slice(0, 12);
    const brief = [
      `Brand name: ${input.brand}`,
      input.url ? `Website: ${input.url}` : '',
      input.social ? `Social profile: ${input.social}` : '',
      input.notes ? `Extra context: ${input.notes}` : '',
      // Scraped, first-party ground truth — the model MUST base the DNA on this.
      input.siteTitle ? `\n[Scraped website title] ${input.siteTitle}` : '',
      input.siteDescription ? `[Scraped website description] ${input.siteDescription}` : '',
      input.siteText ? `[Scraped website copy]\n${input.siteText}` : '',
      input.igBio ? `\n[Scraped Instagram bio] ${input.igBio}` : '',
      input.igCategory ? `[Instagram category] ${input.igCategory}` : '',
      typeof input.igFollowers === 'number' && input.igFollowers > 0
        ? `[Instagram followers] ${input.igFollowers.toLocaleString()}`
        : '',
      igCaptions.length ? `[Recent Instagram post captions]\n- ${igCaptions.join('\n- ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const hasScrape = Boolean(input.siteText || input.igBio || igCaptions.length);
    const content = await this.webSearch(
      `You are a brand strategist for an INDIAN influencer-marketing platform. Distil a concise, factual "Brand DNA" profile that will drive creator-campaign planning.${
        hasScrape
          ? ' The brief below includes REAL scraped content from the brand\'s own website and Instagram — treat it as ground truth and base the DNA primarily on it. Use web search only to fill gaps or confirm.'
          : ' Search the web for the brand\'s website and social profiles.'
      } Base it on what you actually find; do not invent facts. If something is genuinely unknowable, give your best inference from the category.
Respond with ONLY a JSON object, no prose and no markdown fences:
{"summary":"1-2 lines on who they are","category":"primary niche","positioning":"premium/value/etc + market stance","values":["..."],"personality":["tone adjectives"],"target_audience":"who they sell to","aesthetic":"visual style","content_pillars":["themes"],"keywords":["discovery keywords"],"creator_archetypes":["creator types that fit"],"competitors":["named peers"],"opportunities":["concrete, specific ways this brand could market or grow better via creators/social"]}
Keep arrays to 3-7 items, India-relevant where applicable. "opportunities" must be actionable and specific to THIS brand, not generic advice.`,
      brief,
    );
    return this.parseBrandDna(content, input.brand);
  }

  /**
   * Suggest REAL Instagram creators who have PREVIOUSLY WORKED WITH the brand —
   * paid partnerships, gifting/PR, ambassadors, UGC. Uses the web-search model so
   * it browses for actual, verifiable collaborations (press, the brand's tagged
   * posts, creator "#ad" posts) rather than guessing. `seedHandles` are creators
   * the brand tags in its own captions (a strong first-party signal we already
   * scraped) — the model should confirm/keep those and add more it can verify.
   * Every handle is validated against Instagram + the creator DB downstream, so
   * hallucinations are dropped. Returns lowercase handles, no @.
   */
  async suggestBrandCollaborators(
    brand: string,
    opts: { category?: string; products?: string; seedHandles?: string[]; max?: number } = {},
  ): Promise<string[]> {
    const max = opts.max ?? 12;
    const seeds = (opts.seedHandles ?? []).filter(Boolean).slice(0, 20);
    const brief = [
      `Brand: ${brand}`,
      opts.category ? `Category / niche: ${opts.category}` : '',
      opts.products ? `What the brand makes / sells: ${opts.products}` : '',
      seeds.length
        ? `Creators this brand tags in its own Instagram posts (strong signal they have collaborated — keep the real ones and add more):\n- ${seeds.join('\n- ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const content = await this.webSearch(
      `You are an influencer-marketing researcher for an INDIAN brand platform. Search the web to find REAL Instagram creators connected to this brand, in this order of preference:
1. Creators who have ACTUALLY worked with / been gifted by THIS brand before — look at the brand's tagged & mentioned Instagram posts, press coverage, and creators' own sponsored "#ad"/"paid partnership"/"gifted" posts naming the brand.
2. If few or none can be verified for this exact brand, add creators who have done sponsored/gifted posts for the SAME kind of products (e.g. for a kitchenware/appliances/bottles/bags brand: home & kitchen creators, gadget/appliance reviewers, lunchbox/tiffin & meal-prep creators, travel/lifestyle creators who feature bottles & bags, homemaker & organisation creators) — the exact creators a brand like this hires.
Rules:
- INDIA ONLY — real, currently-active Indian creators. Never invent or guess handles; only handles you can find via search.
- Prefer genuine nano / micro / mid-tier creators (a few thousand to ~1M followers) over big celebrities.
- Exclude the brand's OWN accounts and any account whose handle is basically the brand name or a reseller/shop/regional page, plus news outlets, marketplaces and agencies.
Respond with ONLY a JSON object, no prose and no markdown fences: {"handles":["username1","username2"]} with at most ${max} handles, no @ prefix.`,
      brief,
      // Collaborator recall is a harder research task than the other web-search
      // calls — gpt-4o finds materially more real, correct handles than -mini.
      'gpt-4o',
    );
    const found = this.parseHandles(content, max);
    // Drop handles that are basically the brand's own name (reseller / regional /
    // shop pages the model sometimes returns — e.g. "milton_homewares",
    // "miltonindia"). A creator's handle rarely contains the brand name; brand-
    // owned pages almost always do. Seeds are exempt (they are first-party truth).
    const brandTokens = brand
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4); // ignore short/common tokens
    const seedSet = new Set(seeds.map((s) => s.toLowerCase().replace(/^@/, '')));
    const looksLikeBrand = (h: string): boolean =>
      !seedSet.has(h) && brandTokens.some((t) => h.includes(t));

    // Union with the first-party seed handles (creators the brand already tags),
    // de-duped, seeds first — those are the strongest evidence.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of [...seeds, ...found]) {
      const k = h.toLowerCase().replace(/^@/, '');
      if (/^[a-z0-9._]{1,30}$/.test(k) && !seen.has(k) && !looksLikeBrand(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    return out.slice(0, max);
  }

  /** Pull the DNA object out of an LLM reply (clean JSON, else first {...}),
   *  coercing every field so the caller always gets a fully-shaped profile. */
  private parseBrandDna(content: string, brand: string): BrandDnaProfile {
    const asStr = (v: unknown, fallback = ''): string =>
      typeof v === 'string' ? v.trim() : fallback;
    const asArr = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean).slice(0, 7)
        : [];
    const shape = (o: Record<string, unknown>): BrandDnaProfile => ({
      brand,
      summary: asStr(o.summary),
      category: asStr(o.category),
      positioning: asStr(o.positioning),
      values: asArr(o.values),
      personality: asArr(o.personality),
      target_audience: asStr(o.target_audience),
      aesthetic: asStr(o.aesthetic),
      content_pillars: asArr(o.content_pillars),
      keywords: asArr(o.keywords),
      creator_archetypes: asArr(o.creator_archetypes),
      competitors: asArr(o.competitors),
      opportunities: asArr(o.opportunities),
    });

    const tryParse = (raw: string): BrandDnaProfile | null => {
      try {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object' && !Array.isArray(p)) return shape(p as Record<string, unknown>);
      } catch {
        /* fall through */
      }
      return null;
    };

    // 1. Whole content is JSON. 2. First {...} block.
    const whole = tryParse(content);
    if (whole) return whole;
    const objMatch = content.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const out = tryParse(objMatch[0]);
      if (out) return out;
    }
    // Give up gracefully — an empty-but-shaped profile the UI can still render.
    return shape({});
  }

  /** Extract IG handles from an LLM reply — clean JSON first, else @mentions /
   *  instagram.com links in prose (search models return citations + prose). */
  private parseHandles(content: string, max: number): string[] {
    const clean = (arr: unknown[]): string[] =>
      Array.from(
        new Set(
          arr
            .filter((h): h is string => typeof h === 'string')
            .map((h) => h.replace(/^@/, '').toLowerCase().trim())
            .filter((h) => /^[a-z0-9._]{2,30}$/.test(h)),
        ),
      ).slice(0, max);

    // 1. JSON object with "handles"
    const jsonMatch = content.match(/\{[\s\S]*?"handles"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { handles?: unknown };
        if (Array.isArray(parsed.handles)) {
          const out = clean(parsed.handles);
          if (out.length) return out;
        }
      } catch {
        /* fall through to text extraction */
      }
    }
    // 2. Fallback — pull @handles and instagram.com/handle out of the prose.
    const fromAt = [...content.matchAll(/@([a-z0-9._]{2,30})/gi)].map((m) => m[1] ?? '');
    const fromUrl = [...content.matchAll(/instagram\.com\/([a-z0-9._]{2,30})/gi)].map((m) => m[1] ?? '');
    return clean([...fromAt, ...fromUrl]);
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
   * Detect each creator's gender from their PROFILE PHOTO (face), batched into
   * one vision call. Each image is preceded by its handle. Returns a map
   * handle -> 'female' | 'male' | 'unknown' ('unknown' for logos / group photos
   * / no visible face). More accurate than name/bio text inference.
   */
  async inferGendersFromPhotos(
    items: Array<{ handle: string; imageUrl: string }>,
  ): Promise<Record<string, 'female' | 'male' | 'unknown'>> {
    const usable = items.filter((i) => i.imageUrl).slice(0, 8);
    if (usable.length === 0) return {};
    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: `Each image below is an Instagram profile picture, preceded by that account's handle. Identify the ACCOUNT OWNER's gender from the visible person's presentation. If a single person is visible, COMMIT to "female" or "male" even if you're not fully certain — a best-judgment call is wanted, not a fence-sit. Use "unknown" ONLY for logos / brand marks / text-only images, no visible face, or group photos with no single clear owner. Return ONLY JSON: {"results":[{"handle":"<handle>","gender":"female"|"male"|"unknown"}]} — one entry per handle.`,
      },
    ];
    for (const it of usable) {
      content.push({ type: 'text', text: `handle: ${it.handle}` });
      content.push({ type: 'image_url', image_url: { url: it.imageUrl, detail: 'low' } });
    }
    try {
      const res = await this.client.chat.completions.create({
        model: this.outreachModel, // gpt-4o has vision
        response_format: { type: 'json_object' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: [{ role: 'user', content: content as any }],
      });
      const raw = res.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as { results?: Array<{ handle?: string; gender?: string }> };
      const out: Record<string, 'female' | 'male' | 'unknown'> = {};
      for (const r of parsed.results ?? []) {
        const g = r.gender === 'female' || r.gender === 'male' ? r.gender : 'unknown';
        if (r.handle) out[r.handle.toLowerCase()] = g;
      }
      return out;
    } catch {
      return {};
    }
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
    songs: string[];
    setting: string[];
    palette: { name: string; hex: string }[];
    props: string[];
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
  "songs": ["background-music recommendations: trending track name - artist, or a clear style if unsure"],
  "setting": ["background / location / scene-setting recommendations"],
  "palette": [ { "name": "colour name", "hex": "#RRGGBB" } ],
  "props": ["physical props to include in frame"],
  "caption": "ready-to-post caption with 1-2 emojis",
  "hashtags": ["#tag1", "#tag2"]
}
Rules: 4-6 script scenes covering hook -> body -> CTA with concrete shot/voiceover direction; 3-5 alternative ideas; 3-4 song recommendations; 3-4 setting ideas; a 4-5 colour palette with real hex codes that match the vibe; 4-6 props; 6-10 relevant hashtags. Be specific and punchy, no hype or filler.`,
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
    recent_highlight?: string;
    language?: string;
    followup?: boolean;
  }): Promise<string> {
    const isDM = input.channel === 'ig_dm';
    const highlight = input.recent_highlight?.trim();
    const lang = input.language?.trim();
    const followupLine = input.followup
      ? 'This is a polite SECOND follow-up — they have not replied to the first message. Keep it short and low-pressure, gently re-surface the collaboration, do not guilt-trip or sound pushy.'
      : '';
    const langLine =
      lang && !/^english$/i.test(lang)
        ? `Write the entire message in ${lang}. Keep brand names, @handles and product names as-is. Sound like a real Indian person, natural and warm — not a translation.`
        : '';
    const res = await this.client.chat.completions.create({
      model: this.outreachModel,
      messages: [
        {
          role: 'system',
          content: `You write first-touch outreach messages from a brand to a creator.
${isDM ? 'Format: Instagram DM. 2-3 sentences, casual, no formal greeting beyond "hi @handle".' : 'Format: cold email. Subject line then 4-6 sentence body.'}
Tone: matches the brand voice samples. Never claim things not in the brief.
${highlight ? 'Open with a warm, specific reference to their most recent post (provided) — mention a concrete detail so it is clearly genuine, not generic. Do NOT quote it verbatim or use quotation marks; paraphrase naturally.' : "Reference the creator's recent topics to show you actually looked."}
${followupLine}
${langLine}
End with a soft CTA. No emojis unless the brand voice uses them.`,
        },
        {
          role: 'user',
          content: `Brand: ${input.brand_name}
Brand voice samples:
${input.brand_voice_samples.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Creator: @${input.creator_handle}
Recent topics they post about: ${input.creator_recent_topics.join(', ')}${highlight ? `\nTheir most recent post: "${highlight}"` : ''}

Campaign: ${input.campaign_summary}

Write the ${isDM ? 'DM' : 'email'}.`,
        },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Given a creator's reply during outreach, draft a few ready-to-send response
   * options from the brand, each taking a different angle.
   */
  async generateReply(input: {
    creator_reply: string;
    goal?: string;
    brand_name?: string;
    channel: 'ig_dm' | 'email';
    language?: string;
  }): Promise<{ label: string; message: string }[]> {
    const isDM = input.channel === 'ig_dm';
    const lang = input.language?.trim();
    const langLine =
      lang && !/^english$/i.test(lang)
        ? `Write each reply in ${lang}. Keep brand names and @handles as-is. Sound like a real Indian person, natural and warm.`
        : '';
    const res = await this.client.chat.completions.create({
      model: this.outreachModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You help a brand reply to a creator during influencer outreach. Given the creator's incoming message (and the brand's goal, if any), write 3 short, ready-to-send response options that each take a DIFFERENT angle — e.g. an enthusiastic move-forward, a gentle rate negotiation, and asking for their rates/availability or next step.
${isDM ? 'Format: Instagram DM — 1-3 sentences, casual.' : 'Format: email — a short subject then a 3-5 sentence body.'}
${langLine}
Never invent specifics not given. No pushy or desperate tone.
Respond ONLY with JSON: { "suggestions": [ { "label": "2-4 word angle name", "message": "the reply" } ] }`,
        },
        {
          role: 'user',
          content: `Brand: ${input.brand_name?.trim() || 'our brand'}
Goal: ${input.goal?.trim() || '(not specified — keep the conversation moving toward a collaboration)'}

Creator's message:
"""
${input.creator_reply.trim()}
"""

Write the 3 reply options.`,
        },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
    return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  }

  /**
   * Analyse a creator for a brand-marketing team: extract the brands they've
   * likely worked with, summarise the content they're known for, and — when a
   * question is supplied (e.g. "how good for a Goa campaign?") — answer it using
   * the engagement + content signals provided. Powers the profile "Ask AI" panel.
   */
  async creatorInsight(input: {
    handle: string;
    full_name: string | null;
    category: string | null;
    followers: number;
    engagement: number | null;
    rate: string | null;
    themes: string[];
    cadence: string | null;
    biography: string | null;
    recent_captions: string[];
    tagged_accounts: string[];
    recent_posts?: { caption: string; likes: number; comments: number; sponsored: boolean }[];
    question?: string | null;
  }): Promise<{ brands: string[]; content: string; summary: string; language: string; paid_performance: string; standout: string; answer: string | null }> {
    const q = input.question?.trim();
    const posts = input.recent_posts ?? [];
    const postLines = posts.length
      ? posts.map((p, i) => `${i + 1}. ${p.sponsored ? '[SPONSORED]' : '[organic]'} ${p.likes} likes, ${p.comments} comments — ${p.caption}`).join('\n')
      : input.recent_captions.map((c, i) => `${i + 1}. ${c}`).join('\n') || '(none)';
    const res = await this.client.chat.completions.create({
      model: this.outreachModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You analyse an Instagram creator for an Indian brand's influencer-marketing team, using ONLY the data given. Be concrete, cite the numbers, never invent facts.

Respond ONLY with JSON:
{
  "brands": ["brand names this creator has likely WORKED WITH — sponsored/paid/collab. Infer from bio, captions (#ad/paid partnership/collab cues) and tagged accounts. ONLY real, recognisable BRAND/company names — never personal accounts, friends, the creator's own pages, or generic words. Empty array if none are evident."],
  "content": "1-2 sentences on what this creator is known for / the famous content they make (formats, themes, signature style).",
  "language": "the primary language(s) this creator makes content in, inferred from their captions/bio. Be specific to India: e.g. 'Hindi', 'English', 'Hinglish (Hindi-English mix)', 'Bengali', 'Tamil', 'Punjabi', 'Marathi'. If mixed, name the mix. 1-4 words.",
  "paid_performance": "How this creator performs on PAID/branded content. Compare the engagement (likes+comments) on their [SPONSORED] posts vs their [organic] posts where data is given — does engagement hold up on ads or drop off? Name the brands and cite numbers. If no sponsored posts are visible, say 'No paid posts visible to assess' and note their overall engagement health as a proxy. 1-3 sentences.",
  "standout": "What makes THIS creator stand out vs other creators in their niche — their edge (unusually high engagement for size, a distinctive format, strong regional audience, niche authority, etc.). Be specific and comparative. 1-2 sentences.",
  "summary": "2-3 sentence overall read for a brand: reach tier, engagement health, and who they're a fit for.",
  "answer": ${q ? '"a direct, specific answer to the user\'s question, 2-4 sentences, citing the creator\'s numbers and content where relevant. Give a clear verdict (good fit / weak fit / depends) with the why."' : 'null'}
}`,
        },
        {
          role: 'user',
          content: `Creator: @${input.handle}${input.full_name ? ` (${input.full_name})` : ''}
Category: ${input.category ?? '—'}
Followers: ${input.followers}
Engagement: ${input.engagement != null ? `${input.engagement}%` : 'unknown'}
Est. rate/post: ${input.rate ?? 'unknown'}
Posting cadence: ${input.cadence ?? 'unknown'}
Content themes: ${input.themes.join(', ') || 'unknown'}
Tagged accounts (from recent posts): ${input.tagged_accounts.join(', ') || 'none'}
Bio: ${input.biography ?? '—'}
Recent posts (sponsored vs organic, with engagement):
${postLines}
${q ? `\nQuestion from the marketing team: ${q}` : ''}

Analyse this creator.`,
        },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
    const s = (k: string) => (typeof parsed[k] === 'string' ? parsed[k] : '');
    return {
      brands: Array.isArray(parsed.brands) ? parsed.brands.filter((b: unknown): b is string => typeof b === 'string').slice(0, 12) : [],
      content: s('content'),
      summary: s('summary'),
      language: s('language'),
      paid_performance: s('paid_performance'),
      standout: s('standout'),
      answer: typeof parsed.answer === 'string' ? parsed.answer : null,
    };
  }

  /**
   * Multi-turn chat about a specific creator — powers the profile "Ask AI"
   * chatbot. The creator's data is pinned as context; the conversation history
   * keeps follow-ups coherent ("what should they do in the first 3 sec?").
   */
  async creatorChat(input: {
    handle: string;
    full_name: string | null;
    category: string | null;
    followers: number;
    engagement: number | null;
    rate: string | null;
    themes: string[];
    cadence: string | null;
    biography: string | null;
    recent_captions: string[];
    tagged_accounts: string[];
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<string> {
    const context = `Creator: @${input.handle}${input.full_name ? ` (${input.full_name})` : ''}
Category: ${input.category ?? '—'}
Followers: ${input.followers}
Engagement: ${input.engagement != null ? `${input.engagement}%` : 'unknown'}
Est. rate/post: ${input.rate ?? 'unknown'}
Posting cadence: ${input.cadence ?? 'unknown'}
Content themes: ${input.themes.join(', ') || 'unknown'}
Tagged accounts: ${input.tagged_accounts.join(', ') || 'none'}
Bio: ${input.biography ?? '—'}
Recent captions:
${input.recent_captions.map((c, i) => `${i + 1}. ${c}`).join('\n') || '(none)'}`;

    const history = input.messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));

    const res = await this.client.chat.completions.create({
      model: this.outreachModel,
      messages: [
        {
          role: 'system',
          content: `You are an influencer-marketing analyst chatting with a brand's team about ONE specific creator, whose public data is provided below. Help them decide and plan: campaign fit, concrete content ideas (hooks, first-3-seconds, formats), rate/negotiation, risks, audience read.

Rules:
- Ground every answer in the creator's data; cite their actual numbers (followers, engagement, themes) when relevant.
- Be concrete and punchy — 1-4 sentences unless asked for more. For content ideas, give specific, production-ready direction, not generic advice.
- If asked something the data can't support, say what you'd check rather than inventing facts.
- No hype, no filler.

CREATOR CONTEXT:
${context}`,
        },
        ...history,
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Multi-turn chat to refine a generated content pack — powers the Content
   * Idea Generator's "edit as a chatbot" box. The generated reel concept is
   * pinned as context so follow-ups ("what should the first 3 seconds be?",
   * "swap the music to lofi", "make the hook punchier") stay coherent.
   */
  async contentChat(input: {
    prompt: string;
    pack: {
      concept?: string;
      format?: string;
      best_window?: string;
      script?: { scene: string; onscreen: string; voiceover: string }[];
      songs?: string[];
      setting?: string[];
      props?: string[];
      caption?: string;
      hashtags?: string[];
    } | null;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<string> {
    const p = input.pack ?? {};
    const scriptLines = (p.script ?? []).map((s) => `${s.scene}: ${s.onscreen} | ${s.voiceover}`).join('\n');
    const context = `Original brief: ${input.prompt}
Concept: ${p.concept ?? '—'}
Format: ${p.format ?? '—'}${p.best_window ? ` · best ${p.best_window}` : ''}
Script:
${scriptLines || '(none)'}
Music: ${(p.songs ?? []).join('; ') || '—'}
Setting: ${(p.setting ?? []).join('; ') || '—'}
Props: ${(p.props ?? []).join('; ') || '—'}
Caption: ${p.caption ?? '—'}`;

    const history = input.messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));

    const res = await this.client.chat.completions.create({
      model: this.outreachModel,
      messages: [
        {
          role: 'system',
          content: `You are a short-form content director helping a creator refine THIS Instagram reel concept (context below). Answer their requests with concrete, production-ready direction — rewrite the first-3-seconds hook, adjust pacing, swap music/props/setting, tighten the caption. When they ask for a rewrite, give the actual new line, not vague advice. Keep replies punchy: 1-5 sentences or a short rewritten snippet. Stay consistent with the existing concept unless they ask to change direction. No hype, no filler.

REEL CONTEXT:
${context}`,
        },
        ...history,
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Score a post's creative on 12 content-quality dimensions using gpt-4o
   * vision. Prefers an explicit thumbnail; else the media itself if it's an
   * image. The image bytes are inlined as a data URL so the model genuinely
   * SEES the creative (vision=true); if no fetchable image is available it
   * scores from the caption/metadata alone (vision=false, lower confidence).
   */
  async scoreContentQuality(req: ContentScoreRequest): Promise<ContentScoreResponse> {
    const imageCandidate = req.thumbnail_url
      || (req.media_type === 'IMAGE' ? req.media_url : undefined);
    const dataUrl = imageCandidate ? await fetchInlineImageDataUrl(imageCandidate) : null;
    const vision = dataUrl != null;

    const textPrompt = `${CONTENT_SCORING_PROMPT}\n\nContent type: ${req.media_type}\nCaption: ${req.caption ?? '(no caption)'}\nCreator category: ${req.creator_category ?? 'unknown'}\n\n${vision ? 'Analyze the attached image (a frame/cover of the content).' : `Analyze the content described above (no image available).`}`;

    const userContent: Array<Record<string, unknown>> = [{ type: 'text', text: textPrompt }];
    if (dataUrl) userContent.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } });

    const res = await this.client.chat.completions.create({
      model: this.outreachModel, // gpt-4o has vision
      response_format: { type: 'json_object' },
      temperature: 0.1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: userContent as any }],
    });

    const raw = JSON.parse(res.choices[0]?.message?.content ?? '{}') as Record<string, unknown>;

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
    for (const [dim, weight] of Object.entries(CONTENT_DIMENSION_WEIGHTS)) {
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
