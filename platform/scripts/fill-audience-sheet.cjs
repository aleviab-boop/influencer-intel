// ============================================================
// Fill the shared "IG HANDLE / IG LINK" sheet with audience demographics.
//
// Pipeline (per handle): Apify scrape (bio + captions + followers) →
//   inferAudienceFromContent (gender/age/cities/langs/%India) +
//   inferCreatorLocation (creator's own base) → append one CSV row.
//
// Resumable: reads OUT.csv on start, skips handles already done, appends as it
// goes. Raw Apify profiles are dumped to RAW.jsonl so a later DB import is free.
//
//   node scripts/fill-audience-sheet.cjs <input.csv> <out.csv> <raw.jsonl>
// ============================================================
require('dotenv').config();
const fs = require('fs');

const APIFY_TOKEN = process.env.APIFY_TOKEN?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const MODEL = 'gpt-4o-mini';
const BATCH = 45;           // handles per Apify run
const APIFY_ACTOR = 'apify~instagram-api-scraper';

if (!APIFY_TOKEN || !OPENAI_API_KEY) { console.error('missing APIFY_TOKEN or OPENAI_API_KEY'); process.exit(1); }

const INPUT = process.argv[2];
const OUT = process.argv[3];
const RAW = process.argv[4];

const norm = (h) => String(h || '').trim().replace(/^@/, '').replace(/\/.*$/, '').toLowerCase();
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const HEADERS = [
  'IG HANDLE', 'IG LINK', 'Full Name', 'Followers', 'Creator Based In',
  'Audience Female %', 'Audience Male %', 'Top Age Band', 'Audience Top Cities',
  'Audience Languages', 'Audience % India', 'Confidence', 'Status',
];

// ---- Apify -----------------------------------------------------------------
async function apifyBatch(handles) {
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        directUrls: handles.map((h) => `https://www.instagram.com/${h}/`),
        resultsType: 'details', resultsLimit: 1,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) { console.error('apify', res.status); return []; }
    return await res.json();
  } catch (e) { console.error('apify err', e.message); return []; }
  finally { clearTimeout(t); }
}

// ---- OpenAI ----------------------------------------------------------------
async function chatJSON(sys, user, temperature) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: MODEL, response_format: { type: 'json_object' }, temperature,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        }),
      });
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      if (!res.ok) return null;
      const j = await res.json();
      return JSON.parse(j.choices?.[0]?.message?.content ?? '{}');
    } catch { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); }
  }
  return null;
}

const AUD_SYS = `You are an audience-research analyst for an Indian influencer-marketing platform. From a creator's OWN public profile (bio, niche, follower tier, recent post captions) ESTIMATE the demographics of the audience this creator most likely attracts. This is an informed estimate from the creator's content — not a measured follower sample — so be calibrated and conservative, and lean on the niche + language of the captions.

Output STRICT JSON only, with EXACTLY these keys:
{
  "gender": { "female": <0-100 int>, "male": <0-100 int>, "other": <0-100 int> },
  "age_bands": { "18_24": <int>, "25_34": <int>, "35_44": <int>, "45_64": <int> },
  "top_cities": [ { "city": "Mumbai", "pct": <int> }, ... 3-5 Indian cities, descending, plausible spread ],
  "top_languages": [ { "lang": "EN"|"HI"|"local", "pct": <int> }, ... ],
  "country_india_pct": <0-100 int>
}
Rules:
- Infer gender skew from niche: beauty/fashion → female-leaning; tech/gaming/automotive → male-leaning; food/travel/comedy → balanced. Don't force 50/50.
- Infer cities from language/regional cues in captions when present (e.g. Bengali → Kolkata weight, Marathi → Pune/Mumbai, Tamil → Chennai); otherwise spread across metros.
- Age skews younger for larger/entertainment accounts, older for finance/parenting/home.
- Numbers are shares (percent), each group summing to ~100. Use whole integers.
- Return ONLY the JSON object.`;

