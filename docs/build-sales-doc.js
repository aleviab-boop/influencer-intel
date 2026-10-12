// Influencer Intel leadership/investor note — formatted to the NeoTailor Network
// Strategy Note template (Arial, slate-blue accents, colored headline-number band,
// blue/teal/mauve table headers, running header + IP footer).
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  Header, Footer, PageNumber, TabStopType, TabStopPosition,
} = require('docx');
const fs = require('fs');

// ---- palette (from the reference note) ----
const INK = '1A1A1A';     // title / headings / body
const SLATE = '34558B';   // subtitle, sub-labels, table-header text (steel blue)
const MUTE = '8A8A8A';    // header / footer / captions
const GRIDGRAY = 'B8B8B8';
const HDR_BLUE = 'DCE6F2';
const HDR_TEAL = 'D5E8E3', TEAL_TX = '2E7D6E';
const HDR_MAUVE = 'E9DCEA', MAUVE_TX = '7A4A82';
const BLUE_TX = '2A4E7A';
const CARD_BG = 'F7F8FA';
// metric accent colors
const M_BLUE = '2E5AAC', M_GREEN = '3E7B3E', M_PURPLE = '6A4C9C', M_ORANGE = 'C87F2C';
const FONT = 'Arial';

const CW = 9026; // content width @ A4 with 1440 margins

// ---- text helpers ----
const t = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size ?? 21, bold: o.bold, italics: o.italics, color: o.color ?? INK });
const P = (runs, o = {}) => new Paragraph({
  spacing: { after: o.after ?? 130, line: o.line ?? 264 },
  alignment: o.align,
  children: Array.isArray(runs) ? runs : [t(runs, o)],
});
// bold "Lead-in." + trailing body, as the reference does
const lead = (head, body) => P([t(head + ' ', { bold: true }), t(body)]);

const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 300, after: 120 },
  children: [t(text, { bold: true, size: 30 })],
});
const label = (text, color = SLATE) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 200, after: 80 },
  children: [t(text, { bold: true, size: 22, color })],
});
const note = (text) => P([t(text, { italics: true, size: 19, color: MUTE })], { after: 160 });

// ---- headline-numbers band ----
function metricCell(color, big, cap, w) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    margins: { top: 120, bottom: 120, left: 130, right: 130 },
    shading: { type: ShadingType.CLEAR, fill: CARD_BG, color: 'auto' },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 26, color },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: GRIDGRAY },
      left: { style: BorderStyle.SINGLE, size: 4, color: GRIDGRAY },
      right: { style: BorderStyle.SINGLE, size: 4, color: GRIDGRAY },
    },
    children: [
      new Paragraph({ spacing: { after: 40 }, children: [t(big, { bold: true, size: 40, color })] }),
      new Paragraph({ spacing: { after: 0, line: 230 }, children: [t(cap, { size: 16, color: MUTE })] }),
    ],
  });
}
const metricBand = new Table({
  columnWidths: [2256, 2256, 2257, 2257],
  width: { size: CW, type: WidthType.DXA },
  borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
  rows: [new TableRow({ children: [
    metricCell(M_BLUE, 'Seconds', 'Plain-English brief to ranked creators', 2256),
    metricCell(M_GREEN, '3 engines', 'AI search + live crawl + database, in parallel', 2256),
    metricCell(M_PURPLE, 'India-first', 'Vernacular, regional and festival-aware', 2257),
    metricCell(M_ORANGE, 'Self-grows', 'Every search enriches the database', 2257),
  ] })],
});

// ---- generic reference table ----
function refTable(cols, headers, rows, headFill = HDR_BLUE, headTx = BLUE_TX) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: GRIDGRAY };
  const mk = (text, o = {}) => new TableCell({
    width: { size: o.w, type: WidthType.DXA },
    margins: { top: 70, bottom: 70, left: 120, right: 120 },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
    children: [new Paragraph({ spacing: { after: 0, line: 248 }, children: [t(text, { bold: o.bold, size: 20, color: o.color ?? INK })] })],
  });
  const headRow = new TableRow({ tableHeader: true, children: headers.map((h, i) => mk(h, { w: cols[i], bold: true, color: headTx, fill: headFill })) });
  const bodyRows = rows.map((r) => new TableRow({ children: r.map((c, i) => mk(c, { w: cols[i], bold: i === 0, color: i === 0 ? INK : INK })) }));
  return new Table({
    columnWidths: cols, width: { size: CW, type: WidthType.DXA },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [headRow, ...bodyRows],
  });
}

