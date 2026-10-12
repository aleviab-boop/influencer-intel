---
name: reference-ppt-style
description: "Aggressively reconstruct any source PPT/PPTX deck into the Fynd/Impetus reference visual identity. Trigger whenever a user uploads or references a .pptx/.ppt deck and asks to restyle, reformat, rebrand, 'make it match the reference', 'apply our deck style', 'align to the template', or convert slides into the reference look. Also trigger when the task mentions a reference deck, a brand style guide for slides, a bundled brand icon library, or normalizing a deck's tables/charts/cards/metrics to a house style. This skill does full slide reconstruction (layout + components + typography + color + icons), not superficial recoloring. Use together with the pptx skill, which owns the mechanics of reading, building, rendering, and QA-ing .pptx files."
license: Proprietary
---

# reference-ppt-style

Transform ANY source deck into the reference deck's visual identity. This is slide
**reconstruction**, not restyling. Preserve content, meaning, order, data, tables, and
charts. Replace the visual system, layout system, and component system wholesale, so the
result looks like the source content was authored inside the reference deck from the start.

The reference deck is the single source of truth for **style AND layout**. It is a library
of slide patterns, not just a color and font sheet.

## Prerequisite: load the pptx skill first

This skill defines *what the deck must look like*. The `pptx` skill defines *how to read,
build, render, and QA* `.pptx` files. Before doing anything, read
`/mnt/skills/public/pptx/SKILL.md` and use its tooling (`extract-text`, `unpack.py`,
`soffice.py`, `pdftoppm`, subagent visual QA). Build new decks from scratch with
`pptxgenjs` (read `pptxgenjs.md`) unless the user supplies an editable reference `.pptx`
template, in which case follow `editing.md`.

## Golden rule

> Never restyle a source slide in place.
> For every slide ask: **"Which reference pattern should this content become?"**
> Then rebuild the slide from scratch in that pattern.

If a source slide matches no pattern exactly, pick the closest archetype and force the
content into it. Layout-pattern fidelity is the highest priority. Source formatting is the
lowest priority and is discarded unless it already matches the reference.

## Workflow

Run these steps in order.

### 1. Analyze the reference deck (skip only if you already have STYLE.md memorized)

The canonical style values are pre-extracted in `STYLE.md` and `style.py`. Read `STYLE.md`
first. If the user provides a *different* reference deck, re-derive values: unpack it, then
`grep -roh 'srgbClr val="[A-F0-9]*"' unpacked/ppt/slides/ | sort | uniq -c | sort -rn` for
colors and `grep -roh 'typeface="[^"]*"'` for fonts, and thumbnail it to catalog patterns.

### 2. Analyze the source deck

```bash
extract-text source.pptx                 # content, slide by slide
python /mnt/skills/public/pptx/scripts/thumbnail.py source.pptx   # see original layouts
```

For each source slide, classify its **content structure** (not its current look):
title? section break? metrics/KPIs? 3–6 parallel cards? framework/columns? table?
icon+text list? ecosystem/architecture? problem→solution? closing/contact?

### 3. Map each source slide to a reference archetype

Use the table in "Pattern library" below. Record the mapping as a plan before building.
Reflow, split, or merge content as needed so it fits the chosen archetype. A dense
source slide may become two archetype slides; two thin source slides may merge into one.

### 4. Rebuild each slide from scratch in the chosen pattern

Build with pptxgenjs at 13.333 × 7.5 in (16:9). Apply the archetype's geometry first,
then typography, then color, then icons. Use `style.py` constants so every slide is
deterministic and identical in treatment. Never copy source XML formatting forward.

### 5. Select and place icons from the bundled icon library

The official Fynd icon set ships **inside this skill** at `assets/icons/` (285 glossy
slate-gradient glyphs). It is the **preferred** icon source wherever the reference would
use an icon (card headers, icon+text rows, contact chips). Read `ICONS.md` for the themed
index and pick the icon whose name best matches each card/row's meaning. See "Icons"
below for placement rules. If no exact match exists, choose the closest available glyph
and keep the circular treatment identical. No Google Drive access is required — the
library is self-contained, so anyone with the skill has the icons automatically.

### 6. Verify consistency across the full deck

Render to images and run the pptx skill's subagent visual QA. Then run the
"Final validation" checklist for every slide. Fix real defects (overflow, overlap,
inconsistent treatment); do not chase sub-pixel nudges.

---

## Style system (the single source of truth)

Exact values live in `STYLE.md` / `style.py`. Summary:

**Canvas** 13.333 × 7.5 in, 16:9. Margins ≥ 0.5 in. Generous whitespace; never fill edge
to edge. Clean, spacious, premium.

**Typography** — body font **Inter** throughout. **Tables are the only exception: Calibri
10pt.** Weight hierarchy: titles Inter (regular/medium, large), section headers Inter Bold,
labels Inter SemiBold, body Inter regular. (When rendering for QA, Inter may substitute;
sizes below are authored values.)

