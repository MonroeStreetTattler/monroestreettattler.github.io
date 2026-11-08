"""Santa map service tests: data integrity, privacy and abuse limits.

Run from _services/santa-map:  python3 -m unittest discover -s tests -v
Every test uses its own temporary database and a fixture geocoder built from saved
U.S. Census Geocoder answers (2026-11-07); nothing touches the network.
"""

import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import unittest
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from santa_map import store as store_module  # noqa: E402
from santa_map.app import App  # noqa: E402
from santa_map.geo import load_boundary  # noqa: E402
from santa_map.geocoder import FixtureGeocoder, query_for  # noqa: E402
from santa_map.store import Problem, Store  # noqa: E402

BOUNDARY = os.path.join(os.path.dirname(HERE), 'boundary.json')
TOKEN = 'editor-test-token-' + 'x' * 30
ORIGIN = 'https://monroestreettattler.com'

MONROE_2500 = {'address': '2500 MONROE ST, MADISON, WI, 53711', 'lat': 43.05828, 'lon': -89.42737}
MONROE_2100 = {'address': '2100 MONROE ST, MADISON, WI, 53711', 'lat': 43.06283, 'lon': -89.42039}
NAKOMA_3700 = {'address': '3700 NAKOMA RD, MADISON, WI, 53711', 'lat': 43.05018, 'lon': -89.43718}
CAPITOL = {'address': '2 E MAIN ST, MADISON, WI, 53703', 'lat': 43.07399602785, 'lon': -89.383108835932}
MIDVALE = {'address': '702 N MIDVALE BLVD, MADISON, WI, 53705', 'lat': 43.074197245146, 'lon': -89.451204475224}

ANSWERS = {
    query_for('2500 Monroe St'): [MONROE_2500],
    query_for('2500 MONROE ST, MADISON, WI, 53711'): [MONROE_2500],
    query_for('2100 Monroe St'): [MONROE_2100],
    query_for('3700 Nakoma Rd'): [NAKOMA_3700],
    query_for('2 E Main St'): [CAPITOL],
    query_for('702 N Midvale Blvd'): [MIDVALE],
    query_for('Monroe St'): [MONROE_2500, MONROE_2100],      # one entry naming two places
}


def key():
    return str(uuid.uuid4())


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='santa-test-')
        self.addCleanup(shutil.rmtree, self.dir)
        self.db_path = os.path.join(self.dir, 'santa.db')
        self.geocoder = FixtureGeocoder(ANSWERS)
        self.store = self.make_store()
        self.app = App(self.store, TOKEN, [ORIGIN])
        self.ip = '203.0.113.7'

    def make_store(self):
        return Store(self.db_path, 2026, self.geocoder, load_boundary(BOUNDARY), 'test-salt-0123456789',
                     today=lambda: '2026-12-01')

    def call(self, method, path, body=None, headers=None, raw=None, ip=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b'')
        environ = {'REQUEST_METHOD': method, 'PATH_INFO': path.split('?')[0],
                   'QUERY_STRING': path.split('?')[1] if '?' in path else '',
                   'REMOTE_ADDR': ip or self.ip, 'wsgi.input': io.BytesIO(data), 'wsgi.errors': io.StringIO(),
                   'CONTENT_LENGTH': str(len(data)), 'CONTENT_TYPE': 'application/json' if body is not None or raw is not None else ''}
        for k, v in (headers or {}).items():
            environ['HTTP_' + k.upper().replace('-', '_')] = v
        result = {}

        def start(status, hdrs):
            result['status'] = int(status.split()[0])
            result['headers'] = dict(hdrs)
        out = b''.join(self.app(environ, start))
        return result['status'], json.loads(out), result['headers']

    def matching(self, address='2500 Monroe St', quantity=1, k=None, ip=None, **extra):
        body = dict({'category': 'matching', 'address': address, 'confirm_match': True, 'quantity': quantity,
                     'idempotency_key': k or key()}, **extra)
        return self.call('POST', '/api/sightings', body, ip=ip)

    def other(self, address='2500 Monroe St', description='Waving Santa with a sack', k=None):
        return self.call('POST', '/api/sightings', {'category': 'other', 'address': address,
                                                    'description': description, 'idempotency_key': k or key()})

    def totals(self):
        return self.call('GET', '/api/santas')[1]['totals']

    def admin(self, method, path, body=None, token=TOKEN):
        return self.call(method, path, body, headers={'Authorization': 'Bearer ' + token} if token else None)


