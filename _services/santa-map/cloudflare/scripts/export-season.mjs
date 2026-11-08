// Private season export through the editor API: every record for one season (displays,
// the reports about them, correction requests and the editor log), for safe keeping when
// a season closes. It contains private fields, so it is written only outside this
// repository and readable only by you. The editor token is read from SANTA_ADMIN_TOKEN.
//
//   SANTA_ADMIN_TOKEN=… node scripts/export-season.mjs --api https://<api-host> --season 2026 --out <private-file.json>

import { writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const api = opt('--api'), season = Number(opt('--season')), out = opt('--out') && resolve(opt('--out'));
const token = process.env.SANTA_ADMIN_TOKEN;
if (!api || !Number.isInteger(season) || !out) {
  console.error('usage: node scripts/export-season.mjs --api <https://api-host> --season <year> --out <private-file.json>');
  process.exit(2);
}
if (!token) {
  console.error('Set SANTA_ADMIN_TOKEN in the environment first.');
  process.exit(2);
}
if (out.startsWith(REPO + sep)) {
  console.error('Refusing to write private data inside the repository.');
  process.exit(2);
}

const res = await fetch(api.replace(/\/$/, '') + '/api/admin/export', { headers: { Authorization: 'Bearer ' + token } });
if (!res.ok) {
  console.error(`${res.status}: ${await res.text()}`);
  process.exit(1);
}
const all = await res.json();
const displays = all.displays.filter((d) => d.season === season);
const ids = new Set(displays.map((d) => d.id));
const corrections = all.corrections.filter((c) => ids.has(c.display_id));
const correctionIds = new Set(corrections.map((c) => c.id));
const exported = {
  season, exported_at: all.exported_at,
  displays,
  submissions: all.submissions.filter((s) => ids.has(s.display_id)),
  corrections,
  audit_log: all.audit_log.filter((a) => ids.has(a.display_id) || correctionIds.has(a.correction_id)),
};
writeFileSync(out, JSON.stringify(exported, null, 2), { mode: 0o600 });
const visible = displays.filter((d) => d.status === 'visible');
const sum = (c) => visible.filter((d) => d.category === c).reduce((n, d) => n + d.quantity, 0);
console.log(`Wrote ${out}`);
console.log(`Season ${season}: ${displays.length} displays (${visible.length} visible), matching ${sum('matching')}, other ${sum('other')}; ` +
  `${exported.submissions.length} reports, ${corrections.length} correction requests, ${exported.audit_log.length} editor log entries.`);
