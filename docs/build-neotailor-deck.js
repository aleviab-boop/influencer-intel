// Influencer Intel executive deck — reconstructed in the NeoTailor Executive
// Presentation visual identity (cream/champagne backgrounds, gold metallic
// swooshes on title/closing, heart mark top-right, big bold black titles,
// sage-olive accents, thin tan-bordered cream cards, gold pull-quote rules).
// Built per the reference-ppt-style skill: full slide reconstruction, not restyle.
const PptxGenJS = require('pptxgenjs');
const pptx = new PptxGenJS();
pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'WIDE';
pptx.author = 'Influencer Intel';
pptx.title = 'Influencer Intel — Executive Presentation';

// ---------- palette (purple theme) ----------
const INK = '221641';        // titles (deep plum)
const BODY = '3B3357';       // body copy (dark purple-gray)
const MUTE = '8B84A6';       // captions / deks (muted lavender-gray)
const OLIVE = '6C4DF6';      // brand accent — numbers, icons, sub-labels (violet)
const OLIVE_SOFT = 'EBE6FD'; // accent tint chip
const GOLD = '8B6DF5';       // rule / underline (violet)
const GOLD_LT = 'C9BCF9';
const CREAM = 'F7F5FE';      // content background (light lavender)
const CREAM_TITLE = 'F1ECFD';// title/closing background
const CARD = 'FFFFFF';       // card fill
const CARD_LINE = 'E1DAF6';  // light purple hairline border
const BAND = 'ECE7FB';       // deeper lavender band / callout
const WHITE = 'FFFFFF';

const F = 'Poppins';         // geometric sans (falls back gracefully)
const NONE = { color: WHITE, transparency: 100 }; // transparent fill

const EMU = 13.333;

// ---------- shared chrome ----------
function contentBg(slide) {
  slide.background = { color: CREAM };
  // subtle deeper-cream wash along the lower edge (silk-fade approximation)
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 5.9, w: EMU, h: 1.6, fill: { color: BAND, transparency: 35 }, line: { type: 'none' } });
}
function heartMark(slide) {
  // charcoal outline heart, top-right
  slide.addShape(pptx.ShapeType.heart, { x: 12.5, y: 0.34, w: 0.5, h: 0.46, fill: NONE, line: { color: INK, width: 2 } });
  slide.addShape(pptx.ShapeType.heart, { x: 12.62, y: 0.45, w: 0.26, h: 0.24, fill: NONE, line: { color: INK, width: 1.5 } });
}
function goldSwooshes(slide) {
  // approximate the metallic ribbons in TL + BR corners with rotated rounded bars
  const bar = (x, y, w, h, rot, color, tr) => slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rotate: rot, fill: { color, transparency: tr }, line: { type: 'none' }, rectRadius: 0.25 });
  // top-left
  bar(-1.6, -0.5, 5.2, 0.5, -22, GOLD, 15);
  bar(-1.8, 0.1, 5.4, 0.32, -22, GOLD_LT, 25);
  // bottom-right
  bar(9.6, 6.6, 5.6, 0.5, -22, GOLD, 15);
  bar(9.4, 7.2, 5.6, 0.32, -22, GOLD_LT, 25);
}
function pageTitle(slide, text, sub) {
  slide.addText(text, { x: 0.6, y: 0.42, w: 11.4, h: 0.9, fontFace: F, fontSize: 34, bold: true, color: INK, align: 'left', valign: 'middle' });
  if (sub) slide.addText(sub, { x: 0.62, y: 1.28, w: 11.4, h: 0.5, fontFace: F, fontSize: 17, bold: true, color: BODY, align: 'left' });
}

