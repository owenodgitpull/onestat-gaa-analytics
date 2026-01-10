# 🗄️ Database Architecture & API Reference

## 📊 Database Schema Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATABASE DESIGN                          │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐
│   PLAYERS    │ ← Core entity (30 Dungloe players)
│  (players)   │
├──────────────┤
│ • id (PK)    │
│ • name       │
│ • position   │
│ • jersey_#   │
│ • DOB        │
│ • status     │
└──────┬───────┘
       │
       │ ONE-TO-MANY
       │
       ├────────────────────────────────────────┐
       │                                        │
       │                                        │
       ▼                                        ▼
┌──────────────┐                      ┌──────────────────┐
│ FITNESS_TESTS│                      │     MATCHES      │
│(fitness_tests)│                      │    (matches)     │
├──────────────┤                      ├──────────────────┤
│ • id (PK)    │                      │ • id (PK)        │
│ • player_id  │◄─────────┐          │ • opponent       │
│ • test_date  │          │          │ • match_date     │
│ • MAS        │          │          │ • venue          │
│ • EUR        │          │          │ • status         │
│ • mobility   │          │          │ • dungloe_goals  │
│ • power      │          │          │ • dungloe_points │
│ • strength   │          │          │ • opponent_goals │
│ • speed      │          │          │ • opponent_points│
└──────────────┘          │          └────────┬─────────┘
                          │                   │
                          │                   │ ONE-TO-MANY
                          │                   │
                          │         ┌─────────┴─────────────────────┐
                          │         │                               │
                          │         ▼                               ▼
                          │  ┌──────────────────┐         ┌──────────────────┐
                          │  │  MATCH_EVENTS    │         │ POSSESSION_EVENTS│
                          │  │  (match_events)  │         │(possession_events)│
                          │  ├──────────────────┤         ├──────────────────┤
                          │  │ • id (PK)        │         │ • id (PK)        │
                          └──┤ • match_id (FK)  │         │ • match_id (FK)  │
                             │ • player_id (FK) │         │ • team           │
                             │ • assist_id (FK) │         │ • pitch_x        │
                             │ • event_type     │         │ • pitch_y        │
                             │ • team           │         │ • minute         │
                             │ • minute         │         │ • duration       │
                             │ • pitch_x        │         └──────────────────┘
                             │ • pitch_y        │                │
                             └────────┬─────────┘                │
                                      │                          │
                                      │                          │
                                      │ AGGREGATES TO            │ RAW DATA FOR
                                      │                          │
                                      ▼                          ▼
                             ┌──────────────────────┐   ┌────────────────┐
                             │ PLAYER_MATCH_STATS   │   │  HEAT MAPS     │
                             │(player_match_stats)  │   │ FLOW DIAGRAMS  │
                             ├──────────────────────┤   │  ANALYTICS     │
                             │ • id (PK)            │   └────────────────┘
                             │ • match_id (FK)      │
                             │ • player_id (FK)     │
                             │ • goals              │
                             │ • points             │
                             │ • two_pointers       │
                             │ • assists            │
                             │ • turnovers_won      │
                             │ • turnovers_lost     │
                             │ • accuracy           │
                             │ • impact_score       │
                             │ • ai_insights (JSON) │
                             └──────────────────────┘
                                      │
                                      │ AGGREGATES TO
                                      ▼
                             ┌────────────────────┐
                             │  SEASON ANALYTICS  │
                             │   TREND ANALYSIS   │
                             │    LEADERBOARDS    │
                             │   AI PREDICTIONS   │
                             └────────────────────┘
