// ============================================================
// backfill-gender.mjs
//
// Re-label creators whose gender is still NULL/unknown using the improved
// text inference (commits on recognizable gendered Indian first names,
// pronouns, self-descriptors). Fixes the existing ~5k unlabeled creators so
// the Lander's male/female filter has proper recall — not just future crawls.
//
// Text-only (name + bio + handle) so it's fast/cheap and doesn't depend on
// (often-stale) profile-photo URLs. Only fills NULL/unknown — never overwrites
// an existing female/male label.
//
// Run:  cd platform && node --env-file=.env scripts/backfill-gender.mjs
//       DRY_RUN=1 to preview the candidate count only.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { getOpenAIClient } from '@influencer-intel/shared/llm';

const DRY = process.env.DRY_RUN === '1';
const db = getBolticClient();
const llm = getOpenAIClient();

async function main() {
  const rows = await db.query(
    `SELECT handle, display_name, bio
     FROM creators
     WHERE platform='instagram'
       AND (gender IS NULL OR gender='unknown')
       AND (coalesce(display_name,'') <> '' OR coalesce(bio,'') <> '')`,
  );
  console.log(`[gender] ${rows.length} unlabeled candidates${DRY ? ' (DRY RUN)' : ''}.`);
  if (DRY) { process.exit(0); }

  let labeled = 0;
  const BATCH = 60; // inferGenders caps at 60/call
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((c) => ({ handle: c.handle, name: c.display_name, bio: c.bio }));
    let g = {};
    try {
      g = await llm.inferGenders(batch);
    } catch {
      continue; // best-effort; skip a failed batch
    }
    const byG = { female: [], male: [] };
    for (const [h, v] of Object.entries(g)) if (v === 'female' || v === 'male') byG[v].push(h.toLowerCase());
    for (const gg of ['female', 'male']) {
      if (byG[gg].length === 0) continue;
      await db.query(
        `UPDATE creators SET gender=$1, updated_at=now()
         WHERE platform='instagram' AND lower(handle)=ANY($2::text[]) AND (gender IS NULL OR gender='unknown')`,
        [gg, byG[gg]],
      );
      labeled += byG[gg].length;
    }
    if (i % 600 === 0) console.log(`   ${i}/${rows.length}… labeled ${labeled}`);
  }
  console.log(`[gender] done — labeled ${labeled} creators.`);
  process.exit(0);
}

main().catch((e) => { console.error('[gender] failed:', e); process.exit(1); });