const LOC_SYS = `You are a location analyst for a South-Asia influencer-marketing platform. From a creator's OWN public profile, determine where the CREATOR is based (their home country/city) — NOT their audience.

Read the signals a human would:
- Country-coded handles/brands: a "@..np" suffix → Nepal, ".pk" → Pakistan, ".bd" → Bangladesh, ".lk" → Sri Lanka, ".in" → India.
- Country cues in hashtags/words: "gorkha", "kathmandu", "nepali" → Nepal; "dhaka", "bangla" → Bangladesh; "lahore", "karachi" → Pakistan; Indian city/state names → India.
- Tagged local brands, currency, language, place names.

Output STRICT JSON only:
{
  "country": "<full country name, or null if genuinely no signal>",
  "country_code": "<ISO-2 like IN, NP, PK, BD, LK, or null>",
  "city": "<city if inferable, else null>",
  "confidence": "low" | "medium" | "high",
  "evidence": ["<short signal you used>", ...]
}
Rules:
- DO NOT default to India. If the signals point to Nepal/Pakistan/Bangladesh/Sri Lanka, say so.
- If there is truly no location signal, return country:null, city:null, confidence:"low", evidence:[].
- "high" only when a country-coded handle/brand or an explicit place name is present; otherwise "low" or "medium".
- Return ONLY the JSON object.`;

function mapProfile(u, handle) {
  const posts = (u.latestPosts ?? []).slice(0, 12);
  const captions = posts.map((p) => p.caption).filter(Boolean);
  return {
    handle: u.username || handle,
    display_name: u.fullName || null,
    bio: u.biography || null,
    category: u.businessCategoryName || null,
    external_url: u.externalUrl || null,
    follower_count: num(u.followersCount),
    captions,
    // brand handles: @mentions found in captions/bio (rough signal for location)
    brand_handles: [...new Set(
      [(u.biography || ''), ...captions].join(' ').match(/@[\w.]+/g) || [],
    )].slice(0, 15),
  };
}

async function inferAudience(p) {
  const captions = (p.captions ?? []).map((c) => c.replace(/\s+/g, ' ').trim().slice(0, 200)).filter((c) => c.length >= 4).slice(0, 12);
  const user = JSON.stringify({
    handle: p.handle, name: p.display_name ?? '', bio: (p.bio ?? '').slice(0, 400),
    niche: p.category ?? '', follower_count: p.follower_count, recent_captions: captions,
  });
  const r = await chatJSON(AUD_SYS, user, 0.2);
  if (!r) return null;
  const g = r.gender ?? {};
  const female = Math.round(Number(g.female) || 0), male = Math.round(Number(g.male) || 0), other = Math.round(Number(g.other) || 0);
  if (female + male + other <= 0) return null;
  const cities = Array.isArray(r.top_cities) ? r.top_cities.map((c) => ({ city: String(c.city ?? '').trim(), pct: Math.round(Number(c.pct) || 0) })).filter((c) => c.city && c.pct > 0).slice(0, 5) : [];
  const langs = Array.isArray(r.top_languages) ? r.top_languages.map((l) => ({ lang: String(l.lang ?? '').trim(), pct: Math.round(Number(l.pct) || 0) })).filter((l) => l.lang && l.pct > 0).slice(0, 5) : [];
  const age = r.age_bands ?? {};
  const ageBands = { '18-24': Math.round(Number(age['18_24']) || 0), '25-34': Math.round(Number(age['25_34']) || 0), '35-44': Math.round(Number(age['35_44']) || 0), '45-64': Math.round(Number(age['45_64']) || 0) };
  const topAge = Object.entries(ageBands).sort((a, b) => b[1] - a[1])[0];
  const signal = captions.length + (p.bio && p.bio.length > 20 ? 2 : 0);
  return {
    female, male, cities, langs,
    topAge: topAge && topAge[1] > 0 ? topAge[0] : '',
    india_pct: Math.round(Number(r.country_india_pct) || 0) || '',
    confidence: signal >= 8 ? 'medium' : 'low',
  };
}

