"""Santa map data rules. Every write runs in one SQLite transaction, so counts are
always computed from the same rows the map shows."""

import datetime
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time

from .geocoder import GeocoderUnavailable, clean_text, query_for, query_key

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS = os.path.join(os.path.dirname(HERE), 'migrations')

CATEGORIES = ('matching', 'other')
CORRECTION_KINDS = ('location', 'removed', 'quantity', 'category', 'other')
MAX_ADDRESS, MAX_DESCRIPTION, MAX_MESSAGE, MAX_QUANTITY = 120, 150, 500, 10
KEY_PATTERN = re.compile(r'^[A-Za-z0-9-]{16,64}$')

# (requests, seconds) per client; geocoder is a daily cap shared by everyone
LIMITS = {'preview': (30, 600), 'submit': (12, 600), 'correction': (6, 600), 'admin_fail': (10, 600)}
GEOCODER_DAILY = 1000

PUBLIC_FIELDS = ('public_id', 'category', 'address', 'lat', 'lon', 'quantity', 'description',
                 'first_reported_on', 'last_reported_on')


class Problem(Exception):
    """A request the visitor can fix or retry. status is the HTTP status."""

    def __init__(self, status, code, message, **extra):
        super().__init__(message)
        self.status, self.code, self.message, self.extra = status, code, message, extra

    def body(self):
        return dict({'error': self.code, 'message': self.message}, **self.extra)


