// Integration checks against a hosted Santa map API over HTTPS. The full run saves and
// edits test sightings, so it is for staging only. --read-only (safe for production) does
// the public reads, CORS, editor refusals and the edge check, and writes nothing.
// The editor token is read from SANTA_ADMIN_TOKEN.
//
//   SANTA_ADMIN_TOKEN="$(security find-generic-password -a santa-map-api-staging-2026 -s 'Santa map editor token' -w)" \
//     node scripts/hosted-check.mjs --api https://santa-map-api-staging-2026.monroestreettattler.workers.dev
//
// Prints PASS/FAIL per check and the D1 cost of each kind of request (from the
// X-Santa-D1 header that staging sets). Never prints the token.

import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const API = (args[args.indexOf('--api') + 1] || '').replace(/\/$/, '');
const TOKEN = process.env.SANTA_ADMIN_TOKEN;
const ONLY_IDENTITY = args.includes('--only-identity');   // rerun just the last section
const READ_ONLY = args.includes('--read-only');            // production: no saves, edits or lookups
const SITE = 'https://monroestreettattler.com';
if (!API.startsWith('https://') || !TOKEN) {
  console.error('usage: SANTA_ADMIN_TOKEN=… node scripts/hosted-check.mjs --api https://<staging host>');
  process.exit(2);
}

