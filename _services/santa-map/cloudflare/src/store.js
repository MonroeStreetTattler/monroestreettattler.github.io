// Santa map data rules on Cloudflare D1. A port of ../../santa_map/store.py.
//
// The totals and snapshot_version are kept by triggers (migrations/0002_worker.sql) in
// the same transaction as every change to displays.
//
// D1 has no interactive transactions, so every write that the Python reference made
// inside BEGIN IMMEDIATE is one D1 batch here. A batch runs as a single transaction,
// and the statements in it decide for themselves with SQL conditions, never with
// answers read earlier in JavaScript. Reads that must agree with each other (a display
// and the totals) are also made in one batch.

import { AREA, contains } from './geo.js';
import { GeocoderUnavailable, censusLookup, cleanText, queryFor, queryKey } from './geocoder.js';

const CATEGORIES = ['matching', 'other'];
const CORRECTION_KINDS = ['location', 'removed', 'quantity', 'category', 'other'];
const MAX_ADDRESS = 120, MAX_DESCRIPTION = 150, MAX_MESSAGE = 500, MAX_QUANTITY = 10;
const KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

// [requests, seconds] per client; the geocoder cap is daily and shared by everyone.
export const LIMITS = { preview: [30, 600], submit: [12, 600], correction: [6, 600], admin_fail: [10, 600] };
const GEOCODER_DAILY = 1000;

const MESSAGES = {
  created: 'Thanks! Your Santa is on the map.',
  hidden: 'Thanks. This address was taken off the map earlier, so an editor will review your report before it reappears.',
  confirmed: 'Thanks! This Santa was already on the map, and your sighting confirms it.',
  replayGone: 'We already received this report. That Santa isn’t on the map right now.',
};

// A request the visitor can fix or retry. status is the HTTP status.
export class Problem extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body() {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

// The database could not be used (including a used-up daily D1 allowance).
export class Unavailable extends Error {}

// D1 with a running total of what each request costs, for the budget checks.
export class Db {
  constructor(d1) {
    this.d1 = d1;
    this.stats = { queries: 0, rows_read: 0, rows_written: 0 };
  }

  count(meta) {
    this.stats.queries++;
    this.stats.rows_read += (meta && meta.rows_read) || 0;
    this.stats.rows_written += (meta && meta.rows_written) || 0;
  }

  stmt(sql, ...params) {
    return this.d1.prepare(sql).bind(...params);
  }

  // For SQL with numbered parameters (?1, ?2 …): binds exactly as many values as it uses.
  numbered(sql, params) {
    const used = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
    return this.stmt(sql, ...params.slice(0, used));
  }

  async all(sql, ...params) {
    let res;
    try {
      res = await this.stmt(sql, ...params).all();
    } catch (e) {
      throw wrap(e);
    }
    this.count(res.meta);
    return res;
  }

  async one(sql, ...params) {
    return (await this.all(sql, ...params)).results[0] || null;
  }

  async batch(statements) {
    let out;
    try {
      out = await this.d1.batch(statements);
    } catch (e) {
      throw wrap(e);
    }
    out.forEach((r) => this.count(r.meta));
    return out;
  }
}

function wrap(e) {
  const message = String((e && e.message) || e);
  if (/UNIQUE constraint failed/.test(message)) {
    const err = new Error('unique');
    err.unique = true;
    return err;
  }
  const err = new Unavailable(message);
  return err;
}

function now() {
  return new Date().toISOString().slice(0, 19) + '+00:00';
}

// Report dates are Madison dates.
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

// One key per property: the geocoder's standardized address, case and spacing folded.
export function propertyKey(address) {
  return address.toUpperCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean).join(' ');
}

export function publicDisplay(row) {
  return {
    id: row.public_id, category: row.category, address: row.address,
    lat: row.lat, lon: row.lon, quantity: row.quantity, description: row.description,
    first_reported_on: row.first_reported_on, last_reported_on: row.last_reported_on,
  };
}

const PUBLIC_JSON = (d) => `json_object('id', ${d}.public_id, 'category', ${d}.category, 'address', ${d}.address, ` +
  `'lat', ${d}.lat, 'lon', ${d}.lon, 'quantity', ${d}.quantity, 'description', ${d}.description, ` +
  `'first_reported_on', ${d}.first_reported_on, 'last_reported_on', ${d}.last_reported_on)`;

