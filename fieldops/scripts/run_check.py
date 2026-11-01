"""Stream CI checks and expose bounded public diagnostics; no runtime/customer secrets are used."""
import subprocess
import sys
from collections import deque

recent=deque(maxlen=35)
process=subprocess.Popen(sys.argv[1:],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,errors='replace')
for line in process.stdout:
    print(line,end='',flush=True)
    recent.append(line.rstrip())
code=process.wait()
if code:
    message=' | '.join(recent)[-6000:].replace('%','%25').replace('\r','%0D').replace('\n','%0A')
    print('::error title=FieldOps mobile check::'+message,flush=True)
raise SystemExit(code)
