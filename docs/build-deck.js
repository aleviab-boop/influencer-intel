// Influencer Intel — investor/leadership deck, built in the reference (Fynd/Impetus)
// visual identity per reference-ppt-style/SKILL.md. Assets (title_background.jpg, Fynd
// icon library) were NOT bundled in the uploaded skill, so title/closing backgrounds are
// approximated with the reference light-blue wash and icon chips use geometric glyphs.
const pptxgen = require('pptxgenjs');
const p = new pptxgen();
p.defineLayout({ name: 'W', width: 13.333, height: 7.5 });
p.layout = 'W';

// ---- reference tokens ----
const INK = '0E0E0E';       // primary text
const NAVY = '051E39';      // secondary text / body / card headers
const MUTE = '9AA4B0';      // deks, captions, footers
const LINE = 'D9D9D9';      // hairlines, grid
const GRAY = 'F3F3F3';      // neutral surface / table header
const BLUE = 'E7EFF9';      // callout / highlight / icon circle
const WHITE = 'FFFFFF';
const F = 'Inter';          // body font everywhere
const FT = 'Calibri';       // tables only

const MW = 13.333, MH = 7.5, MARGIN = 0.6;

// ---- shared motifs ----
function brandMark(s) { // top-right node stand-in for the heart mark
  s.addText('◆', { x: MW - 0.75, y: 0.28, w: 0.4, h: 0.3, fontFace: F, fontSize: 12, color: INK, align: 'center' });
}
function pageNum(s, n) {
  s.addText(String(n), { x: MW - 0.9, y: MH - 0.45, w: 0.5, h: 0.3, fontFace: F, fontSize: 9, color: MUTE, align: 'right' });
}
function title(s, t, dek) {
  s.addText(t, { x: MARGIN, y: 0.5, w: MW - 2 * MARGIN, h: 0.7, fontFace: F, fontSize: 33, color: INK });
  if (dek) s.addText(dek, { x: MARGIN, y: 1.18, w: MW - 2 * MARGIN, h: 0.4, fontFace: F, fontSize: 16, color: MUTE });
}
function chip(s, x, y, glyph, d = 0.62) {
  s.addShape(p.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: WHITE }, line: { color: LINE, width: 1 } });
  s.addText(glyph, { x, y, w: d, h: d, fontFace: F, fontSize: 15, bold: true, color: NAVY, align: 'center', valign: 'middle' });
}
const contentBase = (s) => { s.background = { color: WHITE }; brandMark(s); };

// ============ 1. TITLE (archetype A) ============
{
  const s = p.addSlide(); s.background = { color: WHITE };
  s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: MW, h: 1.5, fill: { color: BLUE } });
  s.addShape(p.ShapeType.rect, { x: 0, y: MH - 1.5, w: MW, h: 1.5, fill: { color: BLUE } });
  s.addText('Influencer Intel', { x: 0, y: 2.55, w: MW, h: 0.9, fontFace: F, fontSize: 40, color: INK, align: 'center' });
  // thin centered rule with a diamond node
  s.addShape(p.ShapeType.line, { x: MW / 2 - 1.6, y: 3.62, w: 1.4, h: 0, line: { color: LINE, width: 1 } });
  s.addShape(p.ShapeType.line, { x: MW / 2 + 0.2, y: 3.62, w: 1.4, h: 0, line: { color: LINE, width: 1 } });
  s.addText('◆', { x: MW / 2 - 0.2, y: 3.47, w: 0.4, h: 0.3, fontFace: F, fontSize: 11, color: NAVY, align: 'center' });
  s.addText('India-first influencer discovery, built AI-native', { x: 0, y: 3.75, w: MW, h: 0.6, fontFace: F, fontSize: 22, italic: true, color: INK, align: 'center' });
  s.addText('August 2026', { x: 0, y: 4.45, w: MW, h: 0.35, fontFace: F, fontSize: 13, color: MUTE, align: 'center' });
  // confidential pill
  s.addShape(p.ShapeType.roundRect, { x: MW / 2 - 2.4, y: MH - 0.95, w: 4.8, h: 0.42, rectRadius: 0.21, fill: { color: GRAY }, line: { color: LINE, width: 1 } });
  s.addText('Proprietary & Confidential  |  © 2026 Influencer Intel', { x: MW / 2 - 2.4, y: MH - 0.95, w: 4.8, h: 0.42, fontFace: F, fontSize: 9.5, color: NAVY, align: 'center', valign: 'middle' });
}

