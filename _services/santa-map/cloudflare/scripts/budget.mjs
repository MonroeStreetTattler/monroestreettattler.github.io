// D1 and CPU budget check: seeds a scratch local D1 with 500 visible displays (made-up,
// test-only, never deployed), then measures what each kind of request costs and
// estimates a busy day against the Workers Free and D1 Free daily allowances.
//
//   npm run budget
//
// D1 counts come from D1's own per-query metadata. CPU is timed in Node on this computer
// for the Worker's own JavaScript (D1 and network waits do not count as Worker CPU);
// it is an estimate, not a Cloudflare measurement.

import { start, key } from '../test/helpers.js';
import { performance } from 'node:perf_hooks';
import { contains } from '../src/geo.js';
import { publicDisplay } from '../src/store.js';

const DISPLAYS = 500;
const w = await start();
const db = (await w.env()).DB;

// Spread made-up displays along the area so they pass the same rules as real ones.
const rows = [];
for (let i = 0; i < DISPLAYS; i++) {
  const lat = 43.045 + (i % 50) * 0.0005, lon = -89.445 + Math.floor(i / 50) * 0.003;
  const category = i % 5 === 0 ? 'other' : 'matching';
  rows.push(db.prepare('INSERT INTO displays (public_id, season, category, property_key, address, lat, lon, quantity, description, ' +
    "first_reported_on, last_reported_on, created_at, updated_at) VALUES (?, 2026, ?, ?, ?, ?, ?, 1, ?, '2026-11-28', '2026-12-01', 'x', 'x')")
    .bind('seed' + i, category, `${1000 + i} TEST ST`, `${1000 + i} TEST ST, MADISON, WI, 53711`, lat, lon,
      category === 'other' ? 'Made-up test Santa' : null));
}
await db.batch(rows);
await db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'snapshot_version'").run();

const cost = {};
const measure = async (name, fn) => {
  const r = await fn();
  cost[name] = { status: r.status, ...r.d1 };
};
await measure('GET /api/santas, rebuilt (first poll after a change)', () => w.call('GET', '/api/santas'));
await measure('GET /api/santas, unchanged (routine poll)', () => w.call('GET', '/api/santas'));
await w.restart();
await measure('GET /api/santas, another instance (stored snapshot)', () => w.call('GET', '/api/santas'));
await measure('GET /api/area', () => w.call('GET', '/api/area'));
await measure('POST /api/preview, new address', () => w.call('POST', '/api/preview', { address: '2500 Monroe St' }));
await measure('POST /api/preview, cached address', () => w.call('POST', '/api/preview', { address: '2500 Monroe St' }));
await measure('POST /api/sightings, new display', () => w.matching('2500 Monroe St'));
await measure('POST /api/sightings, confirmation', () => w.matching('2500 Monroe St'));
const k = key();
await w.other('3700 Nakoma Rd', 'Test', { k });
await measure('POST /api/sightings, retry', () => w.other('3700 Nakoma Rd', 'Test', { k }));
await measure('POST /api/corrections', () => w.call('POST', '/api/corrections', { display_id: 'seed1', kind: 'removed' }));
await measure('POST /api/admin/displays (editor hide)', () => w.admin('POST', '/api/admin/displays/seed2', { status: 'hidden' }));
const snapshotBytes = (await w.call('GET', '/api/santas')).headers.get('content-length')
  || JSON.stringify((await w.call('GET', '/api/santas')).body).length;
await w.close();

// CPU of the Worker's own work for the heaviest requests, timed in Node (same V8 engine).
const all = JSON.parse(JSON.stringify(rows.map((_, i) => ({ public_id: 'seed' + i, category: 'matching', address: `${1000 + i} TEST ST, MADISON, WI, 53711`,
  lat: 43.05, lon: -89.43, quantity: 1, description: null, first_reported_on: '2026-11-28', last_reported_on: '2026-12-01', status: 'visible' }))));
const time = (fn, n = 200) => {
  for (let i = 0; i < 20; i++) fn();
  const t = performance.now();
  for (let i = 0; i < n; i++) fn();
  return (performance.now() - t) / n;
};
const cpu = {
  'snapshot rebuild: 500 rows to JSON (ms)': time(() => JSON.stringify({ displays: all.map(publicDisplay) })),
  'in-area check, one address (ms)': time(() => contains(43.05828, -89.42737), 5000),
  'area JSON (ms)': time(async () => JSON.stringify((await import('../src/geo.js')).AREA)),
};

// A busy day, as in the hosting assessment: 5,000 visits, each open 10 minutes
// (area + snapshot at load, then one poll a minute), 300 previews, 200 saves and
// 30 corrections, and an editor change every hour.
const visits = 5000, polls = 10, changes = 200 + 24;
const perDay = {
  requests: visits * (2 + polls) + 300 + 200 + 30 + 24,
  // After each change one instance rebuilds and stores the snapshot; every other instance
  // reads the stored one. Assume 20 instances.
  rows_read: visits * polls * cost['GET /api/santas, unchanged (routine poll)'].rows_read
    + changes * cost['GET /api/santas, rebuilt (first poll after a change)'].rows_read
    + changes * 19 * cost['GET /api/santas, another instance (stored snapshot)'].rows_read
    + 200 * cost['POST /api/sightings, new display'].rows_read + 300 * cost['POST /api/preview, new address'].rows_read,
  rows_written: changes * cost['GET /api/santas, rebuilt (first poll after a change)'].rows_written + 200 * cost['POST /api/sightings, new display'].rows_written + 300 * cost['POST /api/preview, new address'].rows_written
    + 30 * cost['POST /api/corrections'].rows_written + 24 * cost['POST /api/admin/displays (editor hide)'].rows_written,
};
const allowance = { requests: 100000, rows_read: 5000000, rows_written: 100000 };

console.log(`\nD1 cost per request with ${DISPLAYS} visible displays (local D1)\n`);
console.log('| Request | Status | Queries | Rows read | Rows written |\n|---|---|---|---|---|');
for (const [name, c] of Object.entries(cost)) console.log(`| ${name} | ${c.status} | ${c.queries} | ${c.rows_read} | ${c.rows_written} |`);
console.log(`\nSnapshot size: ${snapshotBytes} bytes\n`);
console.log('| Worker JavaScript, timed in Node | ms |\n|---|---|');
for (const [name, ms] of Object.entries(cpu)) console.log(`| ${name} | ${ms.toFixed(3)} |`);
console.log('\n| Busy-day estimate | Used | Free allowance | Share |\n|---|---|---|---|');
for (const name of Object.keys(perDay)) {
  console.log(`| ${name} | ${perDay[name].toLocaleString('en-US')} | ${allowance[name].toLocaleString('en-US')} | ${(100 * perDay[name] / allowance[name]).toFixed(0)}% |`);
}
console.log(`\nWithout the version check, the ${(visits * polls).toLocaleString('en-US')} polls alone would read ` +
  `${(visits * polls * cost['GET /api/santas, rebuilt (first poll after a change)'].rows_read).toLocaleString('en-US')} rows.`);
process.exit(0);
