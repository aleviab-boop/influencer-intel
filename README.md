# Influencer Intel

India-deep, AI-native influencer intelligence platform. An agency types a plain-English brief or niche ("food bloggers in Pune", "handloom saree weaver in Chennai") and gets a relevance-ranked, India-first list of creators — pulled from a growing database, named live by AI web search, and enriched with live Instagram data (followers, posts, engagement) on demand.

> **Architecture note:** the platform deploys to **Vercel** (not Boltic Serverless — that changed). The scraper runs on a laptop using **Camoufox** (anti-detect Firefox), not a Chrome extension. Both share one **Boltic managed-Postgres** database.

## Architecture

```
LAPTOP (residential IP)                    BOLTIC (Postgres)                 VERCEL (cloud)
──────────────────────                     ─────────────────                 ──────────────
Worker  (Camoufox / anti-detect FF)        ┌──────────────┐                  Next.js platform
  └─ account pool (rotating IG sessions)   │   creators   │ ◀── read/write ─▶  app/ (API + UI)
  └─ crawls niches → writes creators ─────▶│ scrape_jobs  │                        │
                                           │ service_accts│                        │ live IG fetch
Relay  (tools/ig-relay.mjs on :8787)       │ system_config│                        │ (data-center IP
  └─ Cloudflare tunnel ◀───── reads relay_url from DB ─────────── igFetch ─────────┘  is blocked by IG)
        ▲                                   └──────────────┘                        │
        └────────────── proxies IG requests over the HOME IP ◀─────────────────────┘
```

**Why the relay exists:** Instagram serves its endpoints to residential IPs but blocks data-center IPs — so the cloud app (Vercel) can't hit Instagram directly. It sends every IG request to a **relay** running on the laptop's home connection, which fetches Instagram and returns the response. The relay is exposed publicly by a **Cloudflare tunnel**.

**Self-healing tunnel URL:** the free Cloudflare quick-tunnel gets a new URL on each restart. Instead of re-pasting it into Vercel every time, the on-host keeper writes the fresh URL to `system_config.relay_url` in the DB, and `platform/lib/ig-fetch.ts` reads it (cached ~60s). So tunnel churn propagates itself — no manual Vercel edits.

**Cookie rotation:** live IG requests authenticate with real session cookies pulled from the captured-account pool (`service_accounts`). `igFetch` rotates across accounts and **fails over on 401/403 (dead cookie) or 429 (throttle)** to the next healthy account, so live data self-heals instead of dying on one bad session.

## Discovery pipeline (how a search works)

An agency search (`/api/discover-live`) runs three sources and merges them, India-first:

1. **AI web search** — `gpt-4o-mini-search-preview` browses the web to name **real** Indian creators for the niche+city. Each handle is validated against Instagram (hallucinations dropped) and passed through an OpenAI relevance/geo filter (off-niche or foreign accounts dropped).
2. **Database** — the `creators` table, ranked by weighted relevance (location > niche/name > bio) and **India-first** (known-foreign creators sink).
3. **Live crawl** — for cold prompts, the worker is enqueued a `search_query` job to crawl Instagram and grow the DB.

Every surfaced creator is stored (verified or as a stub to enrich later), flagged Indian, and given a 0–10 data-completeness score.

## How we read/write to Boltic

Boltic Database is **managed PostgreSQL**. We connect via the standard `postgresql://...` connection string (`pg` driver) — no REST API, no proprietary SDK in the hot path.

```typescript
// shared/db/boltic-client.ts — Pool wrapped with typed query/insert/upsert/update/vectorSearch
const pool = new Pool({ connectionString: process.env.BOLTIC_DATABASE_URL, ssl: { rejectUnauthorized: false } });
```

The `BolticClient` class wraps the pool with typed `query / insert / upsert / update / findById / vectorSearch / withTransaction` methods.

## Repo layout

```
influencer-intel/
├── shared/                  # types + Boltic client + OpenAI client (consumed by both)
├── scraper/                 # runs on a laptop — Camoufox (anti-detect Firefox)
│   ├── src/                 # TypeScript orchestrator + jobs + account pool + capture-session CLI
│   └── extension/           # legacy Chrome MV3 extension (no longer the auth path)
├── platform/                # Next.js — deploys to VERCEL (root dir = platform)
│   ├── app/                 # routes (API + UI), incl. api/discover-live, api/ig-profile, api/cron/monitor
│   ├── lib/                 # business logic (ig-fetch relay client, creator-db-search, live-discovery…)
│   └── components/          # React components (live-search.tsx = the agency lander)
├── tools/
│   └── ig-relay.mjs         # the home-IP relay (run on the laptop, tunnelled to Vercel)
├── scripts/
│   ├── relay-daemon.sh      # relay + tunnel keeper (launchd variant)
│   └── set-relay-url.mjs    # publishes the fresh tunnel URL to system_config.relay_url
├── run-worker.sh            # Terminal-run worker keeper (caffeinate + auto-restart)
├── run-relay.sh             # Terminal-run relay + tunnel keeper (auto-restart + DB URL publish)
├── db/schema.sql            # Boltic Tables schema (+ runtime tables: worker_heartbeat, system_config, alert_state)
└── validation/              # pre-build settlement docs (discovery script, LOI template, etc.)
```

