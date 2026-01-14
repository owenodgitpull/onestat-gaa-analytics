# Claude AI Integration Specification

## Overview
This document outlines how Claude AI (Sonnet 4.5) will be integrated into the Dungloe GAA Analytics platform to provide real-time insights, pattern recognition, and tactical recommendations.

---

## 1. Pitch Zone Mapping

### Coordinate System
All match events and possession tracking use x,y coordinates (0-100% scale) that map to specific zones on a GAA pitch.

### Y-Axis Zones (Vertical - Goal to Goal)
```
0-15%:    Own Full-Back Zone / Goal Area
          - Defending goal
          - High-pressure defensive zone
          
15-35%:   Own Half-Back Zone
          - Between own goal and own 45m line
          - First line of defense breakdown point
          
35-50%:   Own Half-Forward Zone
          - Between own 45m line and midfield
          - Attacking third entry point
          
50%:      MIDFIELD LINE
          - Center of pitch
          - Kickout contest zone
          
50-65%:   Opposition Half-Forward Zone
          - Between midfield and opposition 45m line
          - Scoring opportunity build-up
          
65-85%:   Opposition Half-Back Zone
          - Between opposition 45m line and goal
          - High-scoring probability zone
          
85-100%:  Opposition Full-Back Zone / Goal Area
          - Attacking goal
          - Maximum scoring probability
```

### X-Axis Zones (Horizontal - Sideline to Sideline)
```
0-33%:    Left Channel
33-66%:   Central Channel
66-100%:  Right Channel
```

### Example Zone Analysis
- **Coordinate (50, 75)** = Central Channel, Opposition Half-Back Zone
- **Coordinate (20, 30)** = Left Channel, Own Half-Back Zone
- **Coordinate (85, 15)** = Right Channel, Own Full-Back Zone

---

## 2. Data Context for Claude

### Match Data Provided to Claude
Claude will receive the following structured data for analysis:

#### A. Match Metadata
```json
{
  "match_id": "uuid",
  "opponent": "Team Name",
  "match_date": "2026-01-15T19:00:00",
  "venue": "home|away|neutral",
  "competition": "League|Championship|Friendly",
  "weather_conditions": "optional",
  "starting_15": [
    {
      "player_id": 1,
      "name": "Player Name",
      "position": "Goalkeeper",
      "jersey_number": 1
    }
    // ... 14 more players
  ]
}
```

#### B. Match Events
```json
{
  "events": [
    {
      "id": 1,
      "event_type": "POINT|GOAL|WIDE|TURNOVER|KICKOUT_WON|...",
      "player_id": 12,
      "player_name": "Player Name",
      "minute": 15,
      "half": 1,
      "x_coord": 75.5,
      "y_coord": 68.2,
      "is_home_team": true,
      "zone": "Opposition Half-Back Zone, Central Channel"
    }
  ]
}
```

#### C. Possession Events
```json
{
  "possession_events": [
    {
      "id": 1,
      "x_coord": 45.0,
      "y_coord": 52.0,
      "team": "home|away",
      "timestamp": "2026-01-15T19:15:23",
      "zone": "Opposition Half-Forward Zone, Central Channel"
    }
  ]
}
```

#### D. Aggregated Statistics
```json
{
  "possession_percentage": {
    "dungloe": 58,
    "opponent": 42
  },
  "possession_by_zone": {
    "own_defensive": 15,
    "own_half_back": 22,
    "own_half_forward": 18,
    "midfield": 12,
    "opp_half_forward": 20,
    "opp_half_back": 10,
    "opp_goal_area": 3
  },
  "shots": {
    "dungloe": { "total": 18, "scores": 14, "wides": 4, "accuracy": 77.8 },
    "opponent": { "total": 12, "scores": 8, "wides": 4, "accuracy": 66.7 }
  },
  "turnovers": {
    "dungloe": { "won": 12, "lost": 8 },
    "opponent": { "won": 8, "lost": 12 }
  },
  "kickouts": {
    "dungloe": { "won": 7, "lost": 5, "retention": 58.3 },
    "opponent": { "won": 5, "lost": 7, "retention": 41.7 }
  }
}
```

