# Database Cleanup Guide - DBeaver Connection & Match Deletion

## 🔌 DBeaver Connection Setup

### Connection Details
```
Database Type: PostgreSQL
Host: localhost
Port: 5432
Database: dungloe_gaa
Username: owenodonnell
Password: dungloe_dev_password
```

### Step-by-Step Setup

1. **Open DBeaver** → Click "New Database Connection" (database icon with +)
2. **Select PostgreSQL** from the database list → Click "Next"
3. **Main Tab** - Enter connection details:
   ```
   Host: localhost
   Port: 5432
   Database: dungloe_gaa
   Authentication: Database Native
   Username: owenodonnell
   Password: dungloe_dev_password
   ```
4. **Test Connection** → Should see "Connected" message
5. **Finish** → Connection saved

### Troubleshooting
- If connection fails, ensure PostgreSQL is running: `brew services list | grep postgresql`
- Check that port 5432 is correct: `psql -U owenodonnell -d dungloe_gaa -c "\conninfo"`

---

## 🗄️ Database Schema & Table Relationships

### Main Tables

```
matches (parent table)
├── match_events (child - CASCADE DELETE)
├── possession_events (child - CASCADE DELETE)
└── player_match_stats (child - CASCADE DELETE)

players (independent table)
└── player_match_stats (child - CASCADE DELETE)
```

### Detailed Relationships

#### **`matches`** (Parent Table)
- **Primary Key**: `id` (UUID)
- **Child Tables**:
  1. `match_events` - All events (goals, points, turnovers, etc.)
  2. `possession_events` - Ball position tracking over time
  3. `player_match_stats` - Aggregated player stats per match

**Cascade Delete**: `cascade="all, delete-orphan"`  
✅ **Deleting a match automatically deletes all related records!**

#### **`match_events`** (Child Table)
- **Foreign Key**: `match_id` → `matches.id`
- **Stores**: Individual match events (goals, points, turnovers, kickouts, etc.)
- **Contains**: player_id, event_type, minute, half, x_coord, y_coord, team

#### **`possession_events`** (Child Table)
- **Foreign Key**: `match_id` → `matches.id`
- **Stores**: Possession changes over time
- **Contains**: team, pitch_x, pitch_y, minute, duration_seconds, timestamp

#### **`player_match_stats`** (Child Table)
- **Foreign Keys**: 
  - `match_id` → `matches.id`
  - `player_id` → `players.id`
- **Stores**: Aggregated player statistics for a specific match
- **Contains**: goals, points, assists, turnovers, etc.

---

## 🧹 Cleanup Options

### Option 1: Delete a Single Match (RECOMMENDED) ✅

**SQL Query:**
```sql
-- Delete a specific match by ID
DELETE FROM matches WHERE id = 'YOUR-MATCH-UUID-HERE';
```

**What This Does:**
- Deletes the match from `matches` table
- **Automatically cascades** and deletes:
  - All `match_events` for that match ✅
  - All `possession_events` for that match ✅
  - All `player_match_stats` for that match ✅

**Example:**
```sql
-- Find matches to delete
SELECT id, opponent, match_date, status 
FROM matches 
ORDER BY created_at DESC;

-- Delete a specific test match
DELETE FROM matches WHERE opponent = 'Test Opponent';
```

---

### Option 2: Delete All Test Matches

**SQL Query:**
```sql
-- Delete all matches (useful for testing cleanup)
DELETE FROM matches;
```

**WARNING**: This deletes **ALL** matches and cascades to all related tables!

---

### Option 3: Soft Delete (Mark as Deleted)

**SQL Query:**
```sql
-- Soft delete (preserves data)
UPDATE matches 
SET is_deleted = true 
WHERE id = 'YOUR-MATCH-UUID-HERE';
```

**Note**: The app might still query these. You'd need to add filters to exclude `is_deleted = true`.

---

## 📊 Useful Query Scripts

### View All Matches with Event Counts
```sql
SELECT 
    m.id,
    m.opponent,
    m.match_date,
    m.status,
    m.created_at,
    COUNT(DISTINCT me.id) as event_count,
    COUNT(DISTINCT pe.id) as possession_count
FROM matches m
LEFT JOIN match_events me ON m.id = me.match_id
LEFT JOIN possession_events pe ON m.id = pe.match_id
GROUP BY m.id, m.opponent, m.match_date, m.status, m.created_at
ORDER BY m.created_at DESC;
```

### View Events for a Specific Match
```sql
-- Replace with your match ID
SELECT 
    event_type,
    team,
    minute,
    half,
    COUNT(*) as count
FROM match_events
WHERE match_id = 'YOUR-MATCH-UUID-HERE'
GROUP BY event_type, team, minute, half
ORDER BY minute, half;
```

### Delete Recent Test Matches (Last Hour)
```sql
DELETE FROM matches 
WHERE created_at > NOW() - INTERVAL '1 hour';
```

### Delete Matches by Opponent Name
```sql
DELETE FROM matches 
WHERE opponent IN ('Test', 'Glenties', 'St Michaels');
```