// ---------- olive icon glyphs (solid/monoline, ~0.4in, centered on cx,cy) ----------
function icon(slide, cx, cy, type, s = 0.42) {
  const h = s / 2, ol = OLIVE;
  const solid = { fill: { color: ol }, line: { type: 'none' } };
  const ring = { fill: NONE, line: { color: ol, width: 2.25 } };
  const box = (x, y, w, hh, o = solid) => slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: hh, rectRadius: 0.03, ...o });
  const sh = (t, x, y, w, hh, o = solid) => slide.addShape(pptx.ShapeType[t], { x, y, w, h: hh, ...o });
  switch (type) {
    case 'bolt': return sh('lightningBolt', cx - h * 0.6, cy - h, s * 0.6, s, solid);
    case 'layers': { box(cx - h, cy - h * 0.7, s, s * 0.34); box(cx - h, cy - h * 0.05, s, s * 0.34); box(cx - h, cy + h * 0.6, s, s * 0.34); return; }
    case 'pin': return sh('teardrop', cx - h, cy - h, s, s, { fill: { color: ol }, line: { type: 'none' }, rotate: 135 });
    case 'up': return sh('upArrow', cx - h * 0.7, cy - h, s * 0.7, s, solid);
    case 'search': { slide.addShape(pptx.ShapeType.ellipse, { x: cx - h, y: cy - h, w: s * 0.8, h: s * 0.8, ...ring }); slide.addShape(pptx.ShapeType.line, { x: cx + h * 0.2, y: cy + h * 0.2, w: s * 0.35, h: s * 0.35, line: { color: ol, width: 2.5 } }); return; }
    case 'at': return slide.addText('@', { x: cx - h, y: cy - h - 0.03, w: s, h: s, fontFace: F, fontSize: 22, bold: true, color: ol, align: 'center', valign: 'middle' });
    case 'db': return sh('can', cx - h * 0.85, cy - h, s * 0.85, s, ring);
    case 'shield': return sh('hexagon', cx - h, cy - h, s, s, { fill: { color: ol }, line: { type: 'none' }, rotate: 90 });
    case 'gauge': return sh('pie', cx - h, cy - h, s, s, { fill: { color: ol }, line: { type: 'none' }, angleRange: [180, 340] });
    case 'compete': { sh('chevron', cx - h, cy - h, s * 0.6, s, solid); sh('chevron', cx - h * 0.1, cy - h, s * 0.6, s, { fill: { color: GOLD }, line: { type: 'none' } }); return; }
    case 'save': return sh('star5', cx - h, cy - h, s, s, solid);
    case 'ai': return sh('star4', cx - h, cy - h, s, s, solid);
    case 'chat': return sh('wedgeRoundRectCallout', cx - h, cy - h, s, s * 0.82, solid);
    case 'dm': return sh('rightArrow', cx - h, cy - h * 0.6, s, s * 0.6, solid);
    case 'draft': { box(cx - h * 0.75, cy - h, s * 0.75, s); return; }
    case 'flag': return sh('pentagon', cx - h, cy - h, s, s, solid);
    case 'bars': { slide.addShape(pptx.ShapeType.rect, { x: cx - h, y: cy + h * 0.1, w: s * 0.22, h: s * 0.35, ...solid }); slide.addShape(pptx.ShapeType.rect, { x: cx - h * 0.28, y: cy - h * 0.2, w: s * 0.22, h: s * 0.65, ...solid }); slide.addShape(pptx.ShapeType.rect, { x: cx + h * 0.45, y: cy - h * 0.6, w: s * 0.22, h: s * 1.05, ...solid }); return; }
    case 'media': { box(cx - h, cy - h * 0.7, s, s * 0.62, ring); slide.addShape(pptx.ShapeType.ellipse, { x: cx + h * 0.2, y: cy - h * 0.55, w: s * 0.22, h: s * 0.22, ...solid }); return; }
    case 'rupee': return slide.addText('\u20B9', { x: cx - h, y: cy - h - 0.02, w: s, h: s, fontFace: F, fontSize: 21, bold: true, color: ol, align: 'center', valign: 'middle' });
    case 'grid': { const g = s * 0.42; box(cx - h, cy - h, g, g); box(cx + h * 0.15, cy - h, g, g); box(cx - h, cy + h * 0.15, g, g); box(cx + h * 0.15, cy + h * 0.15, g, g); return; }
    case 'gear': return sh('gear6', cx - h, cy - h, s, s, solid);
    case 'coverage': return sh('hexagon', cx - h, cy - h, s, s, ring);
    case 'pie': return sh('pie', cx - h, cy - h, s, s, { fill: { color: ol }, line: { type: 'none' }, angleRange: [270, 200] });
    case 'users': { slide.addShape(pptx.ShapeType.ellipse, { x: cx - h, y: cy - h * 0.7, w: s * 0.5, h: s * 0.5, ...solid }); slide.addShape(pptx.ShapeType.ellipse, { x: cx + h * 0.05, y: cy - h * 0.5, w: s * 0.5, h: s * 0.5, ...solid }); return; }
    case 'clock': { slide.addShape(pptx.ShapeType.ellipse, { x: cx - h, y: cy - h, w: s, h: s, ...ring }); slide.addShape(pptx.ShapeType.line, { x: cx, y: cy - h * 0.5, w: 0, h: h * 0.5, line: { color: ol, width: 2 } }); slide.addShape(pptx.ShapeType.line, { x: cx, y: cy, w: h * 0.5, h: 0, line: { color: ol, width: 2 } }); return; }
    case 'target': { slide.addShape(pptx.ShapeType.donut, { x: cx - h, y: cy - h, w: s, h: s, fill: { color: ol }, line: { type: 'none' } }); return; }
    case 'cube': return sh('cube', cx - h, cy - h, s, s, solid);
    case 'heart': return sh('heart', cx - h, cy - h, s, s, solid);
    default: return sh('star4', cx - h, cy - h, s, s, solid);
  }
}