// ================= BUILD =================
const body = [];

// ---- title block (top of page 1, note-style, no separate cover) ----
body.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [t('Influencer Intel', { bold: true, size: 60 })] }));
body.push(new Paragraph({ spacing: { after: 60 }, children: [t('India-first influencer discovery, built AI-native. Type a campaign brief \u2014 or just an everyday plain-English prompt \u2014 and get ranked, real creators with live profile data, ready to reach out to.', { italics: true, size: 24, color: SLATE })] }));
body.push(new Paragraph({ spacing: { after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '333333' } }, children: [t('', { size: 2 })] }));
body.push(P([t('Alevia Bandyopadhyay', { size: 22 })], { after: 60 }));

// ---- 1. Executive Summary ----
body.push(H1('1. Executive Summary'));
body.push(lead('The one-line.', 'A search engine for creators. You type in plain English \u2014 a full campaign brief (\u201Cbeauty creators in Mumbai under 100k for a Durga Puja shoot\u201D) or just a quick everyday prompt (\u201Cfood vloggers in Kolkata\u201D) \u2014 and the platform returns ranked, real influencers with live profile data, ready to reach out to. No filters to fight, no lists to buy.'));
body.push(lead('Why it exists.', 'Influencer marketing in India runs on gut feel, WhatsApp forwards and agency spreadsheets. Influencer Intel replaces that with an AI-native discovery engine tuned for India \u2014 regional languages, festival campaigns, and the long tail of creators that global tools simply don\u2019t index.'));
body.push(lead('Why it compounds.', 'Every search is stored and re-ranked, so the underlying database grows on its own with each brief a user runs. The more it\u2019s used, the more defensible it becomes.'));
body.push(label('Headline numbers'));
body.push(metricBand);
body.push(new Paragraph({ spacing: { after: 60 }, children: [t('', { size: 2 })] }));

// ---- 2. Why It Matters ----
body.push(H1('2. Why It Matters'));
body.push(lead('A booming market.', 'Creator spend in India is scaling fast \u2014 but discovery is still manual, slow, and biased toward whoever an agency already knows.'));
body.push(lead('Global tools miss India.', 'They are built US-first. Vernacular creators, regional stars and festival-driven campaigns \u2014 exactly where Indian brand spend is going \u2014 fall through the cracks.'));
body.push(lead('Brands overpay for stale data.', 'Bought lists and spreadsheets still can\u2019t answer the one question that matters: who actually fits this campaign, right now?'));
body.push(lead('We answer in seconds.', 'Live data, ranked for India, getting sharper every time someone searches.'));

// ---- 3. What the Platform Does ----
body.push(H1('3. What the Platform Does'));
body.push(P([t('Everything below is live today \u2014 the working feature set, not a roadmap.', { bold: true, color: SLATE })], { after: 140 }));

body.push(label('Find & vet creators'));
body.push(refTable([2900, 6126], ['Feature', 'What it does'], [
  ['Influencer search', 'Type a brief or a quick prompt in plain English. The AI reads intent \u2014 niche, city, follower range, platform \u2014 and returns matching creators. No filter grids.'],
  ['@handle lookup', 'Paste any Instagram handle and pull a full, live profile snapshot on demand \u2014 vet a specific creator instantly.'],
  ['Influencer database', 'A private, self-growing library of every creator the platform has seen \u2014 searchable, filterable, and yours.'],
  ['Authenticity score', 'A fake-follower check that flags bought audiences before you spend on them.'],
  ['Engagement-rate calculator', 'Instant ER for any creator, so shortlists are ranked on real reach, not follower vanity.'],
  ['Competitor / brand collaborations', 'See which creators competitor brands are already working with \u2014 mine rivals\u2019 rosters for talent.'],
  ['Saved creators', 'Shortlist and organise creators into lists for a team, a client or a campaign.'],
]));
body.push(new Paragraph({ spacing: { after: 60 }, children: [t('', { size: 2 })] }));