class SubmissionTests(Base):
    def test_matching_and_other_save_with_their_own_counts(self):
        status, body, _ = self.matching()
        self.assertEqual(status, 201)
        self.assertEqual(body['outcome'], 'created')
        self.assertEqual(body['display']['address'], MONROE_2500['address'])
        self.assertEqual(body['totals'], {'matching': 1, 'other': 0})
        status, body, _ = self.other('3700 Nakoma Rd')
        self.assertEqual(status, 201)
        self.assertEqual(body['display']['description'], 'Waving Santa with a sack')
        self.assertEqual(body['totals'], {'matching': 1, 'other': 1})

    def test_required_fields(self):
        cases = [
            ({'category': 'matching', 'address': '2500 Monroe St', 'idempotency_key': key()}, 'confirm_required'),
            ({'category': 'matching', 'address': '', 'confirm_match': True, 'idempotency_key': key()}, 'address_required'),
            ({'category': 'other', 'address': '2500 Monroe St', 'idempotency_key': key()}, 'description_required'),
            ({'category': 'reindeer', 'address': '2500 Monroe St', 'idempotency_key': key()}, 'bad_category'),
            ({'category': 'matching', 'address': '2500 Monroe St', 'confirm_match': True, 'quantity': 0, 'idempotency_key': key()}, 'bad_quantity'),
            ({'category': 'matching', 'address': '2500 Monroe St', 'confirm_match': True, 'quantity': '2', 'idempotency_key': key()}, 'bad_quantity'),
            ({'category': 'matching', 'address': '2500 Monroe St', 'confirm_match': True}, 'bad_key'),
        ]
        for body, code in cases:
            with self.subTest(code=code):
                status, out, _ = self.call('POST', '/api/sightings', body)
                self.assertEqual((status, out['error']), (400, code))
        self.assertEqual(self.totals(), {'matching': 0, 'other': 0})

    def test_not_found_ambiguous_and_out_of_area_are_explained_and_not_saved(self):
        status, body, _ = self.matching('99999 Nowhere Ln')
        self.assertEqual((status, body['error']), (422, 'not_found'))
        status, body, _ = self.matching('Monroe St')
        self.assertEqual((status, body['error']), (422, 'ambiguous'))
        self.assertEqual(len(body['candidates']), 2)
        for far in ('2 E Main St', '702 N Midvale Blvd'):
            status, body, _ = self.matching(far)
            self.assertEqual((status, body['error']), (422, 'out_of_area'))
            self.assertIn('Nakoma', body['message'])
        self.assertEqual(self.totals(), {'matching': 0, 'other': 0})
        # picking one of the offered candidates then works
        status, body, _ = self.matching(MONROE_2500['address'])
        self.assertEqual(status, 201)

    def test_preview_resolves_without_saving_and_bias_to_madison(self):
        status, body, _ = self.call('POST', '/api/preview', {'address': '  2500   Monroe St '})
        self.assertEqual(status, 200)
        self.assertEqual(body['place']['address'], MONROE_2500['address'])
        self.assertEqual(query_for('2500 Monroe St'), '2500 Monroe St, Madison, WI')
        self.assertEqual(query_for('2500 Monroe St 53711'), '2500 Monroe St 53711')
        self.assertEqual(self.totals(), {'matching': 0, 'other': 0})

    def test_repeat_reports_confirm_without_adding(self):
        self.matching()
        status, body, _ = self.matching('2500 MONROE ST, MADISON, WI, 53711')    # same property, typed differently
        self.assertEqual((status, body['outcome']), (200, 'confirmed'))
        self.other('3700 Nakoma Rd')
        self.other('3700 Nakoma Rd', description='Different words for the same Santa')
        self.assertEqual(self.totals(), {'matching': 1, 'other': 1})
        self.assertEqual(len(self.call('GET', '/api/santas')[1]['displays']), 2)

    def test_retry_with_same_key_returns_first_answer_once(self):
        k = key()
        first = self.matching(k=k)[1]
        status, again, _ = self.matching(k=k)
        self.assertEqual(status, 200)
        self.assertTrue(again['repeat'])
        self.assertEqual(again['display'], first['display'])
        self.assertEqual(again['outcome'], 'created')
        db = sqlite3.connect(self.db_path)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM submissions').fetchone()[0], 1)
        self.assertEqual(db.execute('SELECT report_count FROM displays').fetchone()[0], 1)

    def test_simultaneous_duplicates_make_one_display(self):
        results, keys = [], [key() for _ in range(8)]
        same_key = key()

        def go(k):
            results.append(self.matching(k=k)[1])
        threads = [threading.Thread(target=go, args=(k,)) for k in keys + [same_key] * 4]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(results), 12)
        self.assertEqual(sum(r['outcome'] == 'created' and not r.get('repeat') for r in results), 1)
        self.assertEqual(self.totals(), {'matching': 1, 'other': 0})
        db = sqlite3.connect(self.db_path)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM displays').fetchone()[0], 1)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM submissions').fetchone()[0], 9)

    def test_conflicting_count_goes_to_editor_not_the_map(self):
        self.matching(quantity=1)
        status, body, _ = self.matching(quantity=3)
        self.assertEqual(body['outcome'], 'review')
        self.assertEqual(body['display']['quantity'], 1)
        self.assertEqual(self.totals()['matching'], 1)
        self.matching(quantity=3)      # the same disagreement is not queued twice
        queue = self.admin('GET', '/api/admin/corrections')[1]['corrections']
        self.assertEqual([(c['kind'], c['proposed_quantity']) for c in queue], [('conflicting_report', 3)])

    def test_several_santas_and_both_kinds_at_one_property(self):
        self.matching(quantity=3)
        self.other()
        self.matching('2100 Monroe St')
        body = self.call('GET', '/api/santas')[1]
        self.assertEqual(body['totals'], {'matching': 4, 'other': 1})
        at_2500 = [d for d in body['displays'] if d['address'] == MONROE_2500['address']]
        self.assertEqual(sorted(d['category'] for d in at_2500), ['matching', 'other'])

    def test_geocoder_down_saves_nothing_and_says_so(self):
        self.geocoder.down = True
        status, body, _ = self.matching()
        self.assertEqual((status, body['error']), (503, 'geocoder_unavailable'))
        self.assertNotIn('totals', body)
        self.geocoder.down = False
        self.assertEqual(self.totals(), {'matching': 0, 'other': 0})