// ---------- card helpers ----------
// icon-card: thin tan-bordered cream card, olive icon at top, bold title, gray desc
function iconCard(slide, x, y, w, hh, ic, title, desc, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: hh, rectRadius: 0.06, fill: { color: CARD }, line: { color: CARD_LINE, width: 1 } });
  const cx = x + w / 2;
  icon(slide, cx, y + 0.52, ic);
  slide.addText(title, { x: x + 0.12, y: y + 0.82, w: w - 0.24, h: 0.34, fontFace: F, fontSize: 13.5, bold: true, color: INK, align: opts.centerTitle === false ? 'left' : 'center' });
  slide.addText(desc, { x: x + 0.16, y: y + 1.18, w: w - 0.32, h: hh - 1.28, fontFace: F, fontSize: 10.5, color: MUTE, align: opts.centerTitle === false ? 'left' : 'center', valign: 'top', lineSpacingMultiple: 1.02 });
}

function goldRule(slide, x, y, w) {
  slide.addShape(pptx.ShapeType.line, { x, y, w, h: 0, line: { color: GOLD, width: 1.5 } });
}

// ================= SLIDES =================

// ---- 1. TITLE ----
(() => {
  const s = pptx.addSlide();
  s.background = { color: CREAM_TITLE };
  goldSwooshes(s);
  // heart + wordmark lockup, centered
  s.addShape(pptx.ShapeType.heart, { x: 4.55, y: 2.62, w: 0.62, h: 0.58, fill: NONE, line: { color: INK, width: 2.5 } });
  s.addShape(pptx.ShapeType.heart, { x: 4.7, y: 2.76, w: 0.32, h: 0.3, fill: NONE, line: { color: INK, width: 2 } });
  s.addText('Influencer Intel', { x: 5.3, y: 2.5, w: 4.2, h: 0.8, fontFace: F, fontSize: 40, bold: true, color: INK, align: 'left', valign: 'middle' });
  // gold rule with center diamond
  goldRule(s, 3.9, 3.62, 5.53);
  s.addShape(pptx.ShapeType.diamond, { x: 6.6, y: 3.55, w: 0.14, h: 0.14, fill: { color: GOLD }, line: { type: 'none' } });
  s.addText('India-First Influencer Discovery, Built AI-Native', { x: 1.5, y: 3.78, w: 10.333, h: 0.5, fontFace: F, fontSize: 20, color: BODY, align: 'center' });
  s.addText('2 August 2026', { x: 1.5, y: 4.42, w: 10.333, h: 0.4, fontFace: F, fontSize: 15, italic: true, bold: true, color: INK, align: 'center' });
  // bottom pill
  s.addShape(pptx.ShapeType.roundRect, { x: 3.8, y: 6.78, w: 5.73, h: 0.4, rectRadius: 0.2, fill: { color: WHITE, transparency: 20 }, line: { color: GOLD_LT, width: 1 } });
  s.addText('Proprietary & Confidential  |  Prepared for leadership & investment review', { x: 3.8, y: 6.78, w: 5.73, h: 0.4, fontFace: F, fontSize: 9.5, color: MUTE, align: 'center', valign: 'middle' });
})();

// ---- 2. EXECUTIVE SUMMARY ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'Executive Summary');
  const para = (t) => ({ text: t, options: { fontFace: F, fontSize: 14.5, color: BODY, paraSpaceAfter: 14, lineSpacingMultiple: 1.14, breakLine: true } });
  s.addText([
    para('Influencer Intel is a search engine for creators. You type in plain English \u2014 a full campaign brief or a quick everyday prompt \u2014 and get back ranked, real influencers with live profile data, ready to reach out to. No filters to fight, no lists to buy.'),
    para('It exists because influencer marketing in India runs on gut feel, WhatsApp forwards and agency spreadsheets. Influencer Intel replaces that with an AI-native discovery engine tuned for India \u2014 regional languages, festival campaigns, and the long tail of creators global tools don\u2019t index.'),
    para('And it compounds. Every search is stored and re-ranked, so the underlying database grows on its own with each brief a user runs. The more it\u2019s used, the more defensible it becomes.'),
  ], { x: 0.62, y: 1.7, w: 11.5, h: 4.8, valign: 'top', align: 'left' });
})();

