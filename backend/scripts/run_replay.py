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
ap.add_argument('--app', default='onestat-api')
args = ap.parse_args()

here = pathlib.Path(__file__).resolve().parent
repo = here.parents[1]
script = (here / 'replay_live_insights.py').read_bytes()
b64 = base64.b64encode(script).decode()
env = f"MATCH_ID={args.match} THROUGH={args.through} STEP={args.step} LABEL={args.label} HALF_TIME={'0' if args.no_half_time else '1'}"
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