class PersistenceTests(Base):
    def test_shared_across_clients_and_restart_without_regeocoding(self):
        self.matching(ip='198.51.100.1')
        self.other('3700 Nakoma Rd')
        calls = self.geocoder.calls
        restarted = App(self.make_store(), TOKEN, [ORIGIN])
        self.app = restarted
        for _ in range(3):
            body = self.call('GET', '/api/santas', ip='198.51.100.2')[1]
        self.assertEqual(body['totals'], {'matching': 1, 'other': 1})
        self.assertEqual(self.geocoder.calls, calls)        # loads never look addresses up

    def test_same_address_is_looked_up_once(self):
        self.call('POST', '/api/preview', {'address': '2500 Monroe St'})
        self.matching()
        self.other()
        self.assertEqual(self.geocoder.calls, 1)

    def test_client_coordinates_are_ignored(self):
        status, body, _ = self.matching(lat=43.0, lon=-89.0, season=1999)
        self.assertEqual(status, 201)
        self.assertEqual((body['display']['lat'], body['display']['lon']), (MONROE_2500['lat'], MONROE_2500['lon']))
        self.assertEqual(body['season'], 2026)

    def test_seasons_are_kept_apart(self):
        self.matching()
        next_year = Store(self.db_path, 2027, self.geocoder, load_boundary(BOUNDARY), 'test-salt-0123456789')
        self.assertEqual(next_year.snapshot()['totals'], {'matching': 0, 'other': 0})
        self.assertEqual(self.totals(), {'matching': 1, 'other': 0})