const ROW_JSON = `json_object('id', id, 'public_id', public_id, 'season', season, 'category', category, ` +
  `'property_key', property_key, 'address', address, 'lat', lat, 'lon', lon, 'quantity', quantity, ` +
  `'description', description, 'status', status, 'first_reported_on', first_reported_on, ` +
  `'last_reported_on', last_reported_on, 'report_count', report_count, 'created_at', created_at, 'updated_at', updated_at)`;

export class Store {
  constructor(env, db) {
    this.db = db;
    this.season = parseInt(env.SANTA_SEASON || '2026', 10);
    this.geocoderDaily = parseInt(env.SANTA_GEOCODER_DAILY || String(GEOCODER_DAILY), 10);
    const geocoderUrl = env.SANTA_GEOCODER_URL;
    this.lookup = (query) => censusLookup(query, geocoderUrl || undefined);
  }

  // ------------------------------------------------------------- rate limits
  async limit(bucket, client, max, window) {
    if (max === undefined) [max, window] = LIMITS[bucket];
    const t = Math.floor(Date.now() / 1000);
    const start = t - (t % window);
    const row = await this.db.one(
      'INSERT INTO rate_counts VALUES (?, ?, ?, 1) ON CONFLICT (bucket, client_key, window_start) ' +
      'DO UPDATE SET count = count + 1 RETURNING count', bucket, client, start);
    if (row.count > max) {
      throw new Problem(429, 'rate_limited', 'Too many requests from this connection. Please wait a few minutes and try again.',
        { retry_after: start + window - t });
    }
  }

  // --------------------------------------------------------------- geocoding
  // Look an address up (cached) and check it against the coverage area.
  async resolve(entered) {
    const address = text(entered, 'address', MAX_ADDRESS, 3);
    const key = queryKey(address);
    const row = await this.db.one('SELECT result_json FROM geocode_cache WHERE query_key = ?', key);
    let matches;
    if (row) {
      matches = JSON.parse(row.result_json);
    } else {
      await this.limit('geocoder', 'all', this.geocoderDaily, 86400);
      try {
        matches = await this.lookup(queryFor(address));
      } catch (e) {
        if (!(e instanceof GeocoderUnavailable)) throw e;
        throw new Problem(503, 'geocoder_unavailable',
          'The address lookup service isn’t responding right now. Your entry is still here; please try again in a few minutes.');
      }
      await this.db.all('INSERT OR REPLACE INTO geocode_cache VALUES (?, ?, ?)', key, JSON.stringify(matches), now());
    }
    if (!matches.length) {
      throw new Problem(422, 'not_found',
        'We couldn’t find that address. Check the house number and street name, then try again.');
    }
    if (matches.length > 1) {
      throw new Problem(422, 'ambiguous', 'That address matches more than one place. Choose the right one.',
        { candidates: matches.slice(0, 5).map((m) => m.address) });
    }
    const m = matches[0];
    if (!contains(m.lat, m.lon)) {
      throw new Problem(422, 'out_of_area',
        'That address is outside the map area, which covers Monroe Street and nearby blocks, including parts of Nakoma and Odana. If the Santa is on a nearby street, check the address and try again.',
        { resolved: { address: m.address, lat: m.lat, lon: m.lon } });
    }
    return { address: m.address, lat: m.lat, lon: m.lon };
  }

  // ------------------------------------------------------------- public read
  totalsStmt() {
    return this.db.stmt('SELECT category, quantity AS n FROM season_totals WHERE season = ?', this.season);
  }

  static totals(result) {
    const found = Object.fromEntries(result.results.map((r) => [r.category, r.n]));
    return { matching: found.matching || 0, other: found.other || 0 };
  }

  versionStmt() {
    return this.db.stmt("SELECT value FROM meta WHERE key = 'snapshot_version'");
  }