def connect(path):
    db = sqlite3.connect(path, timeout=10, isolation_level=None, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA busy_timeout = 10000')
    db.execute('PRAGMA foreign_keys = ON')
    if path != ':memory:':
        db.execute('PRAGMA journal_mode = WAL')
    return db


def migrate(db):
    db.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    done = {r[0] for r in db.execute('SELECT version FROM schema_migrations')}
    for name in sorted(os.listdir(MIGRATIONS)):
        if name.endswith('.sql') and name not in done:
            with open(os.path.join(MIGRATIONS, name), encoding='utf-8') as f:
                sql = f.read()
            stamp = name.replace("'", '') + "', '" + _now()
            try:   # one transaction per migration file
                db.executescript(f"BEGIN IMMEDIATE;\n{sql}\nINSERT INTO schema_migrations VALUES ('{stamp}');\nCOMMIT;")
            except Exception:
                if db.in_transaction:
                    db.execute('ROLLBACK')
                raise


def _now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def property_key(address):
    """One key per property: the geocoder's standardized address, case and spacing folded."""
    return ' '.join(address.upper().replace(',', ' ').split())


def public(row):
    return {
        'id': row['public_id'], 'category': row['category'], 'address': row['address'],
        'lat': row['lat'], 'lon': row['lon'], 'quantity': row['quantity'],
        'description': row['description'],
        'first_reported_on': row['first_reported_on'], 'last_reported_on': row['last_reported_on'],
    }


class Store:
    def __init__(self, db_path, season, geocoder, boundary, client_salt, today=None, clock=time.time):
        if not client_salt or len(client_salt) < 16:
            raise ValueError('a client salt of at least 16 characters is required')
        self.db_path, self.season, self.geocoder, self.boundary = db_path, int(season), geocoder, boundary
        self.salt = client_salt.encode()
        self.today = today or (lambda: datetime.date.today().isoformat())
        self.clock = clock
        db = self._db()
        migrate(db)
        db.close()

    def _db(self):
        return connect(self.db_path)

    # ------------------------------------------------------------- rate limits
    def client_key(self, ip):
        return hmac.new(self.salt, (ip or 'unknown').encode(), hashlib.sha256).hexdigest()[:32]

    def _count(self, db, bucket, client, limit, window):
        now = int(self.clock())
        start = now - now % window
        db.execute('BEGIN IMMEDIATE')
        try:
            db.execute('DELETE FROM rate_counts WHERE window_start < ?', (now - 2 * 86400,))
            db.execute('INSERT INTO rate_counts VALUES (?, ?, ?, 1) ON CONFLICT (bucket, client_key, window_start) '
                       'DO UPDATE SET count = count + 1', (bucket, client, start))
            count = db.execute('SELECT count FROM rate_counts WHERE bucket = ? AND client_key = ? AND window_start = ?',
                               (bucket, client, start)).fetchone()[0]
            db.execute('COMMIT')
        except Exception:
            db.execute('ROLLBACK')
            raise
        if count > limit:
            raise Problem(429, 'rate_limited', 'Too many requests from this connection. Please wait a few minutes and try again.',
                          retry_after=start + window - now)

    def limit(self, bucket, client):
        limit, window = LIMITS[bucket]
        db = self._db()
        try:
            self._count(db, bucket, client, limit, window)
        finally:
            db.close()

    # ---------------------------------------------------------------- geocoding
    def resolve(self, entered):
        """Look an address up (cached) and check it against the coverage area."""
        address = _text(entered, 'address', MAX_ADDRESS, minimum=3)
        key = query_key(address)
        db = self._db()
        try:
            row = db.execute('SELECT result_json FROM geocode_cache WHERE query_key = ?', (key,)).fetchone()
            if row:
                matches = json.loads(row[0])
            else:
                self._count(db, 'geocoder', 'all', GEOCODER_DAILY, 86400)
                try:
                    matches = self.geocoder.lookup(query_for(address))
                except GeocoderUnavailable:
                    raise Problem(503, 'geocoder_unavailable',
                                  'The address lookup service isn’t responding right now. Your entry is still here; please try again in a few minutes.') from None
                db.execute('INSERT OR REPLACE INTO geocode_cache VALUES (?, ?, ?)', (key, json.dumps(matches), _now()))
        finally:
            db.close()
        if not matches:
            raise Problem(422, 'not_found',
                          'We couldn’t find that address. Check the house number and street name, then try again.')
        if len(matches) > 1:
            raise Problem(422, 'ambiguous', 'That address matches more than one place. Choose the right one.',
                          candidates=[m['address'] for m in matches[:5]])
        m = matches[0]
        if not self.boundary.contains(m['lat'], m['lon']):
            raise Problem(422, 'out_of_area',
                          'That address is outside the map area, which covers Monroe Street and nearby blocks, including parts of Nakoma and Odana. If the Santa is on a nearby street, check the address and try again.',
                          resolved={'address': m['address'], 'lat': m['lat'], 'lon': m['lon']})
        return {'address': m['address'], 'lat': m['lat'], 'lon': m['lon']}

    # -------------------------------------------------------------- public read
    def totals(self, db):
        rows = db.execute('SELECT category, COALESCE(SUM(quantity), 0) FROM displays '
                          'WHERE season = ? AND status = ? GROUP BY category', (self.season, 'visible')).fetchall()
        found = dict((r[0], r[1]) for r in rows)
        return {c: found.get(c, 0) for c in CATEGORIES}

    def snapshot(self):
        db = self._db()
        try:
            db.execute('BEGIN')
            rows = db.execute('SELECT * FROM displays WHERE season = ? AND status = ? ORDER BY address, category',
                              (self.season, 'visible')).fetchall()
            totals = self.totals(db)
            db.execute('COMMIT')
        finally:
            db.close()
        last = max((r['last_reported_on'] for r in rows), default=None)
        return {'season': self.season, 'totals': totals, 'last_report_on': last,
                'displays': [public(r) for r in rows]}

    def area(self):
        return {'season': self.season, 'name': self.boundary.name, 'radius_m': self.boundary.radius_m,
                'bounds': self.boundary.bounds(), 'rings': self.boundary.outline_rings()}

    # ------------------------------------------------------------------ submit
    def submit(self, data):
        if not isinstance(data, dict):
            raise Problem(400, 'bad_request', 'Send a JSON object.')
        category = data.get('category')
        if category not in CATEGORIES:
            raise Problem(400, 'bad_category', 'Choose the matching Santa or a different Santa.')
        key = data.get('idempotency_key')
        if not isinstance(key, str) or not KEY_PATTERN.match(key):
            raise Problem(400, 'bad_key', 'This form needs to be reloaded. Please refresh the page.')
        entered = _text(data.get('address'), 'address', MAX_ADDRESS, minimum=3)
        if category == 'matching':
            if data.get('confirm_match') is not True:
                raise Problem(400, 'confirm_required',
                              'Please confirm that the Santa matches the photo and is 12 feet tall.')
            quantity = data.get('quantity', 1)
            if type(quantity) is not int or not 1 <= quantity <= MAX_QUANTITY:
                raise Problem(400, 'bad_quantity', f'Choose how many matching Santas, from 1 to {MAX_QUANTITY}.')
            description = None
        else:
            quantity = 1
            description = _text(data.get('description'), 'description', MAX_DESCRIPTION, minimum=3)

        earlier = self._replay(key)        # a retry needs no new address lookup
        if earlier:
            return earlier
        place = self.resolve(entered)       # may call the geocoder, so outside the write transaction
        pkey, today, now = property_key(place['address']), self.today(), _now()

        db = self._db()
        try:
            db.execute('BEGIN IMMEDIATE')
            try:
                raced = self._replay(key, db)
                if raced:                    # a retry raced the first attempt
                    db.execute('COMMIT')
                    return raced
                inserted = db.execute(
                    'INSERT INTO displays (public_id, season, category, property_key, address, lat, lon, quantity, '
                    'description, first_reported_on, last_reported_on, created_at, updated_at) '
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
                    'ON CONFLICT (season, category, property_key) DO NOTHING',
                    (secrets.token_urlsafe(9), self.season, category, pkey, place['address'], place['lat'],
                     place['lon'], quantity, description, today, today, now, now)).rowcount
                display = db.execute('SELECT * FROM displays WHERE season = ? AND category = ? AND property_key = ?',
                                     (self.season, category, pkey)).fetchone()
                if inserted:
                    outcome, message = 'created', 'Thanks! Your Santa is on the map.'
                elif display['status'] == 'hidden':
                    outcome = 'review'
                    message = ('Thanks. This address was taken off the map earlier, so an editor will review your '
                               'report before it reappears.')
                    self._flag(db, display['id'], 'hidden_rereport', None, quantity if category == 'matching' else None, now)
                elif category == 'matching' and quantity != display['quantity']:
                    outcome = 'review'
                    message = (f'Thanks. This address is already on the map with {display["quantity"]} matching '
                               f'Santa{"s" if display["quantity"] != 1 else ""}. We’ve sent your count of {quantity} '
                               'to an editor to check.')
                    self._flag(db, display['id'], 'conflicting_report', None, quantity, now)
                    self._seen(db, display['id'], today, now)
                else:
                    outcome, message = 'confirmed', 'Thanks! This Santa was already on the map, and your sighting confirms it.'
                    self._seen(db, display['id'], today, now)
                display = db.execute('SELECT * FROM displays WHERE id = ?', (display['id'],)).fetchone()
                response = {'outcome': outcome, 'message': message,
                            'display': public(display) if display['status'] == 'visible' else None}
                db.execute('INSERT INTO submissions (idempotency_key, display_id, outcome, category, quantity, '
                           'description, entered_address, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                           (key, display['id'], outcome, category, quantity, description, entered,
                            json.dumps(response), now))
                response['totals'] = self.totals(db)
                response['season'] = self.season
                db.execute('COMMIT')
                return response
            except Exception:
                db.execute('ROLLBACK')
                raise
        finally:
            db.close()

    def _replay(self, key, db=None):
        """The answer to a retried save: the first attempt's outcome, but the display as it
        is now, read in the same transaction as the totals. A display an editor has since
        hidden, edited or that belongs to another season is never reported as on the map."""
        own = db is None
        if own:
            db = self._db()
            db.execute('BEGIN')
        try:
            row = db.execute('SELECT s.response_json, d.* FROM submissions s JOIN displays d ON d.id = s.display_id '
                             'WHERE s.idempotency_key = ?', (key,)).fetchone()
            if not row:
                return None
            first = json.loads(row['response_json'])
            on_map = row['status'] == 'visible' and row['season'] == self.season
            if on_map or first['display'] is None:
                message = first['message']
            else:
                message = 'We already received this report. That Santa isn’t on the map right now.'
            return {'outcome': first['outcome'], 'message': message, 'display': public(row) if on_map else None,
                    'totals': self.totals(db), 'season': self.season, 'repeat': True}
        finally:
            if own:
                db.execute('COMMIT')
                db.close()

    @staticmethod
    def _seen(db, display_id, today, now):
        db.execute('UPDATE displays SET last_reported_on = MAX(last_reported_on, ?), report_count = report_count + 1, '
                   'updated_at = ? WHERE id = ?', (today, now, display_id))

    @staticmethod
    def _flag(db, display_id, kind, message, quantity, now):
        open_same = db.execute("SELECT id FROM corrections WHERE display_id = ? AND kind = ? AND status = 'open' "
                               'AND COALESCE(proposed_quantity, 0) = COALESCE(?, 0)', (display_id, kind, quantity)).fetchone()
        if not open_same:
            db.execute('INSERT INTO corrections (display_id, kind, message, proposed_quantity, created_at) '
                       'VALUES (?, ?, ?, ?, ?)', (display_id, kind, message, quantity, now))

    # ------------------------------------------------------------- corrections
    def request_correction(self, data):
        if not isinstance(data, dict):
            raise Problem(400, 'bad_request', 'Send a JSON object.')
        kind = data.get('kind')
        if kind not in CORRECTION_KINDS:
            raise Problem(400, 'bad_kind', 'Choose what needs correcting.')
        message = data.get('message')
        message = None if message in (None, '') else _text(message, 'message', MAX_MESSAGE)
        if kind in ('location', 'category', 'other') and not message:
            raise Problem(400, 'message_required', 'Please say briefly what should change.')
        quantity = data.get('proposed_quantity')
        if quantity is not None and (type(quantity) is not int or not 1 <= quantity <= MAX_QUANTITY):
            raise Problem(400, 'bad_quantity', f'Choose a count from 1 to {MAX_QUANTITY}.')
        if kind == 'quantity' and quantity is None:
            raise Problem(400, 'quantity_required', 'Choose the correct number of Santas.')
        db = self._db()
        try:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT id FROM displays WHERE public_id = ? AND season = ? AND status = 'visible'",
                             (str(data.get('display_id')), self.season)).fetchone()
            if not row:
                db.execute('ROLLBACK')
                raise Problem(404, 'not_found', 'That Santa is no longer on the map.')
            db.execute('INSERT INTO corrections (display_id, kind, message, proposed_quantity, created_at) '
                       'VALUES (?, ?, ?, ?, ?)', (row['id'], kind, message, quantity, _now()))
            db.execute('COMMIT')
        finally:
            db.close()
        return {'status': 'received',
                'message': 'Thanks. An editor will review this request. The map won’t change until they do.'}

    # ------------------------------------------------------------------ editor
    def open_corrections(self, status='open'):
        db = self._db()
        try:
            rows = db.execute(
                'SELECT c.id, c.kind, c.message, c.proposed_quantity, c.status, c.resolution, c.created_at, '
                'c.resolved_at, d.public_id, d.category, d.address, d.quantity, d.status AS display_status '
                'FROM corrections c JOIN displays d ON d.id = c.display_id WHERE c.status = ? ORDER BY c.id',
                (status,)).fetchall()
        finally:
            db.close()
        return {'corrections': [dict(r) for r in rows]}

    def edit_display(self, public_id, changes):
        """Editor change: category, quantity, description, address (looked up again) or
        status visible/hidden. Logged with before and after; nothing is deleted."""
        allowed = {'category', 'quantity', 'description', 'address', 'status', 'correction_id'}
        if not isinstance(changes, dict) or not changes or set(changes) - allowed:
            raise Problem(400, 'bad_request', 'Allowed fields: ' + ', '.join(sorted(allowed)))
        sets = {}
        if 'category' in changes:
            if changes['category'] not in CATEGORIES:
                raise Problem(400, 'bad_category', 'category must be matching or other')
            sets['category'] = changes['category']
        if 'quantity' in changes:
            q = changes['quantity']
            if type(q) is not int or not 1 <= q <= MAX_QUANTITY:
                raise Problem(400, 'bad_quantity', f'quantity must be 1 to {MAX_QUANTITY}')
            sets['quantity'] = q
        if 'description' in changes:
            d = changes['description']
            sets['description'] = None if d in (None, '') else _text(d, 'description', MAX_DESCRIPTION)
        if 'status' in changes:
            if changes['status'] not in ('visible', 'hidden'):
                raise Problem(400, 'bad_status', 'status must be visible or hidden')
            sets['status'] = changes['status']
        if 'address' in changes:
            place = self.resolve(changes['address'])
            sets.update(address=place['address'], lat=place['lat'], lon=place['lon'],
                        property_key=property_key(place['address']))
        now = _now()
        db = self._db()
        try:
            db.execute('BEGIN IMMEDIATE')
            try:
                before = db.execute('SELECT * FROM displays WHERE public_id = ?', (str(public_id),)).fetchone()
                if not before:
                    raise Problem(404, 'not_found', 'No display with that id.')
                if sets.get('category') == 'matching' and before['category'] == 'other' and 'description' not in sets:
                    sets['description'] = None
                if sets:
                    cols = ', '.join(f'{k} = ?' for k in sets)
                    try:
                        db.execute(f'UPDATE displays SET {cols}, updated_at = ? WHERE id = ?',
                                   list(sets.values()) + [now, before['id']])
                    except sqlite3.IntegrityError:
                        raise Problem(409, 'duplicate', 'Another display already has that address and category. '
                                      'Hide one of them instead.') from None
                after = db.execute('SELECT * FROM displays WHERE id = ?', (before['id'],)).fetchone()
                correction = changes.get('correction_id')
                if correction is not None:
                    if not db.execute('UPDATE corrections SET status = ?, resolution = ?, resolved_at = ? '
                                      'WHERE id = ? AND display_id = ?',
                                      ('resolved', 'display edited', now, correction, before['id'])).rowcount:
                        raise Problem(404, 'not_found', 'No correction with that id for this display.')
                db.execute('INSERT INTO audit_log (at, action, display_id, correction_id, before_json, after_json) '
                           'VALUES (?, ?, ?, ?, ?, ?)', (now, 'edit_display', before['id'], correction,
                                                         json.dumps(dict(before)), json.dumps(dict(after))))
                totals = self.totals(db)
                db.execute('COMMIT')
            except Exception:
                db.execute('ROLLBACK')
                raise
        finally:
            db.close()
        return {'display': dict(public(after), status=after['status']), 'totals': totals}

    def close_correction(self, correction_id, data):
        status = (data or {}).get('status')
        if status not in ('resolved', 'dismissed'):
            raise Problem(400, 'bad_status', 'status must be resolved or dismissed')
        note = (data or {}).get('resolution')
        note = None if note in (None, '') else _text(note, 'resolution', MAX_MESSAGE)
        now = _now()
        db = self._db()
        try:
            db.execute('BEGIN IMMEDIATE')
            changed = db.execute("UPDATE corrections SET status = ?, resolution = ?, resolved_at = ? "
                                 "WHERE id = ? AND status = 'open'", (status, note, now, correction_id)).rowcount
            if changed:
                db.execute('INSERT INTO audit_log (at, action, correction_id, after_json) VALUES (?, ?, ?, ?)',
                           (now, 'close_correction', correction_id, json.dumps({'status': status, 'resolution': note})))
            db.execute('COMMIT')
        finally:
            db.close()
        if not changed:
            raise Problem(404, 'not_found', 'No open correction with that id.')
        return {'id': correction_id, 'status': status}

    def export(self):
        db = self._db()
        try:
            db.execute('BEGIN')
            out = {t: [dict(r) for r in db.execute(f'SELECT * FROM {t} ORDER BY id')]
                   for t in ('displays', 'submissions', 'corrections', 'audit_log')}
            db.execute('COMMIT')
        finally:
            db.close()
        out['exported_at'] = _now()
        return out


def _text(value, field, maximum, minimum=1):
    if not isinstance(value, str):
        raise Problem(400, f'{field}_required', f'Please enter the {field}.')
    text = clean_text(value)
    if len(text) < minimum:
        raise Problem(400, f'{field}_required', f'Please enter the {field}.')
    if len(text) > maximum:
        raise Problem(400, f'{field}_too_long', f'Please keep the {field} under {maximum} characters.')
    return text