class EditorTests(Base):
    def test_editor_api_needs_the_token(self):
        for token in (None, 'wrong', TOKEN[:-1]):
            with self.subTest(token=token):
                status, body, _ = self.admin('GET', '/api/admin/corrections', token=token)
                self.assertEqual(status, 401)
        closed = App(self.store, None, [ORIGIN])
        self.app = closed
        self.assertEqual(self.admin('GET', '/api/admin/export')[0], 403)
        self.app = App(self.store, 'short', [ORIGIN])        # too short to count as configured
        self.assertEqual(self.admin('GET', '/api/admin/export', token='short')[0], 403)

    def test_failed_editor_logins_are_limited(self):
        statuses = [self.admin('GET', '/api/admin/export', token='guess')[0] for _ in range(12)]
        self.assertEqual(statuses[:10], [401] * 10)
        self.assertEqual(statuses[10:], [429, 429])

    def test_editor_api_has_no_cors(self):
        _, _, headers = self.call('GET', '/api/admin/export', headers={'Origin': ORIGIN, 'Authorization': 'Bearer ' + TOKEN})
        self.assertNotIn('Access-Control-Allow-Origin', headers)

    def test_correction_requests_change_nothing_until_an_editor_acts(self):
        display = self.matching(quantity=2)[1]['display']
        status, body, _ = self.call('POST', '/api/corrections', {'display_id': display['id'], 'kind': 'removed'})
        self.assertEqual(status, 202)
        self.assertEqual(self.totals()['matching'], 2)
        queue = self.admin('GET', '/api/admin/corrections')[1]['corrections']
        self.assertEqual(queue[0]['kind'], 'removed')
        status, body, _ = self.admin('POST', f'/api/admin/displays/{display["id"]}',
                                     {'status': 'hidden', 'correction_id': queue[0]['id']})
        self.assertEqual(status, 200)
        self.assertEqual(body['totals'], {'matching': 0, 'other': 0})
        self.assertEqual(self.call('GET', '/api/santas')[1]['displays'], [])
        self.assertEqual(self.admin('GET', '/api/admin/corrections')[1]['corrections'], [])
        export = self.admin('GET', '/api/admin/export')[1]
        self.assertEqual(len(export['displays']), 1)              # kept, only hidden
        self.assertEqual(export['audit_log'][0]['action'], 'edit_display')
        # a later report of a hidden display waits for the editor
        body = self.matching(quantity=2)[1]
        self.assertEqual((body['outcome'], body['display']), ('review', None))
        self.assertEqual(self.totals()['matching'], 0)

    def test_editor_corrections_update_totals(self):
        display = self.matching(quantity=1)[1]['display']
        self.admin('POST', f'/api/admin/displays/{display["id"]}', {'quantity': 3})
        self.assertEqual(self.totals(), {'matching': 3, 'other': 0})
        self.admin('POST', f'/api/admin/displays/{display["id"]}', {'category': 'other', 'description': 'Smaller Santa', 'quantity': 1})
        self.assertEqual(self.totals(), {'matching': 0, 'other': 1})
        status, body, _ = self.admin('POST', f'/api/admin/displays/{display["id"]}', {'address': '2100 Monroe St'})
        self.assertEqual(body['display']['address'], MONROE_2100['address'])
        status, body, _ = self.admin('POST', f'/api/admin/displays/{display["id"]}', {'address': '2 E Main St'})
        self.assertEqual((status, body['error']), (422, 'out_of_area'))

    def test_editor_cannot_make_a_duplicate(self):
        a = self.matching()[1]['display']
        self.matching('2100 Monroe St')
        status, body, _ = self.admin('POST', f'/api/admin/displays/{a["id"]}', {'address': '2100 Monroe St'})
        self.assertEqual(status, 409)
        self.assertEqual(self.totals()['matching'], 2)

    def test_corrections_need_a_real_visible_display(self):
        status, body, _ = self.call('POST', '/api/corrections', {'display_id': 'nope', 'kind': 'removed'})
        self.assertEqual(status, 404)
        display = self.matching()[1]['display']
        status, body, _ = self.call('POST', '/api/corrections', {'display_id': display['id'], 'kind': 'location'})
        self.assertEqual((status, body['error']), (400, 'message_required'))