  // The public snapshot as JSON text, rebuilt only when snapshot_version has changed.
  // snapshot_version is a random token naming one exact state of the displays (see
  // migrations/0003), so a snapshot is reused only when its token is exactly the current
  // one. That also holds after D1 Time Travel or a restore rolls the database back: the
  // restored token matches only a snapshot of that same state.
  // A routine poll reads one row: the token, when this instance already has that snapshot.
  // Otherwise the stored snapshot is used if it carries the current token (one more row),
  // and only the first instance to need a new one reads the displays and stores it.
  async snapshot(memo) {
    const version = (await this.db.one("SELECT value FROM meta WHERE key = 'snapshot_version'")).value;
    if (memo.body && memo.version === version && memo.season === this.season) return memo.body;
    const stored = await this.db.one('SELECT version, body FROM snapshots WHERE season = ?', this.season);
    if (stored && stored.version === version) {
      Object.assign(memo, { body: stored.body, version, season: this.season });
      return stored.body;
    }
    const [v, rows, totals] = await this.db.batch([
      this.versionStmt(),
      this.db.stmt("SELECT * FROM displays WHERE season = ? AND status = 'visible' ORDER BY address, category", this.season),
      this.totalsStmt(),
    ]);
    const displays = rows.results;
    const last = displays.reduce((m, r) => (m === null || r.last_reported_on > m ? r.last_reported_on : m), null);
    const body = JSON.stringify({ season: this.season, totals: Store.totals(totals), last_report_on: last,
      displays: displays.map(publicDisplay) });
    const built = v.results[0].value;     // the token these rows belong to (read in the same batch)
    // Stored only while that token is still current, so the stored row never names a state
    // other than the one it was built from.
    await this.db.all('INSERT INTO snapshots (season, version, body) SELECT ?1, ?2, ?3 ' +
      "WHERE ?2 = (SELECT value FROM meta WHERE key = 'snapshot_version') " +
      'ON CONFLICT (season) DO UPDATE SET version = excluded.version, body = excluded.body',
    this.season, built, body);
    Object.assign(memo, { body, version: built, season: this.season });
    return body;
  }

  area() {
    return { season: this.season, name: AREA.name, radius_m: AREA.radius_m, bounds: AREA.bounds, rings: AREA.rings };
  }

