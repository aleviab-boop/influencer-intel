# Credibility Scoring Spec — v1 Methodology

**Goal.** Define an explainable rules-based credibility score for every creator in the database. Score must separate known-clean from known-fake creators at >85% accuracy on a hand-labelled set. ML-based scoring deferred until campaign-outcome data exists.

---

## The 10 signals

Each signal returns a 0–100 sub-score. Final credibility = weighted average.

| # | Signal | What it measures | Weight |
|---|--------|------------------|--------|
| 1 | **Follower-to-engagement ratio** | engagement rate normalised against follower count + niche benchmark | 15% |
| 2 | **Engagement velocity** | engagement on posts >7 days vs <24h — bots drop off, real audiences sustain | 10% |
| 3 | **Comment-to-like ratio** | real audiences comment; bot floors are 1-line emoji | 10% |
| 4 | **Comment text quality** | regex + LLM classifier — share of bot-pattern comments ("nice 🔥🔥", "follow me back") | 15% |
| 5 | **Follower growth pattern** | sudden spike (>20% in 30 days) flagged unless attributable to viral content | 10% |
| 6 | **Audience authenticity (geo)** | follower city distribution sanity — Indian creator with 80% US audience flagged | 10% |
| 7 | **Audience authenticity (account age)** | share of follower accounts <3 months old; >30% is suspicious | 10% |
| 8 | **Story-to-feed engagement parity** | story views correlate with post engagement on real accounts | 5% |
| 9 | **Hashtag-to-engagement match** | engagement concentrated on niche hashtags vs spammy generic ones | 5% |
| 10 | **Brand-safety screening** | controversy flags from past posts (LLM classifier) | 10% |

**Score interpretation:**

- 85–100 — green: high confidence creator is authentic
- 60–84 — amber: usable but flagged in UI
- <60 — red: surfaced with "Why shown" link, de-ranked, brand-safety warning visible

---

## Validation methodology

**Hand-label set: 100 creators**

- 50 known-clean: creators with verified Modash audit + recent campaign performance data
- 50 known-fake: creators flagged by HypeAuditor + manual inspection (purchased followers, bot comments)

**Acceptance criteria:**

- Score must place ≥85 of 100 creators in the correct bucket (clean ≥80, fake <60)
- False positive rate (clean creator scored <60): <10%
- False negative rate (fake creator scored ≥80): <10%

**Iteration:**

- If accuracy <85%, adjust weights and resample
- Recalibrate every 90 days against fresh-labelled set

---

## How signals are computed

| Signal | Source |
|--------|--------|
| 1, 2 | IG Graph + YT Data API (post-level metrics) |
| 3, 4 | Scraped comment data + LLM classifier |
| 5 | Follower count time-series (14-day refresh data) |
| 6, 7 | Follower-list scraping (Year 1) / creator-side OAuth (Year 2+) |
| 8 | Story view data (creator-side OAuth where available) |
| 9 | Hashtag-level engagement decomposition |
| 10 | Past post content scan + LLM classifier on controversy topics |

---

## Failure modes to monitor

- **Gaming via comment buying** — add separate "engagement-pod" detection signal if observed at scale
- **Real micro-creator flagged as fake** — tier-aware thresholds (smaller creators have noisier ratios)
- **Brand-safety false positives** — creators discussing sensitive topics legitimately (news, health) shouldn't auto-fail; LLM classifier must distinguish
- **Vernacular comment misclassification** — bot-pattern regex tuned only on English will misjudge Hindi/Tamil/Marathi comments; build language-specific bot-comment corpora

---

## Surfacing in the product

- Credibility badge on every creator card (color-coded: green ≥85, amber 60–84, red <60)
- Hover tooltip shows top 3 contributing signals with sub-scores
- "Full credibility breakdown" expand panel shows all 10 signals with explanation
- Recalculation timestamp visible (last computed YYYY-MM-DD)
