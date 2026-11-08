"""Run the Santa map API with Python's built-in server.

Local review:   SANTA_DB=/tmp/santa-review.db SANTA_CLIENT_SALT=... SANTA_STATIC_ROOT=../.. python3 serve.py
Production:     run santa_map.wsgi:application under any WSGI server instead (see README).
"""

import os
import socketserver
import sys
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from santa_map.app import from_environment  # noqa: E402


class ThreadingServer(socketserver.ThreadingMixIn, WSGIServer):
    daemon_threads = True


class QuietHandler(WSGIRequestHandler):
    def log_request(self, *args):   # no IP addresses in logs
        pass


def main():
    host = os.environ.get('SANTA_HOST', '127.0.0.1')
    port = int(os.environ.get('SANTA_PORT', '8787'))
    server = make_server(host, port, from_environment(), server_class=ThreadingServer, handler_class=QuietHandler)
    print(f'santa-map listening on http://{host}:{port}/', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
