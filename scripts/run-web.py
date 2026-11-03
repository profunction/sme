"""Run the personal website locally; deployment remains a separate operator action."""
import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import webbrowser

from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.web_ai import WebConfig, create_web_app, password_hash


def main():
    parser = argparse.ArgumentParser(description="NightBrew single-owner website")
    parser.add_argument('--data-dir', default=str(Path.home()/'.nightbrew'/'personal-web'))
    parser.add_argument('--origin', default=os.getenv('NIGHTBREW_WEB_ORIGIN'), help='Exact HTTPS website origin, or local http://127.0.0.1:8787')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--init-only', action='store_true', help='Create or validate private configuration, then exit')
    parser.add_argument('--open', action='store_true', help='Open the browser after starting locally')
    parser.add_argument('--build', action='store_true', help='Build website assets using the installed Node dependencies')
    args = parser.parse_args()
    directory = Path(args.data_dir).expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    config_file = directory/'private-config.json'
    database = directory/'workspace.sqlite3'
    if not config_file.exists():
        if database.exists():
            raise SystemExit('Existing website database found without its private config. Restore the original config; it contains the key needed to decrypt credentials.')
        if not sys.stdin.isatty():
            raise SystemExit('Website setup is required. Run this command interactively once to choose the owner password.')
        print('First run: choose a private website workspace password (at least 12 characters). Do not paste your DeepSeek key here.')
        first = getpass.getpass('Workspace password: ')
        if first != getpass.getpass('Repeat workspace password: '):
            raise SystemExit('Passwords did not match; no configuration written.')
        settings = {'password_hash': password_hash(first), 'master_key': Fernet.generate_key().decode(), 'origin': args.origin or f'http://127.0.0.1:{args.port}'}
        fd = os.open(config_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(settings, stream)
    else:
        # Read only the configured private file, never print its contents.
        settings = json.loads(config_file.read_text())
    if args.origin:
        settings['origin'] = args.origin
    WebConfig(database, settings['password_hash'], settings['master_key'], origin=settings['origin']).validate()
    if args.init_only:
        print('Private website configuration is ready. Keep it secure and back it up separately from the database.')
        return
    if args.build:
        subprocess.run(['node', 'node_modules/vite/bin/vite.js', 'build', '--config', 'vite.web.config.ts'], cwd=ROOT, check=True)
    assets = ROOT/'build'/'web-preview'
    if not (assets/'index.html').is_file():
        raise SystemExit('Website assets are missing. Run with --build after installing Node dependencies.')
    config = WebConfig(database, settings['password_hash'], settings['master_key'], origin=settings['origin'], frontend=assets)
    app = create_web_app(config)
    if args.open and args.host in ('127.0.0.1', 'localhost', '::1'):
        threading.Timer(1, lambda: webbrowser.open(config.origin)).start()
    print('Website origin: ' + config.origin)
    print('Single-owner personal workspace. No shared cloud credits or paid subscription is activated.')
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, access_log=False)

if __name__ == '__main__':
    main()