  // ------------------------------------------------------------------ submit
  async submit(data) {
    if (!isObject(data)) throw new Problem(400, 'bad_request', 'Send a JSON object.');
    const category = data.category;
    if (!CATEGORIES.includes(category)) {
      throw new Problem(400, 'bad_category', 'Choose the matching Santa or a different Santa.');
    }
    const key = data.idempotency_key;
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new Problem(400, 'bad_key', 'This form needs to be reloaded. Please refresh the page.');
    }
    const entered = text(data.address, 'address', MAX_ADDRESS, 3);
    let quantity, description;
    if (category === 'matching') {
      if (data.confirm_match !== true) {
        throw new Problem(400, 'confirm_required', 'Please confirm that the Santa matches the photo and is 12 feet tall.');
      }
      quantity = data.quantity === undefined ? 1 : data.quantity;
      if (!isInt(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
        throw new Problem(400, 'bad_quantity', `Choose how many matching Santas, from 1 to ${MAX_QUANTITY}.`);
      }
      description = null;
    } else {
      quantity = 1;
      description = text(data.description, 'description', MAX_DESCRIPTION, 3);
    }

    const earlier = await this.replay(key);      // a retry needs no new address lookup
    if (earlier) return earlier;
    const place = await this.resolve(entered);    // may call the geocoder, so before the write batch

    const token = randomId();
    const p = [token, this.season, category, propertyKey(place.address), place.address, place.lat, place.lon,
      quantity, description, today(), now(), key, entered, category === 'matching' ? quantity : null,
      MESSAGES.created, MESSAGES.hidden, MESSAGES.confirmed];
    // ?1 token  ?2 season  ?3 category  ?4 property key  ?5 address  ?6 lat  ?7 lon  ?8 quantity
    // ?9 description  ?10 today  ?11 now  ?12 idempotency key  ?13 entered address
    // ?14 quantity proposed to an editor  ?15-?17 messages
    const display = 'd.season = ?2 AND d.category = ?3 AND d.property_key = ?4';
    const fresh = 'NOT EXISTS (SELECT 1 FROM submissions WHERE idempotency_key = ?12)';
    const notMine = 'd.public_id != ?1';
    const flag = (kind, condition) => this.db.numbered(
      'INSERT INTO corrections (display_id, kind, message, proposed_quantity, created_at) ' +
      `SELECT d.id, '${kind}', NULL, ?14, ?11 FROM displays d WHERE ${display} AND ${condition} AND ${fresh} ` +
      `AND NOT EXISTS (SELECT 1 FROM corrections c WHERE c.display_id = d.id AND c.kind = '${kind}' ` +
      "AND c.status = 'open' AND COALESCE(c.proposed_quantity, 0) = COALESCE(?14, 0))", p);
    const outcome = "CASE WHEN d.public_id = ?1 THEN 'created' WHEN d.status = 'hidden' THEN 'review' " +
      "WHEN ?3 = 'matching' AND d.quantity != ?8 THEN 'review' ELSE 'confirmed' END";
    const message = "CASE WHEN d.public_id = ?1 THEN ?15 WHEN d.status = 'hidden' THEN ?16 " +
      "WHEN ?3 = 'matching' AND d.quantity != ?8 THEN 'Thanks. This address is already on the map with ' || d.quantity || " +
      "' matching Santa' || CASE WHEN d.quantity != 1 THEN 's' ELSE '' END || '. We’ve sent your count of ' || CAST(?8 AS INTEGER) || " +
      "' to an editor to check.' ELSE ?17 END";

    const results = await this.db.batch([
      // 0. a new display, unless this key was already used or the display exists
      this.db.numbered('INSERT INTO displays (public_id, season, category, property_key, address, lat, lon, quantity, ' +
        'description, first_reported_on, last_reported_on, created_at, updated_at) ' +
        `SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?11 WHERE ${fresh} ` +
        'ON CONFLICT (season, category, property_key) DO NOTHING', p),
      // 1. a report of a display an editor hid waits for the editor
      flag('hidden_rereport', `d.status = 'hidden'`),
      // 2. a different count for a matching display goes to the editor, not the map
      flag('conflicting_report', `d.status = 'visible' AND ?3 = 'matching' AND d.quantity != ?8 AND ${notMine}`),
      // 3. any other report of a visible display confirms it
      this.db.numbered('UPDATE displays AS d SET last_reported_on = MAX(last_reported_on, ?10), ' +
        `report_count = report_count + 1, updated_at = ?11 WHERE ${display} AND d.status = 'visible' AND ${notMine} AND ${fresh}`, p),
      // 4. the submission and its answer; inserts nothing if the key was already used
      this.db.numbered('INSERT INTO submissions (idempotency_key, display_id, outcome, category, quantity, description, ' +
        'entered_address, response_json, created_at) ' +
        `SELECT ?12, d.id, ${outcome}, ?3, ?8, ?9, ?13, json_object('outcome', ${outcome}, 'message', ${message}, ` +
        `'display', json(CASE WHEN d.status = 'visible' THEN ${PUBLIC_JSON('d')} END)), ?11 ` +
        `FROM displays d WHERE ${display} AND ${fresh} ON CONFLICT (idempotency_key) DO NOTHING`, p),
      // 5-6. the answer for this key and the totals, as of the end of this batch
      this.replayStmt(key),
      this.totalsStmt(),
    ]);
    const row = results[5].results[0];
    const totals = Store.totals(results[6]);
    if (results[4].meta.changes !== 1) return this.replayAnswer(row, totals);   // a retry raced the first attempt
    return { ...JSON.parse(row.response_json), totals, season: this.season };
  }

  replayStmt(key) {
    return this.db.stmt('SELECT s.response_json, d.* FROM submissions s JOIN displays d ON d.id = s.display_id ' +
      'WHERE s.idempotency_key = ?', key);
  }

  // The answer to a retried save: the first attempt's outcome, but the display as it is
  // now, read in the same batch as the totals. A display an editor has since hidden or
  // edited, or that belongs to another season, is never reported as on the map.
  async replay(key) {
    const [found, totals] = await this.db.batch([this.replayStmt(key), this.totalsStmt()]);
    const row = found.results[0];
    return row ? this.replayAnswer(row, Store.totals(totals)) : null;
  }

  replayAnswer(row, totals) {
    const first = JSON.parse(row.response_json);
    const onMap = row.status === 'visible' && row.season === this.season;
    return {
      outcome: first.outcome,
      message: onMap || first.display === null ? first.message : MESSAGES.replayGone,
      display: onMap ? publicDisplay(row) : null,
      totals, season: this.season, repeat: true,
    };
  }

