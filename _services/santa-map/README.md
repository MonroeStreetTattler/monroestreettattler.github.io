# Santa map service

The small API behind `santa-map.html` (“Santas on Monroe Street”). The page stays on
GitHub Pages; this service stores sightings and answers the page's requests. This folder
starts with an underscore, so GitHub Pages never publishes it.

- Python 3.9 or later, standard library only (no packages to install).
- One SQLite database file. The schema in `migrations/` is plain SQLite and also runs on Cloudflare D1.
- WSGI entry point: `santa_map.wsgi:application`. `serve.py` runs it with Python's built-in server.

## Status

Local implementation only. **Not deployed.** The page's `santa-map-api` meta tag is `/api`,
which only works with the local review server below. On GitHub Pages it finds nothing, so
the page shows “Count unavailable right now” and accepts no sightings until a real API
address is configured.

The approved host is Cloudflare Workers Free with D1 Free. The adaptation is in
`cloudflare/` (see `cloudflare/README.md`). This Python service stays as the reference
implementation and is not deployed alongside it. The hosting notes below apply only if
this Python service is ever hosted instead.

## Hosting prerequisites (none of these are set up yet)

1. **A host for a Python WSGI app with a persistent disk and HTTPS.** Examples: a small VPS,
   or any managed Python host that keeps files between restarts. The database must survive
   restarts and redeploys. A single process is enough: SQLite handles the locking, and
   writes are serialized.
2. **An HTTPS address for the API**, for example a subdomain. Put it in `santa-map.html`:
   `<meta name="santa-map-api" content="https://<api-host>/api">`.
3. **Outbound HTTPS from the host to `geocoding.geo.census.gov`.** Some free hosts block outbound traffic.
4. **Environment settings** (below), kept in the host's secret store, never in this repository.
5. **A scheduled backup** (below), stored off the host.
6. If the host sits behind a proxy or CDN, set `SANTA_CLIENT_IP_HEADER` to the header that
   proxy sets (for example `CF-Connecting-IP`). Otherwise leave it unset, or rate limits can be dodged.

Cloudflare Workers with D1 is a possible alternative host. That needs a JavaScript port of
`santa_map/`; the schema and tests describe the required behavior. No account, domain or
paid service has been created or changed for this work.

## Environment

| Setting | Required | Meaning |
|---|---|---|
| `SANTA_DB` | yes | Path to the SQLite file. Created and migrated on first start. |
| `SANTA_CLIENT_SALT` | yes | Random string of at least 16 characters. Used to hash connection addresses for rate limits; addresses themselves are never stored. |
| `SANTA_ADMIN_TOKEN` | for editing | Random string of at least 32 characters. The editor API is switched off without it. Generate with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`. |
| `SANTA_ALLOWED_ORIGINS` | no | Comma-separated origins allowed to call the public API from a browser. Default `https://monroestreettattler.com`. |
| `SANTA_SEASON` | no | Season shown and saved. Default `2026`. |
| `SANTA_BOUNDARY` | no | Coverage-area file. Default `boundary.json`. |
| `SANTA_GEOCODER` | no | `census` (default), or `fixture:<file>` for tests and offline review only. |
| `SANTA_CLIENT_IP_HEADER` | no | Only behind a proxy that sets it (see above). |
| `SANTA_STATIC_ROOT` | local review only | Also serves the website from this folder, so the page and `/api` share one address. Never set it in production. |
| `SANTA_HOST`, `SANTA_PORT` | no | For `serve.py`. Defaults `127.0.0.1` and `8787`. |

## Local review

```bash
cd _services/santa-map
export SANTA_DB=/tmp/santa-review.db SANTA_CLIENT_SALT=$(python3 -c "import secrets;print(secrets.token_urlsafe(24))")
export SANTA_ADMIN_TOKEN=$(python3 -c "import secrets;print(secrets.token_urlsafe(32))")
SANTA_STATIC_ROOT=../.. SANTA_ALLOWED_ORIGINS=http://127.0.0.1:8787 python3 serve.py
# open http://127.0.0.1:8787/santa-map.html
```

Use a throwaway database for review and testing. Never point review or tests at the production file.

## Tests

```bash
cd _services/santa-map && python3 -m unittest discover -s tests -v
```

Each test uses its own temporary database and saved Census answers, so the tests need no network.

## How it works

- **Counts are counts of displays, not reports.** There is one row per property, season and
  category (`matching` or `other`), enforced by a unique key on the geocoder's standardized
  address. The matching count is the sum of `quantity` (1–10) over visible matching rows.
  Toggling layers, zooming and repeat reports never change it.
- **Saving.** The page looks the address up first (`/api/preview`), shows the pin, then saves
  (`/api/sightings`). The server looks the address up again (from its cache) and checks the
  area itself. It ignores any coordinates a browser sends.
- **Repeat reports and retries.**
  - A repeat report of a display already on the map confirms it.
  - A different count, or a report of a display an editor hid, goes to the editor queue. The public map does not change.
  - Each save carries a random `idempotency_key`, so a retry after a timeout returns the first answer instead of saving twice.
  - Simultaneous saves of the same display create one row.