// ============ 2. THE ONE-LINE (statement + callout) ============
{
  const s = p.addSlide(); contentBase(s);
  title(s, 'The one-line', 'What Influencer Intel is, in a sentence');
  // light-blue callout bar
  s.addShape(p.ShapeType.roundRect, { x: MARGIN, y: 1.9, w: MW - 2 * MARGIN, h: 1.5, rectRadius: 0.06, fill: { color: BLUE }, line: { color: LINE, width: 1 } });
  s.addText([
    { text: 'A search engine for creators. ', options: { bold: true } },
    { text: 'Describe a campaign in plain English — “beauty creators in Mumbai under 100k for a Durga Puja shoot” — and get ranked, real influencers with live profile data, ready to reach out to. No filters to fight, no lists to buy.', options: {} },
  ], { x: MARGIN + 0.3, y: 1.9, w: MW - 2 * MARGIN - 0.6, h: 1.5, fontFace: F, fontSize: 17, color: NAVY, valign: 'middle', lineSpacingMultiple: 1.15 });
  // two supporting rows with chips
  const rows = [
    ['Built for India', 'Regional languages, festival campaigns, and the long tail of creators that global tools don’t index.'],
    ['Compounds with use', 'Every search is stored and re-ranked — the underlying database grows on its own. The more it’s used, the more defensible it becomes.'],
  ];
  rows.forEach((r, i) => {
    const y = 3.9 + i * 1.35;
    chip(s, MARGIN, y, i === 0 ? '★' : '⟳');
    s.addText(r[0], { x: MARGIN + 0.85, y: y - 0.04, w: MW - 2 * MARGIN - 0.85, h: 0.4, fontFace: F, fontSize: 16, bold: true, color: NAVY });
    s.addText(r[1], { x: MARGIN + 0.85, y: y + 0.36, w: MW - 2 * MARGIN - 0.85, h: 0.7, fontFace: F, fontSize: 13.5, color: NAVY });
  });
  pageNum(s, 2);
}

// ============ 3. WHY IT MATTERS (archetype G — icon+text list) ============
{
  const s = p.addSlide(); contentBase(s);
  title(s, 'Why it matters', 'Creator marketing in India is scaling — discovery hasn’t kept up');
  const items = [
    ['↗', 'A booming market', 'Creator spend in India is scaling fast — but discovery is still manual, slow, and biased toward whoever an agency already knows.'],
    ['◧', 'Global tools miss India', 'They’re built US-first — vernacular creators, regional stars, and festival-driven campaigns fall through the cracks.'],
    ['✦', 'Brands overpay for stale data', 'Bought lists and spreadsheets can’t answer the one question that matters: who actually fits this campaign, right now?'],
    ['⚡', 'We answer in seconds', 'Live data, ranked for India, getting sharper every time someone searches.'],
  ];
  items.forEach((it, i) => {
    const y = 2.0 + i * 1.16;
    chip(s, MARGIN, y, it[0]);
    s.addText(it[1], { x: MARGIN + 0.85, y: y - 0.05, w: MW - 2 * MARGIN - 0.85, h: 0.4, fontFace: F, fontSize: 16, bold: true, color: NAVY });
    s.addText(it[2], { x: MARGIN + 0.85, y: y + 0.35, w: MW - 2 * MARGIN - 0.85, h: 0.6, fontFace: F, fontSize: 13.5, color: NAVY });
  });
  pageNum(s, 3);
}

// ============ 4 & 5. WHAT IT DOES — capability cards (archetype D) ============
function cardSlide(pageNo, heading, dek, cards, takeaway) {
  const s = p.addSlide(); contentBase(s);
  title(s, heading, dek);
  const n = cards.length;
  const gap = 0.3, x0 = MARGIN, top = 2.0, cardH = 3.7;
  const cw = (MW - 2 * MARGIN - gap * (n - 1)) / n;
  cards.forEach((c, i) => {
    const x = x0 + i * (cw + gap);
    s.addShape(p.ShapeType.roundRect, { x, y: top, w: cw, h: cardH, rectRadius: 0.06, fill: { color: WHITE }, line: { color: LINE, width: 1 } });
    // centered chip
    const d = 0.62; chip(s, x + cw / 2 - d / 2, top + 0.28, c.g, d);
    s.addText(c.h, { x: x + 0.18, y: top + 1.0, w: cw - 0.36, h: 0.7, fontFace: F, fontSize: 14.5, bold: true, color: NAVY, align: 'center' });
    s.addText(c.b, { x: x + 0.22, y: top + 1.7, w: cw - 0.44, h: cardH - 1.85, fontFace: F, fontSize: 12, color: NAVY, align: 'center', valign: 'top', lineSpacingMultiple: 1.1 });
  });
  if (takeaway) s.addText(takeaway, { x: MARGIN, y: top + cardH + 0.25, w: MW - 2 * MARGIN, h: 0.4, fontFace: F, fontSize: 13, italic: true, color: NAVY, align: 'center' });
  pageNum(s, pageNo);
}

