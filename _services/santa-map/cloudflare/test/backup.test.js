// The backup check with real Wrangler export and restore, against a scratch project
// (its own wrangler.toml copy and local database). An unmodified restore must pass. A
// restored copy with one changed value must fail, though counts and totals still agree.
// A source that changes during the check must be inconclusive, not failed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupAndVerify, execSql, wrangler } from '../scripts/backup-check.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let project, out;

before(() => {
  project = mkdtempSync(join(tmpdir(), 'santa-backup-project-'));
  out = mkdtempSync(join(tmpdir(), 'santa-backups-'));
  cpSync(join(ROOT, 'wrangler.toml'), join(project, 'wrangler.toml'));
  cpSync(join(ROOT, 'migrations'), join(project, 'migrations'), { recursive: true });
  wrangler(project, 'd1', 'migrations', 'apply', 'santa-map', '--local');
  // Made-up test records covering every table a backup holds.
  execSql(project, ['--local'], [
    "INSERT INTO displays (public_id, season, category, property_key, address, lat, lon, quantity, description, first_reported_on, last_reported_on, created_at, updated_at) VALUES ('t1', 2026, 'matching', '2500 MONROE ST MADISON WI 53711', '2500 MONROE ST, MADISON, WI, 53711', 43.05828, -89.42737, 2, NULL, '2026-11-28', '2026-11-29', '2026-11-28T18:00:00+00:00', '2026-11-29T18:00:00+00:00')",
    "INSERT INTO displays (public_id, season, category, property_key, address, lat, lon, quantity, description, first_reported_on, last_reported_on, created_at, updated_at) VALUES ('t2', 2026, 'other', '3700 NAKOMA RD MADISON WI 53711', '3700 NAKOMA RD, MADISON, WI, 53711', 43.05018, -89.43718, 1, 'Santa in a canoe', '2026-11-28', '2026-11-28', '2026-11-28T19:00:00+00:00', '2026-11-28T19:00:00+00:00')",
    "INSERT INTO submissions (idempotency_key, display_id, outcome, category, quantity, description, entered_address, response_json, created_at) VALUES ('k-0000000000000001', 1, 'created', 'matching', 2, NULL, '2500 Monroe St', '{\"outcome\":\"created\"}', '2026-11-28T18:00:00+00:00')",
    "INSERT INTO corrections (display_id, kind, message, proposed_quantity, created_at) VALUES (2, 'location', 'It is next door', NULL, '2026-11-29T10:00:00+00:00')",
    "INSERT INTO audit_log (at, action, display_id, before_json, after_json) VALUES ('2026-11-29T11:00:00+00:00', 'edit_display', 1, '{\"quantity\":1}', '{\"quantity\":2}')",
    "INSERT INTO geocode_cache VALUES ('2500 monroe st, madison, wi', '[{\"address\":\"2500 MONROE ST, MADISON, WI, 53711\",\"lat\":43.05828,\"lon\":-89.42737}]', '2026-11-28T18:00:00+00:00')",
    "INSERT INTO rate_counts VALUES ('submit', 'abc123', 1795000000, 2)",
    "INSERT INTO snapshots (season, version, body) SELECT 2026, value, '{}' FROM meta WHERE key = 'snapshot_version'",
  ].join(';\n'));
});

after(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

const check = (afterRestore) => backupAndVerify({ where: '--local', out, cwd: project, afterRestore });
const tamper = (sql) => ({ restored }) => execSql(project, restored, sql);
const mismatched = (result) => result.items.filter((i) => !i.match).map((i) => i.item);

test('an unmodified restore passes on every table and the schema', () => {
  const r = check();
  assert.equal(r.status, 'passed');
  assert.ok(r.items.length >= 11);
  assert.ok(r.items.every((i) => i.match));
  assert.ok(r.items.find((i) => i.item === 'corrections').rows === 1);
  assert.equal(statSync(r.file).mode & 0o777, 0o600, 'the backup is readable only by its owner');
});

const changes = {
  // A display change also fires its trigger, which gives the restored copy a new version token.
  'a display description': ["UPDATE displays SET description = 'Santa in a kayak' WHERE public_id = 't2'", ['displays', 'meta']],
  'a display address (same property key, same totals)': ["UPDATE displays SET address = '3702 NAKOMA RD, MADISON, WI, 53711' WHERE public_id = 't2'", ['displays', 'meta']],
  'a correction’s message and status': ["UPDATE corrections SET message = 'It is gone', status = 'resolved'", ['corrections']],
  'a cached geocoder answer': ["UPDATE geocode_cache SET result_json = replace(result_json, '43.05828', '43.05829')", ['geocode_cache']],
  'a trigger definition': ['DROP TRIGGER displays_after_delete', ['schema']],
};
for (const [what, [sql, expected]] of Object.entries(changes)) {
  test(`a restored copy with ${what} changed fails, though counts and totals agree`, () => {
    const r = check(tamper(sql));
    assert.equal(r.status, 'failed');
    assert.deepEqual(mismatched(r), expected);
    assert.ok(r.items.find((i) => i.item === 'season_totals').match, 'the totals still agree');
  });
}

test('a source that changes during the check is inconclusive, not failed', () => {
  const r = check(({ source }) => execSql(project, source, "INSERT INTO rate_counts VALUES ('preview', 'def456', 1795000000, 1)"));
  assert.equal(r.status, 'inconclusive');
});

test('printed results hold no private values', () => {
  const r = check();
  const text = JSON.stringify(r.items);
  for (const secret of ['NAKOMA', 'canoe', 'next door', 'abc123', '43.05']) assert.ok(!text.includes(secret), secret);
});
