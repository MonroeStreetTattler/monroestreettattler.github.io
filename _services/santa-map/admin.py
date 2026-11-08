"""Editor tool for the Santa map. The token is read from SANTA_ADMIN_TOKEN, never from
the command line (so it stays out of shell history) and never from the website.

  python3 admin.py --api https://<api-host> corrections [--status open]
  python3 admin.py --api https://<api-host> hide <display-id> [--correction <n>]
  python3 admin.py --api https://<api-host> show <display-id>
  python3 admin.py --api https://<api-host> edit <display-id> [--quantity N] [--category matching|other]
                                                 [--description TEXT] [--address TEXT] [--correction <n>]
  python3 admin.py --api https://<api-host> close <correction-id> resolved|dismissed [--note TEXT]
  python3 admin.py --api https://<api-host> export > santa-export-YYYY-MM-DD.json

On the host itself (no network, works while the API is stopped):
  python3 admin.py backup <database> <backup-file>
  python3 admin.py restore <backup-file> <database>      (refuses to overwrite an existing database)
"""

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request


def call(api, method, path, body=None):
    token = os.environ.get('SANTA_ADMIN_TOKEN')
    if not token:
        sys.exit('Set SANTA_ADMIN_TOKEN in the environment first.')
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(api.rstrip('/') + path, data=data, method=method,
                                 headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                                          # Cloudflare refuses Python's default User-Agent (error 1010).
                                          'User-Agent': 'SantaMapEditor/1.0 (+https://monroestreettattler.com/santa-map.html)'})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'{e.code}: {e.read().decode(errors="replace")}')


def backup(src, dest):
    if os.path.exists(dest):
        sys.exit(f'{dest} already exists')
    with sqlite3.connect(src) as a, sqlite3.connect(dest) as b:
        a.backup(b)
    print(f'backed up {src} to {dest}')


def main(argv=None):
    p = argparse.ArgumentParser(description='Santa map editor tool')
    p.add_argument('--api', help='API base URL, for example https://santa-api.example')
    sub = p.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('corrections')
    c.add_argument('--status', default='open', choices=['open', 'resolved', 'dismissed'])
    for name in ('hide', 'show'):
        s = sub.add_parser(name)
        s.add_argument('display')
        s.add_argument('--correction', type=int)
    e = sub.add_parser('edit')
    e.add_argument('display')
    e.add_argument('--quantity', type=int)
    e.add_argument('--category', choices=['matching', 'other'])
    e.add_argument('--description')
    e.add_argument('--address')
    e.add_argument('--correction', type=int)
    x = sub.add_parser('close')
    x.add_argument('correction', type=int)
    x.add_argument('status', choices=['resolved', 'dismissed'])
    x.add_argument('--note')
    sub.add_parser('export')
    b = sub.add_parser('backup')
    b.add_argument('database')
    b.add_argument('file')
    r = sub.add_parser('restore')
    r.add_argument('file')
    r.add_argument('database')
    a = p.parse_args(argv)

    if a.cmd == 'backup':
        return backup(a.database, a.file)
    if a.cmd == 'restore':
        return backup(a.file, a.database)
    if not a.api:
        sys.exit('--api is required for this command')
    if a.cmd == 'corrections':
        out = call(a.api, 'GET', f'/api/admin/corrections?status={a.status}')
    elif a.cmd in ('hide', 'show', 'edit'):
        changes = {'status': 'hidden' if a.cmd == 'hide' else 'visible'} if a.cmd != 'edit' else {
            k: v for k, v in (('quantity', a.quantity), ('category', a.category),
                              ('description', a.description), ('address', a.address)) if v is not None}
        if a.correction is not None:
            changes['correction_id'] = a.correction
        out = call(a.api, 'POST', f'/api/admin/displays/{a.display}', changes)
    elif a.cmd == 'close':
        out = call(a.api, 'POST', f'/api/admin/corrections/{a.correction}', {'status': a.status, 'resolution': a.note})
    else:
        out = call(a.api, 'GET', '/api/admin/export')
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    print()


if __name__ == '__main__':
    main()
