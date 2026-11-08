"""Generate and set the Worker's two secrets without ever showing or writing them.

  python3 scripts/set-secrets.py -c wrangler.staging.toml

- SANTA_CLIENT_SALT: random. It is sent only to Cloudflare; nobody needs it again.
  Changing it later only resets the rate-limit counts.
- SANTA_ADMIN_TOKEN: random. It is sent to Cloudflare and saved in your macOS
  Keychain (service "Santa map editor token", account = the Worker's name), so the
  editor tools can read it.

Values travel only through standard input, never on a command line, in a file or in
the output. Run it once per deployment (staging and production get different values).
"""

import os
import re
import secrets
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE = 'Santa map editor token'


def main():
    if len(sys.argv) != 3 or sys.argv[1] != '-c':
        sys.exit('usage: python3 scripts/set-secrets.py -c <wrangler config>')
    config = sys.argv[2]
    with open(os.path.join(HERE, config), encoding='utf-8') as f:
        worker = re.search(r'^name\s*=\s*"([^"]+)"', f.read(), re.M).group(1)
    salt, token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)

    # Keychain first, so the token is never set on Cloudflare without a saved copy.
    # `security -i` reads its command from standard input.
    command = f'add-generic-password -U -a "{worker}" -s "{SERVICE}" -w "{token}"\n'
    done = subprocess.run(['security', '-i'], input=command, text=True, capture_output=True)
    if done.returncode != 0:
        sys.exit('Could not save the editor token in the Keychain; nothing was changed on Cloudflare.')

    wrangler = os.path.join(HERE, 'node_modules', '.bin', 'wrangler')
    env = dict(os.environ, WRANGLER_SEND_METRICS='false')
    for name, value in (('SANTA_CLIENT_SALT', salt), ('SANTA_ADMIN_TOKEN', token)):
        put = subprocess.run([wrangler, 'secret', 'put', name, '-c', config], input=value + '\n', text=True,
                             capture_output=True, cwd=HERE, env=env)
        if put.returncode != 0:
            sys.exit(f'Setting {name} failed (Wrangler exit {put.returncode}). Nothing was printed; check access and retry.')
        print(f'{name} set on {worker}.')
    print(f'The editor token is in your Keychain: service "{SERVICE}", account "{worker}".')


if __name__ == '__main__':
    main()
