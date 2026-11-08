// Checks specific to the Worker/D1 adaptation: concurrent retries, edits, hides and
// season changes; snapshot freshness after every kind of change; the prebuilt area;
// the daily clean-up; honest failures; and the D1 cost of routine requests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, key, start } from './helpers.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVICE = dirname(ROOT);
const SITE = dirname(dirname(SERVICE));

function scenario(name, fn, opts = {}) {
  test(name, async () => {
    const w = await start(opts);
    try {
      await fn(w);
    } finally {
      await w.close();
    }
  });
}

const snapshot = async (w) => (await w.call('GET', '/api/santas')).body;

// The trigger-kept totals must equal a fresh sum over the displays, for every season.
async function assertTotalsKept(w) {
  const kept = await w.rows('SELECT season, category, quantity FROM season_totals WHERE quantity != 0 ORDER BY season, category');
  const summed = await w.rows("SELECT season, category, SUM(quantity) AS quantity FROM displays WHERE status = 'visible' " +
    'GROUP BY season, category ORDER BY season, category');
  assert.deepEqual(kept, summed);
}

// ------------------------------------------------------------------ concurrency
scenario('concurrent confirmations and an editor quantity change agree with the map', async (w) => {
  const id = (await w.matching('2500 Monroe St', 1)).body.display.id;
  const replies = await Promise.all([
    ...Array.from({ length: 5 }, () => w.matching('2500 Monroe St', 1)),
    w.admin('POST', `/api/admin/displays/${id}`, { quantity: 2 }),
  ]);
  const saves = replies.slice(0, 5).map((r) => r.body);
  for (const s of saves) {
    assert.ok(['confirmed', 'review'].includes(s.outcome), s.outcome);
    assert.equal(s.totals.matching, s.display.quantity, 'each answer’s count matches its own display');
    if (s.outcome === 'review') assert.equal(s.display.quantity, 2);
  }
  const snap = await snapshot(w);
  assert.deepEqual(snap.totals, { matching: 2, other: 0 });
  assert.equal(snap.displays[0].quantity, 2);
  assert.equal(await w.scalar('SELECT COUNT(*) FROM submissions'), 6);
  assert.equal(await w.scalar('SELECT report_count FROM displays'), 6);     // every report counted once
  assert.ok(await w.scalar("SELECT COUNT(*) FROM corrections WHERE kind = 'conflicting_report'") <= 1);
  const audit = await w.rows("SELECT before_json, after_json FROM audit_log WHERE action = 'edit_display'");
  assert.equal(audit.length, 1);
  assert.deepEqual([JSON.parse(audit[0].before_json).quantity, JSON.parse(audit[0].after_json).quantity], [1, 2]);
  await assertTotalsKept(w);
});

scenario('concurrent reports and an editor hide never leave a hidden Santa on the map', async (w) => {
  const id = (await w.matching('2500 Monroe St', 1)).body.display.id;
  const replies = await Promise.all([
    ...Array.from({ length: 5 }, () => w.matching('2500 Monroe St', 1)),
    w.admin('POST', `/api/admin/displays/${id}`, { status: 'hidden' }),
  ]);
  for (const s of replies.slice(0, 5).map((r) => r.body)) {
    if (s.display) assert.deepEqual([s.outcome, s.totals.matching], ['confirmed', 1]);
    else assert.deepEqual([s.outcome, s.totals.matching], ['review', 0]);
  }
  assert.deepEqual(await snapshot(w), { season: 2026, totals: { matching: 0, other: 0 }, last_report_on: null, displays: [] });
  assert.ok(await w.scalar("SELECT COUNT(*) FROM corrections WHERE kind = 'hidden_rereport' AND status = 'open'") <= 1);
  assert.equal(await w.scalar('SELECT COUNT(*) FROM submissions'), 6);
  await assertTotalsKept(w);
});

scenario('a retry storm with one key saves once and answers the same', async (w) => {
  const k = key();
  const replies = (await Promise.all(Array.from({ length: 6 }, () => w.other('3700 Nakoma Rd', 'Santa on a sleigh', { k })))).map((r) => r.body);
  assert.equal(replies.filter((r) => !r.repeat).length, 1);
  for (const r of replies) {
    assert.equal(r.outcome, 'created');
    assert.equal(r.display.id, replies[0].display.id);
    assert.deepEqual(r.totals, { matching: 0, other: 1 });
  }
  assert.equal(await w.scalar('SELECT COUNT(*) FROM submissions'), 1);
  assert.equal(await w.scalar('SELECT report_count FROM displays'), 1);
});