// ---- 3. WHAT IS INFLUENCER INTEL? (4-column) ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'What is Influencer Intel?');
  const cols = [
    ['bolt', 'Seconds', 'A plain-English brief becomes a ranked shortlist \u2014 not hours of manual sourcing.'],
    ['layers', '3 Engines', 'AI web search, a live public-profile crawl and the internal database run in parallel.'],
    ['pin', 'India-First', 'Vernacular, regional and festival-aware \u2014 tuned for how India actually discovers creators.'],
    ['up', 'Self-Growing', 'Every search enriches a private database, so the platform gets sharper the more it\u2019s used.'],
  ];
  const w = 2.72, gap = 0.28, y = 2.3, hh = 2.9;
  let x = 0.62;
  cols.forEach(([ic, ti, de]) => { iconCard(s, x, y, w, hh, ic, ti, de); x += w + gap; });
  s.addText('Describe a campaign the way you\u2019d brief a colleague \u2014 and get real creators back, ranked for India.', { x: 0.62, y: 5.55, w: 12.1, h: 0.5, fontFace: F, fontSize: 13, italic: true, color: MUTE, align: 'center' });
})();

// ---- 4. WHY IT MATTERS (pull-quote + numbered 01-04) ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'Why It Matters');
  // left pull-quote
  s.addText('\u201CDiscovery in India\nis still done\nby hand.\u201D', { x: 0.62, y: 2.0, w: 5.1, h: 2.0, fontFace: F, fontSize: 30, bold: true, italic: true, color: '55503F', align: 'left', lineSpacingMultiple: 1.0 });
  s.addText('A booming creator market is being sourced from spreadsheets, WhatsApp forwards and whoever the agency already knows.', { x: 0.64, y: 4.15, w: 5.0, h: 1.0, fontFace: F, fontSize: 14, color: BODY, align: 'left', lineSpacingMultiple: 1.12 });
  goldRule(s, 0.64, 5.55, 4.6);
  s.addText('The opportunity is structural, not incremental.', { x: 0.64, y: 5.62, w: 5.0, h: 0.4, fontFace: F, fontSize: 13, italic: true, color: MUTE });
  // right numbered rows
  const rows = [
    ['01', 'Creator spend in India is scaling fast \u2014 but discovery stays manual, slow and biased.'],
    ['02', 'Global tools are US-first; vernacular, regional and festival creators fall through the cracks.'],
    ['03', 'Bought lists can\u2019t answer the one question that matters: who fits this campaign, right now?'],
    ['04', 'We answer in seconds \u2014 live data, ranked for India, sharper every time someone searches.'],
  ];
  let y = 2.0; const rx = 6.3, rw = 6.4, rh = 1.02;
  rows.forEach(([n, tx]) => {
    s.addShape(pptx.ShapeType.roundRect, { x: rx, y, w: rw, h: rh, rectRadius: 0.05, fill: { color: CARD }, line: { color: CARD_LINE, width: 1 } });
    s.addText(n, { x: rx + 0.2, y: y + 0.06, w: 1.0, h: rh - 0.12, fontFace: F, fontSize: 30, bold: true, italic: true, color: OLIVE, align: 'left', valign: 'middle' });
    s.addText(tx, { x: rx + 1.35, y: y + 0.06, w: rw - 1.55, h: rh - 0.12, fontFace: F, fontSize: 12.5, color: BODY, align: 'left', valign: 'middle', lineSpacingMultiple: 1.05 });
    y += rh + 0.2;
  });
})();