const results = [];
const costs = {};
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function call(method, path, body, { headers = {}, signal } = {}) {
  const init = { method, headers: { ...headers }, signal };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(API + path, init);
  const text = await res.text();
  const d1 = res.headers.get('X-Santa-D1');
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers, d1 };
}
const cost = (label, r) => { if (r.d1 && !costs[label]) costs[label] = r.d1; };
const admin = (method, path, body, token = TOKEN) => call(method, path, body, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
const save = (body) => call('POST', '/api/sightings', { idempotency_key: randomUUID(), ...body });
const matching = (address, quantity = 1, k) => save({ category: 'matching', address, confirm_match: true, quantity, ...(k ? { idempotency_key: k } : {}) });
const snapshot = async () => (await call('GET', '/api/santas')).body;

let r, snap;
if (READ_ONLY) {
  r = await call('GET', '/api/santas');
  check('production adds no D1 cost header', r.headers.get('x-santa-d1') === null);
}
if (!ONLY_IDENTITY) {
// ------------------------------------------------------------------ public reads
r = await call('GET', '/api/area');
check('area answers over HTTPS', r.status === 200 && r.body.rings?.length > 0 && r.body.season === 2026);
cost('GET /api/area', r);
r = await call('GET', '/api/santas');
check('snapshot answers with only public fields', r.status === 200 && JSON.stringify(Object.keys(r.body).sort()) === '["displays","last_report_on","season","totals"]');
cost('GET /api/santas (first)', r);
r = await call('GET', '/api/santas');
cost('GET /api/santas (unchanged poll)', r);
check('no-store and nosniff headers', r.headers.get('cache-control') === 'no-store' && r.headers.get('x-content-type-options') === 'nosniff');

// ------------------------------------------------------------------ CORS and editor
r = await call('GET', '/api/santas', undefined, { headers: { Origin: SITE } });
check('CORS allows the canonical site', r.headers.get('access-control-allow-origin') === SITE);
r = await call('GET', '/api/santas', undefined, { headers: { Origin: 'https://example.com' } });
check('CORS refuses other sites', r.headers.get('access-control-allow-origin') === null);
r = await call('OPTIONS', '/api/sightings', undefined, { headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
check('preflight for the site', r.status === 204 && r.headers.get('access-control-allow-origin') === SITE);
r = await call('OPTIONS', '/api/admin/export', undefined, { headers: { Origin: SITE } });
check('no preflight for the editor API', r.status === 403);
r = await admin('GET', '/api/admin/export', undefined, null);
check('anonymous editor request refused', r.status === 401);
r = await admin('GET', '/api/admin/export', undefined, 'not-the-token');
check('wrong editor token refused', r.status === 401);
r = await call('GET', '/_workflow/CURRENT-TASK.md');
check('no files served', r.status === 404);

}
if (!ONLY_IDENTITY && !READ_ONLY) {
// ------------------------------------------------------------------ saves
r = await matching('2500 Monroe St', 1);
cost('POST /api/sightings (new display)', r);
check('matching Santa saved', [200, 201].includes(r.status) && r.body.display?.category === 'matching', `${r.status} ${r.body.outcome}`);
const matchId = r.body.display?.id;
snap = await snapshot();
check('the map shows it straight away', snap.displays.some((d) => d.id === matchId));
r = await save({ category: 'other', address: '3700 Nakoma Rd', description: 'Staging test Santa' });
check('other Santa saved', [200, 201].includes(r.status) && r.body.display?.category === 'other', `${r.status} ${r.body.outcome}`);
const otherId = r.body.display?.id;

// Duplicate race: 4 keys and one key sent twice, all at once, for one new address.
const shared = randomUUID();
const race = await Promise.all([1, 2, 3, 4].map(() => matching('2100 Monroe St', 1)).concat([matching('2100 Monroe St', 1, shared), matching('2100 Monroe St', 1, shared)]));
const firsts = race.filter((x) => x.body.outcome === 'created' && !x.body.repeat).length;
check('simultaneous saves make one display', race.every((x) => [200, 201].includes(x.status)) && firsts <= 1,
  race.map((x) => `${x.status}/${x.body.outcome}${x.body.repeat ? '/repeat' : ''}`).join(' '));
snap = await snapshot();
check('one display at that address', snap.displays.filter((d) => d.address.startsWith('2100 MONROE ST') && d.category === 'matching').length === 1);
cost('POST /api/sightings (confirmation)', race.find((x) => x.body.outcome === 'confirmed') || race[0]);

// A save whose reply is lost to a timeout, then retried with the same key.
const lost = randomUUID();
const ctrl = new AbortController();
const pending = call('POST', '/api/sightings', { category: 'matching', address: '2500 Monroe St', confirm_match: true, quantity: 1, idempotency_key: lost },
  { signal: ctrl.signal }).then(() => 'answered', () => 'reply lost');
setTimeout(() => ctrl.abort(), 30);
const firstTry = await pending;
r = await matching('2500 Monroe St', 1, lost);
cost('POST /api/sightings (retry)', r);
let exported = (await admin('GET', '/api/admin/export')).body;
check('retry after a lost reply is saved once', exported.submissions.filter((s) => s.idempotency_key === lost).length === 1, `first try: ${firstTry}; retry ${r.status} repeat=${!!r.body.repeat}`);

// ------------------------------------------------------------------ editor
r = await admin('POST', `/api/admin/displays/${matchId}`, { quantity: 3 });
cost('POST /api/admin/displays (edit)', r);
snap = await snapshot();
check('editor edit shows straight away', r.status === 200 && snap.displays.find((d) => d.id === matchId)?.quantity === 3);
r = await admin('POST', `/api/admin/displays/${otherId}`, { status: 'hidden' });
snap = await snapshot();
check('editor hide removes it from the map', r.status === 200 && !snap.displays.some((d) => d.id === otherId));
r = await admin('POST', `/api/admin/displays/${otherId}`, { status: 'visible' });
snap = await snapshot();
check('editor show brings it back', r.status === 200 && snap.displays.some((d) => d.id === otherId));
r = await admin('POST', `/api/admin/displays/${matchId}`, { status: 'hidden' });
const replay = await matching('2500 Monroe St', 1, lost);
check('a retry after a hide says it is not on the map', replay.body.display === null && /isn’t on the map/.test(replay.body.message));
await admin('POST', `/api/admin/displays/${matchId}`, { status: 'visible' });
snap = await snapshot();
check('totals agree with the displays',
  ['matching', 'other'].every((c) => snap.totals[c] === snap.displays.filter((d) => d.category === c).reduce((n, d) => n + d.quantity, 0)),
  JSON.stringify(snap.totals));
}

// ------------------------------------------------------------------ client identity
// The Worker trusts only CF-Connecting-IP, which Cloudflare's edge sets. A client that sends
// its own is refused by the edge before the Worker runs.
const forged = await fetch(API + '/api/santas', { headers: { 'CF-Connecting-IP': '198.51.100.7' } });
check('Cloudflare refuses a client-supplied CF-Connecting-IP', forged.status === 403 && !forged.headers.get('x-santa-d1'),
  `${forged.status} ${forged.headers.get('content-type')}`);
if (!READ_ONLY) {
// Other client-address headers reach the Worker but are ignored: previews of a cached
// address (30 per 10 minutes) each claiming a different address still hit the limit.
const spoof = () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
  return { 'X-Forwarded-For': ip, 'X-Real-IP': ip, 'True-Client-IP': ip, Forwarded: `for=${ip}` };
};
let first429 = 0;
for (let i = 1; i <= 35 && !first429; i++) {
  const p = await call('POST', '/api/preview', { address: '2500 Monroe St' }, { headers: spoof() });
  if (i === 1) cost('POST /api/preview (cached address)', p);
  if (p.status === 429) first429 = i;
}
const after = await Promise.all([1, 2, 3].map(() => call('POST', '/api/preview', { address: '2500 Monroe St' }, { headers: spoof() })));
check('client address headers cannot dodge the rate limit', first429 > 0 && first429 <= 31 && after.every((p) => p.status === 429),
  `limited at request ${first429}`);
}

console.log('\nD1 cost per request (queries; rows read; rows written):');
for (const [label, c] of Object.entries(costs)) console.log(`  ${label}: ${c}`);
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
