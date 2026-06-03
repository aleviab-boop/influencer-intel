# Influencer Intel

India-deep AI-native influencer intelligence platform — brand types a campaign brief, gets a credibility-scored shortlist of creators in 5 to 10 minutes, with reasoning per pick.

## How we read/write to Boltic

Boltic Database is **managed PostgreSQL**. We connect via the standard `postgresql://...` connection string from Boltic console (Settings → External Database Access → "View Connection String") using the `pg` Node.js driver. No REST API, no proprietary SDK in the hot path.

```typescript
// shared/db/boltic-client.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.BOLTIC_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Read
const creators = await pool.query('SELECT * FROM creators WHERE primary_city = $1', ['Mumbai']);

// Write
await pool.query(
  'INSERT INTO briefs (brand_id, raw_text, parsed_spec, brief_embedding) VALUES ($1, $2, $3, $4::vector)',
  [brandId, rawText, parsedSpec, vectorLiteral],
);

// Vector similarity search (pgvector)
await pool.query(
  `SELECT *, 1 - (content_embedding <=> $1::vector) AS similarity
   FROM creators
   WHERE primary_category = $2
   ORDER BY content_embedding <=> $1::vector
   LIMIT 100`,
  [briefVector, 'skincare'],
);
```

The `BolticClient` class (`shared/db/boltic-client.ts`) wraps the pool with typed `query / insert / upsert / update / findById / vectorSearch / withTransaction` methods so the rest of the app uses a clean interface.

**Encryption helpers** (`shared/db/encryption.ts`) wrap Boltic's SQL functions (`boltic_encrypt`, `boltic_encrypt_searchable`, `boltic_decrypt`) for the columns that need them — `service_accounts.storage_state`, `creators.verified_oauth_data`, OAuth tokens inside `brands.users`.

Roles: use `db_admin` (full) or `db_executive` (read/write tables) connection string. `db_viewer` is read-only.

## Architecture

```
LAPTOP                                    BOLTIC                                BRAND BROWSER
─────────────────                         ──────                                ─────────────
Scraper (Playwright + Chrome              ┌─────────────┐                       Web app
  + our extension + service account)      │   Boltic    │                       (Next.js on Boltic
        └── walks IG handles    writes ──▶│   Tables    │ ◀── reads ─────▶       Serverless)
        └── extension extracts            └──────┬──────┘                              │
        └── writes to Boltic Tables              │                                     │
                                                 ▼                                     │
                                          Boltic Serverless                            │
                                          (Next.js platform)                           │
                                              Brief → shortlist                        │
                                              SSE streaming                  ◀─────────┘
```

Two systems share a single Boltic Tables database. Scraper writes; platform reads + queues new scrape jobs. Brand interacts with the web app only.

## Repo layout

```
influencer-intel/
├── shared/                  # types + Boltic client + OpenAI client (consumed by both)
├── scraper/                 # runs on your laptop (Playwright + Chrome extension)
│   ├── src/                 # TypeScript orchestrator
│   └── extension/           # Chrome MV3 extension (vanilla JS)
├── platform/                # Next.js, deploys to Boltic Serverless
│   ├── app/                 # routes (API + UI)
│   ├── lib/                 # business logic
│   └── components/          # React components
├── db/
│   └── schema.sql           # Boltic Tables schema (15 tables, vector columns)
└── validation/              # pre-build settlement docs (discovery script, LOI template, etc.)
```

## Setup

### 0. Prerequisites

