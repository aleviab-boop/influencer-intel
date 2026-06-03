# Setup — Influencer Intel

Get from zip to a running platform + scraper.

## Prerequisites

- Node.js ≥ 20 (Camoufox requires modern Node)
- macOS / Linux (Windows untested — Camoufox should work)
- A Boltic Database (managed Postgres + pgvector). Get the connection string from the Boltic console → Settings → External Database Access
- An OpenAI API key
- An Instagram account you can dedicate to scraping (you'll log into it once during session capture)

## 1 · Install dependencies

```bash
cd influencer-intel
npm install
```

Then fetch the Camoufox browser binary (used by the scraper):

```bash
cd scraper
npx camoufox-js fetch
cd ..
```

## 2 · Configure env

Copy the template and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```
BOLTIC_DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB?sslmode=disable
OPENAI_API_KEY=sk-...
SCRAPER_CALLBACK_SECRET=any-long-random-string
PLATFORM_CALLBACK_URL=http://localhost:3030/api/scrape-callback
SERVICE_ACCOUNT_HANDLE=your_ig_login_username
SESSION_SECRET=any-long-random-string-for-cookie-signing
```

## 3 · Initialise the database

Apply the schema:

```bash
psql "$BOLTIC_DATABASE_URL" -f db/schema.sql
```

This creates 6 tables: `creators`, `briefs`, `brief_creators`, `scrape_jobs`, `service_accounts`, `brands`. pgvector extension + HNSW index for vector search included.

## 4 · Capture an Instagram service-account session

Opens Camoufox Firefox; you log into Instagram once as your service account; the cookies are saved to the `service_accounts` table.

```bash
cd scraper
npm run capture-session
```

A Camoufox window opens at `instagram.com`. Log in manually as the handle in `SERVICE_ACCOUNT_HANDLE`. When the home feed has loaded, return to the terminal and press Enter. Session is captured and persisted.

## 5 · Run the scraper

```bash
cd scraper
npm run dev
```

This:
- Connects to your Boltic DB
- Launches Camoufox + loads the captured session
- Polls `scrape_jobs` table and processes them (priority order)

You should see:
```
[orchestrator] starting…
[orchestrator] using service account @your_handle
[orchestrator] Camoufox Firefox ready
```

## 6 · Run the platform (web app)

In another terminal:

```bash
cd platform
npm run dev
```

Opens at `http://localhost:3030`. Sign in with any email → a new brand is created automatically.

## 7 · Submit your first brief

1. Open `http://localhost:3030`
2. Type a brief like: *"Diwali ethnic-wear campaign for Trends — premium fashion, target women 25-35 in Mumbai/Delhi/Bangalore"*
3. Submit. You'll see a preliminary shortlist in 5-30s + scraper jobs queued for deeper discovery
4. Shortlist auto-updates live via SSE as scrapes complete

## Architecture in one diagram

```
Brand browser → Next.js platform → POST /api/briefs
                       │
                       ├─ parse brief (gpt-4o-mini)
                       ├─ embed brief (text-embedding-3-small)
                       ├─ vector search creators table (pgvector)
                       ├─ rank fresh, return preliminary shortlist
                       └─ queue search_query + on_demand jobs in scrape_jobs

Scraper (your laptop / VPS):
                       polls scrape_jobs
                       │
                       ├─ search_query → IG topsearch + similar-account chain + followings mine
                       │                  → upsert stub creators, queue on_demand
                       │
                       └─ on_demand → Camoufox navigates to instagram.com/{handle}/
                                    ├─ in-page extractor (50+ fields from og:meta + DOM)
                                    ├─ vision: gpt-4o on screenshot (22 fields)
                                    ├─ feed: per-post engagement, captions, hashtags, geo
                                    ├─ credibility composite score
                                    └─ POST /api/scrape-callback → reRank → SSE
```

## Useful CLIs

| Command | Purpose |
|---|---|
| `cd scraper && npm run capture-session` | (Re-)capture IG session cookies |
| `cd scraper && npx tsx src/cli/reembed-creators.ts` | Re-embed all creators with rich text |
| `cd scraper && npx tsx src/cli/recompute-credibility.ts` | Backfill credibility with new scorer |

## Manual recovery endpoints

| Endpoint | Use |
|---|---|
| `POST /api/admin/rerank {brief_id}` | Force-rerank a stuck brief without waiting for a callback |
| `POST /api/research {handles}` | Bulk-research handles you paste from manual IG browsing |
| `GET /api/briefs/[id]/export` | Branded XLSX export |

## Stack

- **DB**: Boltic Database (Postgres + pgvector)
- **Platform**: Next.js 15 App Router, Tailwind, SSE for live shortlist
- **Scraper**: Node.js + tsx + Playwright-core + Camoufox (anti-detect Firefox)
- **LLM**: OpenAI — `text-embedding-3-small`, `gpt-4o-mini` (parsing/classification), `gpt-4o` (vision + reasoning)
- **Monorepo**: npm workspaces — `shared/`, `scraper/`, `platform/`

## Troubleshooting

| Symptom | Fix |
|---|---|
| Shortlist stuck at preliminary, never grows | Clear `platform/.next/cache`, restart platform — webpack may have cached a broken module. Or `POST /api/admin/rerank {brief_id}` |
| Scraper says "No active service account" | Run `npm run capture-session` again |
| All credibility scores look identical | Run `npx tsx src/cli/recompute-credibility.ts` to backfill |
| Vector search returns wrong creators | Run `npx tsx src/cli/reembed-creators.ts` to refresh embeddings |
| IG returns 429 / empty results | Service-account session may be flagged. Try `capture-session` from a fresh IP / wait an hour |
