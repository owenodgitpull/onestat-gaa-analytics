# ⏱️ Time-Based Possession Tracking

## How It Works

### The Problem You Wanted Solved
- **Before**: Possession was counting events (50% if each team had 1 event)
- **After**: Possession tracks **actual time** each team controls the ball

### Real Example
```
Match Timeline:
00:00 - Dungloe gets ball
05:00 - Glenties wins turnover (Dungloe had it for 300 seconds)
07:00 - Dungloe regains possession (Glenties had it for 120 seconds)

Possession %:
- Dungloe: 300s / 420s = 71.4%
- Glenties: 120s / 420s = 28.6%
Total: 100% ✅
```

---

## How Duration is Calculated

### Automatic Calculation
Every time you record a new possession event:
1. **Backend looks back** at the previous possession event
2. **Calculates duration**: `current_timestamp - previous_timestamp`
3. **Updates** the previous event's `duration_seconds`
4. **Creates** the new event (duration starts as null until next event)

### Example Flow
```python
Event 1: Dungloe @ 00:00 (duration=null, waiting for next event)
Event 2: Glenties @ 05:00 (sets Event 1 duration=300 seconds)
Event 3: Dungloe @ 07:00 (sets Event 2 duration=120 seconds)
Event 4: Glenties @ 10:00 (sets Event 3 duration=180 seconds)

Possession Stats:
Dungloe: (300 + 180) / (300 + 120 + 180) = 480/600 = 80%
Glenties: 120 / 600 = 20%
```

---

## What You Need to Do

### Recording Possession Changes

**Option 1: Manual Ball Movement** (Current)
- Drag the ball on the pitch when possession changes
- System automatically records timestamp and calculates duration

**Option 2: Action Buttons Trigger Possession Change** (Already implemented!)
- When you click "Turnover Won" → possession switches automatically
- When you click "Unforced Error" → possession switches automatically
- Duration calculation happens automatically

### The Math
```
Duration for Previous Event = New Event Timestamp - Previous Event Timestamp

Possession % = (Sum of Team's Durations) / (Total Match Duration) × 100
```

---

## Testing It

### Test Scenario
1. **Start match** → Select Dungloe has possession
2. **Wait 30 seconds** (or move ball around for 30s)
3. **Click "Turnover Lost"** → Opponent gets possession
4. **Wait 10 seconds**
5. **Click "Turnover Won"** → Dungloe regains possession

**Expected Result:**
- Dungloe: ~75% (30 seconds / 40 seconds)
- Opponent: ~25% (10 seconds / 40 seconds)

### Real Match Example
```
First Half (30 minutes):
- Dungloe controls ball for 18 minutes
- Opponent controls ball for 12 minutes

Possession:
- Dungloe: 60% ✅
- Opponent: 40% ✅
```

---

## Edge Cases Handled

### 1. Match Completion
When you click "End Match", the system:
- Finalizes the last possession event
- Sets its duration based on current time
- Ensures all possession time is accounted for

### 2. Initial Possession
First event has `duration=null` until:
- A possession change occurs, OR
- Match ends (then duration = time from start to end)

### 3. Gaps in Recording
If you forget to record possession changes:
- The duration keeps accumulating for current team
- This is actually GOOD - it reflects reality!
- Example: If Dungloe dominates for 10 mins without losing ball, their possession grows

---

## Frontend Already Configured

✅ **Ball movement** records possession with timestamp  
✅ **Turnovers** automatically switch possession  
✅ **Unforced errors** automatically switch possession  
✅ **Stats display** shows possession percentages  

---

## The Key Insight

**You don't need to manually track time!**

Just record when possession changes:
- Move the ball to new position
- Click turnover/kickout/unforced error
- System calculates all durations automatically

The more frequently you update, the more accurate it gets!

---

## Accuracy Tips

### High Accuracy
✅ Move ball every 10-20 seconds during play  
✅ Record all turnovers immediately  
✅ Record all kickouts immediately  

### Medium Accuracy  
⚠️ Move ball every minute or so  
⚠️ Only record major possession changes  

### Low Accuracy  
❌ Only record when watching slow motion  
❌ Skip entire sequences of play  

**Recommendation**: Start with medium accuracy, improve as you get comfortable!

---

## Testing Checklist

- [ ] Create match and start first half
- [ ] Select Dungloe has initial possession
- [ ] Wait 30 seconds, check possession stats (should be ~100% Dungloe)
- [ ] Click "Turnover Lost" to give opponent the ball
- [ ] Wait 15 seconds, check possession (should be ~67% Dungloe, 33% Opponent)
- [ ] Click "Turnover Won" to regain possession
- [ ] Wait 15 seconds, check possession (should be ~75% Dungloe, 25% Opponent)
- [ ] Verify totals always equal 100%

---

## What's Different Now

### Before (Event Count)
```
10 Dungloe possession events
10 Opponent possession events
Result: 50% / 50% (wrong if one team dominated)
```

### After (Time Based)
```
Dungloe held ball: 1200 seconds
Opponent held ball: 600 seconds
Result: 67% / 33% (accurate! ✅)
```

---

## Ready to Test!

**Refresh your browser** and try recording a point with the workflow above.

The system now tracks **real game time**, not just event counts! 🎯⏱️
