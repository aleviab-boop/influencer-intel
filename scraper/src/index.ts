// Scraper entry point.
import { run } from './orchestrator.js';

run().catch((err) => {
  console.error('[scraper] fatal:', err);
  process.exit(1);
});
