"""CI-only official Flutter SDK fetch with mandatory archive SHA-256 verification."""
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

version='3.44.0'
host='macos' if platform.system()=='Darwin' else 'linux'
arch='arm64' if platform.machine().lower() in ('arm64','aarch64') else 'x64'
base='https://storage.googleapis.com/flutter_infra_release/'
with urllib.request.urlopen(base+f'releases/releases_{host}.json',timeout=60) as response:
    releases=json.load(response)['releases']
release=next(r for r in releases if r['version']==version and r['channel']=='stable' and r.get('dart_sdk_arch','x64')==arch)
target=Path(os.environ.get('RUNNER_TEMP',tempfile.gettempdir()))/'fieldops-flutter'
target.mkdir(exist_ok=True)
archive=target/Path(release['archive']).name
with urllib.request.urlopen(base+release['archive'],timeout=180) as response, archive.open('wb') as out:
    shutil.copyfileobj(response,out)
with archive.open('rb') as f:
    actual=hashlib.file_digest(f,'sha256').hexdigest()
if actual!=release['sha256']:raise SystemExit('Official Flutter archive checksum mismatch')
# Both archives are verified official Flutter artifacts; no untrusted upload is extracted.
if archive.suffix=='.zip':subprocess.run(['unzip','-q',str(archive),'-d',str(target)],check=True)
else:subprocess.run(['tar','xf',str(archive),'-C',str(target)],check=True)
archive.unlink()
print(f'Flutter {version} {host}/{arch} archive SHA-256 verified')
with open(os.environ['GITHUB_PATH'],'a') as f:f.write(str(target/'flutter'/'bin')+'\n')
