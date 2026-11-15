"""Run before every backend deploy. Exits 1 (the deploy must NOT run) if tagging, a report generation, a video
compilation or a chat is in progress, because a deploy restarts the server and kills them.

    PGPW=<prod db password> python backend/scripts/deploy_guard.py && (cd backend && timeout 540 flyctl deploy --remote-only)

If this PC cannot reach the database:  python backend/scripts/deploy_guard.py --via-fly && ...  (same checks, run on the
Fly machine). NEVER pipe the guard (`guard | tail && deploy` deploys even when it fails).

The password comes from the environment; never print it.
"""
import datetime as dt
import os
import re
import subprocess
import sys

import psycopg2

BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ANSI = re.compile(r"\x1b\[[0-9;]*m")

if "--via-fly" in sys.argv:
    # This PC cannot reach the database (e.g. DNS for its IPv6-only host): read the Fly logs here, then run this same
    # script ON the Fly machine with those logs, where the database is reachable. Exit code is the remote verdict.
    import tempfile
    logs_local = subprocess.run("flyctl logs --no-tail", shell=True, capture_output=True, text=True, cwd=BACKEND, timeout=90).stdout
    tmp = os.path.join(tempfile.gettempdir(), "guard_logs.txt")
    open(tmp, "w", encoding="utf-8").write(logs_local)
    env = {**os.environ, "MSYS_NO_PATHCONV": "1"}
    tag = dt.datetime.now().strftime("%Y%m%d%H%M%S")        # fresh names: sftp put will not overwrite a file
    for src, dst in ((os.path.abspath(__file__), f"/tmp/deploy_guard_{tag}.py"), (tmp, f"/tmp/guard_logs_{tag}.txt")):
        subprocess.run(f'flyctl ssh sftp put "{src}" {dst}', shell=True, cwd=BACKEND, env=env, capture_output=True, timeout=120)
    remote = (f"sh -c 'cd /app && GUARD_LOGS_FILE=/tmp/guard_logs_{tag}.txt "
              f"PYTHONPATH=/app:/home/appuser/.local/lib/python3.11/site-packages python /tmp/deploy_guard_{tag}.py'")
    r = subprocess.run(["flyctl", "ssh", "console", "-C", remote], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=180)
    lines = [ln for ln in ANSI.sub("", r.stdout).splitlines() if ln.strip() and not ln.startswith("Connecting")]
    print(chr(10).join(lines))
    sys.exit(0 if lines and lines[-1].strip() == "CLEAR" else 1)

if not os.environ.get("PGPW") and os.environ.get("DATABASE_URL"):     # on the Fly machine (--via-fly): its own URL
    import urllib.parse
    os.environ["PGPW"] = urllib.parse.unquote(urllib.parse.urlparse(os.environ["DATABASE_URL"].replace("+asyncpg", "")).password or "")

c = psycopg2.connect(host="db.uzfwzatdyvnqwurkxhrr.supabase.co", port=6543, dbname="postgres", user="postgres",
                     password=os.environ["PGPW"], sslmode="require")
cur = c.cursor()
stop = []

cur.execute("select now() - max(created_at) from video_events")
age = cur.fetchone()[0]
print("last tag", age)
if age is not None and age < dt.timedelta(minutes=20):
    stop.append(f"tagging {age} ago")

cur.execute("select count(*) from video_compilations where lower(status::text) in ('pending', 'processing')")
n = cur.fetchone()[0]
print("compilations running", n)
if n:
    stop.append(f"{n} compilations running")

if os.environ.get("GUARD_LOGS_FILE"):          # --via-fly: logs fetched on the PC, checked here on the server
    logs = open(os.environ["GUARD_LOGS_FILE"], encoding="utf-8", errors="replace").read()
else:
    logs = subprocess.run("flyctl logs --no-tail", shell=True, capture_output=True, text=True, cwd=BACKEND, timeout=90).stdout
logs = ANSI.sub("", logs)
print("log lines", len(logs.splitlines()))
if not logs.strip():
    stop.append("could not read the Fly logs (login expired? run flyctl auth login)")

gen = [m.start() for m in re.finditer("Generating new AI analysis", logs)]
saved = [m.start() for m in re.finditer("Saved AI analysis", logs)]
if gen and (not saved or max(saved) < max(gen)):
    stop.append("report generating")

chat = [ln for ln in logs.splitlines() if "chat/stream" in ln]
print("recent chat lines", len(chat))
if chat:
    m = re.search(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)", chat[-1])
    if m and dt.datetime.utcnow() - dt.datetime.fromisoformat(m.group(1)) < dt.timedelta(minutes=10):
        stop.append("chat in the last 10 min")

print("STOP: " + "; ".join(stop) if stop else "CLEAR")
sys.exit(1 if stop else 0)
