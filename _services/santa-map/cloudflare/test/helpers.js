// Test harness: the real wrangler.toml run by Wrangler's createTestHarness in the same
// workerd runtime as `wrangler dev`, with a local D1 database migrated by Wrangler from
// ../migrations. The Census Geocoder is replaced by a local server with saved answers
// (2026-11-07), so nothing touches the network.

import { createTestHarness } from 'wrangler';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const TOKEN = 'editor-test-token-' + 'x'.repeat(30);
export const ORIGIN = 'https://monroestreettattler.com';
export const IP = '203.0.113.7';
export const SALT = 'test-salt-0123456789';

export const MONROE_2500 = { address: '2500 MONROE ST, MADISON, WI, 53711', lat: 43.05828, lon: -89.42737 };
export const MONROE_2100 = { address: '2100 MONROE ST, MADISON, WI, 53711', lat: 43.06283, lon: -89.42039 };
export const NAKOMA_3700 = { address: '3700 NAKOMA RD, MADISON, WI, 53711', lat: 43.05018, lon: -89.43718 };
const CAPITOL = { address: '2 E MAIN ST, MADISON, WI, 53703', lat: 43.07399602785, lon: -89.383108835932 };
const MIDVALE = { address: '702 N MIDVALE BLVD, MADISON, WI, 53705', lat: 43.074197245146, lon: -89.451204475224 };

// Keyed by the query the Worker sends, lower-cased (as in the Python fixture geocoder).
const ANSWERS = {
  '2500 monroe st, madison, wi': [MONROE_2500],
  '2500 monroe st, madison, wi, 53711': [MONROE_2500],
  '2100 monroe st, madison, wi': [MONROE_2100],
  '3700 nakoma rd, madison, wi': [NAKOMA_3700],
  '2 e main st, madison, wi': [CAPITOL],
  '702 n midvale blvd, madison, wi': [MIDVALE],
  'monroe st, madison, wi': [MONROE_2500, MONROE_2100],
};

export const key = () => randomUUID();

// A stand-in for the Census Geocoder, answering in its JSON shape.
export class Geocoder {
  constructor(answers = ANSWERS) {
    this.answers = answers;
    this.calls = 0;
    this.down = false;
    this.held = 0;
    this.waiting = [];
  }

  // The next n lookups wait for release(), one release per lookup, in arrival order.
  hold(n = 1) {
    this.held += n;
  }

  async arrived(n) {
    while (this.waiting.length < n) await new Promise((r) => setTimeout(r, 10));
  }

  release() {
    this.waiting.shift()();
  }

  async start() {
    this.server = createServer(async (req, res) => {
      this.calls++;
      if (this.held > 0) {
        this.held--;
        await new Promise((resolve) => this.waiting.push(resolve));
      }
      if (this.down) {
        res.writeHead(503).end('switched off');
        return;
      }
      const query = new URL(req.url, 'http://x').searchParams.get('address').toLowerCase();
      const matches = (this.answers[query] || []).map((m) => ({ matchedAddress: m.address, coordinates: { x: m.lon, y: m.lat } }));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ result: { addressMatches: matches } }));
    });
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${this.server.address().port}/geocoder/locations/onelineaddress`;
  }

  stop() {
    this.server.closeAllConnections();
    return new Promise((r) => this.server.close(r));
  }
}

export async function start({ season = '2026', token = TOKEN, vars = {}, geocoder = new Geocoder() } = {}) {
  const geocoderUrl = await geocoder.start();
  const options = (over = {}) => {
    const t = 'token' in over ? over.token : token;
    return {
      root: ROOT,
      workers: [{
        configPath: './wrangler.toml',
        // Set explicitly, so a developer's .dev.vars (which Wrangler also reads) never leaks in.
        vars: { SANTA_SEASON: over.season || season, SANTA_ALLOWED_ORIGINS: ORIGIN, SANTA_GEOCODER_URL: geocoderUrl,
          SANTA_METRICS: 'on', ...vars, ...over.vars },
        secrets: { SANTA_CLIENT_SALT: SALT, SANTA_ADMIN_TOKEN: t === null ? '' : t },
      }],
    };
  };
  const server = createTestHarness(options());
  await server.listen();
  await server.getWorker().applyD1Migrations('DB');
  const w = {
    server, geocoder, ip: IP,
    async env() {
      return server.getWorker().getEnv();
    },
    // Reload the Worker with new settings; the database is kept (a restart or redeploy).
    async restart(over = {}) {
      await server.update(options(over));
    },
    async call(method, path, body, { headers = {}, raw, ip } = {}) {
      const init = { method, headers: { 'CF-Connecting-IP': ip || w.ip, ...headers } };
      if (raw !== undefined) { init.body = raw; init.headers['Content-Type'] = 'application/json'; }
      else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
      const res = await server.fetch('https://santa-api.test' + path, init);
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers, d1: parseMetrics(res.headers.get('X-Santa-D1')) };
    },
    matching(address = '2500 Monroe St', quantity = 1, { k, ip, ...extra } = {}) {
      return w.call('POST', '/api/sightings', { category: 'matching', address, confirm_match: true, quantity, idempotency_key: k || key(), ...extra }, { ip });
    },
    other(address = '2500 Monroe St', description = 'Waving Santa with a sack', { k } = {}) {
      return w.call('POST', '/api/sightings', { category: 'other', address, description, idempotency_key: k || key() });
    },
    async totals() {
      return (await w.call('GET', '/api/santas')).body.totals;
    },
    admin(method, path, body, token = TOKEN) {
      return w.call(method, path, body, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    },
    async rows(sql, ...params) {
      return (await (await w.env()).DB.prepare(sql).bind(...params).all()).results;
    },
    async scalar(sql, ...params) {
      return Object.values((await w.rows(sql, ...params))[0])[0];
    },
    async close() {
      await server.close();
      await geocoder.stop();
    },
  };
  return w;
}

function parseMetrics(header) {
  if (!header) return null;
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).map(([k, v]) => [k, Number(v)]));
}