async function inferLocation(p) {
  const captions = (p.captions ?? []).map((c) => c.replace(/\s+/g, ' ').trim().slice(0, 200)).filter((c) => c.length >= 3).slice(0, 12);
  const brands = (p.brand_handles ?? []).map((h) => h.replace(/^@/, '')).filter(Boolean).slice(0, 15);
  if (!(p.bio || captions.length || brands.length)) return null;
  const user = JSON.stringify({ handle: p.handle, name: p.display_name ?? '', bio: (p.bio ?? '').slice(0, 400), external_url: p.external_url ?? '', brand_handles: brands, recent_captions: captions });
  const r = await chatJSON(LOC_SYS, user, 0.1);
  if (!r) return null;
  // Model sometimes emits the literal string "null"/"none"/"unknown" instead of
  // JSON null — treat those as no-signal so we never write "null, null".
  const clean = (v) => {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s || /^(null|none|n\/a|na|unknown|not sure|undefined)$/i.test(s)) return null;
    return s;
  };
  const country = clean(r.country);
  const city = clean(r.city);
  if (!country && !city) return null;
  return [city, country].filter(Boolean).join(', ');
}

// ---- main ------------------------------------------------------------------
async function main() {
  const rows = fs.readFileSync(INPUT, 'utf8').split(/\r?\n/).filter(Boolean);
  rows.shift(); // header
  const handles = [...new Set(rows.map((l) => norm(l.split(',')[0])).filter(Boolean))];

  // resume: what's already in OUT
  const done = new Set();
  if (fs.existsSync(OUT)) {
    const prev = fs.readFileSync(OUT, 'utf8').split(/\r?\n/).filter(Boolean);
    prev.shift();
    for (const l of prev) { const h = norm(l.split(',')[0].replace(/^"|"$/g, '')); if (h) done.add(h); }
  } else {
    fs.writeFileSync(OUT, HEADERS.map(csvCell).join(',') + '\n');
  }

  const todo = handles.filter((h) => !done.has(h));
  console.log(`total ${handles.length}, done ${done.size}, todo ${todo.length}`);

  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const items = await apifyBatch(chunk);
    const byHandle = new Map();
    for (const u of items) { const h = (u.username || '').trim().toLowerCase(); if (h) byHandle.set(h, u); }
    if (RAW && items.length) fs.appendFileSync(RAW, items.map((u) => JSON.stringify(u)).join('\n') + '\n');

    // infer for the whole chunk concurrently
    const results = await Promise.all(chunk.map(async (h) => {
      const u = byHandle.get(h);
      if (!u || !u.username) {
        return [h, `https://instagram.com/${h}`, '', '', '', '', '', '', '', '', '', '', 'no_data'];
      }
      const p = mapProfile(u, h);
      const [aud, loc] = await Promise.all([inferAudience(p), inferLocation(p)]);
      return [
        h, `https://instagram.com/${h}`, p.display_name || '', p.follower_count || '',
        loc || '',
        aud ? aud.female : '', aud ? aud.male : '', aud ? aud.topAge : '',
        aud ? aud.cities.map((c) => `${c.city} ${c.pct}%`).join('; ') : '',
        aud ? aud.langs.map((l) => `${l.lang} ${l.pct}%`).join('; ') : '',
        aud ? aud.india_pct : '',
        aud ? aud.confidence : '',
        aud ? 'ok' : (p.follower_count || p.bio ? 'scraped_no_infer' : 'thin'),
      ];
    }));

    fs.appendFileSync(OUT, results.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${Math.min(i + BATCH, todo.length)}/${todo.length}  (batch had ${items.length} profiles)`);
  }
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