// ---- 5. FIND & VET CREATORS (7-card grid 4+3) ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'Find & Vet Creators', 'The working feature set, live today \u2014 not a roadmap.');
  const cards = [
    ['search', 'Influencer search', 'Type a brief or prompt in plain English; the AI reads intent and returns matching creators.'],
    ['at', '@handle lookup', 'Paste any handle for a full, live profile snapshot on demand \u2014 vet a creator instantly.'],
    ['db', 'Influencer database', 'A private, self-growing library of every creator the platform has seen \u2014 searchable and yours.'],
    ['shield', 'Authenticity score', 'A fake-follower check that flags bought audiences before you spend on them.'],
    ['gauge', 'Engagement rate', 'Instant ER for any creator, so shortlists rank on real reach, not follower vanity.'],
    ['compete', 'Competitor collabs', 'See which creators rival brands already work with \u2014 mine their rosters for talent.'],
    ['save', 'Saved creators', 'Shortlist and organise creators into lists for a team, a client or a campaign.'],
  ];
  const w = 2.72, gap = 0.28, hh = 2.0;
  let x = 0.62, y = 1.95;
  cards.slice(0, 4).forEach(([ic, ti, de]) => { iconCard(s, x, y, w, hh, ic, ti, de); x += w + gap; });
  x = 0.62 + (w + gap) * 0.5; y = 4.15; // center the 3 remaining
  cards.slice(4).forEach(([ic, ti, de]) => { iconCard(s, x, y, w, hh, ic, ti, de); x += w + gap; });
})();

// ---- 6. CREATE, REACH OUT & RUN (8-card grid 4+4) ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'Create, Reach Out & Run Campaigns');
  const cards = [
    ['ai', 'AI content generator', 'Campaign ideas, hooks and post concepts tailored to the brand and creator.'],
    ['chat', 'Reply assistant', 'Drafts and suggests replies, so outreach and negotiation stay fast and on-brand.'],
    ['dm', 'Comment-to-DM', 'Turns post comments into direct-message conversations automatically, at scale.'],
    ['draft', 'Outreach drafts', 'A first-pass message per creator \u2014 shortlist to first contact without leaving the tool.'],
    ['flag', 'Campaign management', 'Plan and run campaigns end to end \u2014 recruits, briefs, deliverables and status.'],
    ['bars', 'Campaign analytics', 'Track performance across creators and campaigns \u2014 reach, engagement, outcomes.'],
    ['media', 'Media management', 'Collect, review and organise the content creators deliver against each campaign.'],
    ['rupee', 'Influencer payouts', 'Track budgets, spend and creator payments so finance and marketing stay in sync.'],
  ];
  const w = 2.72, gap = 0.28, hh = 2.0;
  let y = 1.7;
  for (let r = 0; r < 2; r++) {
    let x = 0.62;
    cards.slice(r * 4, r * 4 + 4).forEach(([ic, ti, de]) => { iconCard(s, x, y, w, hh, ic, ti, de); x += w + gap; });
    y += hh + 0.3;
  }
})();

// ---- 7. HOW THE DATA IS SOURCED (two-path comparison + process band) ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'How the Data Is Sourced', 'Free-first. We only pay when we\u2019re blocked.');
  const cardY = 1.95, cardH = 3.35, cw = 5.9, xA = 0.62, xB = 6.82;
  const pathCard = (x, dark, label, labelColor, title, titleColor, badge, badgeFill, badgeTx, bullets, bulletColor) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y: cardY, w: cw, h: cardH, rectRadius: 0.08, fill: { color: dark ? INK : CARD }, line: { color: dark ? INK : CARD_LINE, width: 1.25 } });
    s.addShape(pptx.ShapeType.rect, { x: x + 0.02, y: cardY, w: cw - 0.04, h: 0.09, fill: { color: OLIVE }, line: { type: 'none' } });
    s.addText(label, { x: x + 0.32, y: cardY + 0.24, w: cw - 0.6, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: labelColor, charSpacing: 2 });
    s.addText(title, { x: x + 0.32, y: cardY + 0.52, w: cw - 0.64, h: 0.45, fontFace: F, fontSize: 20, bold: true, color: titleColor, valign: 'middle' });
    s.addShape(pptx.ShapeType.roundRect, { x: x + 0.32, y: cardY + 1.06, w: 2.05, h: 0.52, rectRadius: 0.08, fill: { color: badgeFill }, line: { type: 'none' } });
    s.addText(badge, { x: x + 0.32, y: cardY + 1.06, w: 2.05, h: 0.52, fontFace: F, fontSize: 15, bold: true, color: badgeTx, align: 'center', valign: 'middle' });
    s.addText(bullets.map((t) => ({ text: t, options: { fontFace: F, fontSize: 12.5, color: bulletColor, bullet: { indent: 16 }, paraSpaceAfter: 11, lineSpacingMultiple: 1.06, breakLine: true } })), { x: x + 0.34, y: cardY + 1.82, w: cw - 0.68, h: cardH - 1.95, valign: 'top' });
  };
  pathCard(xA, false, 'PRIMARY PATH \u00B7 FREE', OLIVE, 'Own crawler + cookie pool', INK, '\u20B90 / profile', OLIVE_SOFT, INK, [
    'Live profile data pulled through our own relay crawler.',
    'A rotating pool of real accounts and cookies.',
    'Zero marginal cost whenever it works.',
    'The same engagement & ranking math as the fallback.',
  ], BODY);
  pathCard(xB, true, 'FALLBACK \u00B7 PAY-PER-USE', GOLD_LT, 'Apify scraper', WHITE, '~a few \u00A2 / profile', OLIVE, WHITE, [
    'Fires only on a block \u2014 401 / 403 / rate-limit.',
    'Billed per profile: no block, no bill.',
    'Cost scales with blocks, not with how much we search.',
    'Invisible to the user \u2014 same ranked result either way.',
  ], 'E8E3FA');
  // bottom process band
  const by = 5.6, bh = 0.9;
  s.addShape(pptx.ShapeType.roundRect, { x: 0.62, y: by, w: 12.1, h: bh, rectRadius: 0.06, fill: { color: WHITE, transparency: 15 }, line: { color: CARD_LINE, width: 1 } });
  const stages = ['Own crawler', 'Blocked?', 'Apify (pay-per-use)', 'Same ranked result'];
  const sw = 12.1 / stages.length;
  stages.forEach((st, i) => {
    s.addText(st, { x: 0.62 + i * sw, y: by, w: sw, h: bh, fontFace: F, fontSize: 12.5, bold: true, color: i === stages.length - 1 ? OLIVE : BODY, align: 'center', valign: 'middle' });
    if (i < stages.length - 1) s.addText('\u203A', { x: 0.62 + (i + 1) * sw - 0.16, y: by, w: 0.32, h: bh, fontFace: F, fontSize: 20, color: GOLD, align: 'center', valign: 'middle' });
  });
})();