scenario('concurrent retries after a season change write nothing and show nothing', async (w) => {
  const k = key();
  await w.matching('2500 Monroe St', 1, { k });
  await w.restart({ season: '2027' });
  const replies = (await Promise.all(Array.from({ length: 4 }, () => w.matching('2500 Monroe St', 1, { k })))).map((r) => r.body);
  for (const r of replies) assert.deepEqual([r.repeat, r.display, r.season, r.totals], [true, null, 2027, { matching: 0, other: 0 }]);
  assert.equal(await w.scalar('SELECT COUNT(*) FROM submissions'), 1);
  const fresh = await w.matching('2500 Monroe St', 1);         // the same Santa in the new season is a new display
  assert.deepEqual([fresh.status, fresh.body.season], [201, 2027]);
  assert.deepEqual(await w.rows('SELECT season FROM displays ORDER BY season'), [{ season: 2026 }, { season: 2027 }]);
  await w.restart({ season: '2026' });
  assert.deepEqual((await snapshot(w)).totals, { matching: 1, other: 0 });
  await assertTotalsKept(w);
});

// ---------------------------------------------------------------- freshness
scenario('the snapshot is fresh after every kind of change, and an unchanged poll reads one row', async (w) => {
  const expectPoll = async () => {
    const r = await w.call('GET', '/api/santas');
    assert.deepEqual(r.d1, { queries: 1, rows_read: 1, rows_written: 0 }, 'unchanged poll');
    return r.body;
  };
  await snapshot(w);
  await expectPoll();
  await w.restart();                                // another instance: the stored snapshot, two rows
  assert.deepEqual((await w.call('GET', '/api/santas')).d1, { queries: 2, rows_read: 2, rows_written: 0 });
  await expectPoll();
  const id = (await w.matching('2500 Monroe St', 1)).body.display.id;
  assert.equal((await snapshot(w)).totals.matching, 1, 'after a new sighting');
  await expectPoll();
  await w.matching('2500 Monroe St', 1);
  await w.matching('2500 Monroe St', 3);
  assert.equal((await snapshot(w)).displays[0].quantity, 1, 'a conflicting count changes nothing public');
  await w.admin('POST', `/api/admin/displays/${id}`, { quantity: 4 });
  assert.equal((await snapshot(w)).totals.matching, 4, 'after an editor edit');
  await w.admin('POST', `/api/admin/displays/${id}`, { address: '2100 Monroe St' });
  assert.match((await snapshot(w)).displays[0].address, /^2100 MONROE/, 'after an address change');
  await w.admin('POST', `/api/admin/displays/${id}`, { status: 'hidden' });
  assert.deepEqual((await snapshot(w)).displays, [], 'after a hide');
  await w.admin('POST', `/api/admin/displays/${id}`, { status: 'visible' });
  assert.equal((await snapshot(w)).displays.length, 1, 'after a show');
  await w.other('3700 Nakoma Rd');
  assert.equal((await snapshot(w)).totals.other, 1, 'after an other Santa');
  await expectPoll();
  await w.call('POST', '/api/corrections', { display_id: id, kind: 'removed' });
  const queue = (await w.admin('GET', '/api/admin/corrections')).body.corrections;
  await w.admin('POST', `/api/admin/corrections/${queue[0].id}`, { status: 'dismissed', resolution: 'still there' });
  assert.equal((await expectPoll()).totals.matching, 4, 'requests and dismissals change nothing public');
  await w.restart({ season: '2027' });
  assert.deepEqual((await snapshot(w)).totals, { matching: 0, other: 0 }, 'after a season change');
  await w.restart({ season: '2026' });
  assert.equal((await snapshot(w)).totals.matching, 4, 'each season keeps its own stored snapshot');
});

scenario('the kept totals equal the displays after every kind of edit', async (w) => {
  const a = (await w.matching('2500 Monroe St', 2)).body.display.id;
  const b = (await w.other('3700 Nakoma Rd')).body.display.id;
  await w.matching('2100 Monroe St', 1);
  const steps = [
    [a, { quantity: 5 }], [a, { category: 'other', description: 'Changed' }], [a, { category: 'matching', quantity: 3 }],
    [b, { status: 'hidden' }], [a, { status: 'hidden', quantity: 4 }], [a, { status: 'visible' }], [b, { address: '2500 Monroe St' }],
    [b, { status: 'visible', category: 'matching', quantity: 2 }], [a, { address: '2100 Monroe St' }],   // 409: kept unchanged
  ];
  for (const [id, change] of steps) {
    await w.admin('POST', `/api/admin/displays/${id}`, change);
    await assertTotalsKept(w);
    const snap = await snapshot(w);
    for (const c of ['matching', 'other']) {
      assert.equal(snap.totals[c], snap.displays.filter((d) => d.category === c).reduce((n, d) => n + d.quantity, 0), JSON.stringify(change));
    }
  }
  await w.restart({ season: '2027' });
  await w.matching('2500 Monroe St', 1);
  await assertTotalsKept(w);
  assert.deepEqual((await snapshot(w)).totals, { matching: 1, other: 0 });
});

