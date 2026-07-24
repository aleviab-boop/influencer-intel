# Influencer Intel — Project Handoff / Continuation Guide

**Purpose:** everything a fresh Claude Code session (on a new account/machine) needs to continue
working on this platform without losing context or breaking anything. Read this top-to-bottom
once, then use it as the map. It complements — does not replace — `README.md` (architecture +
setup) and `details.md` (deep design notes).

> ⚠️ **Secrets are NOT in this file.** All keys/tokens/passwords live in `.env` at the repo root
> (git-ignored). Copy `.env` across securely (not via chat, not committed). This doc only names the
> variables. Never paste secret *values* into any committed file.

---

## 0. TL;DR — what this product is

India-focused, AI-native **influencer discovery** platform (a.k.a. "ICMP"). An agency types a
plain-English brief ("home bakers in Mumbai", "specialty coffee roaster in Bangalore") and gets a
relevance-ranked, **India-first** list of Instagram creators, merged from three sources:

1. **AI web search** (OpenAI `gpt-4o-mini-search-preview`) names real handles for the niche+city.
2. **Database** (`creators` table, ~8,200 active creators) ranked by weighted relevance.
3. **Live Instagram crawl** (only for brand-new/"cold" prompts) to grow the DB.

Deploys to **Vercel** (root dir = `platform`). Scraper + relay run on a **laptop** (residential IP).
Shared **Boltic managed-Postgres** DB. Anti-detect scraping via **Camoufox** (not a Chrome extension).

---

## 1. Getting set up on the new account / machine

The **project itself does not move** — same GitHub repo, same Boltic DB, same Vercel deployment.
Only the Claude *conversation context* is new. So on the new setup:

1. **Clone the repo.** It's private and owned by another user (`salmansaudagar-ai`); the operator's
   account (`aleviab-boop`) is an outside collaborator.
   - **Gotcha:** a *fine-grained* PAT (`github_pat_...`) **cannot** reach it — use a **classic** PAT
     (`ghp_...`) with `repo` scope.
   - `git clone https://<ghp_token>@github.com/aleviab-boop/influencer-intel.git` then scrub the token
     from the remote URL. Local clone lives at `~/Downloads/influencer-intel`.
   - Remotes: `origin` = `aleviab-boop/influencer-intel` (push here), `upstream` =
     `salmansaudagar-ai/influencer-intel`. Work on `main`.
2. **Copy `.env`** (root) from the old machine — securely. Both scraper and platform read it.
3. `npm install` at the repo root (sets up the `shared` / `scraper` / `platform` workspaces).
4. `brew install cloudflared` (for the relay tunnel).
5. Camoufox downloads via the `camoufox-js` dependency on first scraper run.

**Node 20+ required.** Workspaces: `shared`, `scraper`, `platform`.

---

## 2. Architecture (1-minute version)

```
LAPTOP (residential IP)              BOLTIC (Postgres)        VERCEL (cloud)
─────────────────────                ─────────────────        ──────────────
run-worker.sh → Camoufox worker      creators                 Next.js platform (app/)
  └ account pool (IG sessions)       scrape_jobs                 └ live IG fetch via relay
  └ crawls niches → writes creators  service_accounts            (Vercel's data-center IP is
run-relay.sh → ig-relay.mjs :8787    system_config (relay_url)    blocked by IG, so it CANNOT
  └ Cloudflare tunnel                worker_heartbeat, alert_state hit IG directly)
```

- **Why the relay exists:** IG serves residential IPs but blocks data-center IPs. Vercel can't hit
  IG, so it POSTs every IG request to the **relay** on the laptop's home IP, which fetches IG and
  returns the response. The relay is exposed by a **Cloudflare quick-tunnel**.
- **Self-healing tunnel URL:** the free tunnel URL changes on every restart. The keeper writes each
  fresh URL to `system_config.relay_url`; `platform/lib/ig-fetch.ts` reads it (cached ~60s). No
  manual Vercel edits needed.
