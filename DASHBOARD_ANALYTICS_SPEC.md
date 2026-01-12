# Dashboard Analytics Specification

## 🎯 Dashboard Views

### View 1: **Performance Analytics** (Match Data)
*Alternative names: "Match Intelligence", "Game Analysis", "Tactical Dashboard"*

Accumulative analysis across all matches, showing patterns, trends, and tactical insights.

---

### View 2: **Player Conditioning** (Fitness & GPS Data)
*Alternative names: "Fitness Analytics", "Physical Performance", "Conditioning Center"*

GPS tracker data, fitness tests, and physical conditioning trends.

---

## 📊 MATCH ANALYTICS CHARTS (View 1)

### **1. Shooting Efficiency & Shot Maps**
**Purpose:** Identify clinical scoring zones and inefficient shot selection

**Chart Type:** Heat Map + Scatter Plot overlay on pitch

**Data Points:**
- Shot location (x, y coordinates)
- Shot outcome (goal, point, wide, short, saved, blocked)
- Shot type (play, free, 45)
- Shooter identity
- Is 2-point zone

**Visual:**
- Green dots = Scores
- Red X's = Misses/blocks
- Heat map intensity = shot frequency
- Pitch overlay with zones marked

**Manager Insight:**
- "High volume of missed shots from outside 45m → work ball closer"
- "90% conversion inside 21m → exploit this strength"

**Claude AI Prompt Context:**
```
Analyze shooting patterns:
- Shot locations and success rates
- Compare scoring zones vs. wides zones
- Identify optimal shooting positions
- Suggest tactical adjustments
```

---

### **2. Kick-out Retention Analysis**
**Purpose:** Win the restart battle, control possession

**Chart Type:** Stacked Bar Chart + Donut Chart

**Data Points:**
- Own kickout won/lost
- Opponent kickout won/lost
- Kickout break won/lost
- Kickout landing zone (short: 0-21m, mid: 21-45m, long: 45m+)
- Side of pitch (left, center, right)

**Visual:**
- Success rate % (donut chart)
- Zone breakdown (stacked bars: short/mid/long)
- Left vs. center vs. right comparison

**Manager Insight:**
- "Losing 70% of long kickouts left wing → move taller midfielder or go short"
- "100% retention on short restarts → exploit this"

**Claude AI Prompt Context:**
```
Analyze kickout strategy:
- Retention % by distance and side
- Opposition success rate on our kickouts
- Recommend tactical changes (short vs long, target areas)
```

---

### **3. Possession Turnover Funnel**
**Purpose:** Fix technical/tactical errors causing possession loss

**Chart Type:** Sankey Diagram or Horizontal Bar Chart

**Data Points:**
- Turnover type (unforced error, intercept, tackle, over-carrying)
- Location (defensive 21m, midfield 21-65m, attacking 21m)
- Player responsible
- Time of match (first/second half)

**GAA Pitch Zones:**
- **13m line:** 13m from end line (small arc)
- **20m line:** 20m from end line (large rectangle)
- **21m (penalty area):** Defensive zone
- **45m line (football) / 65m line (hurling):** Midfield marker
- **Small rectangle (square):** 14m × 4.5m (goalkeeper safe zone)
- **Large rectangle:** 19m × 13m (penalty area)

**Visual:**
- Flow diagram showing turnover sources → locations
- Thickness = frequency
- Color coded by severity

**Manager Insight:**
- "High over-carrying in attacking 21m → move ball faster, specific drill"
- "Intercepts high in defensive third → improve support angles"

**Claude AI Prompt Context:**
```
Analyze turnover patterns:
- Where are we losing the ball most?
- What type of errors (handling, over-carrying, intercepts)?
- Which players involved?
- Recommend technical or positional fixes
```

---

### **4. Scoring Trends (Temporal Analysis)**
**Purpose:** Identify momentum swings and fitness drop-offs