- **Corrections.** `/api/corrections` only files a request. The map changes only when an editor acts.
- **Privacy.**
  - Public responses contain only display fields: id, category, address, coordinates, quantity, description (other Santas) and report dates.
  - IP-derived keys, report counts, entered text, the queue and the audit log are private.
  - All visitor text is shown as text, never HTML.
- **Limits.**
  - Request bodies are capped at 4 KB.
  - Address ≤ 120 characters, description ≤ 150, correction ≤ 500.
  - Per connection: 30 previews, 12 saves and 6 correction requests per 10 minutes, and 10 failed editor logins per 10 minutes.
  - Address lookups are capped at 1,000 a day across all visitors; cached addresses don't count toward it.
- **Seasons.** Every row carries its season. Changing `SANTA_SEASON` starts a fresh count and keeps
  earlier seasons in the database. Nothing is ever reset or deleted automatically.

## Coverage area

`boundary.json` holds the street lines and `radius_m`, currently a provisional **750 m**.
A point counts as in the area if it is within that distance of any line.

- **Lines:**
  - Monroe Street from the 1400 block to the 3650 block;
  - Nakoma Road to the 3900 block;
  - Odana Road to the 4100 block.
- **Source of the points:** U.S. Census Geocoder (TIGER/Line, `Public_AR_Current`) results fetched 2026-11-07.
- **Coverage:** about five blocks either side of Monroe Street, plus a little of Nakoma and Odana.
- **The map's outline** is traced from the same rule (`/api/area`), so the drawn line and the saving rule agree.
- **Changing the area:** adjust `radius_m` or add lines, then restart the service. Displays already saved are not affected.

## Editor procedure

Set `SANTA_ADMIN_TOKEN` in your shell (it is read from the environment, never typed on the
command line), then:

```bash
python3 admin.py --api https://<api-host> corrections                    # open requests and conflicting reports
python3 admin.py --api https://<api-host> hide <display-id> --correction <n>     # take a display off the map
python3 admin.py --api https://<api-host> edit <display-id> --quantity 2 --correction <n>
python3 admin.py --api https://<api-host> edit <display-id> --address "2500 Monroe St"   # looked up and area-checked again
python3 admin.py --api https://<api-host> edit <display-id> --category other --description "Waving Santa"
python3 admin.py --api https://<api-host> show <display-id>              # put a hidden display back
python3 admin.py --api https://<api-host> close <n> dismissed --note "Still there on Dec 3"
```

- Every edit is recorded in `audit_log` with the display before and after.
- Displays are hidden, never deleted.
- Totals update in the same transaction as the edit.
- The editor API never answers browsers from other sites (it sends no CORS headers), and nothing on the website links to it.

## Backup, export and restore

- **Export** (any time, over the API): `python3 admin.py --api https://<api-host> export > santa-export-$(date +%F).json`.
  It contains everything, including private fields. Store it privately, never in this repository.
- **Backup** (on the host, safe while running):
  `python3 admin.py backup "$SANTA_DB" /backups/santa-$(date +%F).db`. Run it daily on a schedule, keep at least 30 days, and copy the backups off the host.
- **Restore:** stop the service, then run `python3 admin.py restore /backups/santa-YYYY-MM-DD.db /path/to/new.db`
  (it refuses to overwrite). Point `SANTA_DB` at the new file and start the service.
- Before any destructive infrastructure change (moving hosts, deleting a volume), take both an export and a backup.

## Third-party services and their terms (checked 2026-11-07)

- **U.S. Census Geocoder**
  (https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html).
  - No key is needed and the documentation states no rate limits, but it does not allow browser calls, so only this server calls it.
  - Lookups are cached, and saved displays are never looked up again when the map loads.
  - Coordinates are interpolated along street address ranges, so a pin can sit a few metres from the house.
- **OpenStreetMap standard tiles**, loaded by visitors' browsers
  (https://operations.osmfoundation.org/policies/tiles/). The page complies with the policy:
  - it uses the HTTPS URL `tile.openstreetmap.org`;
  - attribution stays visible on the map;
  - browsers keep their normal Referer and User-Agent;
  - there is no prefetching, offline mode or bulk download.

  The tile URL is a single constant in `santa-map.js`, so it can be switched without other
  changes. The OSM Foundation may withdraw access for heavy use; if traffic grows, move to a
  commercial tile provider.
- **Leaflet 1.9.4** loads from unpkg, as on the Dog Map page.
- **Nominatim is not used.**

## Release checklist (for the publisher; not done)

1. Host the API, set the environment, and confirm `/api/santas` and `/api/area` over HTTPS.
2. Put the API address in the `santa-map-api` meta tag. Check that `SANTA_ALLOWED_ORIGINS` includes the site.
3. From two different devices: add a test sighting, see it on both, hide it with `admin.py`,
   and confirm the totals return to zero. Test records then stay hidden; nothing is deleted.
4. Run a backup and an export, and restore the backup to a scratch file to prove it works.
5. Publish the page through the normal review and publication step.

## Rollback

Remove the Santa links from `index.html` and `files.html`, the sitemap entry and the page, or
just clear the `santa-map-api` meta tag to stop new sightings. Export and back up the database
before shutting down or deleting any hosting.