- **Cookie rotation:** live IG requests auth with real session cookies from `service_accounts`.
  `igFetch` rotates accounts and fails over on 401/403/429 to the next healthy one.

Full diagram + prose: see `README.md`.

---

## 3. Repo layout (where things live)

```
influencer-intel/
├── shared/                  # Boltic DB client + OpenAI client + types (used by both apps)
│   ├── db/boltic-client.ts  # pg Pool wrapper: query/insert/upsert/update/vectorSearch
│   └── llm/openai-client.ts # suggestHandlesFromPrompt, verifyProfileRelevance, etc.
├── scraper/                 # runs on the laptop (Camoufox / anti-detect Firefox)
│   └── src/
│       ├── orchestrator.ts          # main loop: pick job → crawl → rotate accounts → heartbeat
│       ├── queue/account-pool.ts    # AccountPool: rotation, cooldowns, dead-strike parking
│       ├── queue/worker.ts          # job queue + per-account action counting
│       ├── jobs/search-discovery.ts # the crawl: topsearch + hashtag feeds + seed expansion
│       └── cli/capture-session.ts   # `npm run scraper:capture -- <handle>` — manual IG login
├── platform/                # Next.js — deploys to VERCEL (root dir = platform)
│   ├── app/api/discover-live/route.ts  # THE search endpoint (OpenAI + DB + crawl merge)
│   ├── app/api/cron/enrich/route.ts    # background stub enrichment (fills 0-follower stubs)
│   ├── app/api/cron/monitor/route.ts   # Slack watchdog (relay/cookie/429/accounts/worker)
│   ├── app/api/admin/coverage/route.ts # the city×niche coverage matrix
│   ├── app/admin/scraper/page.tsx      # admin dashboard (worker/relay/accounts/queue)
│   ├── lib/ig-fetch.ts                 # relay client + cookie rotation + failover
│   ├── lib/creator-db-search.ts        # DB search (relevance ranking, niche gate, India-first)
│   ├── lib/live-discovery.ts           # profilesFromHandles, completenessScore, stubs
│   └── components/live-search.tsx      # the agency Lander (search UI, result sections)
├── tools/ig-relay.mjs       # the home-IP relay (POST {url,headers} → fetches IG → returns)
├── scripts/
│   ├── set-relay-url.mjs     # publishes the fresh tunnel URL to system_config.relay_url
│   ├── import-campaigns.mjs  # Excel/Trends import
│   └── import-fynd-seeding.mjs
├── run-relay.sh             # relay + tunnel keeper (caffeinate + auto-restart + DB URL publish
│                            #   + curls /api/cron/monitor & /api/cron/enrich every 2 min)
├── run-worker.sh            # worker keeper (caffeinate + auto-restart)
├── db/schema.sql            # base schema (creators, scrape_jobs, service_accounts, …)
└── README.md / details.md   # architecture + deep design
```

---

## 4. Running it (the three long-lived processes)

All run **on the laptop** (they need the residential IP). Each is a keeper that `caffeinate`s the
Mac and auto-restarts on drop.

| Process | Command | What it does | Required for |
|---|---|---|---|
| **Relay** | `./run-relay.sh` | relay on :8787 + Cloudflare tunnel + writes URL to DB + curls monitor/enrich | **Live search** (always keep this on) |
| **Worker** | `./run-worker.sh` | Camoufox crawler: drains `scrape_jobs`, grows the DB, heartbeats | **Coverage growth / live-crawl section** |
| **Watchdog** | (LaunchAgent, already installed) | every 2 min: if the relay keeper died, restart it | Relay reliability |

- **Relay must stay up** or live search dies (falls back to DB-only). The watchdog (below) keeps it up.
- **Worker is optional / usually left OFF** to avoid throttling the small account pool. Turn it on
  when you want coverage to grow (and ideally after reviving more accounts).
