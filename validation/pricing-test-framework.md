# Pricing Willingness Test Framework

**Goal.** Validate the ₹75K/mo Growth and ₹2L/mo Scale price points against real buyer signals. Run inside the 15 customer discovery calls (Section 6 of `customer-discovery-script.md`).

**Method.** Van Westendorp Price Sensitivity Meter — four questions per buyer, plotted across the cohort.

---

## The four questions (verbatim, after describing the product)

> Imagine the tool we discussed: takes a brief, returns 30 ranked creators with credibility scores, drafts personalised outreach. Indian-creator depth with vernacular coverage. Used by your team end-to-end for influencer campaigns.

1. At what monthly price would this be **so cheap you'd doubt the quality**?
2. At what price would this be a **bargain — clearly worth it**?
3. At what price would this start to feel **expensive but you'd still consider**?
4. At what price would this be **so expensive you wouldn't buy**?

Capture all four numbers per respondent, in INR/month.

---

## Analysis (after 15 calls)

Plot the cumulative distributions:

- "Too cheap" (Q1) — increasing curve
- "Bargain" (Q2) — decreasing curve
- "Expensive" (Q3) — increasing curve
- "Too expensive" (Q4) — decreasing curve

**Key intersection points:**

- **Optimal Price Point (OPP)** — where "too cheap" curve meets "too expensive"
- **Indifference Price Point (IPP)** — where "bargain" meets "expensive" (median expected price)
- **Point of Marginal Cheapness (PMC)** — where "too cheap" meets "bargain"
- **Point of Marginal Expensiveness (PME)** — where "expensive" meets "too expensive"

**Acceptable price range:** between PMC and PME. Ideal price: OPP.

---

## Decision matrix

| Result for Growth tier | Action |
|-----------------------|--------|
| OPP ₹50K–₹1.5L | Confirm ₹75K/mo |
| OPP <₹50K | Lower Growth tier or repackage to higher value |
| OPP >₹1.5L | Increase Growth tier or split into smaller-team starter tier |

| Result for Scale tier (asked as "tool with 15 seats + agentic outreach + API") | Action |
|-------------------------|--------|
| OPP ₹1.5L–₹3L | Confirm ₹2L/mo |
| OPP <₹1.5L | Lower Scale tier or strip features |
| OPP >₹3L | Add enterprise tier on top |

---

## Cross-check signals (beyond Van Westendorp)

- **What are they paying today?** — current tools, agency markup
- **What % of campaign budget would they spend on tooling?** — rule of thumb: 5–10% feels comfortable
- **At what price does procurement get involved?** — typically ₹5L+ requires CFO approval; price tiers below this for fast self-serve

---

## Output deliverable

Pricing memo at end of 15 calls:

- OPP for Growth and Scale tiers (with cohort plot)
- Confirmed or adjusted final pricing
- Buyer quote on price ("we'd pay X/mo if Y was true")
- 3 buyers who said "we'd buy at this price tomorrow" — first-revenue conversion candidates
