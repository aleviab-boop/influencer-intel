// Minimal static server for the leadership-brief preview (Claude Preview target)
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PORT = 4599;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(DIR, p);
  if (!file.startsWith(DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' };
    if (ext === '.docx') headers['content-disposition'] = 'attachment; filename="Influencer-Intel-Leadership-Brief.docx"';
    res.writeHead(200, headers);
    res.end(buf);
  });
}).listen(PORT, () => console.log('preview server on http://localhost:' + PORT));