| Element | Size | Weight | Color |
|---|---|---|---|
| Title-slide hero word | 40pt | regular | #0E0E0E |
| Title-slide subtitle (italic) | 32pt | italic | #0E0E0E |
| Content slide title | 32–36pt | regular/medium | #0E0E0E |
| Content subtitle/dek | 16–18pt | regular | #9AA4B0 |
| Section header (divider) | 36pt | bold | #0E0E0E |
| Card header | 14–16pt | bold | #051E39 |
| Body / bullets | 12–14pt | regular | #051E39 |
| Big metric number | 40–54pt | bold | #0E0E0E |
| Metric label | 12–14pt | regular | #051E39 |
| Caption / footer / page no. | 9–10pt | regular | #9AA4B0 |
| Table cells | 10pt | regular | #0E0E0E |

**Color palette**

| Token | Hex | Use |
|---|---|---|
| Primary text | `0E0E0E` | titles, numbers, primary copy |
| Secondary text | `051E39` | body, card headers, labels (deep navy) |
| Neutral text | `9AA4B0` | deks, captions, footers, page numbers |
| Divider line | `D9D9D9` | hairlines, table borders, column rules |
| Light gray fill | `F3F3F3` | neutral surfaces, table header row |
| Light blue surface | `E7EFF9` | callout bars, highlight panels, icon circles |
| White | `FFFFFF` | card fills, slide base |

**Status colors** (tables, badges, pills) — fill with #0E0E0E text:

| Status | Fill |
|---|---|
| In Progress | `FFF2CC` |
| Blocked | `F4CCCC` |
| Live | `D9EAD3` |

Treat other source statuses by mapping to the nearest: scoping/planned/backlog → no fill
(plain cell); done/shipped/complete → Live; at-risk/delayed/on-hold → In Progress;
stopped/cancelled/failed → Blocked.

**Spacing & grid** — 0.5 in outer margins; 0.2–0.3 in gaps between cards; vertical rhythm
in ~0.25 in steps. Multi-card rows use equal-width columns separated by either a gap or a
1px `D9D9D9` vertical rule. Align all card tops and all baseline grids.

**Recurring motifs** (carry across the deck):
- Top-right **brand heart mark**, ~0.35 in, charcoal, on every content slide.
- Bottom-right **page number**, 9–10pt `9AA4B0`.
- Subtle **page-bottom band**: a faint `E7EFF9`/`EBEFF7` wash along the lower edge on metric
  and ecosystem slides (very light, not a hard color bar).
- Icons sit in **circular** `F3F3F3`/`E7EFF9` chips or thin `D9D9D9`-stroked circles.
- Section-divider titles get a **dotted hairline** beneath them (not a solid accent bar).

**Do NOT** introduce solid accent stripes, underline bars beneath content titles, colored
sidebars, or cream backgrounds. These break the reference identity. The only line motifs
allowed are: hairline `D9D9D9` dividers/rules, and the dotted underline on section dividers.

---

## Pattern library (archetypes)

Map source content → reference archetype. Rebuild in the matched archetype.

### A. Title slide
Full-bleed `assets/title_background.jpg` (metallic swooshes, top-left + bottom-right).
Centered hero word (40pt) over an italic title (32pt) split by a thin centered `D9D9D9`
rule with a small diamond node at its midpoint; date below in neutral text; brand
wordmark centered lower third; a pill-shaped `F3F3F3` chip at the bottom with
"Proprietary & Confidential | © <year> <Brand>" in 9–10pt. Optional iridescent spark
accents flanking the title. Use for the deck's opening slide.

### B. Section divider
Two-column. Left: section title (36pt bold `0E0E0E`) with a **dotted** `D9D9D9` hairline
beneath it, a one-line statement (24pt) under that, and a neutral sub-dek (12pt `9AA4B0`).
Right: a full-height image panel (product/lifestyle) on a light `E7EFF9` surface, often
with small floating rounded-square icon tiles. Use for any "chapter break"/section-intro
content.

### C. Metrics / KPIs
Title + dek at top. A grid of large stat callouts (number 40–54pt bold; label below in
12–14pt) arranged in two rows separated by a horizontal `D9D9D9` rule, with thin vertical
rules between columns and small diamond nodes where rules cross. Optional full-width
`E7EFF9` callout bar at the bottom for a headline claim (with inline logo if relevant).
Use for any slide that is primarily numbers/KPIs.

### D. Four-card capability row
Title (32–36pt) + dek. 3–6 equal white cards across, each with a **circular icon chip**
centered at the top (thin `D9D9D9` stroke, icon inside), a bold card header (+ optional
sub-label), then structured body: a bold mini-heading (e.g. "Problems") with a short
paragraph, and a second bold mini-heading (e.g. "Advantage") with a spark-bulleted list.
A centered one-line takeaway may sit beneath the row. Use for 3–6 parallel
features / capabilities / pillars / benefits / channels.

