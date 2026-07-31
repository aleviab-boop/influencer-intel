# Influencer Intel — Platform Overview

A plain-English, end-to-end explanation of what this platform is, what it does, how
the search/prompt engine works, and how a brand or agency uses it to find creators.
Written for a non-engineer who wants to understand the whole thing.

---

## 1. What this platform is (in one paragraph)

Influencer Intel is an **India-first, AI-native influencer discovery engine**. A brand
or agency types a plain-English brief — *"food bloggers in Pune"*, *"handloom saree
weaver in Chennai"*, *"influencers for my Durga Puja campaign"* — and instantly gets a
**relevance-ranked list of real Indian creators**, complete with follower counts,
engagement, bio, category, and a link to their profile. It combines three sources of
truth (a growing database, live AI web search, and live Instagram data) into one
ranked list, so the agency never starts from a blank page.

Think of it as a **search engine for creators** that understands intent ("this is a
festival campaign, float proven collaborators") instead of just matching keywords.

---

## 2. Who it's for and the problem it solves

- **Agencies / brand marketers** planning influencer campaigns in India.
- The old way: manually scroll Instagram, guess hashtags, keep messy spreadsheets, and
  have no idea who is actually relevant, active, or Indian.
- The problem with existing tools: they are **US/global-first**, expensive, and weak on
  Indian regional/vernacular creators (Bengali, Tamil, Marathi, etc.).
- Our edge: **India-deep** (regional creators, festivals, vernacular niches) + **AI that
  reads intent** + **live data on demand** so numbers are fresh, not stale.

---

## 3. The prompt / search — how it actually works

The search box is the heart of the product. When someone types a brief, the platform
runs **three pipelines in parallel** and merges them into one ranked, India-first list.
The main search endpoint is `/api/discover-live`.

### Pipeline A — AI web search (names real creators)
An OpenAI web-search model (`gpt-4o-mini-search-preview`) browses the live web to
**name real Indian creators** for the niche + city in the brief. Each suggested handle is
then:
1. **Validated** against Instagram (so AI "hallucinations" — accounts that don't exist —
   are dropped).
2. Passed through a **relevance + geography filter** (off-niche or foreign accounts are
   dropped — e.g. a makeup artist suggested for an "aquascaping" brief is removed).

This pipeline "never dies": it doesn't depend on our Instagram accounts, so it returns
suggestions even when the live-data side is throttled.

### Pipeline B — Live crawl (finds fresh creators for cold briefs)
For briefs with no existing seeds, the platform resolves the brief into Instagram
**hashtags** and pulls seed creators from them, then expands outward through Instagram's
"related accounts" graph. A **niche-relevance gate** drops off-topic matches. (Instagram's
keyword search is login-walled, so hashtag discovery uses the Apify actor — see §7.)

### Pipeline C — Database (instant, from what we've already learned)
Every creator we've ever surfaced is stored in the `creators` table. The DB is searched
and ranked by **weighted relevance** (location > niche/name > bio) and is **India-first**
(known-foreign creators sink to the bottom). Because it's already-crawled data, it comes
back instantly and deterministically.

### The merge
Results from all three are de-duplicated by handle and **ranked by source priority**,
then India-first, then on-topic-first, then locals-first, then by relevance and reach.
Every creator that shows up is also:
- **Stored** (as a full record if verified, or a "stub" to enrich later),
- **Flagged Indian / non-Indian**,
- Given a **0–10 data-completeness score** (how much real data we have on them).

---

## 4. Campaign mode — the "Durga Puja campaign" example

This is the flagship behaviour. When a brief carries **campaign / collaboration
vocabulary** — *"influencers for a denim campaign"*, *"creators for durga puja"*,
*"barter deal for a saree launch"* — the platform detects **campaign intent** and changes
strategy:

1. **Skips the slow free handle-guessing** and goes **straight to wider Apify hashtag
   discovery** (more tags, more posts) — because a campaign brief is pure *discovery*
   intent: the user wants *fresh* creators, not one specific known account.
2. **Floats proven brand-collaborators to the front** — creators whose recent posts carry
   a paid-partnership / collab disclosure are ranked first, because they're known to
   actually work with brands.
3. **Expands the meaning of the brief**:
   - Product words ("denim", "saree") expand into creator-oriented hashtags.
   - Festival words ("durga puja", "navratri") expand into the event's **real hashtags**
     (`#durgapuja`, `#durgapujo`, …).
   - An **India bias** is applied when no city is named.
4. **Name-collision guard (the smart part):** words like *"puja"* and *"durga"* double as
   personal names. Without a guard, "durga puja campaign" would surface everyone *named*
   Puja and every shop named Durga. So these **ambiguous tokens only pass the relevance
   gate when they co-occur** (e.g. "durga" + "puja" together) or sit next to an
   unambiguous festival tag. Result: a festival campaign surfaces **festival creators**,
   not random people named Puja.

**What the brand sees:** for *"find me creators for my Durga Puja campaign"*, the platform
returns a page of real Bengali/festival creators posting Durga Puja content — with
follower counts, engagement, and profile links — with proven collaborators at the top.

### The engineering reality behind this (honest note)
Enriching those discovered creators with live follower/engagement numbers is what takes
time and money. When the free Instagram path is available it's used first (free). When
it's blocked (see §6), enrichment falls through to **Apify** (paid, see §7). To keep a
campaign page filling within the request's time limit and at low cost, enrichment is
**batched into a single Apify run** (one billed run for ~14 creators, instead of dozens
of tiny runs) and the whole request is bounded so it always returns a result rather than
timing out.

---

## 5. What you can do with the platform (features)

- **Search / discover creators** by plain-English brief, niche, city, or campaign.
- **Direct @handle lookup** — type `@handle` to pull that exact profile and its network.
- **Profile snapshot** — click a creator to see followers, engagement rate, recent posts,
  category, verification, and a data-completeness score, refreshed live on demand.
- **Outreach drafts** — generate a first-contact message for a creator from the brief
  (`/api/discover-live/outreach`).
- **Export** — export a shortlist (`/api/discover-live/export`).
- **India-first ranking** — regional/vernacular creators surface ahead of foreign lookalikes.
- **Self-growing database** — every search teaches the platform; the next search for a
  similar brief is faster and richer.
- **Admin / health dashboard** (`/admin/scraper`) — live-data pipeline status, a truthful
  "Worker live" badge, account rotation, and queue depth.
- **Operator alerts** — Slack pings when something needs attention (see §8).

---

## 6. Where the data comes from — free path vs paid path

The platform has **two ways** to get live Instagram data. Understanding this explains the
cookie, the relay, and Apify.

### The FREE path (primary, costs nothing)
Instagram serves a public profile's JSON (bio, followers, recent posts, related accounts)
to **residential IPs** but **blocks data-center IPs**. Vercel (the cloud) is a data-center
IP, so it can't hit Instagram directly. Instead:
- A **relay** runs on a laptop at home (residential IP) and fetches Instagram on the
  cloud's behalf, exposed via a **Cloudflare tunnel**.
- Requests authenticate with a real **Instagram session cookie** pulled from a pool of
  captured burner accounts (`service_accounts`). The system rotates across accounts and
  fails over when one cookie is dead or throttled.

This path is **free** but depends on (a) the laptop being on, (b) the relay running, and
(c) at least one live cookie.

### The PAID path (Apify fallback + hashtag discovery)
When the free path is blocked — every pooled cookie returns 401, or the relay is down —
the platform falls back to **Apify** (a scraping service, pay-per-result). Apify is:
- The **fallback** for profile enrichment when the free path fails, AND
- The **primary** way to do **hashtag discovery**, because Instagram's keyword/hashtag
  search is login-walled and the free path can't do it at all.

Apify is controlled entirely by one setting, `APIFY_TOKEN`. If it's unset, the platform
behaves exactly as before (free-only, no charges). **It costs money per result**, so it's
used as an on-demand safety net and for campaign discovery — not for bulk crawling.

**Routing summary (the intended behaviour):**
- **Normal search** → use our own scraper (free relay + cookie) first; fall to Apify only
  when it breaks.
- **Campaign search** ("campaign"/"collab"/etc.) → go straight to Apify for discovery +
  enrichment, because that's the reliable way to surface fresh campaign creators.

---

## 7. How to fix the cookie (when live data stops)

The Instagram **session cookie is what authenticates the free path.** IG session cookies
last ~1 year, but they die early if Instagram flags the account. When every cookie is
dead, the free path returns **401** and live data stops (the DB keeps serving cached
data, and Apify still covers campaign searches).

**The fix — re-capture a fresh session (~2 minutes):**
```bash
cd influencer-intel
npm run scraper:capture -- <handle>     # e.g. npm run scraper:capture -- bha_ti3772
```
This opens a **Camoufox** (anti-detect Firefox) window. Log in **as that burner account**
manually, wait for the Instagram feed to load, then press **Enter** in the terminal. The
fresh cookies + local storage are written to the `service_accounts` table, and the pool
is healthy again.

**Notes:**
- Do this for **2–3 burner accounts**, staggered, so live data has redundancy and doesn't
  throttle on a single cookie.
- Never use a personal Instagram — always a burner.
- The **relay must be running** for the cookie to matter in production:
  ```bash
  ./run-relay.sh     # starts the relay + Cloudflare tunnel and publishes the URL to the DB
  ```
- The **`session-extend` cron** keeps *healthy* cookies alive automatically (it re-validates
  each cookie and pushes its expiry forward). It does **not** revive a *dead* cookie — that
  needs the manual re-capture above.
- **Do you strictly need the cookie?** For **campaign searches**, no — Apify covers
  discovery + enrichment without any cookie. For **normal searches, live profile refresh,
  and the background worker crawl**, yes — those use the free cookie path, and they get
  slower / thinner when it's dead.

---

## 8. Architecture at a glance

```
LAPTOP (residential IP)                 BOLTIC (Postgres)              VERCEL (cloud)
──────────────────────                  ─────────────────              ──────────────
Worker (anti-detect Firefox)            ┌──────────────┐               Next.js platform
  └ rotating IG account pool            │  creators    │ ◀─ read/write ─▶  app/ (API + UI)
  └ crawls niches → writes creators ──▶ │ scrape_jobs  │                     │ live IG fetch
Relay (home-IP proxy on :8787)          │ service_accts│                     │ (data-center IP
  └ Cloudflare tunnel ◀── relay_url ──  │ system_config│                     │  blocked by IG)
        ▲                               └──────────────┘                     │
        └──────── proxies IG requests over the HOME IP ◀────────────────────┘
                                                          (+ Apify paid fallback)
```

- **Vercel** hosts the Next.js app (the search UI + all APIs). Auto-deploys on push to
  `main`.
- **Boltic** is a managed PostgreSQL database — the shared source of truth for both the
  cloud app and the laptop worker. Connected via a standard `postgresql://` string.
- **The laptop** runs the relay (live-data proxy) and the worker (background crawler).
- **Apify** is the paid fallback, called from the cloud only when needed.

**Self-healing tunnel:** the free Cloudflare tunnel gets a new URL on each restart. The
on-host keeper writes the fresh URL into `system_config.relay_url`, and the app reads it
(cached ~60s) — so tunnel churn fixes itself with no manual edits.

---

## 9. Operations & monitoring

- **Monitor cron** (`/api/cron/monitor`) pings Slack on: relay down, cookie rejected (401),
  rate-limited (429), no/low accounts, accounts expiring within 3 days, or
  worker-stalled-with-queue. Alerts are de-duped (at most one per hour per issue) with a
  recovery ping when the problem clears. Noisy free-path alerts can be muted via
  `MONITOR_MUTED_ALERTS` when Apify is intentionally covering that path.
- **Session-extend cron** (`/api/cron/session-extend`) re-validates each captured cookie
  against Instagram daily and extends the expiry of healthy ones — so sessions aren't
  retired on a false timer.
- **Apify health** (`/api/apify-health`) reports which Apify account is wired up and its
  remaining credit.

---

## 10. Honest limitations & costs

- **The laptop must be on** for the free live-data path and the background crawler. When
  it's off, live data + crawling stop (the DB keeps serving cached data, and Apify still
  covers campaign searches). Durable fix: a dedicated always-on host.
- **Shared home IP** — all accounts route through one residential IP, so heavy usage gets
  rate-limited (429). Durable fix: a residential proxy per account.
- **Apify costs money per result.** Campaign searches and dead-cookie enrichment fire paid
  Apify runs. This is bounded (batched into one run of ~14 creators per search, and the
  request is time-capped), but repeated heavy searching **does add up** — monitor credit in
  the Apify console. Normal searches stay free whenever the cookie/relay path is alive.
- **Sessions eventually die** and need a manual, staggered re-capture (§7). Aged accounts
  + proxies reduce how often.

---

*Last updated: 2026-07-31.*