// ---- 8. THREE LOGINS, ONE PLATFORM (3 big rounded cards) ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'Three Logins, One Platform', 'One system, three doors \u2014 each with its own login and view.');
  const cards = [
    ['cube', 'BRAND / AGENCY', 'The marketing team', ['Email-and-password login', 'Full discovery, outreach & campaign toolset', 'Plain-English search to shortlist']],
    ['heart', 'INFLUENCER / CREATOR', 'The creators themselves', ['Passwordless \u2014 connect Instagram', 'Their own portal', 'Performance prediction (about to build)']],
    ['gear', 'SUPER ADMIN', 'The operator', ['Private control panel', 'Runs data pipelines & accounts', 'Coverage, campaigns & analytics']],
  ];
  const w = 3.86, gap = 0.26, y = 1.95, hh = 3.5;
  let x = 0.62;
  cards.forEach(([ic, ti, sub, items]) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: hh, rectRadius: 0.1, fill: { color: CARD }, line: { color: CARD_LINE, width: 1.25 } });
    icon(s, x + 0.55, y + 0.55, ic, 0.5);
    s.addText(ti, { x: x + 1.0, y: y + 0.28, w: w - 1.1, h: 0.4, fontFace: F, fontSize: 15, bold: true, color: OLIVE, valign: 'middle' });
    s.addText(sub, { x: x + 0.35, y: y + 0.95, w: w - 0.6, h: 0.32, fontFace: F, fontSize: 12.5, italic: true, color: MUTE });
    s.addText(items.map((t) => ({ text: t, options: { fontFace: F, fontSize: 12, color: BODY, bullet: { indent: 14 }, paraSpaceAfter: 9, breakLine: true, lineSpacingMultiple: 1.05 } })), { x: x + 0.35, y: y + 1.45, w: w - 0.6, h: hh - 1.6, valign: 'top' });
    x += w + gap;
  });
  s.addShape(pptx.ShapeType.rect, { x: 0.62, y: 5.75, w: 12.1, h: 0.6, fill: { color: BAND, transparency: 25 }, line: { type: 'none' } });
  s.addText('Same engine, three tailored surfaces.', { x: 0.62, y: 5.75, w: 12.1, h: 0.6, fontFace: F, fontSize: 13, italic: true, color: BODY, align: 'center', valign: 'middle' });
})();

