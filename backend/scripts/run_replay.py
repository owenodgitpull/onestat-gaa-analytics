"""
Run replay_live_insights.py against production (via the Fly machine) and save the results under docs/insight-replays/.

    python backend/scripts/run_replay.py --label baseline-sonnet
    python backend/scripts/run_replay.py --label with-7-phases --match <match id> --through 35 --step 5

Needs `flyctl` logged in. Nothing is written to the database. See docs/live-insight-replay.md.
"""
import argparse
import base64
import pathlib
import re
import subprocess
import sys

DEFAULT_MATCH = 'b109b5c1-d121-489f-9098-1ddfa12ed3a7'   # Dungloe v St Eunans (video-tagged, first half to ~35')

ap = argparse.ArgumentParser()
ap.add_argument('--match', default=DEFAULT_MATCH)
ap.add_argument('--through', default='35')
ap.add_argument('--step', default='5')
ap.add_argument('--label', default='run')
ap.add_argument('--no-half-time', action='store_true')
ap.add_argument('--local-code', action='store_true',
                help='test the UNDEPLOYED prompt/brief/engine from this checkout: upload the changed modules to the '
                     'machine and load them in place of the deployed ones (nothing is deployed or saved)')
ap.add_argument('--app', default='onestat-api')
args = ap.parse_args()

here = pathlib.Path(__file__).resolve().parent
repo = here.parents[1]
script = (here / 'replay_live_insights.py').read_bytes()
PREAMBLE = b'''
import os, sys, importlib.util
_st = os.environ.get('LOCAL_STAMP')
if _st:
    sys.path.insert(0, '/app')
    import app.services.ai as _pkg
    for _m in ('phase_facts', 'insight_findings', 'opposition_movement', 'live_brief', 'match_agent'):
        _spec = importlib.util.spec_from_file_location('app.services.ai.' + _m, f'/tmp/lc_{_st}_{_m}.py')
        _mod = importlib.util.module_from_spec(_spec)
        sys.modules['app.services.ai.' + _m] = _mod
        _spec.loader.exec_module(_mod)
        setattr(_pkg, _m, _mod)
'''
b64 = base64.b64encode(PREAMBLE + b'\n' + script).decode()
LOCAL_MODULES = ['phase_facts', 'insight_findings', 'opposition_movement', 'live_brief', 'match_agent']
stamp = ''
if args.local_code:
    import os
    import time
    stamp = str(int(time.time()))
    sftp_env = {**os.environ, 'MSYS_NO_PATHCONV': '1'}
    for mod in LOCAL_MODULES:
        src = repo / 'backend' / 'app' / 'services' / 'ai' / f'{mod}.py'
        r = subprocess.run(['flyctl', 'ssh', 'sftp', 'put', '-a', args.app, str(src), f'/tmp/lc_{stamp}_{mod}.py'],
                           capture_output=True, text=True, env=sftp_env)
        if r.returncode != 0:
            sys.exit(f'Could not upload {mod}: {r.stdout[-300:]} {r.stderr[-300:]}')
    print('Using LOCAL (undeployed) code:', ', '.join(LOCAL_MODULES), flush=True)
env = f"MATCH_ID={args.match} THROUGH={args.through} STEP={args.step} LABEL={args.label} HALF_TIME={'0' if args.no_half_time else '1'} LOCAL_STAMP={stamp}"
remote = (f"sh -c 'cd /app && {env} PYTHONPATH=/home/appuser/.local/lib/python3.11/site-packages "
          f"/usr/local/bin/python3.11 -c \"import base64;exec(base64.b64decode(\\\"{b64}\\\"))\"'")
print('Running the replay on production (this takes a few minutes: one model call per interval)...', flush=True)
proc = subprocess.run(['flyctl', 'ssh', 'console', '-a', args.app, '-C', remote], capture_output=True, text=True)
out_dir = repo / 'docs' / 'insight-replays'
out_dir.mkdir(parents=True, exist_ok=True)
saved = []
for line in proc.stdout.splitlines():
    m = re.match(r'@@FILE@@(.+?)@@(.+)', line.strip())
    if m:
        (out_dir / m.group(1)).write_bytes(base64.b64decode(m.group(2)))
        saved.append(m.group(1))
if not saved:
    print(proc.stdout[-3000:])
    print(proc.stderr[-3000:])
    sys.exit('Replay produced no files — see the output above.')
print('Saved:', *[str(out_dir / n) for n in saved], sep='\n  ')