```

---

## 🔗 Table Relationships & Purposes

### **1. PLAYERS** (Core Entity)
**Purpose:** Master list of all team players

**Relationships:**
- ONE player → MANY fitness tests
- ONE player → MANY match events (as scorer)
- ONE player → MANY match events (as assist provider)
- ONE player → MANY match stats (one per match)

**Key Fields:**
- `id`: Unique identifier
- `name`: Player name
- `position`: Field position (goalkeeper, full_back, etc.)
- `jersey_number`: Squad number
- `date_of_birth`: For age calculations
- `status`: active/injured/suspended/inactive

**Used For:**
- Player selection in match recording
- Performance tracking across matches
- Squad management
- Age/eligibility verification

---

### **2. MATCHES** (Event Container)
**Purpose:** Represents a single GAA match

**Relationships:**
- ONE match → MANY match events
- ONE match → MANY possession events
- ONE match → MANY player match stats

**Key Fields:**
- `opponent`: Team being played
- `match_date`: When match occurs
- `venue`: home/away/neutral
- `status`: scheduled/in_progress/completed/cancelled
- `dungloe_goals`, `dungloe_points`: Final scores
- `started_at`, `completed_at`: Match timing

**Used For:**
- Match scheduling
- Score tracking
- Result history
- Performance context (home vs away, opponent strength)

---

### **3. MATCH_EVENTS** (Action Recording)
**Purpose:** Every significant action during a match

**Relationships:**
- MANY events → ONE match
- MANY events → ONE player (scorer)
- MANY events → ONE player (assist)

**Key Fields:**
- `event_type`: goal/point/turnover/kickout/card/etc.
- `team`: dungloe/opponent
- `player_id`: Who did it
- `assist_player_id`: Who helped (for scores)
- `pitch_x`, `pitch_y`: Where it happened (0-100 scale)
- `minute`: When it happened

**Used For:**
- **Live match tracking** (tap to record events)
- **Player attribution** (who scored, who assisted)
- **Auto-updating match scores**
- **Auto-updating player stats**
- **2-point detection** (shots from 40m+)
- **Event timeline** (replay the match)

**Special Logic:**
- Auto-converts `POINT` → `TWO_POINT` if pitch_x indicates 40m+ shot
- Updates match.dungloe_goals/points automatically
- Updates PlayerMatchStats automatically
- Tracks assists for scoring events

---

### **4. POSSESSION_EVENTS** (Ball Tracking)
**Purpose:** Track ball position throughout match

**Relationships:**
- MANY possession events → ONE match

**Key Fields:**
- `team`: Which team has possession
- `pitch_x`, `pitch_y`: Ball coordinates (0-100 scale)
- `minute`: When
- `duration_seconds`: How long ball stayed here

**Used For:**
- **Possession heat maps** (where did Dungloe have the ball?)
- **Possession percentage** (58% vs 42%)
- **Flow diagrams** (how did ball move between zones?)
- **Territory analysis** (did we dominate their half?)
- **2-point zone visualization** (yellow overlay on pitch)

**Coordinate System:**
```
pitch_x: 0 = Dungloe goal line, 100 = Opponent goal line
pitch_y: 0 = Left sideline, 100 = Right sideline, 50 = Center

Example zones:
- Own defense: x: 0-30
- Midfield: x: 30-70
- Attack: x: 70-100
- 2-point zone: x: 40-60 (midfield, 40m+ from either goal)
```

---

### **5. PLAYER_MATCH_STATS** (Aggregated Performance)
**Purpose:** Summary of each player's performance in a specific match

**Relationships:**
- MANY stats → ONE match
- MANY stats → ONE player
- ONE unique record per player per match

**Key Fields (Counting Stats):**
- `goals`, `points`, `two_pointers`: Scoring
- `assists`: Setup plays
- `wides`, `shots_short`, `shots_saved`: Unsuccessful shots
- `turnovers_won`, `turnovers_lost`: Possession changes
- `kickouts_won`, `kickouts_lost`: Restart battles
- `blocks`, `interceptions`: Defensive plays
- `yellow_cards`, `red_cards`: Discipline

**Calculated Fields:**
- `total_score`: (goals × 3) + points + (two_pointers × 2)
- `accuracy`: successful_shots / total_shots × 100
- `turnover_ratio`: turnovers_won / turnovers_lost
- `impact_score`: Weighted formula considering all contributions

**AI Field:**
- `ai_insights`: JSON field for Claude-generated analysis

**Used For:**
- **Individual performance review** (how did Barry Curran play?)
- **Man of the match** (highest impact score)
- **Player comparisons** (who was more accurate?)
- **Position-specific analysis** (are our forwards scoring enough?)
- **Leaderboards** (top scorer, most assists, etc.)

**Auto-Updated By:**
- MatchEventService when events are created/updated/deleted
- Automatically recalculates metrics after stat changes

---

### **6. FITNESS_TESTS** (Physical Conditioning)
**Purpose:** Track player physical performance over time

**Relationships:**
- MANY tests → ONE player

**Key Fields:**
- `test_date`: When test occurred
- `MAS`: Maximal Aerobic Speed (km/h)
- `EUR`: Endurance running time
- `mobility`, `power`, `strength`, `speed`: Component scores

**Used For:**
- **Training load management** (is player ready?)
- **Injury risk prediction** (declining fitness = warning)
- **Return from injury** (has fitness recovered?)
- **Position comparison** (are midfielders fitter than forwards?)
- **AI insights** (predict performance based on recent fitness)

---

## 🔄 Data Flow During Match

### **Live Match Recording Flow:**

```
1. User taps pitch at (x: 75, y: 50)
   → Creates PossessionEvent
   → Ball icon moves to that position
   
2. User taps "Point" button
   → Opens "Who scored?" modal
   → User selects "Barry Curran"
   → Optional: "Who assisted?" → Selects "Oran Gallagher"
   
3. System creates MatchEvent:
   - event_type: POINT (or TWO_POINT if x < 60)
   - pitch_x: 75, pitch_y: 50
   - player_id: Barry Curran's ID
   - assist_player_id: Oran Gallagher's ID
   