## Setup

### Prerequisites
- **Node 20+** and npm
- **OpenAI API key** with credit (prompt parsing, embeddings, web-search discovery)
- **Boltic** account with a database
- **Camoufox** (installed via the `camoufox-js` dependency; downloads the anti-detect Firefox build)
- **cloudflared** (for the tunnel) — `brew install cloudflared`
- **One+ Instagram burner accounts** (never a personal IG) — more accounts = steadier live data

### 1. Install + env
```bash
cd influencer-intel && npm install         # sets up the shared / scraper / platform workspaces
```
Fill `.env` at the repo root (both scraper and platform read it):
```bash
BOLTIC_DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
# Relay (live IG data path). IG_RELAY is a fallback — the DB relay_url wins.
IG_RELAY=https://<tunnel>.trycloudflare.com
IG_RELAY_KEY=<shared secret, matches RELAY_KEY on the relay>
# A session cookie fallback (the account pool is the primary source):
IG_SESSIONID=...  IG_DS_USER_ID=...  IG_CSRFTOKEN=...
SERVICE_ACCOUNT_HANDLE=<default account for capture-session>
SLACK_WEBHOOK_URL=<incoming webhook for operator alerts>
```

### 2. Capture an Instagram account session
```bash
npm run scraper:capture -- <handle>        # e.g. bha_ti3772 (or omit to use SERVICE_ACCOUNT_HANDLE)
```
Opens a **Camoufox** window → log in as that account manually → wait for the feed → press Enter. The session (cookies + localStorage) is written to `service_accounts`. Re-run when IG expires it (~30 days). Revive several, staggered, so they don't all expire the same week.

### 3. Run the relay + tunnel (live data path)
```bash
./run-relay.sh        # starts the relay on :8787 + a Cloudflare tunnel, auto-restarts on drop,
                      # and publishes each fresh tunnel URL to the DB so Vercel self-updates.
```

### 4. Run the worker (crawler)
```bash
./run-worker.sh       # Camoufox orchestrator: drains scrape_jobs across the account pool,
                      # crawls niches, stores creators, and heartbeats worker_heartbeat.
```

### 5. Run the platform locally (optional)
```bash
npm --workspace platform run dev   # → http://localhost:3000
```

## Deploy the platform to Vercel

- The platform is a Vercel project with **root directory = `platform`**; it auto-deploys on push to `main`.
- Set env vars in the Vercel dashboard (`BOLTIC_DATABASE_URL`, `OPENAI_API_KEY`, `IG_RELAY_KEY`, cookie fallbacks, `SLACK_WEBHOOK_URL`, …). `IG_RELAY` is optional — the DB `relay_url` is authoritative.
- Cron jobs live in `platform/vercel.json` (news digest + the operational monitor). On the Hobby plan crons run at most daily; the on-host relay keeper curls `/api/cron/monitor` every 5 min for real-time alerting.

## Operations

- **Monitoring:** `/api/cron/monitor` pings Slack (via `SLACK_WEBHOOK_URL`) on relay-down, cookie-rejected, rate-limited (429), no/low accounts, accounts **expiring within 3 days**, or worker-stalled-with-queue. De-duped (≤1/hr per issue) with recovery pings.
- **Health at a glance:** `/admin/scraper` shows the live-data pipeline status, a truthful "Worker live" badge (backed by `worker_heartbeat`), account rotation, and queue depth.
- **Rate limits:** all accounts share one home IP, so a heavy load throttles the IP (429). Ease off crawls and revive more accounts; residential proxies per account are the durable fix.

## Validation toolkit

The `validation/` folder has pre-build settlement artefacts — customer-discovery script, design-partner outreach + LOI, competitive teardown scorecard, credibility-scoring spec, pricing-test framework, pre-build tracker.

## Honest limitations

- **The laptop must be on.** The relay + worker run there; when it's off, live data and crawling stop (the DB keeps serving cached data). Durable fix: a dedicated always-on host.
- **Shared home IP.** All accounts route through one residential IP, so heavy usage gets the IP rate-limited (429). Fix: residential proxy per account.
- **Free-tunnel URL churn.** Handled by the DB-stored `relay_url` (self-healing); a named tunnel / stable URL would remove even that.
- **Session upkeep.** Burner sessions expire (~30 days, sooner if IG watches an account); revival is a manual login (staggered). Aged accounts + proxies reduce this.
- **launchd auto-start isn't possible from `~/Downloads`** on a managed Mac (macOS TCC blocks it); use the Terminal-run `run-relay.sh` / `run-worker.sh` keepers.
