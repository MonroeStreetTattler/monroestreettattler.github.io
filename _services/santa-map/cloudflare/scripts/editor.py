"""Run the Santa map editor tool (../admin.py) without handling the editor token.

  python3 scripts/editor.py production corrections
  python3 scripts/editor.py production hide <display-id> --correction <n>
  python3 scripts/editor.py production edit <display-id> --quantity 2
  python3 scripts/editor.py staging show <display-id>

Everything after the target is passed to admin.py (see ../README.md for its commands).
The token is read from the macOS Keychain (service "Santa map editor token", account =
the Worker's name, saved there by set-secrets.py) straight into admin.py's environment.
It never appears on a command line, in a file or in the output. `export` prints private
data, so send it to a private file, never into this repository.
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADMIN = os.path.join(os.path.dirname(HERE), 'admin.py')
SERVICE = 'Santa map editor token'
TARGETS = {
    'production': ('santa-map-api', 'https://santa-map-api.monroestreettattler.workers.dev'),
    'staging': ('santa-map-api-staging-2026', 'https://santa-map-api-staging-2026.monroestreettattler.workers.dev'),
}


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in TARGETS:
        sys.exit('usage: python3 scripts/editor.py production|staging <admin.py command> [options]')
    account, api = TARGETS[sys.argv[1]]
    found = subprocess.run(['security', 'find-generic-password', '-a', account, '-s', SERVICE, '-w'],
                           capture_output=True, text=True)
    token = found.stdout.strip()
    if found.returncode != 0 or not token:
        sys.exit(f'No editor token for {account} in the Keychain. Run scripts/set-secrets.py for that config first.')
    env = dict(os.environ, SANTA_ADMIN_TOKEN=token, PYTHONDONTWRITEBYTECODE='1')
    sys.exit(subprocess.run([sys.executable, ADMIN, '--api', api] + sys.argv[2:], env=env).returncode)


if __name__ == '__main__':
    main()