class RetryAfterChangeTests(Base):
    """A retried save must describe the display as it is now, agree with the public
    snapshot, and write nothing new."""

    def counts(self):
        db = sqlite3.connect(self.db_path)
        return (db.execute('SELECT COUNT(*) FROM submissions').fetchone()[0],
                db.execute('SELECT COALESCE(SUM(report_count), 0) FROM displays').fetchone()[0],
                db.execute('SELECT COUNT(*) FROM corrections').fetchone()[0])

    def assert_agrees_with_snapshot(self, reply):
        snap = self.call('GET', '/api/santas')[1]
        self.assertEqual(reply['totals'], snap['totals'])
        if reply['display'] is not None:
            self.assertIn(reply['display'], snap['displays'])

    def test_retry_after_hide_is_not_reported_on_the_map(self):
        k = key()
        display = self.matching(k=k)[1]['display']
        self.admin('POST', f'/api/admin/displays/{display["id"]}', {'status': 'hidden'})
        before = self.counts()
        status, reply, _ = self.matching(k=k)
        self.assertEqual(status, 200)
        self.assertTrue(reply['repeat'])
        self.assertIsNone(reply['display'])
        self.assertNotIn('on the map.', reply['message'].replace('isn’t on the map', ''))
        self.assertEqual(reply['totals'], {'matching': 0, 'other': 0})
        self.assert_agrees_with_snapshot(reply)
        self.assertEqual(self.counts(), before)

    def test_retry_after_edits_returns_the_edited_display(self):
        k = key()
        display = self.matching(k=k)[1]['display']
        self.admin('POST', f'/api/admin/displays/{display["id"]}', {'quantity': 3, 'address': '2100 Monroe St'})
        before, calls = self.counts(), self.geocoder.calls
        reply = self.matching(k=k)[1]
        self.assertEqual(reply['display']['quantity'], 3)
        self.assertEqual(reply['display']['address'], MONROE_2100['address'])
        self.assertEqual(reply['totals'], {'matching': 3, 'other': 0})
        self.assert_agrees_with_snapshot(reply)
        self.assertEqual(self.counts(), before)
        self.assertEqual(self.geocoder.calls, calls)          # a retry needs no new lookup
        self.admin('POST', f'/api/admin/displays/{display["id"]}', {'category': 'other', 'description': 'Not the model', 'quantity': 1})
        reply = self.matching(k=k)[1]
        self.assertEqual(reply['display']['category'], 'other')
        self.assert_agrees_with_snapshot(reply)

    def test_retry_after_season_change_is_not_on_this_seasons_map(self):
        k = key()
        self.matching(k=k)
        self.app = App(Store(self.db_path, 2027, self.geocoder, load_boundary(BOUNDARY), 'test-salt-0123456789'), TOKEN, [ORIGIN])
        before = self.counts()
        reply = self.matching(k=k)[1]
        self.assertIsNone(reply['display'])
        self.assertEqual((reply['season'], reply['totals']), (2027, {'matching': 0, 'other': 0}))
        self.assert_agrees_with_snapshot(reply)
        self.assertEqual(self.counts(), before)

    def test_raced_retry_uses_the_same_current_answer(self):
        k = key()
        display = self.matching(k=k)[1]['display']
        self.admin('POST', f'/api/admin/displays/{display["id"]}', {'status': 'hidden'})
        real = self.store._replay
        calls = []

        def miss_first(key_, db=None):           # the pre-check misses, as if the first save landed just after it
            calls.append(db)
            return None if db is None else real(key_, db)
        self.store._replay = miss_first
        before = self.counts()
        reply = self.matching(k=k)[1]
        self.assertEqual(len(calls), 2)
        self.assertIsNotNone(calls[1])
        self.assertIsNone(reply['display'])
        self.assertEqual(reply['totals'], {'matching': 0, 'other': 0})
        self.assertEqual(self.counts(), before)


