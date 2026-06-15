# Work Log — Influencer Intel

## Session: 2026-05-29

### What we built

**Three new features** (all compiled clean, verified in browser):

1. **Past Content References → "Brand Work" tab** (`/insights/[handle]`)
   - New 5th tab on the insights page showing an influencer's brand collaboration history
   - Detects paid partnerships, collab tags, brand mentions, and content themes from GPT-4o vision data (`raw_metadata.vision`)
   - Sponsored-post detection via regex patterns (#ad, #sponsored, #paidpartnership, #gifted, etc.) + brand-name matching
   - Added `brand_work` to the `ScrapedInsights` interface in `insights-service.ts`

2. **Excel / CSV Import + Automated Shortlisting** (`/briefs` → "Import List")
   - New `POST /api/briefs/import` endpoint — accepts .xlsx (via ExcelJS) or .csv
   - Auto-detects the handle column, looks handles up in the creators table
   - Optional campaign brief → runs imported creators through the ranker and creates a real brief
   - Drag-and-drop upload UI with inline results + collapsible "not found" section

3. **Store-Based Influencer Targeting** (`/stores` — new page)
   - Find influencers popular near retail store locations (for 1900+ stores)
   - New `stores` table (`db/migrations/003_stores.sql`), `GET/POST /api/stores`, `/api/stores/[id]/influencers`, `/api/stores/suggest`
   - Region scoring: primary_city (+40), audience top_cities (pct×30), bio match (+10), city_tier (+10), brand experience (+5)
   - City search + region filter + CSV store upload + "New Store Launch" form
   - Added "Stores" nav link to the app header

### Bugs fixed
- **Content tab "No posts available"** — `computeScrapedInsights()` only read `recent_posts` (often empty). Added a fallback to `raw_metadata.geo.posts` with field mapping. Now renders 12 posts for scraped creators.
- **Stores results not rendering** — turned out to be a browser-automation quirk (typed input didn't fire React's `onChange`), not a code bug. API was returning 50 results correctly via curl. Verified working with `form_input`.

### End-to-end test pass
Tested every page and flow. **What works:** home search, Discover (4,782 creators + filters), all 5 insights tabs (Overview/Content/Brand Work/Predict/Monitor), Predict (find→run→factors), Briefs (list/search/create/import), Shortlist (ranked + AI reasoning), Compare (side-by-side), Outreach (drafts), Stores (city→50 results), nav + auth.

**Bugs found (still open):**
1. Engagement chart shows 0.00% + SVG NaN errors — `engagement_rate` stored as decimal but chart re-multiplies by 100. Fix: normalize to percentage in `insights-service.ts`, stop double-multiplying in `page.tsx:337`.
2. Follower count missing (null → empty) or unformatted (`274000000` instead of `274M`) in insights/predict headers.
3. "Creator not found" page has no nav/header/back button — user gets stranded.
4. Profile photos break on expired IG CDN URLs.

**Polish backlog:** raw enum labels (`very_low` → "Very Low"), "← New brief" mislabel on shortlist, messy category tags, unexplained PENDING badges, gender % not summing to 100, "Insufficient data" trend (cascade from bug #1).

**Data gap:** top creators (Virat Kohli, etc.) have empty post-level engagement — scraping didn't capture metrics for many large accounts.

### Docs written
- **`details.md`** — full project reference: architecture, data model, ranking + prediction algorithms, scraper pipeline, design specs, dev workflow, quick-reference table.
- **`WORKLOG.md`** — this file.

### Next steps (recommended order)
1. Fix the 4 demo-visible bugs (chart, follower count, error page, broken images) — start here, they're the most visible.
2. Clear the polish backlog.
3. Backfill post-level engagement for top creators so marquee names don't look broken.

## Session: 2026-06-09

### Headline — seed-based Instagram scraper (free, login-free)
- Built a discovery engine that avoids Instagram's login wall: never calls blocked search APIs; instead **seeds from known handles and crawls outward** via the public `web_profile_info` endpoint (related accounts + caption @mentions).
- Three ways to seed a search:
  1. **Prompt only** → auto-derives seed handles from city + niche (e.g. "food bloggers in indore" → probes `indorefoodie`, `indorefoodblogger`…), keeps the real ones.
  2. **A name** ("mridul sharma") → generates handle spellings, probes, seeds from hits.
  3. **An exact @handle** → seeds directly.
- Ported the Python prototype (`ig_hybrid.py`) to TypeScript (`platform/lib/live-discovery.ts`).

### What we built
- **Search UI** (lander + Influencer Search): live ranked table, profile photos via `/api/ig-image` proxy, Excel export, prompt autocomplete, DB persistence.
- **API**: `POST /api/discover-live` (crawl + rank + persist), `/api/discover-live/export` (xlsx), `/api/ig-image` (CDN proxy).
- **Ranking**: iterated DB-first → **live-first with quality ranking** (relevance, then followers, source-agnostic).
- **Coverage**: ~90 cities + 26 niche-synonym sets + unlisted-city fallback.
- **DB**: every search upserts results into `creators` (source=scrape, tier_c); a richer DB plugs in for free.
- **For Influencers**: animated AI creator-toolkit section.
- **Creator dashboard**: photo proxy fix, responsive stats, gradient redesign.
- **Login**: animated split-panel redesign + drifting background orbs.
- **Showcase**: accurate state-level India map (`public/india.svg`) + colourful pins/features.
- Removed "Instagram Search (live)" from the Features nav.

### Bugs fixed
- **`400 SecFetch Policy violation`** — Node's `fetch` auto-sent `Sec-Fetch-*` headers Instagram rejects; spoofed browser headers + `Referer` to make server-side requests work.
- **Profile photos not loading** — Instagram CDN blocks hotlinking; added a server-side image proxy with host allowlist.

### Known limits / open
- Seed-based scraping catches **predictable handles** only; unusual ones need Instagram's logged-in search (deferred — reintroduces the 2FA wall).
- Every search now always crawls (~15–20s); no instant DB-only path.
- Test/seed campaigns still showing on `/creator`; engagement value looks like seed data — both DB cleanups.

### Next steps
1. Engagement rate + quality score from the post data we already fetch (biggest result-quality jump, still free).
2. Result filters + sorting (min followers, verified-only).
3. Optionally blend authenticated search for the unpredictable-handle misses.
4. Clean test campaigns / fix seed engagement values in the DB.
