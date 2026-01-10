# 🐳 Docker Guide - Understanding Your Setup

## What is Docker?

**Docker** is like a shipping container for software. It packages your application and all its dependencies into isolated "containers" that run consistently everywhere.

### Real-World Analogy:
- **Without Docker:** Like moving house by carrying individual items
- **With Docker:** Like moving house with everything in pre-packed containers

---

## PostgreSQL vs Docker

### PostgreSQL (The Database)
```
What: Database software that stores your data
Like: Microsoft Excel, but for structured data
Does: Stores players, matches, fitness tests, etc.
```

### Docker (The Container Platform)
```
What: Software that runs applications in isolated containers
Like: A virtual machine, but faster and lighter
Does: Runs PostgreSQL (and other services) in isolation
```

### The Relationship:
```
Your Mac
  └── Docker Desktop (platform)
        └── PostgreSQL Container (database)
              └── dungloe_gaa database (your data)
```

---

## Why Use Docker?

### ✅ Benefits

1. **Isolation**
   - Database runs in its own sandbox
   - Won't conflict with other projects
   - Clean slate every time

2. **Portability**
   - Same setup on your Mac, Noel's Mac, production servers
   - "Works on my machine" problems = solved

3. **Easy Reset**
   ```bash
   docker compose down -v  # Delete everything
   docker compose up       # Fresh start
   ```

4. **Version Control**
   - Lock PostgreSQL version (we use 15)
   - Everyone uses the exact same version
   - No surprises

5. **Production-Ready**
   - Matches how real servers work
   - Easy transition to cloud hosting

---

## Your Current Setup

### What's Running:
```
Docker Desktop (on your Mac)
  ├── PostgreSQL Container
  │     ├── Port: 5432
  │     ├── User: dungloe
  │     ├── Password: dungloe_dev_password
  │     └── Database: dungloe_gaa
  │           └── 30 players ✅
  │
  └── (backend/frontend will go here later)
```

---

## Essential Docker Commands

### Start Everything:
```bash
cd dungloe-gaa-analytics
docker compose up
```
*Starts PostgreSQL (and backend/frontend when built)*

### Start in Background:
```bash
docker compose up -d
```
*Runs containers in background, terminal stays free*

### Stop Everything:
```bash
docker compose down
```
*Stops all containers, but keeps data*

### Stop and Delete Data:
```bash
docker compose down -v
```
*⚠️ WARNING: Deletes all database data!*

### View Logs:
```bash
docker compose logs postgres
docker compose logs -f postgres  # Follow logs (like tail -f)
```

### Check What's Running:
```bash
docker ps
```

### Restart Just PostgreSQL:
```bash
docker compose restart postgres
```

### Access PostgreSQL Shell:
```bash
docker exec -it dungloe-gaa-analytics-postgres-1 psql -U dungloe -d dungloe_gaa
```

---

## Common Scenarios

### 🔹 Starting Work Each Day:
```bash
cd dungloe-gaa-analytics
docker compose up -d
# Now code away! Database is running.
```

### 🔹 Finished for the Day:
```bash
docker compose down
# Or just close laptop - Docker auto-stops
```

### 🔹 Database Acting Weird? Reset It:
```bash
docker compose down -v     # Delete everything
docker compose up -d       # Start fresh
python backend/seed_players.py  # Re-seed players
```

### 🔹 Out of Disk Space?
```bash
docker system prune -a --volumes
# Removes all unused containers, images, volumes
```

---

## Docker vs Local PostgreSQL

| Feature | Local PostgreSQL | Docker PostgreSQL |
|---------|-----------------|-------------------|
| **Installation** | `brew install postgresql` | `docker compose up` |
| **Isolation** | Runs on Mac directly | Isolated container |
| **Port Conflicts** | Can conflict | Easy to change ports |
| **Reset Database** | Manual dropdb/createdb | `docker compose down -v` |
| **Multiple Projects** | Need different ports | Each project = own container |
| **Production Match** | Different setup | Same as production |
| **Disk Space** | ~500MB | ~500MB + Docker overhead |

---

## What We Did Earlier

### Step 1: Stopped Local PostgreSQL
```bash
brew services stop postgresql@15
```
*This freed up port 5432 for Docker*

### Step 2: Started Docker PostgreSQL
```bash
docker compose up -d postgres
```
*Downloaded PostgreSQL image, created container, started it*

### Step 3: Seeded Players
```bash
python backend/seed_players.py
```
*Connected to Docker database, created tables, added 30 players*

---

## Docker Costs

### Development (Your Mac):
- **Docker Desktop:** FREE ✅
- **PostgreSQL Image:** FREE ✅
- **Total:** $0/month

### Production (Cloud):
- **Docker Desktop:** Not used in production
- **Fly.io/Railway:** Runs code directly (not Docker Desktop)
- **Docker Images:** FREE (we use public images)

**Docker adds $0 to your costs!** 🎉

---

## Troubleshooting

### "Port 5432 already in use"
```bash
# Stop local PostgreSQL
brew services stop postgresql@15

# Or change Docker port in docker-compose.yml
ports:
  - "5433:5432"  # Use 5433 on Mac, 5432 in container
```

### "Cannot connect to database"
```bash
# Check if container is running
docker ps

# If not running, start it
docker compose up -d postgres

# Check logs
docker compose logs postgres
```

### "Out of disk space"
```bash
# Clean up old containers/images
docker system prune -a --volumes
```

### "Docker command not found"
```bash
# Open Docker Desktop app
# Wait for whale icon in menu bar to stop animating
```

---

## Next Steps

When we build the backend API, we'll add it to Docker too:

```bash
docker compose up -d
# This will start:
# - PostgreSQL (database)
# - Backend API (FastAPI)
# - Frontend (React) - later
```

**One command, entire dev environment running!** 🚀

---

## Quick Reference

| Task | Command |
|------|---------|
| Start everything | `docker compose up -d` |
| Stop everything | `docker compose down` |
| View logs | `docker compose logs -f` |
| Restart | `docker compose restart` |
| Fresh start | `docker compose down -v && docker compose up -d` |
| Check status | `docker ps` |
| Access DB | `docker exec -it dungloe-gaa-analytics-postgres-1 psql -U dungloe -d dungloe_gaa` |

---

**You're now using Docker like a pro!** 🐳✨

Questions? Just ask!

