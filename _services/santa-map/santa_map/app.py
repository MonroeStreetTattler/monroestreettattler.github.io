"""WSGI application for the Santa map API. Standard library only.

Public:  GET  /api/santas        current season's visible displays and totals
         GET  /api/area          coverage area (bounds and outline)
         POST /api/preview       look up an address and check the area (nothing saved)
         POST /api/sightings     save a sighting (idempotent by idempotency_key)
         POST /api/corrections   ask an editor to correct or remove a display
Editor (Authorization: Bearer <SANTA_ADMIN_TOKEN>; never sent to browsers, no CORS):
         GET  /api/admin/corrections[?status=open|resolved|dismissed]
         POST /api/admin/displays/<id>        edit or hide/show a display
         POST /api/admin/corrections/<id>     resolve or dismiss a request
         GET  /api/admin/export               everything, for backup
"""

import hashlib
import hmac
import json
import mimetypes
import os
import re
import urllib.parse

from .store import Problem

MAX_BODY = 4096
JSON_HEADERS = [('Content-Type', 'application/json; charset=utf-8'), ('Cache-Control', 'no-store'),
                ('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'no-referrer')]


class App:
    def __init__(self, store, admin_token=None, allowed_origins=(), client_ip_header=None, static_root=None):
        self.store = store
        # The editor API stays off unless a long random token is configured.
        self.admin_digest = hashlib.sha256(admin_token.encode()).digest() if admin_token and len(admin_token) >= 32 else None
        self.allowed_origins = set(allowed_origins)
        self.client_ip_header = client_ip_header
        self.static_root = os.path.realpath(static_root) if static_root else None

    # ------------------------------------------------------------------ WSGI
    def __call__(self, environ, start_response):
        method = environ.get('REQUEST_METHOD', 'GET')
        path = environ.get('PATH_INFO', '/')
        origin = environ.get('HTTP_ORIGIN')
        is_admin = path.startswith('/api/admin')
        cors = []
        if origin and origin in self.allowed_origins and path.startswith('/api/') and not is_admin:
            cors = [('Access-Control-Allow-Origin', origin), ('Vary', 'Origin')]
        try:
            if path.startswith('/api/'):
                if method == 'OPTIONS':
                    if not cors:
                        raise Problem(403, 'forbidden', 'Origin not allowed.')
                    start_response('204 No Content', cors + [
                        ('Access-Control-Allow-Methods', 'GET, POST'),
                        ('Access-Control-Allow-Headers', 'Content-Type'), ('Access-Control-Max-Age', '600')])
                    return [b'']
                status, body = self.route(method, path, environ)
                return self._json(start_response, status, body, cors)
            if self.static_root and method in ('GET', 'HEAD'):
                return self.static(path, start_response)
            raise Problem(404, 'not_found', 'Not found.')
        except Problem as p:
            extra = [('Retry-After', str(p.extra['retry_after']))] if 'retry_after' in p.extra else []
            return self._json(start_response, p.status, p.body(), cors + extra)
        except Exception:
            environ['wsgi.errors'].write('santa-map: unexpected error\n')
            import traceback
            traceback.print_exc(file=environ['wsgi.errors'])
            return self._json(start_response, 500, {'error': 'server_error', 'message': 'Something went wrong on our end. Please try again.'}, cors)

    def _json(self, start_response, status, body, extra):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        start_response(f'{status} {STATUS_TEXT.get(status, "OK")}', JSON_HEADERS + extra + [('Content-Length', str(len(data)))])
        return [data]

    # --------------------------------------------------------------- routing
    def route(self, method, path, environ):
        ip = self.client_ip(environ)
        client = self.store.client_key(ip)
        if path.startswith('/api/admin/') or path == '/api/admin':
            return self.admin(method, path, environ, client)
        if method == 'GET' and path == '/api/santas':
            return 200, self.store.snapshot()
        if method == 'GET' and path == '/api/area':
            return 200, self.store.area()
        if method == 'POST' and path == '/api/preview':
            self.store.limit('preview', client)
            data = read_json(environ)
            return 200, {'status': 'ok', 'place': self.store.resolve(data.get('address') if isinstance(data, dict) else None)}
        if method == 'POST' and path == '/api/sightings':
            self.store.limit('submit', client)
            result = self.store.submit(read_json(environ))
            return (200 if result.get('repeat') or result['outcome'] != 'created' else 201), result
        if method == 'POST' and path == '/api/corrections':
            self.store.limit('correction', client)
            return 202, self.store.request_correction(read_json(environ))
        if path in ('/api/santas', '/api/area', '/api/preview', '/api/sightings', '/api/corrections'):
            raise Problem(405, 'method_not_allowed', 'Method not allowed.')
        raise Problem(404, 'not_found', 'Not found.')

    def admin(self, method, path, environ, client):
        if not self.admin_digest:
            raise Problem(403, 'forbidden', 'Editor access is not configured.')
        auth = environ.get('HTTP_AUTHORIZATION', '')
        token = auth[7:] if auth.startswith('Bearer ') else ''
        if not hmac.compare_digest(hashlib.sha256(token.encode()).digest(), self.admin_digest):
            self.store.limit('admin_fail', client)
            raise Problem(401, 'unauthorized', 'Editor token required.')
        if method == 'GET' and path == '/api/admin/corrections':
            status = urllib.parse.parse_qs(environ.get('QUERY_STRING', '')).get('status', ['open'])[0]
            if status not in ('open', 'resolved', 'dismissed'):
                raise Problem(400, 'bad_status', 'status must be open, resolved or dismissed')
            return 200, self.store.open_corrections(status)
        if method == 'GET' and path == '/api/admin/export':
            return 200, self.store.export()
        m = re.fullmatch(r'/api/admin/displays/([A-Za-z0-9_-]{1,40})', path)
        if method == 'POST' and m:
            return 200, self.store.edit_display(m.group(1), read_json(environ))
        m = re.fullmatch(r'/api/admin/corrections/(\d{1,9})', path)
        if method == 'POST' and m:
            return 200, self.store.close_correction(int(m.group(1)), read_json(environ))
        raise Problem(404, 'not_found', 'Not found.')

    def client_ip(self, environ):
        if self.client_ip_header:     # only behind a proxy that sets this header itself
            value = environ.get('HTTP_' + self.client_ip_header.upper().replace('-', '_'), '')
            if value:
                return value.split(',')[0].strip()
        return environ.get('REMOTE_ADDR', '')

    # ------------------------------------------- local review only: static site
    def static(self, path, start_response):
        rel = urllib.parse.unquote(path).lstrip('/') or 'index.html'
        if any(part.startswith(('_', '.')) for part in rel.split('/')):
            raise Problem(404, 'not_found', 'Not found.')
        full = os.path.realpath(os.path.join(self.static_root, rel))
        if not full.startswith(self.static_root + os.sep) or not os.path.isfile(full):
            raise Problem(404, 'not_found', 'Not found.')
        with open(full, 'rb') as f:
            data = f.read()
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        start_response('200 OK', [('Content-Type', ctype), ('Content-Length', str(len(data))), ('Cache-Control', 'no-cache')])
        return [data]


def read_json(environ):
    if not environ.get('CONTENT_TYPE', '').split(';')[0].strip() == 'application/json':
        raise Problem(415, 'json_required', 'Send JSON.')
    try:
        length = int(environ.get('CONTENT_LENGTH') or 0)
    except ValueError:
        length = -1
    if length < 0 or length > MAX_BODY:
        raise Problem(413, 'too_large', 'That request is too large.')
    raw = environ['wsgi.input'].read(length) if length else b''
    try:
        return json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, ValueError):
        raise Problem(400, 'bad_json', 'Send valid JSON.') from None


STATUS_TEXT = {200: 'OK', 201: 'Created', 202: 'Accepted', 400: 'Bad Request', 401: 'Unauthorized',
               403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
               413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity',
               429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable'}


def from_environment(env=os.environ):
    """Build the app from SANTA_* settings (see README). No defaults for secrets."""
    from .geo import load_boundary
    from .geocoder import CensusGeocoder, FixtureGeocoder
    from .store import Store
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    geocoder_setting = env.get('SANTA_GEOCODER', 'census')
    if geocoder_setting.startswith('fixture:'):
        geocoder = FixtureGeocoder(path=geocoder_setting[len('fixture:'):])
    elif geocoder_setting == 'census':
        geocoder = CensusGeocoder()
    else:
        raise SystemExit('SANTA_GEOCODER must be census or fixture:<path>')
    for required in ('SANTA_DB', 'SANTA_CLIENT_SALT'):
        if not env.get(required):
            raise SystemExit(f'{required} must be set')
    store = Store(env['SANTA_DB'], int(env.get('SANTA_SEASON', '2026')), geocoder,
                  load_boundary(env.get('SANTA_BOUNDARY', os.path.join(here, 'boundary.json'))),
                  env['SANTA_CLIENT_SALT'])
    origins = [o.strip() for o in env.get('SANTA_ALLOWED_ORIGINS', 'https://monroestreettattler.com').split(',') if o.strip()]
    return App(store, env.get('SANTA_ADMIN_TOKEN'), origins, env.get('SANTA_CLIENT_IP_HEADER') or None,
               env.get('SANTA_STATIC_ROOT') or None)