  // ------------------------------------------------------------- corrections
  async requestCorrection(data) {
    if (!isObject(data)) throw new Problem(400, 'bad_request', 'Send a JSON object.');
    const kind = data.kind;
    if (!CORRECTION_KINDS.includes(kind)) throw new Problem(400, 'bad_kind', 'Choose what needs correcting.');
    let message = data.message;
    message = message === undefined || message === null || message === '' ? null : text(message, 'message', MAX_MESSAGE);
    if (['location', 'category', 'other'].includes(kind) && !message) {
      throw new Problem(400, 'message_required', 'Please say briefly what should change.');
    }
    const quantity = data.proposed_quantity === undefined ? null : data.proposed_quantity;
    if (quantity !== null && (!isInt(quantity) || quantity < 1 || quantity > MAX_QUANTITY)) {
      throw new Problem(400, 'bad_quantity', `Choose a count from 1 to ${MAX_QUANTITY}.`);
    }
    if (kind === 'quantity' && quantity === null) {
      throw new Problem(400, 'quantity_required', 'Choose the correct number of Santas.');
    }
    const res = await this.db.all(
      'INSERT INTO corrections (display_id, kind, message, proposed_quantity, created_at) ' +
      "SELECT id, ?, ?, ?, ? FROM displays WHERE public_id = ? AND season = ? AND status = 'visible'",
      kind, message, quantity, now(), String(data.display_id), this.season);
    if (res.meta.changes !== 1) throw new Problem(404, 'not_found', 'That Santa is no longer on the map.');
    return { status: 'received', message: 'Thanks. An editor will review this request. The map won’t change until they do.' };
  }

  // ------------------------------------------------------------------ editor
  async openCorrections(status = 'open') {
    const res = await this.db.all(
      'SELECT c.id, c.kind, c.message, c.proposed_quantity, c.status, c.resolution, c.created_at, ' +
      'c.resolved_at, d.public_id, d.category, d.address, d.quantity, d.status AS display_status ' +
      'FROM corrections c JOIN displays d ON d.id = c.display_id WHERE c.status = ? ORDER BY c.id', status);
    return { corrections: res.results };
  }