- Local platform dev (optional): `npm --workspace platform run dev` → http://localhost:3000.

### 4a. The relay watchdog (auto-restart) — IMPORTANT

macOS `launchd` **cannot** run scripts from `~/Downloads` (TCC blocks it), so the relay can't be a
normal system service. Instead there's a **watchdog** that survives that limitation:

- **Files (all OUTSIDE the repo, so nothing to migrate here):**
  - `~/relay-watchdog.sh` — every 2 min, checks if the relay keeper is alive (via `pgrep -f` on the
    cloudflared command + `comm` check, because `ps -o command` truncates the long keeper argv).
  - `~/relay-launch.command` — the launcher (run *by Terminal*, which has `~/Downloads` access);
    cleans orphan cloudflared/keepers, then starts one `run-relay.sh`.
  - `~/Library/LaunchAgents/com.influencerintel.relaywatch.plist` — runs the watchdog every 120s.
- **Controls:**
  - Check: `launchctl list | grep relaywatch`
  - Off: `launchctl unload ~/Library/LaunchAgents/com.influencerintel.relaywatch.plist`
  - On: `launchctl load ~/Library/LaunchAgents/com.influencerintel.relaywatch.plist`
  - Log: `cat /tmp/relay-watchdog.out.log` (empty = relay stayed healthy)
- **On the new machine these three files must be recreated** (they don't live in the repo). They
  reference `~/Downloads/influencer-intel` paths — regenerate them if the repo path differs.
- Only starts the relay when it's actually down (no duplicate-keeper stacking). Pops a small Terminal
  window when it restarts — leave it open. After a reboot it fires once you log in.

---

## 5. Instagram accounts — the core constraint

Everything IG-related depends on **captured account sessions** in `service_accounts`. This is the #1
operational bottleneck.

- **Capture / revive:** `npm run scraper:capture -- <handle>` → opens Camoufox → log in manually as
  that handle → wait for the feed → press Enter → session saved to DB with a 30-day expiry.
- **They expire** (~30 days, sooner if IG flags them). Revive **staggered** so they don't all die the
  same week.
- **The throttle problem:** all accounts share **one home IP**, so IG rate-limits the IP (429) and
  serves **stripped/0-follower data** under load. Account *rotation* doesn't escape this because it's
  an IP-level limit. **Fix = residential proxy per account** (see roadmap) — the code already supports
  a proxy via `IG_PROXY` (platform) / `SCRAPER_PROXY_URL` (scraper).
- **Check pool health:** admin `/admin/scraper` page, or query `service_accounts`.

**As of last session (2026-07-24):** pool was **3/6 ready** (yashsingh12081, manishsinha149,
lamsal3829) with 3 expired needing re-capture (bha_ti3772, riteshsarkar439, kamri3214). Reviving 1–2
more (to 4–5) is the single highest-leverage manual action — it eases throttling and fills the AI
section.

---

## 6. How a search works (the flow you'll touch most)

Endpoint: `platform/app/api/discover-live/route.ts`. UI: `platform/components/live-search.tsx`.

- **Two-phase (fast) load:** the client first calls `discover-live` with `dbOnly:true` → DB results
  render in ~2s; then a full call streams OpenAI + live results in. (Fixes the old 15–30s spinner.)
- **Three result sections (grouped):**
  1. **AI web search** — OpenAI-named handles, confirmed against IG (or resolved from the DB by
     normalized handle match). *Purely OpenAI-based — do not pad with DB creators (product call).*
  2. **Based on previous searches** — DB matches.
  3. **Live from Instagram** — only for **cold** prompts AND only if the **worker is running**.
- **"Found — enriching…" section** (full-width bars): OpenAI finds that couldn't be confirmed this run
  (throttle → 0-follower stubs). Shown so nothing disappears from view; they fill in via enrichment.
- **Cold vs repeat:** a prompt crawls live only the FIRST time it's searched (`searchedBefore` guard,
  to avoid re-throttling). Repeat prompts = OpenAI + DB only, no crawl, no "crawling" indicator.