cardSlide(4, 'What it does — discovery & search', 'Type a brief the way you’d brief a colleague', [
  { g: '✦', h: 'Plain-English search', b: 'The AI reads intent — niche, city, follower range, platform — and returns matching creators. No filter grids.' },
  { g: '◆', h: 'Campaign mode', b: 'Detects campaign briefs and ranks creators who have proven they collaborate with brands — not just anyone in the niche.' },
  { g: '★', h: 'Festival & vernacular', b: 'Understands Indian context — Durga Puja, Diwali, regional languages — and guards name collisions (a festival vs. a person named Durga).' },
  { g: '@', h: '@handle lookup', b: 'Paste any Instagram handle and pull a full, live profile snapshot on demand — vet a specific creator instantly.' },
], 'Everything here is live today — the working feature set, not a roadmap.');

cardSlide(5, 'What it does — data & workflow', 'Fresh, ranked, and ready to act on', [
  { g: '●', h: 'Live profile snapshots', b: 'Followers, engagement, recent reels, category and contact signals — pulled fresh at search time, not from a stale list.' },
  { g: '▲', h: 'India-first ranking', b: 'Ranked for Indian relevance — location, language, audience fit — plus proven-collaborator signals from post captions.' },
  { g: '⟳', h: 'Self-growing database', b: 'Every search enriches a private creator DB. Repeat and reworded searches serve instantly — a compounding data asset.' },
  { g: '➜', h: 'Outreach & export', b: 'A first-pass outreach message per creator and one-click export of the shortlist. Brief to first contact in one tool.' },
], 'Three engines — AI web search, a live profile crawl, and the growing database — run in parallel on every brief.');

// ============ 6. COMPARISON TABLE (archetype F) ============
{
  const s = p.addSlide(); contentBase(s);
  title(s, 'Influencer Intel vs. Impact.com', 'A strong global platform — but not built for how India discovers creators');
  const hdr = (t, fill) => ({ text: t, options: { fill: { color: fill }, color: fill === NAVY ? WHITE : INK, bold: true, fontFace: FT, fontSize: 10.5, align: 'left', valign: 'middle' } });
  const cell = (t, opts = {}) => ({ text: t, options: { fontFace: FT, fontSize: 10, color: INK, valign: 'middle', fill: { color: opts.fill || WHITE }, ...opts } });
  const rows = [
    [hdr('Capability', GRAY), hdr('Impact.com', GRAY), hdr('Influencer Intel', BLUE)],
    ['India creator depth', 'US / global-first; thin India coverage', 'India-first; vernacular, regional & festival creators'],
    ['How you search', 'Filters, forms & vetted marketplace lists', 'Plain-English brief — AI reads intent'],
    ['Data freshness', 'Marketplace + partner-reported metrics', 'Live public-profile snapshots on demand'],
    ['Campaign fit', 'Generic tags & categories', 'Campaign mode: proven-collaborator ranking, festival-aware'],
    ['Name collisions', 'Not addressed', 'Guarded (e.g. “Durga Puja” vs. a person named Durga)'],
    ['Data asset', 'Static partner network', 'Self-growing DB — every search enriches it'],
    ['Setup', 'Contracts, enrolment, integration', 'Type a brief, get creators in seconds'],
  ].map((r, i) => i === 0 ? r : [
    cell(r[0], { fill: GRAY, bold: true, color: NAVY }),
    cell(r[1]),
    cell(r[2], { fill: BLUE, color: NAVY }),
  ]);
  s.addTable(rows, {
    x: MARGIN, y: 1.85, w: MW - 2 * MARGIN, colW: [3.0, 4.35, 4.383],
    border: { type: 'solid', color: LINE, pt: 1 }, rowH: 0.52, valign: 'middle',
    margin: [4, 8, 4, 8],
  });
  s.addText('The short version: Impact.com is where a global brand runs a formal partner program. Influencer Intel is where an Indian brand finds the right creator for a specific campaign — faster, live, and deep in the market Impact under-serves.',
    { x: MARGIN, y: 6.55, w: MW - 2 * MARGIN, h: 0.6, fontFace: F, fontSize: 12.5, italic: true, color: NAVY, align: 'center' });
  pageNum(s, 6);
}