body.push(label('Create & reach out'));
body.push(refTable([2900, 6126], ['Feature', 'What it does'], [
  ['AI content generator', 'Generates campaign content ideas, hooks and post concepts tailored to the brand and creator \u2014 from brief to a running content plan.'],
  ['Reply assistant', 'Drafts and suggests replies to creator conversations, so outreach and negotiation stay fast and on-brand.'],
  ['Comment-to-DM', 'Turns comments on a post into direct-message conversations automatically \u2014 capture interested creators and fans at scale.'],
  ['Outreach drafts', 'A first-pass outreach message per creator, so you go from shortlist to first contact without leaving the tool.'],
]));
body.push(new Paragraph({ spacing: { after: 60 }, children: [t('', { size: 2 })] }));

body.push(label('Run the campaign'));
body.push(refTable([2900, 6126], ['Feature', 'What it does'], [
  ['Campaign management', 'Plan and run campaigns end to end \u2014 recruits, briefs, deliverables and status in one place.'],
  ['Campaign analytics', 'Track performance across creators and campaigns \u2014 reach, engagement and outcomes, not guesswork.'],
  ['Media management', 'Collect, review and organise the content creators deliver against each campaign.'],
  ['Influencer payouts', 'Track budgets, spend and creator payments per campaign, so finance and marketing stay in sync.'],
]));
body.push(note('Three discovery engines \u2014 an AI web-search pass, a live public-profile crawl, and the growing internal database \u2014 run in parallel on every brief, then results are merged, de-duplicated and ranked. The user just sees a clean, ranked list.'));

// ---- 3b. How the data is sourced ----
body.push(label('How the data is sourced'));
body.push(lead('Free path first.', 'Live profile data is pulled through the platform\u2019s own crawler \u2014 a relay with a rotating pool of accounts and cookies. When it works, it works at zero marginal cost.'));
body.push(lead('Apify as a pay-per-use fallback.', 'When Instagram blocks a request (a 401, 403 or rate-limit), that specific profile automatically re-routes through Apify, a paid scraping service billed per profile \u2014 roughly a few cents each. No block means no bill, so cost scales with how often we\u2019re blocked, not with how much we search.'));
body.push(lead('Same answer either way.', 'The engagement and ranking math is identical whichever path returns the data \u2014 the fallback is invisible to the user and only ever makes coverage more reliable.'));

// ---- 4. Three Logins, One Platform ----
body.push(H1('4. Three Logins, One Platform'));
body.push(lead('One platform, three doors.', 'The same system serves three kinds of users, each with its own login and its own view \u2014 brands, creators, and the operator.'));
body.push(refTable([2400, 6626], ['Login', 'Who it\u2019s for and what they get'], [
  ['Brand / agency', 'The marketing team. Email-and-password login into the full discovery, outreach and campaign toolset described above.'],
  ['Influencer / creator', 'The creators themselves. A passwordless login (connect Instagram) into their own portal \u2014 the side we\u2019re about to build out with performance prediction.'],
  ['Super admin', 'The operator. A private control panel that runs the whole platform \u2014 data pipelines, accounts, coverage and analytics (next section).'],
], HDR_TEAL, TEAL_TX));

// ---- 5. The Super Admin Control Panel ----
body.push(H1('5. The Super Admin Control Panel'));
body.push(lead('The cockpit behind the product.', 'A private, admin-only panel gives the operator full visibility and control over the engine that powers every search. Seven screens:'));
body.push(refTable([2200, 6826], ['Screen', 'What it shows and controls'], [
  ['Dashboard', 'The at-a-glance state of the platform \u2014 database size, scrapes in the last 24h, agency searches, accounts in rotation and job-queue depth.'],
  ['Scraper', 'The live crawl \u2014 recent scrapes, health and cooling of each account, and pipeline status (healthy, rate-limited, cookie-dead or relay-down), so issues are caught before they hit users.'],
  ['Metrics', 'Deep operational telemetry \u2014 worker heartbeat, crawl-queue detail, hourly throughput, 7-day search trends, daily active users and logins, creator growth, and job success/fail rates.'],
  ['Coverage', 'A niche \u00D7 city heat-map of where the database is strong and where it\u2019s thin \u2014 so seeding effort goes exactly where the gaps are.'],
  ['Campaigns', 'Per-brand campaign oversight \u2014 recruits, budget, spend and performance across the platform.'],
  ['Analytics', 'System-wide KPIs, including prediction accuracy as the creator portal comes online.'],
  ['Agency', 'The brand-side audit \u2014 signups, logins and account activity.'],
], HDR_MAUVE, MAUVE_TX));

