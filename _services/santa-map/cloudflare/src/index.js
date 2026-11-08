/* Santa map API on Cloudflare Workers + D1. Same contract as ../../santa_map/app.py.

Public:  GET  /api/santas        current season's visible displays and totals
         GET  /api/area          coverage area (bounds and outline), prebuilt
         POST /api/preview       look up an address and check the area (nothing saved)
         POST /api/sightings     save a sighting (idempotent by idempotency_key)
         POST /api/corrections   ask an editor to correct or remove a display
Editor (Authorization: Bearer <SANTA_ADMIN_TOKEN>; never sent to browsers, no CORS):
         GET  /api/admin/corrections[?status=open|resolved|dismissed]
         POST /api/admin/displays/<id>        edit or hide/show a display
         POST /api/admin/corrections/<id>     resolve or dismiss a request
         GET  /api/admin/export               everything, for backup

Settings: SANTA_SEASON, SANTA_ALLOWED_ORIGINS and SANTA_GEOCODER_DAILY are plain vars;
SANTA_CLIENT_SALT and SANTA_ADMIN_TOKEN are secrets. SANTA_GEOCODER_URL and SANTA_METRICS
are for local tests only and are never set in wrangler.toml. The client address comes only from
CF-Connecting-IP, which Cloudflare sets itself. Nothing here logs request bodies or tokens. */

import { Db, Problem, Store, Unavailable } from './store.js';

const MAX_BODY = 4096;
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
};
const PUBLIC_PATHS = ['/api/santas', '/api/area', '/api/preview', '/api/sightings', '/api/corrections'];
const UNAVAILABLE = 'The Santa map isn’t responding right now. Your entry is still here; please try again in a few minutes.';

// Per isolate: the last public snapshot built here, reused while snapshot_version is unchanged.
const memo = {};
let saltKey = null;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin');
    const isAdmin = path.startsWith('/api/admin');
    const allowed = (env.SANTA_ALLOWED_ORIGINS || 'https://monroestreettattler.com').split(',').map((o) => o.trim()).filter(Boolean);
    const cors = origin && allowed.includes(origin) && path.startsWith('/api/') && !isAdmin
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const db = new Db(env.DB);
    let response;
    try {
      if (!path.startsWith('/api/')) throw new Problem(404, 'not_found', 'Not found.');
      if (request.method === 'OPTIONS') {
        if (!cors['Access-Control-Allow-Origin']) throw new Problem(403, 'forbidden', 'Origin not allowed.');
        return new Response(null, { status: 204, headers: { ...cors,
          'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
      }
      const [status, body] = await route(request, env, url, new Store(env, db));
      response = json(status, body, cors);
    } catch (e) {
      if (e instanceof Problem) {
        const extra = 'retry_after' in e.extra ? { 'Retry-After': String(e.extra.retry_after) } : {};
        response = json(e.status, e.body(), { ...cors, ...extra });
      } else if (e instanceof Unavailable) {
        // Includes a used-up daily D1 allowance. Never answered with an empty map.
        console.error('santa-map: database unavailable');
        response = json(503, { error: 'unavailable', message: UNAVAILABLE }, { ...cors, 'Retry-After': '300' });
      } else {
        console.error('santa-map: unexpected error', e && e.name);
        response = json(500, { error: 'server_error', message: 'Something went wrong on our end. Please try again.' }, cors);
      }
    }
    if (env.SANTA_METRICS === 'on') {       // local budget checks only
      const s = db.stats;
      response.headers.set('X-Santa-D1', `queries=${s.queries}; rows_read=${s.rows_read}; rows_written=${s.rows_written}`);
    }
    return response;
  },

  async scheduled(event, env) {
    await new Store(env, new Db(env.DB)).cleanUp();
  },
};

function json(status, body, headers) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { ...JSON_HEADERS, ...headers } });
}

async function route(request, env, url, store) {
  const method = request.method;
  const path = url.pathname;
  // The snapshot and the area need no client key, so a routine poll does no hashing.
  if (method === 'GET' && path === '/api/santas') return [200, await store.snapshot(memo)];
  if (method === 'GET' && path === '/api/area') return [200, store.area()];
  const client = await clientKey(env, request.headers.get('CF-Connecting-IP'));
  if (path === '/api/admin' || path.startsWith('/api/admin/')) return admin(request, env, url, store, client);
  if (method === 'POST' && path === '/api/preview') {
    await store.limit('preview', client);
    const data = await readJson(request);
    return [200, { status: 'ok', place: await store.resolve(isObject(data) ? data.address : undefined) }];
  }
  if (method === 'POST' && path === '/api/sightings') {
    await store.limit('submit', client);
    const result = await store.submit(await readJson(request));
    return [result.repeat || result.outcome !== 'created' ? 200 : 201, result];
  }
  if (method === 'POST' && path === '/api/corrections') {
    await store.limit('correction', client);
    return [202, await store.requestCorrection(await readJson(request))];
  }
  if (PUBLIC_PATHS.includes(path)) throw new Problem(405, 'method_not_allowed', 'Method not allowed.');
  throw new Problem(404, 'not_found', 'Not found.');
}

async function admin(request, env, url, store, client) {
  const token = env.SANTA_ADMIN_TOKEN;
  // The editor API stays off unless a long random token is configured.
  if (!token || token.length < 32) throw new Problem(403, 'forbidden', 'Editor access is not configured.');
  const auth = request.headers.get('Authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!equal(await sha256(given), await sha256(token))) {
    await store.limit('admin_fail', client);
    throw new Problem(401, 'unauthorized', 'Editor token required.');
  }
  const method = request.method;
  const path = url.pathname;
  if (method === 'GET' && path === '/api/admin/corrections') {
    const status = url.searchParams.get('status') || 'open';
    if (!['open', 'resolved', 'dismissed'].includes(status)) throw new Problem(400, 'bad_status', 'status must be open, resolved or dismissed');
    return [200, await store.openCorrections(status)];
  }
  if (method === 'GET' && path === '/api/admin/export') return [200, await store.export()];
  let m = path.match(/^\/api\/admin\/displays\/([A-Za-z0-9_-]{1,40})$/);
  if (method === 'POST' && m) return [200, await store.editDisplay(m[1], await readJson(request))];
  m = path.match(/^\/api\/admin\/corrections\/(\d{1,9})$/);
  if (method === 'POST' && m) return [200, await store.closeCorrection(Number(m[1]), await readJson(request))];
  throw new Problem(404, 'not_found', 'Not found.');
}

async function readJson(request) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  if (type !== 'application/json') throw new Problem(415, 'json_required', 'Send JSON.');
  const tooLarge = new Problem(413, 'too_large', 'That request is too large.');
  const declared = request.headers.get('Content-Length');
  if (declared !== null && !(/^\d+$/.test(declared) && Number(declared) <= MAX_BODY)) throw tooLarge;
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw tooLarge;
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Problem(400, 'bad_json', 'Send valid JSON.');
  }
}

// A keyed hash of the connection address; the address itself is never stored.
async function clientKey(env, ip) {
  const salt = env.SANTA_CLIENT_SALT;
  if (!salt || salt.length < 16) throw new Unavailable('SANTA_CLIENT_SALT is not set');
  if (!saltKey || saltKey.salt !== salt) {
    saltKey = { salt, key: await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) };
  }
  const mac = await crypto.subtle.sign('HMAC', saltKey.key, new TextEncoder().encode(ip || 'unknown'));
  return hex(mac).slice(0, 32);
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function equal(a, b) {
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