// ---- 9. THE SUPER ADMIN CONTROL PANEL (7-card grid 4+3) ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'The Super Admin Control Panel', 'The cockpit behind the product \u2014 seven screens.');
  const cards = [
    ['grid', 'Dashboard', 'Database size, 24h scrapes, agency searches, accounts in rotation, job-queue depth.'],
    ['gear', 'Scraper', 'Recent scrapes, account health & cooling, pipeline status (healthy / rate-limited / cookie-dead).'],
    ['bars', 'Metrics', 'Worker heartbeat, crawl queue, throughput, 7-day search trends, DAU, creator growth.'],
    ['coverage', 'Coverage', 'A niche \u00D7 city heat-map of where the database is strong and where it\u2019s thin.'],
    ['flag', 'Campaigns', 'Per-brand oversight \u2014 recruits, budget, spend and performance across the platform.'],
    ['pie', 'Analytics', 'System-wide KPIs, including prediction accuracy as the creator portal comes online.'],
    ['users', 'Agency', 'The brand-side audit \u2014 signups, logins and account activity.'],
  ];
  const w = 2.72, gap = 0.28, hh = 2.0;
  let x = 0.62, y = 1.95;
  cards.slice(0, 4).forEach(([ic, ti, de]) => { iconCard(s, x, y, w, hh, ic, ti, de); x += w + gap; });
  x = 0.62 + (w + gap) * 0.5; y = 4.15;
  cards.slice(4).forEach(([ic, ti, de]) => { iconCard(s, x, y, w, hh, ic, ti, de); x += w + gap; });
})();

// ---- 10. INFLUENCER INTEL vs IMPACT.COM (table) ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'Influencer Intel vs. Impact.com');
  s.addText('Impact.com is a strong global partner-network platform \u2014 built for US brands, not for how India discovers creators. That gap is our opening.', { x: 0.62, y: 1.35, w: 12.1, h: 0.55, fontFace: F, fontSize: 13, color: BODY, align: 'left', lineSpacingMultiple: 1.08 });
  const head = (t) => ({ text: t, options: { bold: true, color: WHITE, fill: { color: OLIVE }, align: 'left', fontFace: F, fontSize: 12 } });
  const c0 = (t) => ({ text: t, options: { bold: true, color: INK, align: 'left', fontFace: F, fontSize: 11 } });
  const c = (t) => ({ text: t, options: { color: BODY, align: 'left', fontFace: F, fontSize: 11 } });
  const cW = (t) => ({ text: t, options: { color: INK, bold: true, align: 'left', fontFace: F, fontSize: 11, fill: { color: OLIVE_SOFT } } });
  const rows = [
    [head('Capability'), head('Impact.com'), head('Influencer Intel')],
    [c0('India creator depth'), c('US / global-first; thin India coverage'), cW('India-first; vernacular, regional & festival creators')],
    [c0('How you search'), c('Filters, forms & vetted marketplace lists'), cW('Plain-English brief \u2014 the AI reads intent')],
    [c0('Data freshness'), c('Marketplace + partner-reported metrics'), cW('Live public-profile snapshots on demand')],
    [c0('Campaign fit'), c('Generic tags and categories'), cW('Campaign mode: proven-collaborator, festival-aware')],
    [c0('Data asset'), c('Static partner network'), cW('Self-growing database \u2014 every search enriches it')],
    [c0('Setup'), c('Contracts, enrolment, integration'), cW('Type a brief, get creators in seconds')],
  ];
  s.addTable(rows, { x: 0.62, y: 2.05, w: 12.1, colW: [2.9, 4.3, 4.9], rowH: 0.5, border: { type: 'solid', color: CARD_LINE, pt: 1 }, fill: { color: CARD }, valign: 'middle', margin: [4, 8, 4, 8], autoPage: false });
  s.addText('Impact.com is where a global brand runs a formal partner program. Influencer Intel is where an Indian brand finds the right creator for a specific campaign \u2014 faster, live, and deep in exactly the market Impact under-serves.', { x: 0.62, y: 6.35, w: 12.1, h: 0.7, fontFace: F, fontSize: 12, italic: true, color: MUTE, align: 'left', lineSpacingMultiple: 1.05 });
})();

