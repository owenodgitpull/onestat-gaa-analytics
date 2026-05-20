# Infrastructure Scaling TODO

Last updated: May 2026  
Current status: Single club (Dungloe GAA) in production. First live match recorded May 17 2026.

---

## What happened on match day (May 17 2026)

The app crashed ~45 minutes into live recording. Root cause: the audit middleware was
logging every possession event (fired every 1-2 seconds), every match event, and every
ball carrier segment — roughly 8,000+ extra DB writes during a 90-min match. Each write
opened a new connection and blocked the HTTP response. The production DB pool (max 10
connections) became exhausted and the app stopped responding for ~10 minutes.

**Fixed:**
- Possession events, match events, ball carrier segments, player movement all removed
  from audit logging. Only match lifecycle events (create, half-time, end) are now audited.
- Audit writes made fire-and-forget (asyncio.create_task) so they can never block a response.
- Switched Supabase connection from direct (port 5432) to PgBouncer pooler (port 6543),
  which multiplexes app connections through fewer real Postgres connections.

---

## Current infrastructure limits

| Service | Plan | Key Limits | Monthly Cost |
|---|---|---|---|
| Supabase | **Free** | 500MB storage, ~60 direct connections, **pauses after 7 days inactivity** | Free |
| Fly.io | **Pay-as-you-go** | 1× shared-cpu-1x, 1GB RAM, single instance, no auto-scale | ~$5-8/mo |
| Vercel | **Hobby** | 100GB bandwidth, unlimited deployments | Free |
| Cloudflare R2 | **Free** | 10GB storage, 10M ops/month | Free |
| AWS Cognito | **Free tier** | 50,000 MAUs | Free |

---

## Priority TODO

### 1. Upgrade Supabase to Pro — URGENT for any real production use
**Cost:** $25/month  
**Why urgent:**
- Free tier **pauses the database after 7 days of inactivity**. During off-season or a week
  without logins, the DB goes to sleep. First user back on match day gets a 30-60 second
  cold start. This is unacceptable on match day.
- 500MB storage will fill up in an estimated 3-6 months with GPS uploads, AI analysis
  cache, match event history, and possession tracking.
- Pro gives 8GB storage, no pausing, higher connection limits, and proper monitoring.

**How to upgrade:**  
Supabase dashboard → project settings → Billing → Upgrade to Pro

---

### 2. Add Fly.io auto-scaling for 5+ simultaneous clubs
**Cost:** Adds ~$5-15/month depending on usage  
**Why:** Current single-instance shared-cpu-1x handles 2-3 concurrent match recordings
comfortably after the audit fix. Beyond that, the connection pool (max 10) and single
shared CPU start to strain.

**When to do this:** When you have 5+ clubs actively using simultaneous live recording.

**How:**
In `fly.toml`, add:
```toml
[http_service]
  min_machines_running = 1
  auto_start_machines = true
  auto_stop_machines = true
```
And set machine count: `flyctl scale count 2 --app onestat-api`

Also increase the DB pool in `database.py`:
```python
pool_size=10 if _is_prod else 10,
max_overflow=10 if _is_prod else 20,
```
Note: each Fly.io instance has its own pool. 2 instances × 10 connections = 20 total
connections against Supabase. Ensure Supabase plan supports this (Pro supports 200+).

---

### 3. Switch to Supabase session-mode pooler or dedicated DB connection when on Pro
**Why:** Current pooler (port 6543, transaction mode) disables prepared statements.
This is fine but slightly less efficient than a direct or session-mode connection.
On Supabase Pro, the connection limits are high enough to go back to direct connections
with a larger pool, or use session-mode pooler which supports all Postgres features.

**When to do this:** After upgrading to Pro.

---

### 4. Add a proper log aggregation service
**Cost:** Free tiers available (Logtail, Papertrail, Betterstack)  
**Why:** When the May 17 crash happened, Fly.io logs from that time were already gone
by the next day — impossible to see the actual error. Currently flying blind on production
incidents.

**How:**
```bash
flyctl logs --app onestat-api  # Only shows last few hours
```
Connect Logtail or Betterstack to Fly.io via syslog drain:
```bash
flyctl logs-config set --app onestat-api --type syslog --url "syslog://..."
```

---

### 5. Cloudflare R2 — monitor storage usage
**Current free limit:** 10GB  
**Risk:** GPS PDF uploads, voiceover recordings for playbooks, and video keyframes
accumulate. At 10+ clubs with regular GPS uploads, could approach limit in 6-12 months.

**When to do this:** Check R2 usage in Cloudflare dashboard every month or two.
Paid R2 is very cheap ($0.015/GB/month) — not urgent.

---

## Multi-club capacity estimate (after audit fix)

| Simultaneous recording clubs | Expected behaviour |
|---|---|
| 1-2 | Stable — well within all limits |
| 3-4 | Fine — async DB pool handles concurrent writes efficiently |
| 5-7 | Pool may start queuing — consider scaling Fly.io to 2 instances |
| 8+ | Upgrade needed: Fly.io scale + Supabase Pro |

---

## Connections reference

- Fly.io dashboard: https://fly.io/apps/onestat-api
- Supabase dashboard: https://supabase.com/dashboard/project/uzfwzatdyvnqwurkxhrr
- Vercel dashboard: https://vercel.com/owenodgitpulls-projects/dungloe-gaa-analytics
- Cloudflare R2: https://dash.cloudflare.com (R2 → Buckets)
