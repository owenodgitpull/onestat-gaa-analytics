# Live Match Recording — Scalability Plan

## Problem

The current architecture makes too many individual API calls during a live match:

- **Possession tick** — 1 POST every 3 seconds → 600 calls per 30-min half
- **Stats polling** — 1 GET every 10 seconds → 180 calls per half
- **Phase/event updates** — on top of the above

With 5 clubs recording simultaneously this is ~5,000 calls per half for possession alone.
The single `shared-cpu-1x` Fly.io machine gets CPU-starved under this load, causing health
check timeouts and ~2 minute outages (seen twice during Ballyshannon match, May 2026).

---

## Planned Fixes (implement after current match)

### 1. Batch possession events (biggest win, ~80% load reduction)

**Current:** `offlinePossession.create()` fires a POST to `/possession-events/` every 3 seconds.

**Fix:** Accumulate possession ticks in the IndexedDB outbox for 15 seconds, then flush as a
single POST to `/possession-events/bulk` (endpoint already exists). The territory chart is
time-weighted so 15-second granularity is identical in practice to 3-second.

Files to change:
- `frontend/src/pages/MatchRecording.tsx` — possession tick `useEffect` (~line 613)
- `frontend/src/services/offline/offlineApi.ts` — `offlinePossession.create()` → buffer + batch flush

### 2. Server-Sent Events for live stats (eliminates polling entirely)

**Current:** Frontend polls `GET /matches/{id}/stats` every 10 seconds.

**Fix:** Server pushes a stats payload over SSE whenever a match event or possession event is
recorded. Frontend opens one persistent SSE connection per match instead of polling.

Files to change:
- `backend/app/routes/matches.py` — add `GET /matches/{id}/stats/stream` SSE endpoint
- `frontend/src/hooks/useMatchStats.ts` (or equivalent) — replace React Query polling with
  `EventSource` connection
- Close the SSE connection when the match ends or the component unmounts

FastAPI SSE is supported natively via `StreamingResponse` with `text/event-stream`.

### 3. Extend possession tick interval to 8–10 seconds (trivial, ~60% reduction on top of batching)

**Current:** Tick fires every 3 seconds (`setInterval(..., 3000)`).

**Fix:** Change to 8 seconds. Still produces accurate time-weighted territory data
(225 data points per half vs 600). Combined with batching, the server sees 1 bulk POST
every 15 seconds instead of 5 individual POSTs.

Files to change:
- `frontend/src/pages/MatchRecording.tsx` — possession tick interval constant

---

## TODO — Infrastructure

### [ ] Auth refresh must survive machine downtime (do not log user out on 503)

**Symptom:** During a machine outage, `POST /api/v1/auth/refresh` returns 503. The frontend
treats a failed refresh as a genuine expired session and redirects to the login page — losing
the user's match recording context entirely. Seen during Ballyshannon match (May 2026).

**Root cause:** The auth refresh failure is a network/infrastructure error, not an auth error.
The two should be handled differently.

**Fix (frontend):** In the auth refresh logic (`AuthProvider` / token refresh handler), only
redirect to login on a genuine 401/403 from the auth endpoint. On 503 / network error, hold
the existing session in memory and retry silently with exponential backoff (2s → 4s → 8s,
max 60s). During a live match the user should never be ejected because of a server blip.

**Fix (backend, secondary):** The second machine (below) means auth/refresh is almost never
unreachable in the first place — this frontend fix is the safety net for the rare case both
machines are briefly unavailable simultaneously.

Files to change:
- `frontend/src/contexts/AuthProvider.tsx` (or equivalent auth refresh hook) — distinguish
  network errors from auth errors before clearing session

---

### [ ] Add second Fly.io machine (`min_machines_running = 2`)

Even with the above architectural fixes, a single machine is a single point of failure.
Fly.io restarts machines for routine maintenance (~weekly). With two machines, Fly.io's
load balancer routes traffic to the healthy one during any restart — zero user-facing downtime.

**Cost:** ~£26/month total (vs £13/month now for one machine). No CPU upgrade needed if
the architectural fixes above are in place first.

**How to apply:**
```toml
# backend/fly.toml
[http_service]
  min_machines_running = 2   # change from 1
```

Then run:
```bash
flyctl scale count 2 -a onestat-api
```

Do this *after* the architectural fixes above are deployed and verified stable under load,
so both machines are running lean code before doubling them.

---

## Expected outcome

| Metric | Before | After |
|---|---|---|
| Possession API calls / half | 600 | ~12 (bulk) |
| Stats API calls / half | 180 | 0 (SSE push) |
| Concurrent clubs on shared-cpu-1x | ~1-2 safely | 10+ |
| Single point of failure | Yes | No (2 machines) |
| Monthly hosting cost | £13 | £26 |