// ---------------------------------------------------------------- area & schema
test('the prebuilt area matches the Python reference and its in-area rule', async () => {
  const fresh = execFileSync('python3', ['scripts/build_area.py', '--check'], { cwd: ROOT, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }).toString();
  assert.match(fresh, /up to date/);
  const python = JSON.parse(execFileSync('python3', ['-c',
    'import json,sys; sys.path.insert(0, "."); from santa_map.geo import load_boundary; b = load_boundary("boundary.json"); ' +
    'print(json.dumps({"name": b.name, "radius_m": b.radius_m, "bounds": b.bounds(), "rings": b.outline_rings()}))'],
  { cwd: SERVICE, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }).toString());
  const w = await start();
  try {
    const area = (await w.call('GET', '/api/area')).body;
    assert.deepEqual({ ...area, season: undefined }, { ...python, season: undefined });
    assert.equal(area.season, 2026);
  } finally {
    await w.close();
  }
  const { contains } = await import('../src/geo.js');
  const points = JSON.parse(readFileSync(join(ROOT, 'test', 'area-points.json'), 'utf8'));
  assert.ok(points.length > 500);
  for (const [lat, lon, inside] of points) assert.equal(contains(lat, lon), inside, `${lat},${lon}`);
});

test('migration 0001 is the reference schema, unchanged', () => {
  assert.equal(readFileSync(join(ROOT, 'migrations', '0001_init.sql'), 'utf8'), readFileSync(join(SERVICE, 'migrations', '001_init.sql'), 'utf8'));
});

test('the page holds no editor secret or editor address', () => {
  for (const file of ['santa-map.html', 'santa-map.js']) {
    const text = readFileSync(join(SITE, file), 'utf8');
    for (const word of ['SANTA_ADMIN', 'Bearer', '/admin', 'workers.dev', 'SANTA_CLIENT_SALT']) assert.ok(!text.includes(word), `${file}: ${word}`);
  }
});

// ---------------------------------------------------------------- operations
scenario('the daily clean-up forgets only old rate-limit counts', async (w) => {
  const now = Math.floor(Date.now() / 1000);
  const db = (await w.env()).DB;
  await db.batch([
    db.prepare("INSERT INTO rate_counts VALUES ('submit', 'old', ?, 3)").bind(now - 3 * 86400),
    db.prepare("INSERT INTO rate_counts VALUES ('submit', 'recent', ?, 3)").bind(now - 3600),
  ]);
  await w.matching();
  await w.server.getWorker().scheduled({ cron: '17 9 * * *', scheduledTime: new Date() });
  const left = (await w.rows('SELECT client_key FROM rate_counts')).map((r) => r.client_key);
  assert.ok(!left.includes('old'));
  assert.ok(left.includes('recent'));
  assert.equal((await snapshot(w)).totals.matching, 1);
});

scenario('a database failure is reported honestly, never as an empty map', async (w) => {
  await w.matching();
  await (await w.env()).DB.prepare('DROP TABLE meta').run();      // stands in for a used-up daily D1 allowance
  let r = await w.call('GET', '/api/santas', undefined, { headers: { Origin: ORIGIN } });
  assert.equal(r.status, 503);
  assert.deepEqual(Object.keys(r.body).sort(), ['error', 'message']);
  assert.equal(r.headers.get('Retry-After'), '300');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);     // so the page can read the answer
  r = await w.matching('2100 Monroe St');
  assert.equal(r.status, 503);
  for (const word of ['SQL', 'meta', 'D1', 'table', 'Error']) assert.ok(!r.body.message.includes(word), word);
  assert.match(r.body.message, /Your entry is still here/);
});

scenario('preflight is answered for the site only, never for the editor API', async (w) => {
  let r = await w.call('OPTIONS', '/api/sightings', undefined, { headers: { Origin: ORIGIN } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(r.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  r = await w.call('OPTIONS', '/api/sightings', undefined, { headers: { Origin: 'https://example.com' } });
  assert.equal(r.status, 403);
  r = await w.call('OPTIONS', '/api/admin/export', undefined, { headers: { Origin: ORIGIN } });
  assert.equal(r.status, 403);
});

scenario('routine reads cost what the budget assumes', async (w) => {
  for (let i = 0; i < 3; i++) await w.matching(['2500 Monroe St', '2100 Monroe St', '3700 Nakoma Rd'][i]);
  const area = await w.call('GET', '/api/area');
  assert.deepEqual(area.d1, { queries: 0, rows_read: 0, rows_written: 0 });
  const rebuilt = await w.call('GET', '/api/santas');
  // A rebuild reads each visible display about twice (index and row), plus the version
  // (twice), the two kept totals and the stored snapshot (looked up, then replaced).
  assert.ok(rebuilt.d1.rows_read <= 2 * 3 + 6, JSON.stringify(rebuilt.d1));
  assert.deepEqual((await w.call('GET', '/api/santas')).d1, { queries: 1, rows_read: 1, rows_written: 0 });
  const save = await w.matching('2500 Monroe St');
  assert.ok(save.d1.queries <= 15, JSON.stringify(save.d1));
  assert.ok(save.d1.rows_read <= 25, 'a save no longer reads every display: ' + JSON.stringify(save.d1));
});