#### E. Player Performance (from Starting 15)
```json
{
  "player_stats": [
    {
      "player_id": 12,
      "name": "Player Name",
      "position": "Centre Half-Forward",
      "is_starter": true,
      "goals": 1,
      "points": 3,
      "assists": 2,
      "turnovers_won": 3,
      "turnovers_lost": 1,
      "kickouts_won": 2,
      "shots_taken": 5,
      "shot_accuracy": 80.0
    }
  ]
}
```

---

## 3. Claude AI Prompts & Insights

### Real-Time In-Match Insights
Claude will be queried during the match (e.g., every 10 minutes or at half-time) with:

**Prompt Template:**
```
Analyze the current match performance for Dungloe GAA vs {opponent}.

Match Context:
- Current Time: {minute} minutes, {half} half
- Score: Dungloe {score} vs {opponent} {score}
- Possession: Dungloe {pct}%, {opponent} {pct}%

Match Data:
{JSON data from above}

Starting 15:
{Player lineup with positions}

Zone Analysis:
{Possession % per zone breakdown}

Provide:
1. **Tactical Insight** (1-2 sentences on what's working/not working)
2. **Key Pattern** (1 specific observation from the data)
3. **Recommended Adjustment** (1 actionable suggestion for the manager)

Keep it concise, actionable, and relevant for a GAA manager during a live match.
```

**Example Output:**
> **Tactical Insight:** Dungloe is dominating possession in the opposition half-back zone (68%), but shot accuracy is only 60%. The team is getting into good scoring positions but rushing shots.
> 
> **Key Pattern:** 75% of turnovers are occurring in the central channel between midfield and the opposition 45m line, indicating a need to spread the play wide.
> 
> **Recommended Adjustment:** Encourage players to work the ball wide before taking shots. Consider bringing on a fresh half-forward to exploit the tiring opposition defense.

---

### Post-Match Analysis
After the match, Claude will provide a comprehensive analysis:

**Prompt Template:**
```
Provide a comprehensive post-match analysis for Dungloe GAA vs {opponent}.

Final Score: Dungloe {score} vs {opponent} {score}
Result: {Win|Loss|Draw}

Full Match Data:
{Complete JSON data}

Starting 15 Effectiveness:
{Player stats with is_starter field}

Provide:
1. **Match Summary** (2-3 sentences)
2. **Key Strengths** (Top 3 things that went well)
3. **Areas for Improvement** (Top 3 areas to work on)
4. **Player Performances** (Top 3 standout players with stats)
5. **Tactical Analysis** (Zone control, possession patterns, scoring efficiency)
6. **Starting 15 Insight** (Was this lineup effective? Historical performance?)
7. **Recommendations for Next Match** (2-3 tactical suggestions)
```

---

### Historical Pattern Recognition (Using Starting 15 Data)

**Prompt Template:**
```
Analyze historical performance patterns for Dungloe GAA.

Dataset:
{Past 10+ matches with starting_15, results, and stats}

Focus Areas:
1. **Starting Lineup Effectiveness**
   - Which starting 15 combinations have the best win rate?
   - Which positions have the most impact when specific players start?
   
2. **Positional Analysis**
   - Which positions show the most variation in performance?
   - Are there consistent weak points in the lineup?

3. **Player Impact**
   - Which players, when starting, correlate with better results?
   - Are there underutilized players who perform well when given a chance?

4. **Tactical Patterns**
   - Do certain lineups perform better at home vs. away?
   - Are there recurring patterns in losses (e.g., weak kickout retention)?

Provide actionable insights for team selection.
```

---

## 4. Integration Points