- **Node 20+** and npm
- **OpenAI API key** with credit
- **Boltic** account with a database created
- **Google Chrome** installed locally (for the scraper)
- **Residential proxy** (optional for prototype, recommended for sustained scraping)
- **One Instagram service account** (a fresh account or one we'll warm — never your personal IG)

### 1. Apply the schema to Boltic Tables

Open the Boltic console:

```
https://console.fynd.com/boltic/asia-south1/accounts/.../tables/create/...
```

Run [db/schema.sql](db/schema.sql) against your database. Standard PostgreSQL syntax — most Boltic Tables UIs accept SQL DDL directly. If your namespace differs, search-and-replace `"influencer_intel".` with your namespace prefix (or remove it).

### 2. Install dependencies

```bash
cd influencer-intel
npm install
```

This sets up the npm workspaces (`shared`, `scraper`, `platform`).

### 3. Environment

Copy `.env.example` → `.env` at the repo root, then fill in:

```bash
# Get the Postgres connection string from Boltic console:
# Settings → External Database Access → "View Connection String"
BOLTIC_DATABASE_URL=postgresql://user:password@host:port/database

OPENAI_API_KEY=<your OpenAI key>

SCRAPER_CALLBACK_SECRET=<long random string>
SESSION_SECRET=<long random string>

SERVICE_ACCOUNT_HANDLE=<your warmed IG service account handle>
```

The scraper and platform both pick up `.env` from the repo root via dotenv.

### 3a. Verify the DB connection

```bash
npm run db:health
```

This connects via the standard Postgres protocol, confirms pgvector is installed, lists the 6 required tables (creators, brands, briefs, brief_creators, scrape_jobs, service_accounts), and checks for the Boltic encryption helpers. Output looks like:

```
1. Connection… ✓ Connected. PostgreSQL 16.x
2. pgvector extension… ✓ pgvector 0.7.x present.
3. Required tables… ✓ creators ✓ brands ✓ briefs ✓ brief_creators ✓ scrape_jobs ✓ service_accounts
4. Vector column on creators.content_embedding… ✓ creators.content_embedding (USER-DEFINED / vector)
5. Boltic encryption helpers… ✓ all three encryption functions present
```

If anything's missing the script tells you exactly what.

### 4. Capture an Instagram service account session

The scraper needs an authenticated IG session. Capture it once with the headed Chrome flow:

```bash
SERVICE_ACCOUNT_HANDLE=your_handle npm --workspace scraper run capture-session
```

This opens Chrome with the extension loaded. **Manually log in to Instagram** with the service account in the opened window, then return to the terminal and press Enter. The session (cookies + localStorage) is written to the `service_accounts` table in Boltic Tables. Re-run when IG forces re-login (typically every 30 days).

### 5. Run the platform locally

```bash
npm --workspace platform run dev
# → http://localhost:3000
```

Open the browser, type a brief like:

> *Festive Diwali campaign for our ghee skincare line, ₹8L budget, target metro women 25–34, prefer creators with past festive content and 85%+ credibility.*

Press Cmd+Enter. The platform parses the brief via GPT-4o-mini, generates an embedding, queries the cache, returns a preliminary shortlist (initially empty if your DB is empty), and queues scrape jobs.

### 6. Run the scraper

In a separate terminal:

```bash
npm --workspace scraper run dev
```

This starts the orchestrator. It picks up queued jobs (priority first, then idle background work), drives Chrome to `instagram.com/{handle}`, and the extension extracts data → writes to Boltic Tables. Each completion notifies the platform via `/api/scrape-callback`, which re-ranks the shortlist and pushes updates to the brand UI via Server-Sent Events.

You'll see the shortlist update live in the browser as scrapes complete.

## Deploy the platform to Boltic Serverless

1. **Push to your personal GitHub.** From the repo root: `git init && git add . && git commit -m "initial" && git remote add origin git@github.com:<you>/influencer-intel.git && git push -u origin main`.
2. **In Boltic console**, go to Compute → Serverless → "Import from GitHub". Authenticate, select the `platform` workspace. Boltic auto-detects Next.js.
3. **Set env vars** in the Boltic dashboard (same as `.env` but with the production callback URL — `https://<your-boltic-app>.fynd.com/api/scrape-callback`).
4. **Update `PLATFORM_CALLBACK_URL` in your laptop's `.env`** to that URL.
5. **Push to main** — Boltic auto-deploys.

The scraper continues running on your laptop; it talks to the deployed platform and the Boltic Tables DB.

## Validation toolkit

The `validation/` folder has pre-build settlement artefacts:

- [customer-discovery-script.md](validation/customer-discovery-script.md) — 30-min interview script for 15 brand-marketing leads
- [design-partner-outreach.md](validation/design-partner-outreach.md) — verbal ask + email template + LOI
- [competitive-teardown-scorecard.md](validation/competitive-teardown-scorecard.md) — 22-dimension rubric for Qoruz / Plixxo / Winkl / Modash
- [credibility-scoring-spec.md](validation/credibility-scoring-spec.md) — 10 signals + validation methodology
- [pricing-test-framework.md](validation/pricing-test-framework.md) — Van Westendorp PSM
- [pre-build-tracker.md](validation/pre-build-tracker.md) — readiness scoreboard

## Stage 0 honest limitations

- **Scraper depends on your laptop being on.** When closed, on-demand requests queue. Stage 1 trigger to fix: migrate scraper to a small VPS or Boltic Serverless container.
- **Audience inference is a placeholder** that writes a low-confidence row. Real engager-sampling implementation is queued for Stage 1+.
- **Credibility v0 has 6 signals**, not 10. Comment-text classifier, audience-account-age, story parity, hashtag-engagement match — all Stage 2+.
- **IG selectors are fragile.** When IG ships a DOM change, `scraper/extension/content/ig-helpers.js` SELECTORS object is the first place to look.
- **No multi-account pool.** Single warmed service account at Stage 0. When throughput is the constraint, add accounts and rotate (Stage 2 work).

## Next concrete moves

1. Apply `db/schema.sql` to Boltic Tables.
2. `npm install` at repo root.
3. Fill in `.env`.
4. Capture an IG service account session.
5. Run platform + scraper locally; submit a test brief.
6. Once the loop works, push to GitHub + deploy platform to Boltic Serverless.
7. Invite a design partner for the first real brief.

That's a working v1. Everything from there is iteration on real usage.
