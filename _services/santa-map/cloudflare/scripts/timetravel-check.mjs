// STAGING ONLY. A real D1 Time Travel rollback while the Worker is warm: the hosted map
// must show the restored state at once, and later changes must show too. It rolls the
// staging database back, so it discards whatever staging saved during the check.
//
//   SANTA_ADMIN_TOKEN="$(security find-generic-password -a santa-map-api-staging-2026 -s 'Santa map editor token' -w)" \
//     node scripts/timetravel-check.mjs --api https://santa-map-api-staging-2026.monroestreettattler.workers.dev -c wrangler.staging.toml
//
// It refuses any config whose database name does not contain "staging".

import { randomUUID } from 'node:crypto';
import { databaseName, wrangler } from './backup-check.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const API = (args[args.indexOf('--api') + 1] || '').replace(/\/$/, '');
const config = args.includes('-c') ? args[args.indexOf('-c') + 1] : null;
const TOKEN = process.env.SANTA_ADMIN_TOKEN;
if (!API.startsWith('https://') || !config || !TOKEN) {
  console.error('usage: SANTA_ADMIN_TOKEN=… node scripts/timetravel-check.mjs --api https://<staging host> -c <staging config>');
  process.exit(2);
}
const database = databaseName(ROOT, config);
if (!database.includes('staging')) {
  console.error(`Refusing: ${database} is not a staging database.`);
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
async function get() {
  const res = await fetch(API + '/api/santas');
  return { body: await res.text(), d1: res.headers.get('X-Santa-D1'), status: res.status };
}
const post = (path, body, headers = {}) => fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const admin = (id, change) => post(`/api/admin/displays/${id}`, change, { Authorization: 'Bearer ' + TOKEN });
const bookmark = () => JSON.parse(wrangler(ROOT, 'd1', 'time-travel', 'info', database, '-c', config, '--json')).bookmark;

// 1. The state to return to, held warm.
let a = await get();
for (let i = 0; i < 4; i++) a = await get();
const mark = bookmark();
console.log(`before: ${JSON.parse(a.body).displays.length} displays, totals ${JSON.stringify(JSON.parse(a.body).totals)}; poll cost ${a.d1}`);

// 2. Changes that will be rolled back, and a warm instance that has seen them.
const saved = await post('/api/sightings', { category: 'other', address: '2100 Monroe St', description: 'Time Travel test Santa', idempotency_key: randomUUID() });
const firstId = JSON.parse(a.body).displays[0]?.id;
if (firstId) await admin(firstId, { quantity: 7 });
let b;
for (let i = 0; i < 4; i++) b = await get();
check('the changes show before the rollback', b.body !== a.body && saved.status < 300, `poll cost ${b.d1}`);

// 3. Roll back with Time Travel while the Worker stays warm.
const restore = wrangler(ROOT, 'd1', 'time-travel', 'restore', database, '-c', config, '--bookmark', mark, '--json');
console.log('restored to bookmark', mark, JSON.parse(restore).bookmark ? '(an undo bookmark was created)' : '');
const c = await get();
check('the very next read is the restored map', c.body === a.body, `cost ${c.d1}`);
const c2 = await get();
check('and polling is cheap again', /queries=1; rows_read=1;/.test(c2.d1 || ''), c2.d1);

// 4. A change after the rollback shows at once.
if (firstId) await admin(firstId, { quantity: 2 });
const d = await get();
const shown = JSON.parse(d.body).displays.find((x) => x.id === firstId);
check('a change after the rollback shows at once', !firstId || shown?.quantity === 2, `cost ${d.d1}`);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