**Chart Type:** Area Chart or Cumulative Line Graph

**Data Points:**
- Score (goals + points) per minute
- Cumulative score over time
- Both teams on same chart
- Half-time marker
- Substitution markers

**Visual:**
- Time (x-axis): 0-70+ mins
- Score (y-axis): 0-30+
- Dungloe (blue area) vs. Opponent (red area)
- "Purple patches" highlighted

**Manager Insight:**
- "Score flatlines 20-35 mins → fitness issue or early subs needed"
- "Opposition 10-minute purple patch 40-50 mins → tactical adjustment"

**Claude AI Prompt Context:**
```
Analyze scoring momentum:
- Identify purple patches (scoring bursts)
- Detect flatline periods (no scores)
- Correlate with substitutions and tactical changes
- Recommend timing for interventions
```

---

### **5. Defensive Pressure & Tackle Counts**
**Purpose:** Reward "unseen work," quantify defensive effort

**Chart Type:** Radar (Spider) Chart

**Data Points:**
- Tackles made
- Turnovers won
- Blocks
- Interceptions
- Breaking balls won
- Frees conceded (negative)

**Visual:**
- Individual player vs. team average
- Position-specific benchmarks (corner-back vs. midfielder)
- 6-8 axis spider chart

**Manager Insight:**
- "High tackles but low turnovers won → engaging but not winning ball"
- "Corner-back 3 blocks, 5 turnovers → elite performance"

**Claude AI Prompt Context:**
```
Analyze defensive contributions:
- Compare player to positional average
- Identify defensive standouts
- Highlight players below expected work rate
- Suggest positional swaps if needed
```

---

### **6. Conversion Rate (Scores per Attack)**
**Purpose:** Measure finishing efficiency, not just volume

**Chart Type:** Bullet Chart

**Data Points:**
- Entries into final 45m
- Entries into attacking 21m
- Scores (goals + points)
- Wides
- Turnovers in final third
- Conversion % = (Scores / Final 45 entries) × 100

**Visual:**
- Target: 60% conversion (benchmark)
- Actual: Current team %
- Comparison: Opposition %
- Red/amber/green zones

**Manager Insight:**
- "30 final 45 entries, only 10 scores → finishing issue, not build-up"
- "80% conversion inside 21m → work ball into danger zone"

**Claude AI Prompt Context:**
```
Analyze attacking efficiency:
- How many attacking entries convert to scores?
- Where is the breakdown (final pass, shot selection, decision-making)?
- Compare to league average/benchmarks
- Recommend attacking drills
```

---

### **7. Scores Per Area Breakdown**
**Purpose:** Identify scoring hotspots and dead zones

**Chart Type:** Pitch Heatmap with Zone Labels

**Zones (based on GAA pitch markings):**
1. **Inside 13m arc** (premium zone)
2. **13-20m (large rectangle)** 
3. **20-45m (left, center, right thirds)**
4. **45m+ (2-point zone)**

**Data Points:**
- Goals by zone
- Points by zone
- Wides by zone
- Success rate % by zone
- Player shot distribution

**Visual:**
- Pitch divided into zones
- Color intensity = score frequency
- Numbers overlay = conversion %

**Manager Insight:**
- "95% success inside 13m, only 30% from 45m+ → patience pays off"
- "Zero scores left 20-45m zone → opposition defensive weakness?"

**Claude AI Prompt Context:**
```
Analyze scoring geography:
- Which zones are most clinical?
- Which zones have poor conversion?
- Are we shooting from optimal positions?
- Exploit opponent's defensive weaknesses in specific zones
```

---

### **8. Turnovers by Zone**
**Purpose:** Identify problem areas for possession loss

**Chart Type:** Pitch Overlay with Turnover Markers

**Zones:**
- Defensive 21m
- Defensive 21-45m
- Midfield 45-65m (opposition)
- Attacking 45-21m (opposition)
- Attacking 21m (opposition)

