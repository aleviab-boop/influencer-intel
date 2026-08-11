// One-off trainer: fit the reach model on the live DB and persist weights.
// Run: npx tsx platform/scripts/train-reach.ts   (from repo root)
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

function findEnv(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const c = path.join(dir, '.env');
    if (fs.existsSync(c)) return c;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
const envPath = findEnv();
if (envPath) dotenv.config({ path: envPath });

import { trainReachModels } from '../lib/ml/reach-model';

trainReachModels()
  .then((r) => { console.log('TRAIN_REPORT', JSON.stringify(r, null, 2)); process.exit(0); })
  .catch((e) => { console.error('TRAIN_ERROR', e); process.exit(1); });
