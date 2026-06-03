// ============================================================
// Audience inference — sample 80-100 of the creator's followers, fetch
// each follower's bio + photo via web_profile_info, then ask gpt-4o-mini
// to classify city / country / gender / language. Aggregate to a
// demographic distribution with confidence.
//
// This is the "follower catchment" signal that Modash and HypeAuditor sell.
// Costs ~₹1-2 + ~30s per creator. Worth running for every shortlisted
// creator who passes the quality gate.
// ============================================================

import type { AudienceDemographics, ScrapeJob } from '@influencer-intel/shared/types';
import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';
import { humanDelay, type DriverHandle } from '../playwright-driver.js';
import type { JobQueue } from '../queue/worker.js';

const FOLLOWER_SAMPLE_SIZE = 80;       // followers to fetch
const CLASSIFY_BATCH = 8;              // followers classified per LLM call
const ENRICH_PARALLEL = 5;             // concurrent web_profile_info fetches

interface FollowerSnapshot {
  username: string;
  full_name: string | null;
  is_verified: boolean;
  is_private: boolean;
  bio: string | null;
}

interface FollowerClassification {
  username: string;
  city: string | null;
  country: string | null;
  gender: 'male' | 'female' | 'other' | null;
  age_band: '18_24' | '25_34' | '35_44' | '45_64' | null;
  language: string | null;
}

export async function handleAudienceInference(
  job: ScrapeJob,
  driver: DriverHandle,
  _queue: JobQueue,
): Promise<void> {
  const handle = job.target_handle.toLowerCase();
  const db = getBolticClient();

  // Resolve creator_id by handle.
  let creatorId = job.creator_id;
  if (!creatorId) {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM creators WHERE platform = 'instagram' AND handle = $1 LIMIT 1`,
      [handle],
    );
    creatorId = rows[0]?.id ?? null;
  }
  if (!creatorId) {
    console.warn(`[audience-inference] no creator row for ${handle}, skipping`);
    return;
  }

  // 1. Fetch a sample of followers from the authenticated session.
  console.log(`[audience-inference] sampling followers for ${handle}…`);
  const followers = await sampleFollowers(driver, handle, FOLLOWER_SAMPLE_SIZE);
  if (followers.length === 0) {
    console.warn(`[audience-inference] ${handle}: 0 followers sampled, writing low-confidence placeholder`);
    await writePlaceholder(creatorId);
    return;
  }
  console.log(`[audience-inference] ${handle}: sampled ${followers.length} followers`);

  // 2. Classify each via gpt-4o-mini in batches.
  const classifications: FollowerClassification[] = [];
  const llm = getOpenAIClient();
  for (let i = 0; i < followers.length; i += CLASSIFY_BATCH) {
    const batch = followers.slice(i, i + CLASSIFY_BATCH);
    try {
      const classified = await classifyFollowerBatch(llm, batch);
      classifications.push(...classified);
    } catch (err) {
      console.warn(`[audience-inference] classify batch failed:`, (err as Error).message);
    }
  }

  // 3. Aggregate.
  const demographics = aggregate(classifications, followers.length);
  await db.update('creators', { id: creatorId }, { audience_demographics: demographics });
  console.log(
    `[audience-inference] ${handle}: confidence=${demographics.confidence} ` +
    `top_cities=${demographics.top_cities.slice(0, 3).map((c) => c.city).join(', ')} ` +
    `gender_f=${demographics.gender.female_pct ?? '?'}%`,
  );
  await humanDelay();
}

async function sampleFollowers(
  driver: DriverHandle,
  handle: string,
  count: number,
): Promise<FollowerSnapshot[]> {
  const data = await driver.page.evaluate(
    async ({ h, n, parallel }: { h: string; n: number; parallel: number }) => {
      const g: any = globalThis;
      if (typeof g.__name !== 'function') g.__name = (fn: unknown) => fn;
      const headers = {
        'X-Requested-With': 'XMLHttpRequest',
        'X-IG-App-ID': '936619743392459',
      };
      try {
        const pr = await fetch(
          `/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
          { headers, credentials: 'include' },
        );
        if (!pr.ok) return { error: `web_profile_info HTTP ${pr.status}` };
        const pj = await pr.json();
        const userId = pj?.data?.user?.id;
        if (!userId) return { error: 'no user id' };

        const fr = await fetch(
          `/api/v1/friendships/${encodeURIComponent(String(userId))}/followers/?count=${n}`,
          { headers, credentials: 'include' },
        );
        if (!fr.ok) return { error: `followers HTTP ${fr.status}` };
        const fj = await fr.json();
        const users = (fj?.users ?? []) as Array<{ username: string; full_name?: string; is_verified?: boolean; is_private?: boolean }>;
        // The followers endpoint doesn't include bios. Enrich each with web_profile_info
        // in parallel batches. Cap total to keep request volume bounded.
        const cap = Math.min(users.length, n);
        const toEnrich = users.slice(0, cap);
        const out: any[] = [];
        for (let i = 0; i < toEnrich.length; i += parallel) {
          const batch = toEnrich.slice(i, i + parallel);
          await Promise.all(
            batch.map(async (u) => {
              try {
                const r2 = await fetch(
                  `/api/v1/users/web_profile_info/?username=${encodeURIComponent(u.username)}`,
                  { headers, credentials: 'include' },
                );
                if (!r2.ok) {
                  out.push({ username: u.username, full_name: u.full_name ?? null, is_verified: !!u.is_verified, is_private: !!u.is_private, bio: null });
                  return;
                }
                const j = await r2.json();
                const user = j?.data?.user;
                out.push({
                  username: u.username,
                  full_name: user?.full_name ?? u.full_name ?? null,
                  is_verified: !!(user?.is_verified ?? u.is_verified),
                  is_private: !!(user?.is_private ?? u.is_private),
                  bio: user?.biography ?? null,
                });
              } catch {
                out.push({ username: u.username, full_name: u.full_name ?? null, is_verified: !!u.is_verified, is_private: !!u.is_private, bio: null });
              }
            }),
          );
          // Small jitter between batches.
          await new Promise((res) => setTimeout(res, 300 + Math.random() * 400));
        }
        return { followers: out };
      } catch (err) {
        return { error: String(err) };
      }
    },
    { h: handle, n: count, parallel: ENRICH_PARALLEL },
  );

  if (!data || (data as { error?: string }).error) {
    console.warn(`[audience-inference] ${handle}: sample error:`, (data as { error?: string })?.error);
    return [];
  }
  return ((data as { followers?: FollowerSnapshot[] }).followers ?? []) as FollowerSnapshot[];
}

