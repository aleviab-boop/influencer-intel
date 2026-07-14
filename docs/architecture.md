# Influencer Intel — System & Workflow Architecture

A plain-English influencer-marketing platform. Two Instagram data engines feed a
Next.js app: a **Discovery Crawler** (breadth — builds the database) and a
**Live Data path** (depth — real-time posts & engagement on demand).

- **Platform**: Next.js 15 / React 19 on Vercel (datacenter IP)
- **Laptop (always-on, residential IP)**: crawler worker + Fetcher + relay/ngrok
- **Database**: Boltic Postgres
- **AI**: OpenAI (embeddings for semantic search + outreach drafts)
- **Alerts**: Slack incoming webhook

---

## 1. Master architecture

```mermaid
flowchart TB
  classDef user fill:#ede9fe,stroke:#6C4DF6,color:#3b0764,stroke-width:1px
  classDef plat fill:#eff6ff,stroke:#3b82f6,color:#1e3a8a,stroke-width:1px
  classDef data fill:#ecfdf5,stroke:#10b981,color:#064e3b,stroke-width:1px
  classDef edge fill:#fff7ed,stroke:#f59e0b,color:#7c2d12,stroke-width:1px
  classDef ext  fill:#fce7f3,stroke:#db2777,color:#831843,stroke-width:1px
  classDef alert fill:#fee2e2,stroke:#ef4444,color:#7f1d1d,stroke-width:1px

  %% ---------- USERS ----------
  subgraph U["👤 Users — /login (role gate + middleware)"]
    direction LR
    UA[Agency<br/>brand / marketer]:::user
    UI[Influencer<br/>creator]:::user
    UAD[Super Admin<br/>superadmin@gmail.com]:::user
  end

  %% ---------- PLATFORM ----------
  subgraph P["☁️ Platform — Next.js on Vercel"]
    direction TB
    MW{{middleware<br/>auth gate}}:::plat
    SRCH[Search / Lander<br/>plain-English brief]:::plat
    DRW[Creator drawer<br/>live posts · ER · authenticity]:::plat
    CAMP[Campaigns · shortlists<br/>saved creators · CSV export]:::plat
    OUT[AI outreach drafter<br/>email / DM]:::plat
    ADMP[/admin panel<br/>pipeline health · jobs · coverage · accounts/]:::plat
    HLTH[/api/admin/pipeline-health<br/>cookie→relay→IG check/]:::plat
  end

  %% ---------- DATA / AI ----------
  subgraph DZ["🗄️ Data & AI"]
    direction LR
    DB[(Postgres<br/>creators · programs · recruits<br/>saved · tags · embeddings)]:::data
    AI[OpenAI<br/>embeddings + drafts + gender]:::data
  end

  %% ---------- LAPTOP ----------
  subgraph LAP["💻 Laptop — always-on · residential IP"]
    direction TB
    WRK[Discovery Crawler worker<br/>Camoufox browser sessions]:::edge
    POOL[[Account pool · 6 IG accounts<br/>auto-rotate on 429/401]]:::edge
    FET[Fetcher<br/>engagement backfill loop]:::edge
    RLY[Relay + ngrok tunnel<br/>localhost:8787]:::edge
  end

  IG([📸 Instagram<br/>private web endpoints]):::ext
  SLACK[[🔔 Slack alerts]]:::alert

  %% ---- user entry ----
  UA & UI & UAD --> MW
  MW -->|agency/influencer| SRCH
  MW -->|admin| ADMP

  %% ---- search: DB-backed, instant ----
  SRCH -->|keyword + vector query| DB
  SRCH -.semantic match.-> AI
  SRCH --> DRW
  SRCH --> CAMP

  %% ---- live drawer via relay ----
  DRW -->|igFetch| RLY
  RLY -->|residential IP| IG
  IG -->|web_profile_info<br/>+ user-feed fallback| RLY --> DRW
  DRW -.cache snapshot.-> DB

  %% ---- crawler discovery ----
  WRK <--> POOL
  WRK -->|topsearch · hashtags<br/>similar-accounts · followings| IG
  IG --> WRK
  WRK -->|filter · relevance gate<br/>tag city/niche · gender · upsert| DB
  WRK -.embeddings.-> AI

  %% ---- fetcher backfill ----
  FET -->|null-ER creators| DB
  FET -->|cookie fetch| RLY

  %% ---- campaigns / outreach ----
  CAMP --> OUT
  OUT -.draft.-> AI
  CAMP --> DB

  %% ---- health + alerts ----
  ADMP --> HLTH -->|1 lightweight fetch| RLY
  HLTH -->|cookie rejected 401/403| SLACK
  POOL -->|account died / parked| SLACK
  FET -->|cookie expired 401| SLACK
```