### Count Records by Table
```sql
SELECT 
    (SELECT COUNT(*) FROM matches) as match_count,
    (SELECT COUNT(*) FROM match_events) as event_count,
    (SELECT COUNT(*) FROM possession_events) as possession_count,
    (SELECT COUNT(*) FROM player_match_stats) as player_stats_count,
    (SELECT COUNT(*) FROM players) as player_count;
```

---

## ⚠️ Important Notes

### 1. Cascade Delete is ENABLED ✅
```python
# From match.py model:
events = relationship(
    "MatchEvent",
    back_populates="match",
    cascade="all, delete-orphan"  # ← Automatic cleanup!
)
```

**What this means:**
- You **ONLY** need to delete from `matches` table
- Child tables (`match_events`, `possession_events`, `player_match_stats`) are **automatically** cleaned up
- You **DO NOT** need to manually delete from child tables

### 2. Players Table is INDEPENDENT
- `players` table is NOT deleted when matches are deleted ✅
- `player_match_stats` (the join table) IS deleted via cascade ✅
- Your player roster persists across match cleanup ✅

### 3. Backups (Recommended Before Cleanup)
```sql
-- Backup a specific match and its data
COPY (
    SELECT * FROM matches WHERE id = 'YOUR-MATCH-UUID'
) TO '/tmp/match_backup.csv' CSV HEADER;

COPY (
    SELECT * FROM match_events WHERE match_id = 'YOUR-MATCH-UUID'
) TO '/tmp/match_events_backup.csv' CSV HEADER;
```

---

## 🧪 Safe Cleanup Workflow

### 1. Identify Matches to Delete
```sql
SELECT id, opponent, match_date, status, created_at
FROM matches
ORDER BY created_at DESC;
```

### 2. Check What Will Be Deleted (Preview)
```sql
-- See what data will be removed
SELECT 
    'match_events' as table_name, 
    COUNT(*) as records
FROM match_events 
WHERE match_id = 'YOUR-MATCH-UUID'

UNION ALL

SELECT 
    'possession_events', 
    COUNT(*)
FROM possession_events 
WHERE match_id = 'YOUR-MATCH-UUID'

UNION ALL

SELECT 
    'player_match_stats', 
    COUNT(*)
FROM player_match_stats 
WHERE match_id = 'YOUR-MATCH-UUID';
```

### 3. Delete the Match (Cascade Happens Automatically)
```sql
-- Delete single match
DELETE FROM matches WHERE id = 'YOUR-MATCH-UUID';

-- OR delete multiple test matches
DELETE FROM matches WHERE opponent LIKE '%Test%';
```

### 4. Verify Cleanup
```sql
-- Check that child records are gone
SELECT COUNT(*) FROM match_events WHERE match_id = 'DELETED-MATCH-UUID';
-- Should return 0

SELECT COUNT(*) FROM possession_events WHERE match_id = 'DELETED-MATCH-UUID';
-- Should return 0
```

---

## 🎯 Quick Commands for Common Scenarios

### Scenario 1: "Delete all my test matches"
```sql
DELETE FROM matches 
WHERE opponent IN ('Test', 'Glenties', 'St Michaels', 'Test Opponent');
```

### Scenario 2: "Delete matches from today"
```sql
DELETE FROM matches 
WHERE DATE(created_at) = CURRENT_DATE;
```

### Scenario 3: "Keep only completed matches"
```sql
DELETE FROM matches 
WHERE status != 'completed';
```

### Scenario 4: "Delete all matches (fresh start)"
```sql
DELETE FROM matches;
-- Cascade automatically removes all match_events, possession_events, player_match_stats
```

---

## 📋 Database Structure Summary

```
┌─────────────────┐
│    matches      │ ← Delete from here ONLY
├─────────────────┤
│ id (UUID) PK    │
│ opponent        │
│ match_date      │
│ venue           │
│ status          │
│ ...             │
└────────┬────────┘
         │ cascade="all, delete-orphan"
         │
    ┌────┴────────────────────────────┐
    │                                 │
    ▼                                 ▼
┌──────────────┐              ┌──────────────────┐
│match_events  │              │possession_events │
├──────────────┤              ├──────────────────┤
│ id PK        │              │ id PK            │
│ match_id FK  │              │ match_id FK      │
│ player_id FK │              │ team             │
│ event_type   │              │ pitch_x, pitch_y │
│ minute, half │              │ duration_seconds │
│ x_coord, y_  │              │ created_at       │
└──────────────┘              └──────────────────┘
         │
         │ cascade="all, delete-orphan"
         ▼
┌────────────────────┐
│player_match_stats  │
├────────────────────┤
│ id PK              │
│ match_id FK        │
│ player_id FK       │
│ goals, points      │
│ turnovers, etc.    │
└────────────────────┘
```

---

## ✅ Summary

**To delete matches:**
1. Connect to database via DBeaver (credentials above)
2. Run: `DELETE FROM matches WHERE <condition>;`
3. **All related data is automatically deleted** via cascade
4. Players table remains intact ✅

**You do NOT need to manually delete from:**
- ❌ `match_events` (automatic cascade)
- ❌ `possession_events` (automatic cascade)
- ❌ `player_match_stats` (automatic cascade)

**Safe cleanup = Delete from `matches` table only!** 🎯
