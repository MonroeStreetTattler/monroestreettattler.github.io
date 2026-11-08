// Recovery: after the database is rolled back (D1 Time Travel or a restore from backup),
// a Worker instance that is still running must serve the restored map, never the snapshot
// it built before the rollback. The rollback is simulated by putting back every table's
// earlier rows in one D1 batch (one transaction) while the Worker stays warm.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

// Parents before children, so foreign keys hold while rows go back.
const TABLES = ['displays', 'submissions', 'corrections', 'audit_log', 'geocode_cache', 'season_totals', 'snapshots', 'meta'];

async function capture(w) {
  const state = {};
  for (const t of TABLES) state[t] = await w.rows(`SELECT * FROM ${t}`);
  return state;
}

// Put every table back exactly as captured, in one transaction. The display triggers fire
// while displays go back, so the kept tables (season_totals, snapshots, meta) are
// written last, just as a restored database holds them.
async function rollBack(w, state) {
  const db = (await w.env()).DB;
  const insert = (t, row) => db.prepare(`INSERT INTO ${t} (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`)
    .bind(...Object.values(row));
  await db.batch([
    ...[...TABLES].reverse().map((t) => db.prepare(`DELETE FROM ${t}`)),
    ...TABLES.flatMap((t) => (['season_totals', 'snapshots', 'meta'].includes(t) ? [] : state[t].map((r) => insert(t, r)))),
    db.prepare('DELETE FROM season_totals'), db.prepare('DELETE FROM snapshots'), db.prepare('DELETE FROM meta'),
    ...['season_totals', 'snapshots', 'meta'].flatMap((t) => state[t].map((r) => insert(t, r))),
  ]);
}

const get = (w) => w.call('GET', '/api/santas');

function scenario(name, fn) {
  test(name, async () => {
    const w = await start();
    try {
      await fn(w);
    } finally {
      await w.close();
    }
  });
}

scenario('a warm instance serves the restored map after a rollback, even when later changes repeat the old pattern', async (w) => {
  const a = (await w.matching('2500 Monroe St', 1)).body.display.id;
  const before = (await get(w)).body;                     // this instance now holds the snapshot of the earlier state
  const earlier = await capture(w);

  await w.matching('2100 Monroe St', 1);
  await w.admin('POST', `/api/admin/displays/${a}`, { quantity: 3 });
  await w.other('3700 Nakoma Rd', 'Santa on a sleigh');
  const lost = (await get(w)).body;                       // and now the snapshot of the state that will be lost
  assert.deepEqual(lost.totals, { matching: 4, other: 1 });

  await rollBack(w, earlier);                             // the instance stays warm
  const restored = await get(w);
  assert.deepEqual(restored.body, before, 'the restored map, not the one this instance last built');
  assert.deepEqual((await get(w)).d1, { queries: 1, rows_read: 1, rows_written: 0 }, 'polling stays one row after a rollback');

  // The same kinds of change again, with different data. With a counting version these
  // would bring it back to the number the lost snapshot carried.
  await w.matching('2100 Monroe St', 2);
  await w.admin('POST', `/api/admin/displays/${a}`, { quantity: 4 });
  await w.other('3700 Nakoma Rd', 'Santa in a canoe');
  const after = (await get(w)).body;
  assert.deepEqual(after.totals, { matching: 6, other: 1 });
  assert.equal(after.displays.find((d) => d.category === 'other').description, 'Santa in a canoe');

  await w.restart();                                      // a second instance agrees
  const second = await get(w);
  assert.deepEqual(second.body, after);
  assert.deepEqual(second.d1, { queries: 2, rows_read: 2, rows_written: 0 }, 'it reads the stored snapshot');
});

scenario('a second instance after a rollback serves the restored map', async (w) => {
  await w.matching('2500 Monroe St', 1);
  const before = (await get(w)).body;
  const earlier = await capture(w);
  await w.matching('2100 Monroe St', 5);
  await get(w);
  await rollBack(w, earlier);
  await w.restart();
  assert.deepEqual((await get(w)).body, before);
});

scenario('a stored snapshot that does not carry the current token is rebuilt, and stored again', async (w) => {
  await w.matching('2500 Monroe St', 2);
  const truth = (await get(w)).body;
  const db = (await w.env()).DB;
  // Recovery left the stored snapshot out of step with the displays: wrong body, other token.
  await db.prepare("UPDATE snapshots SET version = version + 1, body = '{\"stale\":true}'").run();
  await w.restart();
  let r = await get(w);
  assert.deepEqual(r.body, truth);
  assert.ok(r.d1.rows_read > 2, 'rebuilt from the displays');
  assert.equal(await w.scalar("SELECT COUNT(*) FROM snapshots s JOIN meta m ON m.key = 'snapshot_version' AND m.value = s.version"), 1);
  // No stored snapshot at all.
  await (await w.env()).DB.prepare('DELETE FROM snapshots').run();
  await w.restart();
  r = await get(w);
  assert.deepEqual(r.body, truth);
});

scenario('under concurrent saves and reads the stored snapshot only ever names the state it was built from', async (w) => {
  await w.matching('2500 Monroe St', 1);
  const work = [];
  for (let i = 0; i < 4; i++) {
    work.push(get(w), w.matching(['2100 Monroe St', '3700 Nakoma Rd', '2500 Monroe St', '2100 Monroe St'][i], 1), get(w));
  }
  await Promise.all(work);
  const stored = (await w.rows('SELECT version, body FROM snapshots'))[0];
  const current = await w.scalar("SELECT value FROM meta WHERE key = 'snapshot_version'");
  await (await w.env()).DB.prepare('DELETE FROM snapshots').run();
  await w.restart();
  const truth = (await get(w)).body;
  if (stored.version === current) assert.deepEqual(JSON.parse(stored.body), truth);
  assert.deepEqual(truth.totals, { matching: 3, other: 0 });
});

scenario('the version is a token, not a counter', async (w) => {
  const tokens = [await w.scalar("SELECT value FROM meta WHERE key = 'snapshot_version'")];
  await w.matching('2500 Monroe St', 1);
  tokens.push(await w.scalar("SELECT value FROM meta WHERE key = 'snapshot_version'"));
  await w.matching('2100 Monroe St', 1);
  tokens.push(await w.scalar("SELECT value FROM meta WHERE key = 'snapshot_version'"));
  assert.equal(new Set(tokens).size, 3);
  for (const t of tokens) assert.ok(Number.isSafeInteger(t) && t >= 0, String(t));
  assert.ok(!(tokens[1] === tokens[0] + 1 && tokens[2] === tokens[1] + 1), 'not counting up');
});