class PrivacyAndLimitTests(Base):
    def test_public_read_has_only_display_fields(self):
        self.matching(ip='192.0.2.55')
        self.other()
        body = self.call('GET', '/api/santas')[1]
        self.assertEqual(set(body), {'season', 'totals', 'last_report_on', 'displays'})
        for d in body['displays']:
            self.assertEqual(set(d), {'id', 'category', 'address', 'lat', 'lon', 'quantity', 'description',
                                      'first_reported_on', 'last_reported_on'})
        text = json.dumps(body)
        for private in ('192.0.2.55', 'report_count', 'property_key', 'idempotency', 'entered'):
            self.assertNotIn(private, text)
        db = sqlite3.connect(self.db_path)
        stored = json.dumps([list(r) for t in ('rate_counts', 'submissions', 'displays')
                             for r in db.execute(f'SELECT * FROM {t}')])
        self.assertNotIn('192.0.2.55', stored)                   # IPs are only kept as keyed hashes

    def test_markup_is_stored_and_returned_as_plain_text(self):
        evil = '<img src=x onerror=alert(1)><script>x()</script>'
        status, body, headers = self.other(description=evil)
        self.assertEqual(status, 201)
        self.assertEqual(body['display']['description'], evil)
        self.assertTrue(headers['Content-Type'].startswith('application/json'))
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')

    def test_input_limits(self):
        status, body, _ = self.other(description='x' * 151)
        self.assertEqual((status, body['error']), (400, 'description_too_long'))
        status, body, _ = self.matching(address='9' * 121)
        self.assertEqual((status, body['error']), (400, 'address_too_long'))
        status, body, _ = self.call('POST', '/api/sightings', raw=b'{"a":"' + b'x' * 5000 + b'"}')
        self.assertEqual(status, 413)
        status, body, _ = self.call('POST', '/api/sightings', raw=b'not json')
        self.assertEqual(status, 400)
        environ_status = self.call('POST', '/api/preview', None)[0]
        self.assertEqual(environ_status, 415)

    def test_submissions_are_rate_limited_per_connection(self):
        statuses = [self.matching()[0] for _ in range(14)]
        self.assertEqual(statuses[12:], [429, 429])
        status, body, headers = self.matching()
        self.assertIn('Retry-After', headers)
        self.assertEqual(self.matching(ip='198.51.100.9')[0], 200)   # someone else is unaffected

    def test_geocoder_daily_cap(self):
        original = store_module.GEOCODER_DAILY
        store_module.GEOCODER_DAILY = 2
        self.addCleanup(setattr, store_module, 'GEOCODER_DAILY', original)
        self.call('POST', '/api/preview', {'address': '2500 Monroe St'})
        self.call('POST', '/api/preview', {'address': '2100 Monroe St'})
        status, body, _ = self.call('POST', '/api/preview', {'address': '3700 Nakoma Rd'})
        self.assertEqual(status, 429)
        status, _, _ = self.call('POST', '/api/preview', {'address': '2500 Monroe St'})   # cached still works
        self.assertEqual(status, 200)

    def test_cors_only_for_the_site(self):
        _, _, headers = self.call('GET', '/api/santas', headers={'Origin': ORIGIN})
        self.assertEqual(headers['Access-Control-Allow-Origin'], ORIGIN)
        _, _, headers = self.call('GET', '/api/santas', headers={'Origin': 'https://example.com'})
        self.assertNotIn('Access-Control-Allow-Origin', headers)

    def test_local_static_server_hides_private_folders(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
        self.app = App(self.store, TOKEN, [ORIGIN], static_root=root)
        for path in ('/_services/santa-map/boundary.json', '/_workflow/CURRENT-TASK.md', '/.git/HEAD', '/../etc/passwd'):
            with self.subTest(path=path):
                self.assertEqual(self.call('GET', path)[0], 404)

    def test_problem_messages_never_include_internals(self):
        with self.assertRaises(Problem):
            self.store.submit('not a dict')


if __name__ == '__main__':
    unittest.main()