async function classifyFollowerBatch(
  llm: ReturnType<typeof getOpenAIClient>,
  batch: FollowerSnapshot[],
): Promise<FollowerClassification[]> {
  // Compact list — only username + display + bio. The model classifies all
  // at once for cost efficiency.
  const compact = batch.map((f) => ({
    username: f.username,
    name: f.full_name ?? '',
    bio: (f.bio ?? '').slice(0, 280),
  }));
  const sys = `You classify Instagram followers from their bio + name. Output strict JSON:
{ "followers": [{ "username": "...", "city": "Mumbai" | null, "country": "India" | null, "gender": "male"|"female"|"other"|null, "age_band": "18_24"|"25_34"|"35_44"|"45_64"|null, "language": "en"|"hi"|"mr"|"ta"|"te"|"bn"|"gu"|"kn"|"pa"|"ml"|null }] }
Only fill a field if the bio gives a clear signal. Otherwise null. Be conservative — empty bios → all nulls. Indian cities preferred over generic country tags. Don't guess gender from generic names alone.`;
  const res = await (llm as unknown as { client: { chat: { completions: { create: Function } } } }).client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify({ followers: compact }) },
    ],
  });
  const content = res.choices[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.followers) ? parsed.followers : [];
  } catch {
    return [];
  }
}

function aggregate(
  classifications: FollowerClassification[],
  sampleSize: number,
): AudienceDemographics {
  const cityCount = new Map<string, number>();
  let countryIndiaCount = 0;
  let countryAnyCount = 0;
  const langCount = new Map<string, number>();
  let male = 0, female = 0, other = 0, genderAny = 0;
  const ageBuckets = { '18_24': 0, '25_34': 0, '35_44': 0, '45_64': 0 };
  let ageAny = 0;

  for (const c of classifications) {
    if (c.city) cityCount.set(c.city, (cityCount.get(c.city) ?? 0) + 1);
    if (c.country) {
      countryAnyCount++;
      if (c.country.toLowerCase() === 'india') countryIndiaCount++;
    }
    if (c.language) langCount.set(c.language, (langCount.get(c.language) ?? 0) + 1);
    if (c.gender) {
      genderAny++;
      if (c.gender === 'male') male++;
      else if (c.gender === 'female') female++;
      else other++;
    }
    if (c.age_band && c.age_band in ageBuckets) {
      ageAny++;
      ageBuckets[c.age_band as keyof typeof ageBuckets]++;
    }
  }

  const top_cities = Array.from(cityCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([city, count]) => ({ city, pct: Math.round((count / sampleSize) * 100) }));

  const top_languages = Array.from(langCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang, count]) => ({ lang, pct: Math.round((count / sampleSize) * 100) }));

  // Confidence scaling: how many of the sample had detectable signals.
  const cityFillRate = (Array.from(cityCount.values()).reduce((a, b) => a + b, 0)) / sampleSize;
  const confidence: AudienceDemographics['confidence'] =
    cityFillRate > 0.4 ? 'high' : cityFillRate > 0.15 ? 'medium' : 'low';

  return {
    source: 'inferred_scraping',
    sample_size: classifications.length,
    confidence,
    gender: {
      male_pct: genderAny > 0 ? Math.round((male / genderAny) * 100) : null,
      female_pct: genderAny > 0 ? Math.round((female / genderAny) * 100) : null,
      other_pct: genderAny > 0 ? Math.round((other / genderAny) * 100) : null,
    },
    age_bands: {
      '18_24': ageAny > 0 ? Math.round((ageBuckets['18_24'] / ageAny) * 100) : null,
      '25_34': ageAny > 0 ? Math.round((ageBuckets['25_34'] / ageAny) * 100) : null,
      '35_44': ageAny > 0 ? Math.round((ageBuckets['35_44'] / ageAny) * 100) : null,
      '45_64': ageAny > 0 ? Math.round((ageBuckets['45_64'] / ageAny) * 100) : null,
    },
    top_cities,
    country_india_pct: countryAnyCount > 0 ? Math.round((countryIndiaCount / countryAnyCount) * 100) : null,
    top_languages,
    computed_at: new Date().toISOString(),
  };
}

async function writePlaceholder(creatorId: string): Promise<void> {
  const db = getBolticClient();
  const placeholder: AudienceDemographics = {
    source: 'inferred_scraping',
    sample_size: 0,
    confidence: 'low',
    gender: { male_pct: null, female_pct: null, other_pct: null },
    age_bands: { '18_24': null, '25_34': null, '35_44': null, '45_64': null },
    top_cities: [],
    country_india_pct: null,
    top_languages: [],
    computed_at: new Date().toISOString(),
  };
  await db.update('creators', { id: creatorId }, { audience_demographics: placeholder });
}
