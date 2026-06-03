// ============================================================
// CLI: re-embed all active creators with the new rich embedding text
// (bio + vision niche + themes + vibe + city + language as prose).
//
// Run after profile-scraper.ts is updated so vector search returns
// semantically richer matches against new briefs.
//
//   npx tsx src/cli/reembed-creators.ts
// ============================================================

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

function findEnvPath(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const c = path.join(dir, '.env');
    if (fs.existsSync(c)) return c;
    const p = path.dirname(dir);
    if (p === dir) break;
    dir = p;
  }
  return null;
}
const envPath = findEnvPath();
if (envPath) dotenv.config({ path: envPath });

const { getPool } = await import('@influencer-intel/shared/db');
const { getOpenAIClient } = await import('@influencer-intel/shared/llm');

const LANG_MAP: Record<string, string> = {
  hi: 'hindi', mr: 'marathi', ta: 'tamil', te: 'telugu', bn: 'bengali',
  gu: 'gujarati', kn: 'kannada', pa: 'punjabi', ml: 'malayalam', or: 'odia',
  en: 'english',
};

interface Row {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  primary_category: string | null;
  primary_city: string | null;
  content_languages: string[] | null;
  is_indian: boolean | null;
  raw_metadata: { vision?: Record<string, unknown>; tier?: string; geo?: { top_cities?: Array<{ name: string }> } } | null;
}

async function main() {
  const pool = getPool();
  const llm = getOpenAIClient();

  const all = await pool.query<Row>(
    `SELECT id::text, handle, display_name, bio, primary_category, primary_city,
            content_languages, is_indian, raw_metadata
     FROM creators
     WHERE is_active = true AND last_scraped_at IS NOT NULL
     ORDER BY follower_count DESC NULLS LAST`,
  );
  console.log(`re-embedding ${all.rows.length} active creators…`);

  let i = 0;
  const BATCH = 50; // OpenAI embeddings supports many inputs per call
  while (i < all.rows.length) {
    const slice = all.rows.slice(i, i + BATCH);
    const texts = slice.map((r) => buildEmbeddingText(r));
    try {
      const vecs = await llm.embedMany(texts);
      for (let j = 0; j < slice.length; j++) {
        const v = vecs[j];
        if (!v) continue;
        const lit = `[${v.join(',')}]`;
        await pool.query(
          `UPDATE creators SET content_embedding = $1::vector WHERE id = $2`,
          [lit, slice[j]!.id],
        );
      }
      i += slice.length;
      console.log(`  ${i}/${all.rows.length}`);
    } catch (err) {
      console.warn(`batch starting at ${i} failed:`, (err as Error).message);
      i += slice.length;
    }
  }
  console.log('done.');
  await pool.end();
}

function buildEmbeddingText(r: Row): string {
  const vision = r.raw_metadata?.vision ?? {};
  const niche = (vision.niche as string | undefined) ?? '';
  const themes = ((vision.content_themes as string[] | undefined) ?? []).join(', ');
  const vibe = ((vision.vibe_tags as string[] | undefined) ?? []).join(', ');
  const subNiches = ((vision.sub_niches as string[] | undefined) ?? []).join(', ');
  const tier = r.raw_metadata?.tier ? `${r.raw_metadata.tier} tier creator` : '';
  const lang = (r.content_languages?.[0] && (LANG_MAP[r.content_languages[0]!] ?? r.content_languages[0]));
  const city = r.primary_city ?? r.raw_metadata?.geo?.top_cities?.[0]?.name ?? '';
  const text = [
    r.display_name ?? '',
    r.bio ?? '',
    r.primary_category ?? '',
    niche,
    subNiches,
    themes && `themes: ${themes}`,
    vibe && `vibe: ${vibe}`,
    tier,
    r.is_indian ? 'India' : '',
    lang && `${lang} content`,
    city && `based in ${city}`,
  ].filter(Boolean).join(' | ');
  return text || `@${r.handle}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
