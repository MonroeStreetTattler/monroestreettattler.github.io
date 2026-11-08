# Santa map API on Cloudflare Workers + D1

The Santa map API from `../santa_map/` (the Python reference), adapted to run on
**Cloudflare Workers Free with D1 Free**. It has the same endpoints, answers, data rules,
privacy and limits, so `santa-map.html` and the editor tool `../admin.py` work with it
unchanged. The website itself stays on GitHub Pages.

## Status

**Production API deployed (Cloudflare Free), 2026-11-08:**
https://santa-map-api.monroestreettattler.workers.dev/api.

- Worker `santa-map-api`, database `santa-map` (`3129ffd1-5845-4688-a2bb-6d753761db9e`).
- It starts empty: the public 2026 map has no sightings.
- The page's `santa-map-api` meta tag points at it in the local release commit. The
  website itself is published separately, through the normal review.
- No DNS change, custom domain or paid plan.
- Staging is separate (see below).

## What is here

| Path | What it is |
|---|---|
| `src/index.js` | Routing, CORS, request limits, editor sign-in, error answers |
| `src/store.js` | The data rules (port of `../santa_map/store.py`) as D1 batches |
| `src/geo.js`, `src/area-data.js` | Coverage-area check; the outline is **prebuilt** from `../boundary.json` |
| `src/geocoder.js` | U.S. Census Geocoder lookups, server-side only |
| `migrations/0001_init.sql` | The reference schema, an exact copy of `../migrations/001_init.sql` |
| `migrations/0002_worker.sql` | Kept totals, snapshot version, stored snapshot, triggers, two indexes |
| `migrations/0003_version_token.sql` | Makes the snapshot version a random token (recovery; triggers only) |
| `wrangler.toml` | Worker settings (no secrets) |
| `test/` | 33 reference scenarios, Worker/D1, rollback-recovery and backup checks, run in the real Workers runtime |
| `scripts/` | Area build, budget check, backup check, season export, local review server |

## How it differs from the Python service, and why

- **Every write is one D1 batch.** D1 has no interactive transactions, so each change the
  Python service made inside `BEGIN IMMEDIATE` is a single batch (one transaction) whose
  statements decide for themselves with SQL conditions. A retried save, a duplicate, a
  report of a hidden Santa or a conflicting count is settled inside the batch, never by an
  earlier read in JavaScript.
- **Totals are kept by triggers.** `season_totals` is updated by SQLite triggers in the
  same transaction as every change to `displays`, so reading the totals costs two rows.
  The tests compare it with a fresh sum after every kind of edit.
- **Public reads are cheap.**
  - Every change to `displays` gives `snapshot_version` a new random token (also by
    trigger). A token names one exact state of the displays.
  - A routine poll reads that one row and, when it is exactly the token of the snapshot the
    Worker instance already built, reuses it.
  - After a change, the first instance to rebuild stores the snapshot in D1, but only if its
    token is still current. Other instances read that one row.
  - **After a rollback** (D1 Time Travel or a restore), the database carries the token of the
    state it returned to. Running instances notice at once that their snapshot's token
    differs and serve the restored map; nothing needs restarting. Later changes make tokens
    that never existed before, so an old snapshot can never come back into use.
  - A poll never writes, and the page still sees every change immediately.
  - The page's own code is unchanged; it already refreshes after every save.
- **The coverage outline is prebuilt.** `npm run build:area` traces it with the Python
  reference into `src/area-data.js`. The tests check that it is up to date and that the
  JavaScript in-area rule agrees with Python on 622 points.
- **Client addresses** come only from `CF-Connecting-IP`, which Cloudflare sets at its edge.
  They are kept only as keyed hashes, as before.
- **No static files.** The Worker serves only `/api/*`; the site stays on GitHub Pages.
- **Rate-limit clean-up** runs once a day from a Cron Trigger, not on every request.
- **Honest failures.** If D1 cannot be used, including when the free daily allowance is used
  up (it resets at midnight UTC), the API answers 503 with `Retry-After: 300`. The page
  then shows its existing "couldn’t be loaded" or "your entry is still here" messages,
  never an empty map. There is no automatic paid upgrade.
- **No Workers Logs** (`observability.enabled = false`): invocation logs would keep visitor
  IP addresses and request details. The Worker logs nothing about requests. Cloudflare
  itself still processes IP addresses at its edge, as any host does.

## Local setup

Requires Node.js 22 or later (tested with Node 24.22.2 LTS from nodejs.org). Python 3 is
used only to rebuild the area file and in one test.

```bash
cd _services/santa-map/cloudflare
npm ci                                   # wrangler 4.152.0, pinned in package-lock.json
npm test                                 # 59 tests, about a minute, no network
npm run budget                           # D1 and CPU cost with 500 made-up displays
```