- **Trends tab** = curated-only: returns the Trends-team Excel-imported creators from the DB, never
  crawls.
- **Enrichment** (`api/cron/enrich`): every ~2 min (triggered by the relay keeper's curl), gated to
  **≥3 healthy accounts**, fills 5 stubs/batch, backs off on any throttle, only prunes on a clean 404,
  never overwrites real data with soft-throttled 0-follower reads.

---

## 7. Database (Boltic managed Postgres)

- Connect via `BOLTIC_DATABASE_URL` (`pg` driver, `ssl.rejectUnauthorized=false`). No REST/SDK in the
  hot path. Client: `shared/db/boltic-client.ts`.
- **Key tables:** `creators`, `scrape_jobs`, `service_accounts`, `system_config` (holds `relay_url`),
  `worker_heartbeat`, `alert_state`, `agency_searches`, plus campaign/program/brief/store tables.
- **`creators.source` CHECK** only allows: `icmp`, `trends`, `scrape`, `manual` (+ Fynd import tagged
  `fynd-seeding` in `tags`).
- **⚠️ pg returns NUMERIC/BIGINT as strings.** Always `Number(...)` before math (this bug once broke
  the quality scorer). Coerce follower_count / engagement_rate / score before arithmetic.
- `db/schema.sql` is the base; some runtime tables (`worker_heartbeat`, `system_config`,
  `alert_state`) were added later and may not be fully reflected there — **reconciling `schema.sql`
  is an open TODO.**
- **Never mutate data casually.** Read freely; writes to `creators`/`service_accounts` go through the
  app or vetted scripts. Never stage/commit `.env`.

---

## 8. Environment variables (names only — values live in `.env`)

From `.env` (root, git-ignored). Copy the file; don't retype secrets here.

| Var | Purpose |
|---|---|
| `BOLTIC_DATABASE_URL` | Postgres connection string (the whole DB) |
| `OPENAI_API_KEY` | prompt parsing, embeddings, web-search discovery |
| `IG_RELAY` | fallback relay URL (DB `relay_url` wins over this) |
| `IG_RELAY_KEY` | shared secret between platform and relay (`RELAY_KEY` in run-relay.sh: `ii-relay-7k2m9x`) |
| `IG_SESSIONID` / `IG_DS_USER_ID` / `IG_CSRFTOKEN` | fallback session cookie (pool is primary) |
| `SERVICE_ACCOUNT_HANDLE` | default handle for capture-session |
| `SLACK_WEBHOOK_URL` | operator alerts (relay down, 429, accounts expiring, worker stalled) |
| `IG_APP_ID` / `IG_APP_SECRET` / `IG_REDIRECT_URI` / `IG_WEBHOOK_VERIFY_TOKEN` | IG OAuth/webhook (secondary path) |
| `IG_SCRAPER_USER` / `IG_SCRAPER_PASS` | legacy scraper creds |

**Vercel:** set the same vars in the Vercel dashboard for prod (`BOLTIC_DATABASE_URL`,
`OPENAI_API_KEY`, `IG_RELAY_KEY`, cookie fallbacks, `SLACK_WEBHOOK_URL`). `IG_RELAY` optional (DB wins).

---

## 9. Deployment (Vercel)

- Vercel project with **root directory = `platform`**; **auto-deploys on push to `main`** (origin =
  `aleviab-boop/influencer-intel`). A push takes ~1–2 min to go live.
- Prod URL: `https://influencer-intel-platform.vercel.app`.
- Cron in `platform/vercel.json` — **Hobby plan caps crons at once/day**, so the real-time triggers
  (monitor + enrich, every 2 min) come from the **relay keeper's curl loop**, not Vercel cron.
- **Verify a deploy landed:** hit the prod API and check for a field you just added (e.g. `partial`,
  `enriching`). If it's missing, the old bundle is still live — wait ~1 min.

---

## 10. Operational runbook (common issues → fix)

| Symptom | Cause | Fix |
|---|---|---|
| Admin: **"Relay unreachable"** | keeper died, tunnel URL dead | `./run-relay.sh` (or the watchdog does it in ≤2 min). It writes a fresh URL to the DB; prod self-updates in ~60s. |
| Admin: **"Rate-limited (429)"** | 3 accounts on one IP | Ease off crawls; revive more accounts; residential proxies is the real fix. Usually clears in 30–60 min. |
| **AI section thin / 0** | OpenAI handles can't confirm under throttle → hidden stubs | Revive accounts / proxies / (declined) HikerAPI. Not a bug. |
| **Cold search shows no "Live" section** | worker is OFF, or prompt already searched | Start `./run-worker.sh`; only cold prompts crawl. |
| **Search feels stuck (long spinner)** | old bundle (pre two-phase) | Hard-refresh; deploy propagation. |
| **Slack alert arrives late** | monitor is triggered by the keeper; keeper dies with the relay | Set up an external pinger (**UptimeRobot** → GET `/api/cron/monitor` every 5 min) — keeper-independent. (Open TODO.) |
| **Worker "idle" on dashboard** | no `worker_heartbeat` in last 90s = worker not running | Start `./run-worker.sh` (badge flips live within ~15s). |
| **DB search returns 0 for a prompt** | (historical bug, fixed) `ORDER BY false` on non-location prompts | Already fixed; if it recurs, check `creator-db-search.ts` ORDER BY. |

**Health probe (are accounts throttled right now?):** POST to the tunnel URL with a pooled cookie and
fetch `web_profile_info?username=nike` — real follower count = healthy; 429/stripped = throttled.

---

## 11. Known issues & roadmap (prioritized)

1. **Residential proxies, one sticky IP per account** — the durable fix for throttle + account death.
   Code hooks exist (`IG_PROXY` / `SCRAPER_PROXY_URL`). Providers researched: DataImpulse (~$1/GB),
   Decodo/Smartproxy (~$1.50/GB, best India pool), Bright Data ($2.50/GB). Scraping is JSON → ~$5/mo.
2. **More accounts** — revive the 3 expired; get to 4–6.
3. **HikerAPI** (creator-data API, ~$0.0006/req) — would let enrichment + AI-confirm + sourcing run
   *without* the account pool. **Operator declined building it for now** — revisit if throttle stays painful.
4. **UptimeRobot** external ping on `/api/cron/monitor` — fixes late Slack alerts (keeper-independent).
5. **Short-token relevance** — a 3-letter niche token like "tea" substring-matches "team"
   (@indiancricketteam showed up). Fix: word-boundary match for short tokens. (Offered, not yet built.)
6. **Reconcile `db/schema.sql`** with runtime tables/columns (worker_heartbeat, system_config,
   alert_state, is_indian, data_completeness).
7. **Always-on host** (Mac mini / VPS + proxy) + **named tunnel** — ends laptop babysitting.
8. **Content-feed sourcing** (lightreel-style) — continuous hashtag/feed harvesting to grow coverage;
   needs proxies first (it's crawl-heavy).

---

## 12. Working conventions (how the operator likes it)

- **Commit + push regularly** to `origin` (`aleviab-boop/influencer-intel`) after each chunk.
  **Never stage `.env`.** Co-author trailer is fine.
- **EOD/SOD updates:** short **point-wise bullets, no emojis, no preamble**. Trim further when asked.
  Pointwise, not heading-wise, not overly detailed.
- **Typecheck before pushing:** `cd platform && npx tsc --noEmit` (and the same in scraper/shared if
  touched). `npm run typecheck` runs all three.
- **Verify on prod after deploy** (hit the API, check the new field) — don't assume a push = live.
- **Trust-but-verify infra:** check actual `ps`/heartbeat/DB state, don't trust admin badges alone
  (they can be stale). Multiple times the badge lied while the process was actually dead/alive.
- **Don't reproduce secrets** in files or chat. Credentials/logins are the operator's to enter.

---

## 13. What changed most recently (2026-07-22 → 07-24 session)

So the new session knows the current state of the code:

- **Account longevity:** a single transient 401/403 no longer permanently parks an account — now
  requires 3 consecutive dead-strikes (`scraper/src/queue/account-pool.ts`).
- **Search DB backfill fixed:** `ORDER BY (false)` crashed the query for every non-location prompt →
  returned 0 from DB. Fixed → perfume/comedy/makeup now return full DB results.
- **AI section:** DB-first resolution of OpenAI handles + normalized handle match (subko_coffee ↔
  subkocoffee). Kept **purely OpenAI-based** (a DB top-up was built then reverted per product call).
- **"Found — enriching…" section** added (full-width bars) so unconfirmed OpenAI finds stay visible.
- **Two-phase search:** DB in ~2s, then OpenAI + crawl stream in (killed the 15–30s spinner).
- **Enrichment hardened:** soft-throttled 0-follower reads can't overwrite data or wrongly deactivate
  creators; only prunes on clean 404; enrichment gate raised to ≥3 accounts.
- **Trends tab** = curated-only (no crawl). Niche gate: weak container words (home/studio/shop/online/
  india) treated as generic so "home baker" stops returning gardeners/decor.
- **Coverage matrix total fixed:** one niche per creator + an "Other" column so rows add up
  (Total = sum of niche columns + Other).
- **Relay watchdog** built + tested (section 4a) — relay now auto-restarts.
- **Removed** the per-row selection checkboxes and the amber "no creators from <city>" banner;
  refresh now restores results + tab (sessionStorage cache + URL bucket).
- Worker was intentionally **stopped**; enrichment left running.

Git head at handoff: `f788db1` (coverage "Other" column). Check `git log` for anything newer.

---

## 14. First-hour checklist on the new account

1. Clone (classic `ghp_` token) + copy `.env` + `npm install`.
2. `./run-relay.sh` → confirm the tunnel URL got written to `system_config.relay_url` and a live
   `web_profile_info?username=nike` fetch returns real data.
3. Recreate the **watchdog** files (section 4a) if you want auto-restart on this machine.
4. Check account pool health (`/admin/scraper`); revive expired ones (`npm run scraper:capture -- <handle>`).
5. Read `README.md` (architecture) and skim `details.md` (deep design) + the phase plan below.
6. Only start `./run-worker.sh` when you want coverage to grow (and ideally after ≥4 accounts).

---

## 15. Product roadmap (the 3-phase plan — for direction)

This repo IS "ICMP". Rebuild in 3 phases:

- **Phase 1 — discovery + storage** (largely done): NL prompt → parse → search creators → score →
  dedupe → store (name/genre/region/niche/platform/source/relevance/confidence/tags). Schema decision
  was **SPLIT**: extend `creators` + a per-prompt relevance table, not one flat table.
- **Phase 2 — scoring/ranking:** score on followers/engagement/likes/comments per post; drop below 80.
  Engine mostly exists (`scraper/src/jobs/credibility-scorer.ts`, banded green≥80).
- **Phase 3 — monitoring + prediction:** predicted-vs-real likes/views, reel analysis, content
  recommendations, reach, attribution. Engines exist (`prediction-engine.ts`, `monitoring-service.ts`,
  Gemini content scorer). **Don't greenfield — audit/reuse first.**
- **Critical-path gap** both Phase 2 & 3 depend on: **per-post engagement capture**.

---

*Handoff written 2026-07-24. Keep this file updated as the project evolves so the next continuation is
just as clean.*