---

## 2. Discovery Crawler — how the database gets filled

Breadth engine. Runs on the laptop, rotates across 6 accounts, never blocks.

```mermaid
sequenceDiagram
  autonumber
  participant Q as Job queue (DB)
  participant W as Crawler worker
  participant AP as Account pool (6 accts)
  participant IG as Instagram
  participant AI as OpenAI
  participant DB as Postgres
  participant SL as Slack

  Q->>W: next discovery job ("interior design mumbai")
  W->>AP: pick account (least-used, healthy)
  Note over W: expand state→city, clean keywords<br/>("interior","mumbai")

  W->>IG: topsearch users + hashtags
  W->>IG: top media for each hashtag → post authors
  W->>IG: similar-accounts chaining (per strong seed)
  W->>IG: seed's followings (creators follow creators)

  alt HTTP 429 (throttled)
    IG-->>W: 429
    W->>AP: rest this account, rotate to next
  else HTTP 401 (session dead)
    IG-->>W: 401
    W->>AP: park account (needs re-capture)
    AP->>SL: "account X died"
  else OK
    IG-->>W: candidates + follower counts
  end

  Note over W: DROP news/shops/mega/nano<br/>RELEVANCE GATE: whole-word match<br/>on name/bio/category (no puneet→pune)
  W->>AI: embed (name + handle + intent)
  W->>AI: infer gender (photo, then text)
  W->>DB: upsert creators + tags(city/niche) + embedding
  Note over DB: only tags a keyword the profile<br/>actually supports (no poisoned search)
```

---

## 3. Live Data path — the drawer & Fetcher

Depth engine. Production can't reach Instagram directly (datacenter IP), so every
live call is tunnelled through the laptop's relay (residential IP) using one
logged-in cookie.

```mermaid
sequenceDiagram
  autonumber
  participant User
  participant V as Platform (Vercel)
  participant R as Relay + ngrok (laptop)
  participant IG as Instagram
  participant DB as Postgres
  participant SL as Slack

  User->>V: open creator drawer (@handle)
  V->>DB: cached snapshot? (fast paint)
  V->>R: igFetch web_profile_info (cookie attached)
  R->>IG: request from residential IP

  alt 200 OK, posts present
    IG-->>R: profile + 12 recent posts
  else posts empty (warmed session)
    R->>IG: user-feed fallback /feed/user/{id}
    IG-->>R: 12 posts
  else 429 rate-limited
    IG-->>R: 429  (ease off crawls/fetcher)
  else 401/403 cookie rejected
    IG-->>R: 401
    R-->>V: dead
    V->>SL: "drawer cookie expired — refresh IG_SESSIONID"
  end

  R-->>V: posts + likes + comments
  Note over V: compute avg likes/comments → ER
  V-->>User: live posts + engagement rate
  V->>DB: update snapshot + last_scraped_at
```

---

## 4. Health monitoring & alerts

```mermaid
flowchart LR
  classDef edge fill:#fff7ed,stroke:#f59e0b,color:#7c2d12
  classDef alert fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
  classDef plat fill:#eff6ff,stroke:#3b82f6,color:#1e3a8a

  CRON{{scheduled check<br/>(laptop cron / Vercel cron)}}:::edge
  PANEL[admin panel poll<br/>every 30s]:::plat
  H[/pipeline-health<br/>1 authenticated fetch/]:::plat

  CRON --> H
  PANEL --> H
  H -->|healthy| OK([✅ live data flowing])
  H -->|429| RL([⏳ rate-limited — cool down])
  H -->|401/403| CD([❌ cookie dead]):::alert
  H -->|relay unreachable| RD([🔌 relay down]):::alert
  CD -->|notifySlack, deduped 1/hr| S[[🔔 Slack]]:::alert
  RD --> S
```

---

## Component reference

| Component | Runs on | Job |
|---|---|---|
| Platform (Next.js) | Vercel | Search, drawer, campaigns, outreach, /admin |
| Discovery Crawler | Laptop | Find & vet creators → DB (6 rotating accounts) |
| Fetcher | Laptop | Backfill engagement across the DB |
| Relay + ngrok | Laptop | Give Vercel a residential IP into Instagram |
| Postgres (Boltic) | Cloud | Creators, campaigns, tags, embeddings |
| OpenAI | Cloud | Semantic search embeddings, outreach drafts, gender |
| Slack webhook | — | Account-death & cookie-expiry alerts |

**Why two engines:** discovery is *wide but cheap* (cover thousands of creators);
live fetch is *deep but targeted* (spend the expensive call only on the creator
you actually open). Together = comprehensive **and** fast, hard to rate-limit.