4. MatchEventService.create_event():
   ├─ Auto-detects 2-point zone (75 > 60, so regular POINT)
   ├─ Updates Match.dungloe_points += 1
   ├─ Updates Barry's PlayerMatchStats.points += 1
   ├─ Updates Oran's PlayerMatchStats.assists += 1
   └─ Recalculates both players' accuracy, impact_score
   
5. Frontend polls /api/matches/{id}/stats
   → Returns updated stats for live dashboard
   
6. User sees:
   - Score updates (Dungloe: 1-05)
   - Stats sidebar updates (Possession %, Shots, etc.)
   - Event timeline shows "Point - Barry Curran (Assist: Oran)"
```

---

## 📡 API Endpoints Explained

### **PLAYERS API** (`/api/players`)

#### `GET /api/players`
**Purpose:** List all players with pagination  
**Use Case:** Display squad roster, populate player dropdowns

**Parameters:**
- `skip`: Pagination offset (default: 0)
- `limit`: Results per page (default: 50, max: 100)
- `position`: Filter by position (optional)
- `status`: Filter by status (optional)
- `search`: Search by name (optional)

**Response:**
```json
{
  "players": [
    {
      "id": "uuid",
      "name": "Barry Curran",
      "position": "full_forward",
      "jersey_number": 14,
      "status": "active"
    }
  ],
  "total": 30,
  "page": 1,
  "page_size": 50
}
```

---

#### `POST /api/players`
**Purpose:** Create a new player  
**Use Case:** Add new squad member

---

#### `GET /api/players/{id}`
**Purpose:** Get single player details  
**Use Case:** Player profile page, detailed stats view

---

#### `PUT /api/players/{id}`
**Purpose:** Update player information  
**Use Case:** Change jersey number, update status (injured), change position

---

### **MATCHES API** (`/api/matches`)

#### `POST /api/matches`
**Purpose:** Create a new match  
**Use Case:** Schedule upcoming match

**Request:**
```json
{
  "opponent": "Glenties",
  "match_date": "2026-01-20T15:00:00",
  "venue": "home",
  "notes": "League match - must win"
}
```

---

#### `POST /api/matches/{id}/start`
**Purpose:** Start live match tracking  
**Use Case:** User clicks "Start Match" button on match day

**What Happens:**
- Changes status: SCHEDULED → IN_PROGRESS
- Records started_at timestamp
- Enables live event recording

---

#### `POST /api/matches/{id}/complete`
**Purpose:** Finalize match  
**Use Case:** Match is over, lock the scores

**What Happens:**
- Changes status: IN_PROGRESS → COMPLETED
- Records completed_at timestamp
- Triggers post-match analysis (AI insights)

---

#### `GET /api/matches/{id}/stats`
**Purpose:** Get real-time match statistics  
**Use Case:** Live stats dashboard, post-match report

**Response:**
```json
{
  "match_id": "uuid",
  "dungloe_possession_percentage": 58.5,
  "opponent_possession_percentage": 41.5,
  "dungloe_total_shots": 23,
  "dungloe_scores": 18,
  "dungloe_wides": 5,
  "dungloe_accuracy": 78.26,
  "dungloe_turnovers_won": 12,
  "dungloe_turnovers_lost": 8
}
```

---

### **MATCH EVENTS API** (`/api/match-events`)

#### `POST /api/match-events/quick-score`
**Purpose:** Fast score recording during live match  
**Use Case:** User taps "Goal" or "Point" button, selects scorer

**Request:**
```json
{
  "match_id": "uuid",
  "event_type": "POINT",
  "team": "dungloe",
  "player_id": "uuid-of-scorer",
  "assist_player_id": "uuid-of-assist",
  "pitch_x": 75.5,
  "pitch_y": 50.0,
  "minute": 23
}
```

**What Happens:**
1. Auto-detects 2-point zone
2. Creates MatchEvent
3. Updates match scores
4. Updates player stats
5. Returns event details

---

#### `POST /api/match-events/quick-event`
**Purpose:** Fast non-scoring event recording  
**Use Case:** User taps "Turnover", "Kickout Won", "Block", etc.

---

#### `GET /api/match-events/match/{match_id}`
**Purpose:** Get all events for a match  
**Use Case:** Display event timeline, replay match events

---

## 📈 Analytics Dashboard Data Sources

### **Multi-Match Queries for Dashboard:**

1. **Season Performance Trends**
   - Score trends over time
   - Home vs Away performance
   - Opponent difficulty analysis

2. **Player Season Stats**
   - Total goals/points/assists
   - Average accuracy
   - Impact score trends
   - Position comparisons

3. **Team Analytics**
   - Possession patterns
   - Scoring zones heat maps
   - Turnover analysis
   - Discipline trends

4. **AI Insights**
   - Performance predictions
   - Injury risk alerts
   - Tactical recommendations
   - Training priorities

---

**Complete API documentation available at:** `http://localhost:8000/docs` (Swagger UI)

