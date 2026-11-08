// Local review only: serves the website from the repository root and passes /api/* to
// `wrangler dev` (npm run dev, port 8788), so santa-map.html, whose santa-map-api meta tag
// is "/api", talks to the local Worker and D1 exactly as it will to the hosted API.
// Folders starting with _ or . are never served. Never use this in production.
//
//   npm run dev        (in one terminal)
//   npm run review     then open http://127.0.0.1:8789/santa-map.html

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = normalize(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'));
const PORT = Number(process.env.REVIEW_PORT || 8789);
const API = process.env.REVIEW_API || 'http://127.0.0.1:8788';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.xml': 'application/xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    delete headers.host;
    headers['cf-connecting-ip'] = req.socket.remoteAddress;
    try {
      const up = await fetch(API + url.pathname + url.search, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      res.writeHead(up.status, Object.fromEntries([...up.headers].filter(([k]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(k))));
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch {
      res.writeHead(502).end('local Worker not running');
    }
    return;
  }
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const full = normalize(join(SITE, rel));
  if (rel.split('/').some((p) => p.startsWith('_') || p.startsWith('.')) || !full.startsWith(SITE + sep)) return res.writeHead(404).end();
  try {
    if (!(await stat(full)).isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': TYPES[extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(full));
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`review: http://127.0.0.1:${PORT}/santa-map.html (API ${API})`));
