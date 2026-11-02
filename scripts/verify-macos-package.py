"""Check native architecture, frozen authentication and packaged Electron startup."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

arch = sys.argv[1]
local_preview = '--local-preview' in sys.argv[2:]
byok_preview = '--byok-preview' in sys.argv[2:]
apps = list(Path('release').glob('mac*/NightBrew AI Employee.app'))
if len(apps) != 1:
    raise SystemExit('Expected exactly one native macOS application')
app = apps[0].resolve()
backend = app / 'Contents/Resources/backend/nightbrew-backend'
executable = app / 'Contents/MacOS/NightBrew AI Employee'
resources = app / 'Contents/Resources'
policy = json.loads((resources / 'release-policy.json').read_text())
if policy.get('development_unsigned') is not True or bool(policy.get('local_preview')) != local_preview or bool(policy.get('byok_preview')) != byok_preview:
    raise SystemExit('Embedded release policy does not match this build mode')
for binary in (backend, executable):
    actual = subprocess.check_output(['/usr/bin/lipo', '-archs', str(binary)], text=True).strip()
    expected = 'arm64' if arch == 'arm64' else 'x86_64'
    if actual != expected:
        raise SystemExit(f'Architecture mismatch: {actual}, expected {expected}')
subprocess.run([sys.executable, 'scripts/probe-frozen.py', str(backend)], check=True)
subprocess.run([str(executable), '--smoke-test'], check=True, timeout=90)
if local_preview or byok_preview:
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    subprocess.run(['node', 'scripts/probe-local-preview.cjs', str(resources), *(['--byok-preview'] if byok_preview else [])], check=True, timeout=90)
prefix = 'NightBrew-API-PREVIEW-' if byok_preview else 'NightBrew-LOCAL-PREVIEW-' if local_preview else 'NightBrew-DEV-UNSIGNED-'
artifacts = sorted([*Path('release').glob(prefix + '*.dmg'), *Path('release').glob(prefix + '*.zip')])
if len(artifacts) != 2:
    raise SystemExit('Expected DMG and ZIP artifacts')
checksum_name = 'SHA256SUMS-API-PREVIEW.txt' if byok_preview else 'SHA256SUMS-LOCAL-PREVIEW.txt' if local_preview else 'SHA256SUMS.txt'
Path('release', checksum_name).write_text(''.join(
    f'{hashlib.file_digest(p.open("rb"), "sha256").hexdigest()}  {p.name}\n'
    for p in artifacts
))
print('macOS native backend, packaged startup and artifact checksums passed')
