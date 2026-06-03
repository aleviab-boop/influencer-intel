// Quick verifier — does mindsetmaya have a captured session?
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

async function main() {
  const pool = getPool();
  // Detect actual column type (Boltic might have made it json instead of jsonb)
  const colTypeRow = await pool.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = 'service_accounts' AND column_name = 'storage_state'`,
  );
  const cast = colTypeRow.rows[0]?.data_type === 'json' ? '::jsonb' : '';

  const rows = await pool.query<{
    id: string;
    handle: string;
    status: string;
    storage_captured_at: string | null;
    storage_expires_at: string | null;
    cookie_count: number;
  }>(`
    SELECT
      id,
      handle,
      status,
      storage_captured_at,
      storage_expires_at,
      jsonb_array_length(COALESCE((storage_state${cast})->'cookies', '[]'::jsonb)) AS cookie_count
    FROM service_accounts
    WHERE handle = $1 AND platform = 'instagram'
    ORDER BY storage_captured_at DESC NULLS LAST
    LIMIT 1
  `, [process.env.SERVICE_ACCOUNT_HANDLE ?? '']);

  if (rows.rows.length === 0) {
    console.log(`✗ No service_accounts row for "${process.env.SERVICE_ACCOUNT_HANDLE}".`);
    process.exit(1);
  }
  const r = rows.rows[0]!;
  console.log(`✓ @${r.handle}`);
  console.log(`  status: ${r.status}`);
  console.log(`  cookies: ${r.cookie_count}`);
  console.log(`  captured: ${r.storage_captured_at}`);
  console.log(`  expires:  ${r.storage_expires_at}`);

  // Verify sessionid cookie is present
  const ses = await pool.query<{ has_session: boolean }>(`
    SELECT EXISTS(
      SELECT 1
      FROM service_accounts,
           jsonb_array_elements(COALESCE((storage_state${cast})->'cookies', '[]'::jsonb)) c
      WHERE handle = $1 AND platform = 'instagram'
        AND c->>'name' = 'sessionid'
        AND c->>'domain' LIKE '%instagram%'
    ) AS has_session
  `, [process.env.SERVICE_ACCOUNT_HANDLE ?? '']);
  console.log(`  sessionid cookie present: ${ses.rows[0]!.has_session ? '✓' : '✗'}`);

  await pool.end();
}

main().catch((err) => {
  console.error('check-session failed:', err.message);
  process.exit(1);
});
