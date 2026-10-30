"""Check native architecture, frozen authentication and packaged Electron startup."""
import hashlib
import subprocess
import sys
from pathlib import Path

arch = sys.argv[1]
apps = list(Path('release').glob('mac*/NightBrew AI Employee.app'))
if len(apps) != 1:
    raise SystemExit('Expected exactly one native macOS application')
app = apps[0].resolve()
backend = app / 'Contents/Resources/backend/nightbrew-backend'
executable = app / 'Contents/MacOS/NightBrew AI Employee'
for binary in (backend, executable):
    actual = subprocess.check_output(['/usr/bin/lipo', '-archs', str(binary)], text=True).strip()
    expected = 'arm64' if arch == 'arm64' else 'x86_64'
    if actual != expected:
        raise SystemExit(f'Architecture mismatch: {actual}, expected {expected}')
subprocess.run([sys.executable, 'scripts/probe-frozen.py', str(backend)], check=True)
subprocess.run([str(executable), '--smoke-test'], check=True, timeout=90)
artifacts = sorted([*Path('release').glob('*.dmg'), *Path('release').glob('*.zip')])
if len(artifacts) != 2:
    raise SystemExit('Expected DMG and ZIP artifacts')
Path('release/SHA256SUMS.txt').write_text(''.join(
    f'{hashlib.file_digest(p.open("rb"), "sha256").hexdigest()}  {p.name}\n'
    for p in artifacts
))
print('macOS native backend, packaged startup and artifact checksums passed')