### A. Live Match Screen
- **"AI Insights" Section** - Updates every 10 minutes or on-demand
- Button: "Refresh Insights" triggers Claude analysis
- Display: Card with 3 key insights (Tactical, Pattern, Recommendation)

### B. Post-Match Report
- Auto-generated after "End Match" is clicked
- Full analysis stored in `match.ai_analysis` JSONB field
- Viewable on dashboard or match detail page

### C. Dashboard Analytics
- "Team Insights" section powered by Claude
- Historical pattern analysis over multiple matches
- Starting 15 effectiveness leaderboard
- Position-specific performance trends

---

## 5. API Integration

### Anthropic Claude API (Sonnet 4.5)
```python
import anthropic

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

def get_match_insights(match_data: dict) -> str:
    """
    Call Claude API with match data and zone mapping context
    """
    message = client.messages.create(
        model="claude-sonnet-4.5",
        max_tokens=1024,
        system=ZONE_MAPPING_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": format_match_prompt(match_data)
            }
        ]
    )
    return message.content[0].text
```

### System Prompt (Zone Mapping Context)
```python
ZONE_MAPPING_SYSTEM_PROMPT = """
You are an AI analyst for Dungloe GAA, a Gaelic Athletic Association team.

PITCH ZONE MAPPING:
You will receive match data with x,y coordinates (0-100% scale).
Use this mapping to understand spatial patterns:

Y-Axis (Goal to Goal):
- 0-15%: Own Goal Area
- 15-35%: Own Half-Back Zone
- 35-50%: Own Half-Forward Zone
- 50%: Midfield Line
- 50-65%: Opposition Half-Forward Zone
- 65-85%: Opposition Half-Back Zone (HIGH SCORING ZONE)
- 85-100%: Opposition Goal Area

X-Axis (Sideline to Sideline):
- 0-33%: Left Channel
- 33-66%: Central Channel
- 66-100%: Right Channel

GAA CONTEXT:
- Scores: Goals (3 points) and Points (1 point)
- Kickouts: Goalkeeper restarts play after a score or wide
- Turnovers: Change of possession
- 45m line: Marks the high-scoring zone
- Starting 15: The initial lineup has significant tactical importance

Your analysis should be:
1. Concise and actionable
2. Data-driven
3. Tactically sound for GAA
4. Focused on patterns in zone control and player positioning
"""
```

---

## 6. Future Enhancements

### GPS Data Integration
Once GPS data from tracker devices is uploaded, Claude will also analyze:
- Distance covered per zone
- Sprint counts in attacking zones
- High-intensity running patterns
- Player fatigue indicators

### Opponent Scouting
Upload opponent match data to get:
- Opponent strengths/weaknesses by zone
- Predicted lineup effectiveness
- Counter-tactical recommendations

---

## 7. Cost Optimization

### API Call Strategy
- **Live Match:** Max 3-4 calls per match (half-time, 60 mins, full-time)
- **Post-Match:** 1 comprehensive call
- **Historical Analysis:** 1 call per week for dashboard insights

### Estimated Costs (Claude Sonnet 4.5)
- Input: ~2,000 tokens per call (match data + context)
- Output: ~500 tokens per response
- Cost: ~$0.015 per call
- **Monthly estimate:** ~$5-10 for 20-30 matches + weekly insights

---

## Implementation Checklist
- [x] Define pitch zone mapping
- [x] Document data structure for Claude
- [ ] Create backend endpoint: `/api/v1/matches/{id}/ai-insights`
- [ ] Implement Claude API integration
- [ ] Add system prompt with zone mapping
- [ ] Create frontend UI for displaying insights
- [ ] Test with real match data
- [ ] Optimize token usage
- [ ] Add caching for repeated queries
- [ ] Implement starting 15 historical analysis
- [ ] Deploy to production

---

**Last Updated:** 2026-01-14
**Author:** Dungloe GAA Analytics Team