### Local review with the real page

1. Create `.dev.vars` (ignored by git; never commit it):

   ```
   SANTA_CLIENT_SALT=<random, 16+ characters>
   SANTA_ADMIN_TOKEN=<random, 32+ characters>
   SANTA_ALLOWED_ORIGINS=http://127.0.0.1:8789
   ```

   Generate each value with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`.
2. Apply the migrations to the local database: `npx wrangler d1 migrations apply santa-map --local`.
3. Run `npm run dev` (the Worker on port 8788, real Census lookups) and, in a second terminal,
   `npm run review`.
4. Open http://127.0.0.1:8789/santa-map.html. The review server serves the site and passes
   `/api` to the local Worker, and it never serves folders that start with `_` or `.`.

Use only test sightings locally. The local database lives in `.wrangler/` (ignored by git) and
is never uploaded.

## Staging (free, test data only)

- **Config:** `wrangler.staging.toml`.
  - Worker `santa-map-api-staging-2026`, database `santa-map-staging-2026`.
  - `SANTA_METRICS` is on, adding the D1 cost header; there is no Cron Trigger.
  - Use it explicitly with every command: `-c wrangler.staging.toml`.
- **Address:** https://santa-map-api-staging-2026.monroestreettattler.workers.dev/api.
  - No route, zone or custom domain.
  - The website does not point at it.
- **Secrets:** `python3 scripts/set-secrets.py -c wrangler.staging.toml`.
  - It generates both values and sends them to Cloudflare through standard input.
  - It saves the editor token in the macOS Keychain (service "Santa map editor token",
    account = Worker name).
  - Nothing is printed or written to a file.
- **Editor tool:** read the token from the Keychain for each run:

  ```bash
  SANTA_ADMIN_TOKEN="$(security find-generic-password -a santa-map-api-staging-2026 -s 'Santa map editor token' -w)" \
    python3 ../admin.py --api https://santa-map-api-staging-2026.monroestreettattler.workers.dev corrections
  ```

  `admin.py` sends its own User-Agent, because Cloudflare refuses Python's default one
  (error 1010).
- **Hosted checks:** `node scripts/hosted-check.mjs --api <staging URL>`, with the token as
  above. They save and edit test sightings and use up this connection's save and lookup
  limits for 10 minutes.
- **Rollback check:** `node scripts/timetravel-check.mjs --api <staging URL> -c wrangler.staging.toml`.
  This is a real D1 Time Travel rollback. It refuses any database whose name lacks
  "staging".
- **Backup check:** `node scripts/backup-check.mjs --remote ~/SantaMapBackups/staging --config wrangler.staging.toml`.
- **Client addresses:** Cloudflare's edge refuses any request that carries its own
  `CF-Connecting-IP` (403 before the Worker runs). Other address headers are ignored. The
  hosted check proves both.
- **Never copy staging into production.** Production gets a new, empty database and new
  secrets.

## Cloudflare setup (done for production on 2026-11-08; kept as the procedure)

Account checks first, read-only:

- Sign in with `npx wrangler login`.
- Confirm the account, plan and Workers subdomain with `npx wrangler whoami`.
- Confirm current Workers and D1 usage in the dashboard. The free allowances are shared
  with anything else on the account.

Then:

1. `npx wrangler d1 create santa-map`, and put the printed `database_id` in `wrangler.toml`.
2. `npx wrangler d1 migrations apply santa-map --remote`.
3. Set the two secrets with `python3 scripts/set-secrets.py -c wrangler.toml`. The
   values never appear on a command line, in a file or in output, and the editor token is
   saved in the Keychain. (Or use `npx wrangler secret put <NAME>`, which prompts.)
4. Run `npx wrangler deploy`. The API is then at
   `https://santa-map-api.monroestreettattler.workers.dev/api`. No custom domain, route or
   DNS record is needed.
5. Check production without writing anything:
   `node scripts/hosted-check.mjs --api <production URL> --read-only`, with the token as in
   "Editor procedure". **Never run the full hosted check on production**: it saves test
   sightings.
6. To test saves without touching the public season, deploy for a few minutes with a test
   season, for example `npx wrangler deploy --var SANTA_SEASON:1999`. Save, retry and hide
   the test sightings, then redeploy with plain `npx wrangler deploy`. The 1999 records stay
   hidden and are never shown in 2026.
7. Run `npm run backup:production`, then set the page's `santa-map-api` meta tag through
   the normal review and publication step.

`SANTA_ALLOWED_ORIGINS` is `https://monroestreettattler.com` only. To try the real page
from a local server, add its origin only for that test deploy
(`--var "SANTA_ALLOWED_ORIGINS:https://monroestreettattler.com,http://127.0.0.1:8765"`), then
redeploy plainly to remove it. Check afterwards that the local origin gets no
`Access-Control-Allow-Origin` header.