// ============ 7. ABOUT TO BUILD (archetype B — section divider + tiles) ============
{
  const s = p.addSlide(); contentBase(s);
  // left column
  s.addText('About to build', { x: MARGIN, y: 0.7, w: 6.0, h: 0.4, fontFace: F, fontSize: 15, color: MUTE });
  s.addText('The Influencer Portal', { x: MARGIN, y: 1.1, w: 6.2, h: 0.8, fontFace: F, fontSize: 34, bold: true, color: INK });
  // dotted hairline under title
  s.addShape(p.ShapeType.line, { x: MARGIN, y: 1.95, w: 5.6, h: 0, line: { color: LINE, width: 1, dashType: 'dot' } });
  s.addText('Creators log in — and see their future.', { x: MARGIN, y: 2.15, w: 6.0, h: 0.6, fontFace: F, fontSize: 20, color: NAVY });
  s.addText('An influencer connects their account and the platform predicts how their next reel or post will perform — before they publish it. Expected reach, likes and engagement, from their own history and what’s working in their niche right now.',
    { x: MARGIN, y: 2.9, w: 5.9, h: 1.6, fontFace: F, fontSize: 13.5, color: NAVY, lineSpacingMultiple: 1.2 });
  s.addShape(p.ShapeType.roundRect, { x: MARGIN, y: 4.7, w: 5.9, h: 1.9, rectRadius: 0.06, fill: { color: BLUE }, line: { color: LINE, width: 1 } });
  s.addText([
    { text: 'Why this is the real unlock.  ', options: { bold: true } },
    { text: 'The moment creators log in for predictions, they hand us first-party performance data no scraper can get — sharpening brand-side results and pulling both sides onto one platform. The flywheel that compounds.', options: {} },
  ], { x: MARGIN + 0.25, y: 4.7, w: 5.4, h: 1.9, fontFace: F, fontSize: 12.5, color: NAVY, valign: 'middle', lineSpacingMultiple: 1.15 });
  // right column — 2x2 feature tiles on light surface
  const tiles = [
    ['◎', 'Performance prediction', 'Forecast reach & engagement for a planned post — publish what will land.'],
    ['◷', 'Best time & format', 'When to post and which format works for their specific audience.'],
    ['◆', 'Brand-fit signals', 'Which brands & campaigns they match — feeding brand-side discovery.'],
    ['⟳', 'Growth tracking', 'A running view of what’s working as they follow the guidance.'],
  ];
  const rx = 6.9, tw = 2.9, th = 2.55, gx = 0.25, gy = 0.25, ry = 1.1;
  tiles.forEach((t, i) => {
    const x = rx + (i % 2) * (tw + gx);
    const y = ry + Math.floor(i / 2) * (th + gy);
    s.addShape(p.ShapeType.roundRect, { x, y, w: tw, h: th, rectRadius: 0.06, fill: { color: WHITE }, line: { color: LINE, width: 1 } });
    chip(s, x + 0.22, y + 0.24, t[0], 0.56);
    s.addText(t[1], { x: x + 0.22, y: y + 0.95, w: tw - 0.44, h: 0.6, fontFace: F, fontSize: 13.5, bold: true, color: NAVY });
    s.addText(t[2], { x: x + 0.22, y: y + 1.5, w: tw - 0.44, h: 0.9, fontFace: F, fontSize: 11.5, color: NAVY, lineSpacingMultiple: 1.1 });
  });
  pageNum(s, 7);
}

// ============ 8. CLOSING (archetype I) ============
{
  const s = p.addSlide(); s.background = { color: WHITE };
  s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: MW, h: 1.5, fill: { color: BLUE } });
  s.addShape(p.ShapeType.rect, { x: 0, y: MH - 1.5, w: MW, h: 1.5, fill: { color: BLUE } });
  s.addText('Where this goes', { x: 0, y: 1.9, w: MW, h: 0.7, fontFace: F, fontSize: 32, bold: true, color: INK, align: 'center' });
  const pts = [
    ['Today', 'A working, India-first discovery engine brands can use now.'],
    ['Next', 'The creator portal with performance prediction — a two-sided network with a proprietary data flywheel.'],
    ['The moat', 'Every search and every creator login makes the data — and the predictions — better. That advantage compounds and is hard to copy.'],
  ];
  pts.forEach((pt, i) => {
    const y = 2.9 + i * 0.72;
    s.addText([
      { text: pt[0] + '   ', options: { bold: true, color: NAVY } },
      { text: pt[1], options: { color: NAVY } },
    ], { x: MW / 2 - 4.5, y, w: 9, h: 0.6, fontFace: F, fontSize: 14.5, align: 'center' });
  });
  s.addText('Proprietary & Confidential  ·  Influencer Intel  ·  Prepared for leadership & investment review',
    { x: 0, y: MH - 0.95, w: MW, h: 0.4, fontFace: F, fontSize: 10, color: MUTE, align: 'center' });
}

const OUT = '/Users/aleviabandyopadhyay/Downloads/influencer-intel/docs/Influencer-Intel-Deck.pptx';
p.writeFile({ fileName: OUT }).then(() => console.log('WROTE ' + OUT));