**Data Points:**
- Turnover location (x, y)
- Turnover type
- Player responsible
- Time in match
- Possession duration before turnover

**Visual:**
- Red markers on pitch
- Size = frequency
- Clustering analysis

**Manager Insight:**
- "Losing ball heavily in left attacking 21m → player X needs positional talk"
- "No turnovers in midfield → strong control, maintain"

**Claude AI Prompt Context:**
```
Analyze turnover geography:
- Where are critical turnovers happening?
- Which players involved in specific zones?
- Is it positional, technical, or tactical?
- Recommend player movement or coaching focus
```

---

## 🏃 PLAYER CONDITIONING CHARTS (View 2)

### **9. Fitness Test Trends**
- Multi-session comparison
- EUR (Estimated Ultimate Recovery) trends
- MAS (Maximum Aerobic Speed) progression
- Mobility, Power, Strength scores over time

### **10. GPS Training Load**
- Total distance per session
- High-speed running
- Sprint count
- Accelerations/decelerations
- Player load
- Week-over-week trends

### **11. Individual Player Profiles**
- Fitness test history
- Match performance trends
- Injury risk indicators (AI-powered)
- Leaderboard rankings

### **12. Last Fitness Test Snapshot**
- Isolated view of most recent test
- Compare to previous test
- Highlight improvements/declines

---

## 🎨 SUGGESTED VIEW NAMES

### **Option 1: (RECOMMENDED)**
- **Match Intelligence** 🎯
- **Fitness & Conditioning** 💪

### Option 2:
- **Tactical Dashboard**
- **Physical Performance**

### Option 3:
- **Game Analytics**
- **Player Wellness**

---

## 🤖 CLAUDE AI INTEGRATION NOTES

### **Data Context for AI:**
All charts will feed structured data to Claude for:
1. Pattern recognition
2. Tactical recommendations
3. Player-specific coaching points
4. Opponent weakness identification
5. Substitution timing suggestions
6. Training drill recommendations

### **Sample AI Prompt Structure:**
```python
f"""
You are an elite GAA coach analyzing match data for {team_name}.

MATCH OVERVIEW:
- Final Score: {score}
- Possession: {possession_stats}
- Shooting: {shooting_stats}

DETAILED ANALYSIS NEEDED:
1. Shooting Efficiency: {shot_map_data}
2. Kickout Strategy: {kickout_data}
3. Turnover Patterns: {turnover_data}
4. Scoring Momentum: {temporal_data}
5. Defensive Work: {defensive_data}
6. Conversion Rate: {conversion_data}

ZONES OF CONCERN:
- Turnovers: {turnover_zones}
- Scoring: {scoring_zones}

Provide:
1. Top 3 tactical insights
2. Top 3 areas for improvement
3. 2 specific training drill recommendations
4. Substitution/positional suggestions for next match
"""
```

---

## 📋 UPDATED IMPLEMENTATION PHASES

### **Phase 1: Connect Frontend ↔ Backend** ⚡ (NEXT)
- API integration
- Live score updates
- Event recording

### **Phase 2: Possession Tracking** 🎯
- Real-time possession calculation
- Auto-switch on turnover

### **Phase 3: Claude AI Integration** 🤖
- Basic insights endpoint
- Live match analysis

### **Phase 4: Match Intelligence Dashboard** 📊
- Chart 1-8 implementation (Recharts)
- Toggle between views
- Historical data queries

### **Phase 5: Fitness & Conditioning Dashboard** 💪
- Chart 9-12 implementation
- GPS data visualization
- Fitness test trends

### **Phase 6: Advanced AI Insights** 🧠
- Context-aware prompts
- Drill recommendations
- Pattern detection

---

**This specification will be used to:**
1. Guide Recharts implementation
2. Structure database queries
3. Build Claude AI prompts
4. Create manager-facing insights

**SAVED FOR CONTEXT PERSISTENCE** ✅