// ---- 11. ABOUT TO BUILD: THE INFLUENCER PORTAL ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'About to Build: The Influencer Portal', 'The next build opens the other side of the market.');
  s.addText('Today the platform serves brands. Next it opens to creators: an influencer connects their account and the platform predicts how their next reel or post will perform \u2014 before they publish it.', { x: 0.62, y: 1.7, w: 12.1, h: 0.7, fontFace: F, fontSize: 13.5, color: BODY, lineSpacingMultiple: 1.1 });
  const cards = [
    ['target', 'Performance prediction', 'Forecast reach and engagement for a planned reel or post \u2014 post what will land.'],
    ['clock', 'Best-time & format', 'When to post and which format is likely to perform for their specific audience.'],
    ['compete', 'Brand-fit signals', 'Which brands and campaigns they match \u2014 feeding back into brand-side discovery.'],
    ['up', 'Growth tracking', 'A running view of what\u2019s working, so creators see the effect of the guidance.'],
  ];
  const w = 2.72, gap = 0.28, y = 2.6, hh = 2.35;
  let x = 0.62;
  cards.forEach(([ic, ti, de]) => { iconCard(s, x, y, w, hh, ic, ti, de); x += w + gap; });
  s.addShape(pptx.ShapeType.rect, { x: 0.62, y: 5.35, w: 12.1, h: 0.85, fill: { color: BAND, transparency: 22 }, line: { type: 'none' } });
  s.addText('The moment creators log in for predictions, they hand us first-party performance data no scraper can get \u2014 turning a discovery tool into a two-sided network.', { x: 0.9, y: 5.35, w: 11.5, h: 0.85, fontFace: F, fontSize: 13, italic: true, color: BODY, align: 'center', valign: 'middle', lineSpacingMultiple: 1.05 });
})();

// ---- 12. WHERE THIS GOES (horizon band) ----
(() => {
  const s = pptx.addSlide();
  contentBg(s); heartMark(s); pageTitle(s, 'Where This Goes');
  const cards = [
    ['Today', 'A working, India-first discovery engine brands can use now.'],
    ['Next', 'The creator portal with performance prediction \u2014 a two-sided network with a proprietary data flywheel.'],
    ['The Moat', 'Every search and every creator login makes the data \u2014 and the predictions \u2014 better. That advantage compounds and is hard to copy.'],
  ];
  const w = 3.86, gap = 0.26, y = 2.1, hh = 3.0;
  let x = 0.62;
  cards.forEach(([ti, de], i) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: hh, rectRadius: 0.1, fill: { color: CARD }, line: { color: CARD_LINE, width: 1.25 } });
    s.addText(String(i + 1).padStart(2, '0'), { x: x + 0.35, y: y + 0.3, w: w - 0.6, h: 0.7, fontFace: F, fontSize: 34, bold: true, italic: true, color: OLIVE });
    s.addText(ti, { x: x + 0.35, y: y + 1.05, w: w - 0.6, h: 0.5, fontFace: F, fontSize: 18, bold: true, color: INK });
    s.addText(de, { x: x + 0.35, y: y + 1.6, w: w - 0.7, h: hh - 1.8, fontFace: F, fontSize: 13, color: BODY, valign: 'top', lineSpacingMultiple: 1.12 });
    x += w + gap;
  });
  s.addText('The more it\u2019s used, the more defensible it becomes.', { x: 0.62, y: 5.55, w: 12.1, h: 0.5, fontFace: F, fontSize: 14, italic: true, color: MUTE, align: 'center' });
})();

// ---- 13. CLOSING ----
(() => {
  const s = pptx.addSlide();
  s.background = { color: CREAM_TITLE };
  goldSwooshes(s);
  s.addShape(pptx.ShapeType.heart, { x: 5.5, y: 2.55, w: 0.6, h: 0.56, fill: NONE, line: { color: INK, width: 2.5 } });
  s.addShape(pptx.ShapeType.heart, { x: 5.64, y: 2.68, w: 0.32, h: 0.3, fill: NONE, line: { color: INK, width: 2 } });
  s.addText('Influencer Intel', { x: 6.2, y: 2.45, w: 3.6, h: 0.8, fontFace: F, fontSize: 34, bold: true, color: INK, valign: 'middle' });
  goldRule(s, 3.9, 3.6, 5.53);
  // contact chips
  const chips = [['India-first influencer discovery'], ['Live, ranked, AI-native'], ['Prepared for leadership review']];
  const cw = 3.6, gap = 0.3; let x = (13.333 - (cw * 3 + gap * 2)) / 2; const y = 4.15;
  chips.forEach(([t]) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: cw, h: 0.5, rectRadius: 0.25, fill: { color: WHITE, transparency: 20 }, line: { color: GOLD_LT, width: 1 } });
    s.addText(t, { x, y, w: cw, h: 0.5, fontFace: F, fontSize: 12, color: BODY, align: 'center', valign: 'middle' });
    x += cw + gap;
  });
})();

// ---------- write ----------
const out = '/Users/aleviabandyopadhyay/Downloads/influencer-intel/docs/Influencer-Intel-Deck.pptx';
pptx.writeFile({ fileName: out }).then(() => console.log('WROTE ' + out));
