// Convert the leadership brief .docx -> styled standalone HTML for Claude Preview
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');

const SRC = '/Users/aleviabandyopadhyay/Downloads/influencer-intel/docs/Influencer-Intel-Leadership-Brief.docx';
const OUT = path.join(__dirname, 'index.html');

mammoth.convertToHtml({ path: SRC }).then((r) => {
  const body = r.value;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Influencer Intel — Leadership Brief</title>
<style>
  :root{ --accent:#6C4DF6; --ink:#1A1A2E; --mute:#5A5A72; --line:#E3E0F3; --soft:#F5F3FF; }
  *{ box-sizing:border-box; }
  body{ margin:0; background:#ECEAF6; color:var(--ink);
        font-family:'Calibri','Segoe UI',system-ui,-apple-system,sans-serif; line-height:1.55; }
  .page{ max-width:820px; margin:32px auto; background:#fff; padding:64px 72px;
         box-shadow:0 8px 40px rgba(40,30,90,.12); border-radius:6px; }
  h1{ color:var(--accent); font-size:22px; margin:30px 0 10px; }
  h1:first-child{ margin-top:0; }
  h2{ color:var(--ink); font-size:17px; margin:20px 0 8px; }
  p{ font-size:15px; margin:0 0 11px; }
  ul{ margin:0 0 12px; padding-left:22px; }
  li{ font-size:15px; margin:0 0 7px; }
  strong{ color:var(--ink); }
  table{ border-collapse:collapse; width:100%; margin:14px 0; font-size:13.5px; }
  th{ background:var(--accent); color:#fff; text-align:left; padding:9px 12px; font-weight:600; }
  td{ border:1px solid var(--line); padding:9px 12px; vertical-align:top; }
  tr td:first-child{ background:var(--soft); font-weight:600; }
  tr td:last-child{ background:var(--soft); }
  a{ color:var(--accent); }
  .banner{ position:sticky; top:0; z-index:5; background:var(--accent); color:#fff;
           font-size:12.5px; letter-spacing:.03em; padding:8px 16px; text-align:center; }
</style></head>
<body>
  <div class="banner">INFLUENCER INTEL · Leadership &amp; Investor Brief · Confidential</div>
  <div class="page">${body}</div>
</body></html>`;
  fs.writeFileSync(OUT, html);
  console.log('WROTE ' + OUT + (r.messages.length ? '  (mammoth notes: ' + r.messages.length + ')' : ''));
});
