// ============================================================
// Diff what's actually in Boltic vs what our schema expects.
// Run with: npm run db:diff
// ============================================================

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { getPool } from './boltic-client.js';

function findEnvPath(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
const envPath = findEnvPath();
if (envPath) dotenv.config({ path: envPath });

const expected: Record<string, string[]> = {
  creators: [
    'id', 'platform', 'handle', 'profile_url', 'display_name', 'bio', 'profile_photo_url',
    'is_verified', 'follower_count', 'following_count', 'posts_count', 'avg_views', 'avg_likes',
    'avg_comments', 'engagement_rate', 'primary_category', 'content_languages', 'primary_city',
    'city_tier', 'data_tier', 'is_active', 'is_indian', 'is_verified_creator',
    'recent_posts', 'audience_demographics', 'credibility', 'verified_oauth_data',
    'content_embedding', 'first_indexed_at', 'last_scraped_at', 'last_full_refresh',
  ],
  brands: [
    'id', 'name', 'slug', 'category', 'voice_samples', 'users', 'plan',
    'research_quota_used', 'research_quota_max', 'onboarded_at', 'created_at', 'updated_at',
  ],
  briefs: [
    'id', 'brand_id', 'raw_text', 'parsed_spec', 'brief_embedding', 'status',
    'created_at', 'parsed_at',
  ],
  brief_creators: [
    'id', 'brief_id', 'brand_id', 'creator_id', 'rank', 'match_score', 'reasoning',
    'freshness', 'outreach', 'outcome', 'brand_action', 'brand_action_at', 'created_at',
  ],
  scrape_jobs: [
    'id', 'job_type', 'target_platform', 'target_handle', 'creator_id', 'brief_id',
    'priority', 'status', 'attempts', 'assigned_account_id', 'result_summary',
    'error_message', 'requested_by_brand', 'queued_at', 'started_at', 'completed_at',
  ],
  service_accounts: [
    'id', 'platform', 'handle', 'email', 'phone_number', 'storage_state',
    'storage_captured_at', 'storage_expires_at', 'status', 'proxy_assignment',
    'device_fingerprint', 'daily_action_count', 'total_scrapes', 'category_focus',
    'geo_focus', 'warmed_at', 'created_at', 'updated_at',
  ],
};

async function main() {
  const pool = getPool();
  const allMissing: { table: string; column: string }[] = [];

  for (const [table, cols] of Object.entries(expected)) {
    const rows = await pool.query<{ column_name: string; data_type: string; udt_name: string }>(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );
    const have = new Set(rows.rows.map((r) => r.column_name));
    const missing = cols.filter((c) => !have.has(c));
    const extra = rows.rows
      .map((r) => r.column_name)
      .filter((c) => !cols.includes(c));

    console.log(`\n[${table}] ${rows.rows.length} columns present, ${missing.length} missing`);
    if (missing.length > 0) {
      console.log(`   Missing: ${missing.join(', ')}`);
      missing.forEach((c) => allMissing.push({ table, column: c }));
    }
    if (extra.length > 0) console.log(`   Extra (Boltic-default): ${extra.join(', ')}`);
  }

  if (allMissing.length === 0) {
    console.log('\n✓ All expected columns present.');
  } else {
    console.log(`\n✗ ${allMissing.length} columns missing. Add them in Boltic SQL Editor:\n`);
    for (const { table, column } of allMissing) {
      console.log(`  ALTER TABLE ${table} ADD COLUMN ${column} ${suggestType(table, column)};`);
    }
  }

  await pool.end();
}

function suggestType(table: string, column: string): string {
  if (column === 'id') return 'UUID PRIMARY KEY DEFAULT gen_random_uuid()';
  if (column.endsWith('_id')) return 'UUID';
  if (column.endsWith('_at')) return 'TIMESTAMPTZ';
  if (column.endsWith('_count') || column === 'rank' || column === 'priority' || column === 'attempts') return 'INTEGER';
  if (column.includes('rate') || column.includes('score')) return 'NUMERIC(5,4)';
  if (column.endsWith('_embedding')) return 'VECTOR(1536)';
  if (['recent_posts', 'audience_demographics', 'credibility', 'verified_oauth_data',
       'voice_samples', 'users', 'parsed_spec', 'outreach', 'outcome', 'storage_state',
       'device_fingerprint', 'result_summary'].includes(column)) return 'JSONB';
  if (['is_verified', 'is_active', 'is_indian', 'is_verified_creator'].includes(column)) return 'BOOLEAN DEFAULT FALSE';
  if (column === 'content_languages') return 'TEXT[]';
  return 'TEXT';
}

main().catch((err) => {
  console.error('\nDiff failed:', err.message);
  process.exit(1);
});