  // Editor change: category, quantity, description, address (looked up again) or status
  // visible/hidden. Logged with before and after; nothing is deleted.
  async editDisplay(publicId, changes) {
    const allowed = ['address', 'category', 'correction_id', 'description', 'quantity', 'status'];
    if (!isObject(changes) || !Object.keys(changes).length || Object.keys(changes).some((k) => !allowed.includes(k))) {
      throw new Problem(400, 'bad_request', 'Allowed fields: ' + allowed.join(', '));
    }
    const sets = {};
    if ('category' in changes) {
      if (!CATEGORIES.includes(changes.category)) throw new Problem(400, 'bad_category', 'category must be matching or other');
      sets.category = changes.category;
    }
    if ('quantity' in changes) {
      const q = changes.quantity;
      if (!isInt(q) || q < 1 || q > MAX_QUANTITY) throw new Problem(400, 'bad_quantity', `quantity must be 1 to ${MAX_QUANTITY}`);
      sets.quantity = q;
    }
    if ('description' in changes) {
      const d = changes.description;
      sets.description = d === null || d === '' ? null : text(d, 'description', MAX_DESCRIPTION);
    }
    if ('status' in changes) {
      if (!['visible', 'hidden'].includes(changes.status)) throw new Problem(400, 'bad_status', 'status must be visible or hidden');
      sets.status = changes.status;
    }
    if ('address' in changes) {
      const place = await this.resolve(changes.address);
      Object.assign(sets, { address: place.address, lat: place.lat, lon: place.lon, property_key: propertyKey(place.address) });
    }
    // Displays and corrections are never deleted and a correction never changes display,
    // so these checks still hold when the batch runs.
    const target = await this.db.one('SELECT id FROM displays WHERE public_id = ?', String(publicId));
    if (!target) throw new Problem(404, 'not_found', 'No display with that id.');
    const correction = changes.correction_id === undefined ? null : changes.correction_id;
    if (correction !== null && !(isInt(correction) &&
        await this.db.one('SELECT 1 AS ok FROM corrections WHERE id = ? AND display_id = ?', correction, target.id))) {
      throw new Problem(404, 'not_found', 'No correction with that id for this display.');
    }

    const t = now();
    const cols = Object.keys(sets).map((k) => `${k} = ?`);
    const values = Object.values(sets);
    // Switching an other Santa to matching clears its description unless one was given.
    if (sets.category === 'matching' && !('description' in sets)) cols.push("description = CASE WHEN category = 'other' THEN NULL ELSE description END");
    const statements = [
      this.db.stmt(`INSERT INTO audit_log (at, action, display_id, correction_id, before_json) SELECT ?, 'edit_display', id, ?, ${ROW_JSON} ` +
        'FROM displays WHERE id = ?', t, correction, target.id),
    ];
    if (cols.length) statements.push(this.db.stmt(`UPDATE displays SET ${cols.join(', ')}, updated_at = ? WHERE id = ?`, ...values, t, target.id));
    if (correction !== null) {
      statements.push(this.db.stmt("UPDATE corrections SET status = 'resolved', resolution = 'display edited', resolved_at = ? " +
        'WHERE id = ? AND display_id = ?', t, correction, target.id));
    }
    statements.push(
      this.db.stmt(`UPDATE audit_log SET after_json = (SELECT ${ROW_JSON} FROM displays WHERE id = ?1) ` +
        "WHERE id = (SELECT MAX(id) FROM audit_log WHERE action = 'edit_display' AND display_id = ?1 AND after_json IS NULL)", target.id),
      this.db.stmt('SELECT * FROM displays WHERE id = ?', target.id),
      this.totalsStmt(),
    );
    let results;
    try {
      results = await this.db.batch(statements);
    } catch (e) {
      if (e.unique) {
        throw new Problem(409, 'duplicate', 'Another display already has that address and category. Hide one of them instead.');
      }
      throw e;
    }
    const after = results[results.length - 2].results[0];
    return { display: { ...publicDisplay(after), status: after.status }, totals: Store.totals(results[results.length - 1]) };
  }

  async closeCorrection(id, data) {
    const status = isObject(data) ? data.status : undefined;
    if (!['resolved', 'dismissed'].includes(status)) throw new Problem(400, 'bad_status', 'status must be resolved or dismissed');
    let note = data.resolution;
    note = note === undefined || note === null || note === '' ? null : text(note, 'resolution', MAX_MESSAGE);
    const t = now();
    const [, closed] = await this.db.batch([
      this.db.stmt("INSERT INTO audit_log (at, action, correction_id, after_json) SELECT ?1, 'close_correction', ?2, " +
        "json_object('status', ?3, 'resolution', ?4) WHERE EXISTS (SELECT 1 FROM corrections WHERE id = ?2 AND status = 'open')",
      t, id, status, note),
      this.db.stmt("UPDATE corrections SET status = ?3, resolution = ?4, resolved_at = ?1 WHERE id = ?2 AND status = 'open'",
        t, id, status, note),
    ]);
    if (closed.meta.changes !== 1) throw new Problem(404, 'not_found', 'No open correction with that id.');
    return { id, status };
  }

  async export() {
    const tables = ['displays', 'submissions', 'corrections', 'audit_log'];
    const results = await this.db.batch(tables.map((t) => this.db.stmt(`SELECT * FROM ${t} ORDER BY id`)));
    const out = Object.fromEntries(tables.map((t, i) => [t, results[i].results]));
    out.exported_at = now();
    return out;
  }

  // Daily: forget rate-limit counts older than two days.
  async cleanUp() {
    const t = Math.floor(Date.now() / 1000);
    return this.db.all('DELETE FROM rate_counts WHERE window_start < ?', t - 2 * 86400);
  }
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

function text(value, field, maximum, minimum = 1) {
  if (typeof value !== 'string') throw new Problem(400, `${field}_required`, `Please enter the ${field}.`);
  const t = cleanText(value);
  const length = [...t].length;
  if (length < minimum) throw new Problem(400, `${field}_required`, `Please enter the ${field}.`);
  if (length > maximum) throw new Problem(400, `${field}_too_long`, `Please keep the ${field} under ${maximum} characters.`);
  return t;
}