## Editor procedure

Use the wrapper; it reads the editor token from the Keychain itself:

```bash
python3 scripts/editor.py production corrections               # open requests and conflicting reports
python3 scripts/editor.py production hide <display-id> --correction <n>
python3 scripts/editor.py production edit <display-id> --quantity 2
python3 scripts/editor.py production show <display-id>
python3 scripts/editor.py production close <n> dismissed --note "Still there"
python3 scripts/editor.py production export > <private-file.json>   # private data: never into this repository
```

- Use `staging` in place of `production` for the test deployment.
- The wrapper runs `../admin.py`; see `../README.md` for every command and option.
- The token goes from the Keychain straight into that program's memory. It never appears
  on a command line, in a file or in the output.
- An assistant can run these for the publisher without anyone handling the token.
The `backup` and `restore` commands in `admin.py` are for the Python service's SQLite file;
on D1, use the commands below.

## Backup, export and restore

- **Backup with a restore check:** `npm run backup:production` (saves to
  `~/SantaMapBackups/production`; `npm run backup:staging` for staging). Or run
  `node scripts/backup-check.mjs --remote <private-folder-outside-the-repo> --config <wrangler config>`.
  - It fingerprints the source: the full content of every row of every table, plus every
    table, index and trigger definition. Each row is written the same way every time, the
    rows are sorted, and the result is hashed with SHA-256.
  - It exports the whole database to a `.sql` file readable only by you.
  - It loads the file into a brand-new scratch local database (never over the source) and
    fingerprints that the same way. Every table and the schema must match exactly.
  - It fingerprints the source again. If the database changed while the check ran (a visitor
    saved a sighting), the result is **inconclusive** (exit 3), not failed: run it again at a
    quiet time.
  - SQLite's and Cloudflare's own internal tables (`sqlite_%`, `_cf_%`) are left out.
  - It prints only table names, row counts and short hashes, never the rows.
  - A failed check exits 1: keep the source and don't rely on that file.
  - Run it at least weekly in season.
  - **Still to decide:** a private copy off this computer. The backups live only in
    `~/SantaMapBackups` on this Mac until a real private destination is chosen. No
    automatic schedule is set up.
  - Run against the live database, it reads every row twice, which is small next to the
    daily allowance.
- **Season export (JSON, private):**
  `node scripts/export-season.mjs --api <https://api-host> --season 2026 --out <private-file.json>`.
- **D1 Time Travel** can roll the database back to any minute in the last 7 days on the Free
  plan (`npx wrangler d1 time-travel restore santa-map --timestamp <time>`). The Worker serves
  the restored map straight away (see the snapshot token above). It is a safety net, not a
  substitute for the kept backups.
- **Restoring a backup to Cloudflare:**
  1. Create a new database (`npx wrangler d1 create santa-map-restore`).
  2. Point a temporary `[[d1_databases]]` entry at it.
  3. Run `npx wrangler d1 execute santa-map-restore --remote --file <backup.sql>`, then
     check it.
  4. Switch the binding's `database_id` and redeploy.

  Never restore over the live database.

## Budget (measured locally, `npm run budget`, 500 visible made-up displays)

| Request | D1 queries | Rows read | Rows written |
|---|---|---|---|
| Routine poll (unchanged) | 1 | 1 | 0 |
| Poll on another instance after a change (stored snapshot) | 2 | 2 | 0 |
| First poll after a change (rebuild and store) | 6 | 1,007 | 1 |
| Area | 0 | 0 | 0 |
| New sighting | 11 | 20 | 11 |
| Retry of a save | 3 | 6 | 1 |

On the hosting assessment's busy-day illustration, the estimate is about 61% of the daily
request allowance, 6% of rows read and 5% of rows written. That day is 5,000 visits of 10
minutes, 300 lookups, 200 saves, 30 correction requests and an editor change every hour,
spread over 20 instances.

- **Requests** are the closest limit (100,000 a day, all Workers on the account).
- **CPU:** the Worker's own JavaScript for a 500-display rebuild takes about 0.2 ms in Node
  on this computer. Waiting for D1 or Census does not count as CPU. The 10 ms Free limit has
  wide room, but real CPU time can only be confirmed on Cloudflare after deployment
  (Workers metrics).
- **Snapshot size:** with 500 displays the snapshot is about 110 KB; D1's row limit is 2 MB.

## Third-party services

- **Census Geocoder:** as in `../README.md`.
- **Cloudflare:**
  - [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
  - [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
  - [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
  - [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
  - [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- **The Cache API** is documented as working on custom domains, so it is not relied on at
  the `workers.dev` address. The version check and the stored snapshot work anywhere.
