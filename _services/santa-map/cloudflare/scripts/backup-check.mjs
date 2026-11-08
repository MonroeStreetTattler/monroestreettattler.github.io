// Back up the Santa map D1 database to a SQL file and prove the file restores exactly.
//
//   node scripts/backup-check.mjs --local  <private-folder>   (the database `wrangler dev` uses)
//   node scripts/backup-check.mjs --remote <private-folder>   (needs `wrangler login`)
//   add --config wrangler.staging.toml to check the database that config names
//
// <private-folder> must be outside this repository; backups contain private data.
//
// What "exactly" means here:
//   1. The source is fingerprinted: every application table's full row content (each row
//      written canonically, rows sorted, then SHA-256), plus the schema itself (every
//      table, index and trigger definition from sqlite_master).
//   2. The source is exported to a .sql file readable only by you.
//   3. The file is restored into a brand-new scratch local database, never over the source.
//   4. The scratch copy is fingerprinted the same way and must match step 1 table by table.
//   5. The source is fingerprinted again. If it changed while this ran (a visitor saved a
//      sighting, say), the result is INCONCLUSIVE, not failed: the export may hold either
//      state. Run it again at a quiet time.
// Left out on purpose: SQLite's and Cloudflare's own internal tables (sqlite_%, _cf_%).
// Only table names, row counts and short hashes are printed, never the private rows.
//
// Exit status: 0 passed, 1 failed (keep the source; do not rely on this file),
// 3 inconclusive (the source changed during the check), 2 usage error.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = resolve(ROOT, '..', '..', '..');

// Every table the migrations create, d1_migrations included (a restored database needs it
// to know which migrations it already has).
export const TABLES = ['displays', 'submissions', 'corrections', 'audit_log', 'geocode_cache', 'rate_counts',
  'season_totals', 'snapshots', 'meta', 'd1_migrations'];
const SCHEMA = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name";

export function wrangler(cwd, ...args) {
  return execFileSync(join(ROOT, 'node_modules', '.bin', 'wrangler'), args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 29,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

// The database a Wrangler config binds (its first [[d1_databases]] database_name).
export function databaseName(cwd, config = 'wrangler.toml') {
  const match = readFileSync(resolve(cwd, config), 'utf8').match(/^\s*database_name\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`no database_name in ${config}`);
  return match[1];
}

// Run SQL against a database (flags: ['--local'], ['--remote'] or ['--local', '--persist-to', dir]).
export function execSql(cwd, flags, sql, config = 'wrangler.toml') {
  return JSON.parse(wrangler(cwd, 'd1', 'execute', databaseName(cwd, config), '-c', config, ...flags, '--json', '--command', sql))
    .map((r) => r.results);
}

const canonical = (row) => JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k]]));
const digest = (lines) => createHash('sha256').update(lines.join('\n')).digest('hex');

// { item: { rows, hash } } for the schema and every table, read in one command.
export function fingerprint(cwd, flags, config) {
  const [schema, ...tables] = execSql(cwd, flags, [SCHEMA, ...TABLES.map((t) => `SELECT * FROM ${t}`)].join(';\n'), config);
  const out = { schema: { rows: schema.length, hash: digest(schema.map(canonical)) } };
  TABLES.forEach((t, i) => {
    out[t] = { rows: tables[i].length, hash: digest(tables[i].map(canonical).sort()) };
  });
  const known = new Set(TABLES);
  const extra = schema.filter((s) => s.type === 'table' && !known.has(s.name)).map((s) => s.name);
  if (extra.length) out['unexpected tables'] = { rows: extra.length, hash: digest(extra) };
  return out;
}

// afterRestore is for tests only: it runs after the restore and before the comparison.
export function backupAndVerify({ where, out, cwd = ROOT, config = 'wrangler.toml', afterRestore }) {
  const database = databaseName(cwd, config);
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 17);
  const file = join(out, `santa-map-${stamp}.sql`);
  const scratch = join(out, `restore-check-${stamp}`);
  const source = [where];
  const restoredFlags = ['--local', '--persist-to', scratch];
  try {
    const before = fingerprint(cwd, source, config);
    wrangler(cwd, 'd1', 'export', database, '-c', config, where, '--output', file);
    chmodSync(file, 0o600);                     // private: readable only by you
    wrangler(cwd, 'd1', 'execute', database, '-c', config, ...restoredFlags, '--file', file, '--yes');
    if (afterRestore) afterRestore({ source, restored: restoredFlags });
    const restored = fingerprint(cwd, restoredFlags, config);
    const after = fingerprint(cwd, source, config);
    const items = [...new Set([...Object.keys(before), ...Object.keys(restored)])].map((item) => ({
      item,
      rows: before[item]?.rows ?? 0,
      source: (before[item]?.hash || '-').slice(0, 12),
      restored: (restored[item]?.hash || '-').slice(0, 12),
      match: before[item]?.hash === restored[item]?.hash && before[item]?.rows === restored[item]?.rows,
    }));
    const steady = JSON.stringify(before) === JSON.stringify(after);
    const status = !steady ? 'inconclusive' : items.every((i) => i.match) ? 'passed' : 'failed';
    return { status, file, items };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const where = args.includes('--remote') ? '--remote' : args.includes('--local') ? '--local' : null;
  const config = args.includes('--config') ? args[args.indexOf('--config') + 1] : 'wrangler.toml';
  const folder = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--config');
  if (!where || !folder) {
    console.error('usage: node scripts/backup-check.mjs --local|--remote <private-folder> [--config <wrangler config>]');
    process.exit(2);
  }
  const out = resolve(folder);
  if (out === REPO || out.startsWith(REPO + sep)) {
    console.error('Refusing to write a backup inside the repository.');
    process.exit(2);
  }
  console.log(`Backing up the ${where.slice(2)} database ${databaseName(ROOT, config)} and checking the restore…`);
  const { status, file, items } = backupAndVerify({ where, out, config });
  console.table(items);
  if (status === 'failed') {
    console.error(`RESTORE CHECK FAILED: ${items.filter((i) => !i.match).map((i) => i.item).join(', ')} differ. ` +
      'Keep the source; do not rely on this file.');
    process.exit(1);
  }
  if (status === 'inconclusive') {
    console.error('INCONCLUSIVE: the database changed while the check ran, so the file could not be proven. ' +
      'Nothing is wrong with the database. Run the check again at a quiet time.');
    process.exit(3);
  }
  console.log(`Restore check passed: schema and every table match exactly. Keep ${file} privately ` +
    `(it is ${existsSync(file) ? 'saved, readable only by you' : 'missing!'}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