### E. Framework / four-column
Same card grid as D but tuned for a process/framework: each column is a stage
(e.g. Source → Infer → Activate → Serve) with a circular icon chip, a centered stage
name, a hairline, then "Problems"/"Advantage" blocks. Use for steps, stages, workflows,
maturity models, or labeled frameworks.

### F. Table
Rebuild the table entirely in the reference table style — never recolor the source table.
Header row: `F3F3F3` fill, Calibri 10pt bold, centered, `0E0E0E`. Body rows: white,
Calibri 10pt, 1px `D9D9D9` gridlines, comfortable row height, left-aligned text cells and
centered short cells (#, status, dates). Status cells get the status-color fills above.
Keep all source rows, columns, and data. Use for any tabular slide.

### G. Icon + text list (with image)
Title + dek. Left column: 4–6 rows, each a circular `F3F3F3` icon chip + a bold row title
(`051E39`) + a short description (`9AA4B0`/`051E39`). Right column: a rounded-corner image
or a secondary content panel. Use for problem lists, factor lists, "before/after" context,
benefit rundowns paired with a supporting visual.

### H. Ecosystem / split metrics
Left: a two-column icon+text grid (as in G but denser, 8–10 items). Right: a titled
metrics quad (4 big stats in a 2×2 with `D9D9D9` cross-rules and a diamond node).
Separate left and right with a vertical `D9D9D9` rule. Use for platform/ecosystem/
architecture slides that combine capabilities with headline numbers.

### I. Closing / contact
Full-bleed `assets/title_background.jpg`. Centered brand wordmark in the upper third, then
a centered row of contact chips: circular `F3F3F3` icon chip + label
(e.g. website, LinkedIn, Instagram). Optional iridescent/3D decorative accents. Use for
the final slide.

**Fallback:** content that fits none of A–I → pick the nearest archetype (most "list of
parallel things" → D; most "title + supporting visual" → G) and reconstruct into it.

---

## Icons

The official Fynd icon library is **bundled in this skill** at `assets/icons/` — 285
glossy slate-gradient glyphs (96–128px PNG; some also SVG), plus the `fynd` and
`impetus_logomark_dark` brand marks. `ICONS.md` is the themed index; `_manifest.json`
maps every clean filename to its original display name. This replaces the previous Google
Drive dependency: the skill is self-contained and every user gets these icons with no
connector or download step.

1. Read `ICONS.md`, then match an icon to the meaning of each card/row by name
   (e.g. `point_of_sale`, `virtual_try_on`, `secure_payments`, `ai_driven_forecasting`,
   `catalog_and_inventory`, `analytics`). One icon per card header or list row.
2. Reference it as `assets/icons/<name>.png`. Numbered variants (`secure_payments`,
   `secure_payments_1`, …) are interchangeable style alternates of one concept.
3. Place every icon inside the standard **circular chip**: ~0.55–0.7 in diameter, white or
   `F3F3F3`/`E7EFF9` fill, thin `D9D9D9` stroke, icon centered and sized to ~55% of the
   chip. These icons are already on-brand (slate gradient), so place them as-is — do NOT
   recolor them to flat charcoal.
4. For the recurring top-right brand mark and the title/closing wordmark, use `fynd.png`.
5. If no exact-meaning icon exists, choose the closest available glyph; keep the chip
   treatment identical so the row still reads as native. Only fall back to a generated
   substitute if the library genuinely has nothing close.

---

## Compact build checklist

- [ ] Canvas 13.333×7.5, margins ≥ 0.5 in, whitespace preserved
- [ ] Fonts: Inter everywhere; tables Calibri 10pt
- [ ] Colors only from the token table; statuses use FFF2CC/F4CCCC/D9EAD3
- [ ] Title slide uses `assets/title_background.jpg` + centered hero/italic/date/pill
- [ ] Section dividers: dotted hairline under title, image panel right
- [ ] Metrics: big numbers + rule grid + diamond nodes; optional E7EFF9 callout bar
- [ ] Cards: equal width, circular icon chips, Problems/Advantage blocks, spark bullets
- [ ] Tables rebuilt in reference style (F3F3F3 header, D9D9D9 grid, status fills)
- [ ] Icons from bundled assets/icons/ library (see ICONS.md) in circular chips; closest match if no exact
- [ ] Heart mark top-right + page number bottom-right on content slides
- [ ] No accent stripes, no title underlines (except section dotted line), no cream bg
- [ ] Closing slide uses title background + contact chips

## Final validation (run per slide after rebuild)

For each rebuilt slide, confirm: **"Would this slide look at home if dropped into the
reference deck?"** Specifically verify — archetype matches content type; typography and
colors are exactly from the system; spacing/margins match; tables and icons use the
reference treatment; no source-style residue (stray fonts, colors, stripes); no overflow
or overlap. If any slide fails, rebuild it — do not patch source formatting.
