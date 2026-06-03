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