// ---- 6. Comparison ----
body.push(H1('6. Influencer Intel vs. Impact.com'));
body.push(lead('The opening.', 'Impact.com is a strong, mature global platform \u2014 built around partner networks, contracts and sales-conversion tracking for US and international brands. It is not built for how India discovers creators. That gap is our opening.'));
body.push(refTable([2400, 3313, 3313], ['Capability', 'Impact.com', 'Influencer Intel'], [
  ['India creator depth', 'US / global-first; thin India coverage', 'India-first; vernacular, regional and festival creators'],
  ['How you search', 'Filters, forms and vetted marketplace lists', 'Plain-English brief \u2014 AI reads intent'],
  ['Data freshness', 'Marketplace + partner-reported metrics', 'Live public-profile snapshots on demand'],
  ['Campaign fit', 'Generic tags and categories', 'Campaign mode: proven-collaborator ranking, festival-aware'],
  ['Name collisions', 'Not addressed', 'Guarded (a festival vs. a person of the same name)'],
  ['Data asset', 'Static partner network', 'Self-growing database \u2014 every search enriches it'],
  ['Setup', 'Contracts, enrolment, integration', 'Type a brief, get creators in seconds'],
]));
body.push(note('The short version: Impact.com is where a global brand runs a formal partner program. Influencer Intel is where an Indian brand finds the right creator for a specific campaign \u2014 faster, live, and deep in exactly the market Impact under-serves.'));

// ---- 7. About to Build ----
body.push(H1('7. About to Build: The Influencer Portal'));
body.push(lead('The next build opens the other side of the market.', 'Today the platform serves brands. Next, it opens to the creators themselves.'));
body.push(lead('Creators log in \u2014 and see their future.', 'An influencer connects their account and the platform predicts how their next reel or post will perform before they publish it \u2014 expected reach, likes and engagement, based on their own history and what\u2019s working in their niche right now.'));
body.push(label('What a creator gets', TEAL_TX));
body.push(refTable([2900, 6126], ['Feature', 'What it does'], [
  ['Performance prediction', 'Forecast reach and engagement for a planned reel or post \u2014 so creators post what will land, not what they hope will.'],
  ['Best-time & format guidance', 'When to post and which format (reel, carousel, static) is likely to perform for their specific audience.'],
  ['Brand-fit signals', 'Which brands and campaigns they\u2019re a strong match for \u2014 feeding directly back into brand-side discovery.'],
  ['Growth tracking', 'A running view of what\u2019s working, so creators see the effect of following the guidance.'],
], HDR_TEAL, TEAL_TX));
body.push(new Paragraph({ spacing: { after: 60 }, children: [t('', { size: 2 })] }));
body.push(lead('Why this is the real unlock.', 'The moment creators log in for predictions, they hand us first-party performance data no scraper can get. That sharpens the brand-side predictions, pulls both sides of the market onto one platform, and turns a discovery tool into a two-sided network \u2014 the flywheel that compounds.'));

// ---- 8. Where This Goes ----
body.push(H1('8. Where This Goes'));
body.push(refTable([2100, 6926], ['Horizon', 'What it is'], [
  ['Today', 'A working, India-first discovery engine brands can use now.'],
  ['Next', 'The creator portal with performance prediction \u2014 a two-sided network with a proprietary data flywheel.'],
  ['The moat', 'Every search and every creator login makes the data \u2014 and the predictions \u2014 better. That advantage compounds and is hard to copy.'],
], HDR_MAUVE, MAUVE_TX));

// ---- header / footer ----
const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [t('1 Aug 2026   \u00B7   Influencer Intel', { size: 17, color: MUTE })] })] });
const footer = new Footer({ children: [new Paragraph({
  spacing: { before: 0, after: 0 },
  tabStops: [{ type: TabStopType.RIGHT, position: CW }],
  children: [t('Proprietary & Confidential  \u00B7  Influencer Intel  \u00B7  Prepared for leadership & investment review', { size: 16, color: MUTE }), new TextRun({ text: '\tPage ', font: FONT, size: 16, color: MUTE }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: MUTE })],
})] });

const doc = new Document({
  creator: 'Influencer Intel',
  title: 'Influencer Intel \u2014 Leadership & Investor Note',
  styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } },
    headers: { default: header },
    footers: { default: footer },
    children: body,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = '/Users/aleviabandyopadhyay/Downloads/influencer-intel/docs/Influencer-Intel-Leadership-Brief.docx';
  fs.writeFileSync(out, buf);
  console.log('WROTE ' + out);
});
