"""Run before every backend deploy. Exits 1 (the deploy must NOT run) if tagging, a report generation, a video
compilation or a chat is in progress, because a deploy restarts the server and kills them.

    PGPW=<prod db password> python backend/scripts/deploy_guard.py && (cd backend && timeout 540 flyctl deploy --remote-only)

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
