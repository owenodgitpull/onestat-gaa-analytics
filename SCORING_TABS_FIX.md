# Scoring Tabs Fix - Separate "Our Scoring" and "Opp Scoring" ✅

## The Problem

### Issue 1: Score Attributed to Wrong Team ❌

**User Flow:**
```
1. Dungloe scores point → Score: 00-1 - 00-0 ✅
2. Ball resets to center, "Opp K/O" tab selected ✅
3. User moves ball and records "Opp kickout won" ✅
4. User moves ball and records another point
5. Score shows: 00-1 - 00-1 ❌❌❌ (Opponent got the point!)
```

**Why This Happened:**
- Old logic: Default scoring buttons (GOAL, POINT, WIDE) had no team prefix
- System used **possession** to determine which team scored
- After "Opp kickout won", possession = opponent
- So next point → opponent score ❌

### Issue 2: Kickout Tab Stays Open ❌

- After recording kickout event, the kickout tab stayed active
- User had to manually click back to "Scoring" tab
- Annoying and breaks flow

---

## The Solution

### 1. Separate Scoring Tabs 🎯

**Before:**
```
Tabs: [Scoring] [Turnovers] [Our K/O] [Opp K/O]
      ↓
      GOAL, POINT, WIDE (team determined by possession ❌)
```

**After:**
```
Tabs: [Our Scoring] [Opp Scoring] [Turnovers] [Our K/O] [Opp K/O]
      ↓              ↓
      GOAL           OPP_GOAL      (explicit team, no ambiguity ✅)
      POINT          OPP_POINT
      WIDE           OPP_WIDE
```

### 2. Auto-Return to Scoring After Kickouts ✅

**Flow:**
```
1. Score recorded (Goal/Point)
   → activeKickoutTab = 'opp_kickouts' (or 'our_kickouts')
   → System switches to kickout tab

2. Kickout event recorded (any kickout button)
   → activeKickoutTab = null
   → System returns to 'Our Scoring' tab

3. User can now record next score easily
```

---

## Technical Implementation

### New Event Types Added

```typescript
// frontend/src/types/index.ts
export enum EventType {
  // Dungloe scoring (already existed)
  GOAL = 'goal',
  POINT = 'point',
  WIDE = 'wide',
  
  // NEW: Opponent scoring
  OPP_GOAL = 'opp_goal',
  OPP_POINT = 'opp_point',
  OPP_WIDE = 'opp_wide',
  // ...
}
```

### Button Categories Updated

```typescript
// frontend/src/components/CategorizedActionButtons.tsx
const categories = [
  {
    id: 'scoring',
    label: 'Our Scoring',  // ← Changed from 'Scoring'
    buttons: [
      { eventType: EventType.GOAL, label: 'Goal', icon: Target },
      { eventType: EventType.POINT, label: 'Point', icon: TrendingUp },
      { eventType: EventType.WIDE, label: 'Wide', icon: XCircle },
    ]
  },
  {
    id: 'opp_scoring',  // ← NEW TAB
    label: 'Opp Scoring',
    buttons: [
      { eventType: EventType.OPP_GOAL, label: 'Opp Goal', icon: Target },
      { eventType: EventType.OPP_POINT, label: 'Opp Point', icon: TrendingUp },
      { eventType: EventType.OPP_WIDE, label: 'Opp Wide', icon: XCircle },
    ]
  },
  // ... other tabs
]
```

### Team Determination Logic Fixed

```typescript
// frontend/src/pages/MatchRecording.tsx - handleQuickAction()

// OLD LOGIC (BROKEN):
const isHomeTeam = eventType.startsWith('OPP_') 
  ? false
  : eventType.startsWith('OWN_')
    ? true
    : ballPosition.team === PossessionTeam.DUNGLOE  // ❌ Used possession for scoring!

// NEW LOGIC (FIXED):
if (eventType.startsWith('OPP_')) {
  // OPP_ prefix = opponent action (includes OPP_GOAL, OPP_POINT, etc.)
  isHomeTeam = false
} else if (eventType.startsWith('OWN_')) {
  // OWN_ prefix = Dungloe action
  isHomeTeam = true
} else {
  // No prefix (GOAL, POINT, WIDE, turnovers) = always Dungloe ✅
  isHomeTeam = true
}
```

### Auto-Return to Scoring Logic

```typescript
// frontend/src/pages/MatchRecording.tsx - recordEventWithoutPlayer()

// Check if this was a kickout event
const kickoutEvents = [
  EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_LOST,
  EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_LOST,
  EventType.OWN_KICKOUT_BREAK_WON, EventType.OWN_KICKOUT_BREAK_LOST,
  EventType.OPP_KICKOUT_BREAK_WON, EventType.OPP_KICKOUT_BREAK_LOST
]
const isKickoutEvent = kickoutEvents.includes(eventType)

if (isScore) {
  // Auto-select kickout tab after score
  setActiveKickoutTab(isHomeTeam ? 'opp_kickouts' : 'our_kickouts')
} else if (isKickoutEvent) {
  // After kickout is resolved, return to scoring tab
  setActiveKickoutTab(null)  // ← This triggers return to 'Our Scoring'
}
```

```typescript
// frontend/src/components/CategorizedActionButtons.tsx

// When activeCategory is explicitly null, return to 'scoring'
const activeCategory = externalActiveCategory === null 
  ? 'scoring' 
  : (externalActiveCategory ?? internalActiveCategory)

useEffect(() => {
  if (externalActiveCategory === null) {
    setInternalActiveCategory('scoring')  // Reset to scoring
  } else if (externalActiveCategory) {
    setInternalActiveCategory(externalActiveCategory)
  }
}, [externalActiveCategory])
```

---

## User Flow Comparison

### Before (Broken) ❌

```
1. Dungloe scores → Score: 00-1 - 00-0
2. Opp K/O tab selected
3. User: "Opp kickout won" → Records, tab stays open
4. User: Manually switch to "Scoring" tab
5. User: Move ball, click "Point"
   → System checks possession = opponent
   → Point goes to opponent! Score: 00-1 - 00-1 ❌
```

### After (Fixed) ✅

```
1. Dungloe scores → Score: 00-1 - 00-0
2. Opp K/O tab selected
3. User: "Opp kickout won" → Records, AUTO-RETURNS to "Our Scoring" tab ✅
4. User: Move ball, click "Point"
   → EventType.POINT (no prefix) = always Dungloe ✅
   → Point goes to Dungloe! Score: 00-2 - 00-0 ✅
```

---

## Complete Tab Structure

### Tab Layout

```
[Our Scoring] [Opp Scoring] [Turnovers] [Our K/O] [Opp K/O]
```

### Tab Contents

#### **Our Scoring** (Default tab)
- Goal → Dungloe scores 3 points
- Point → Dungloe scores 1 point
- Wide → Dungloe missed shot

#### **Opp Scoring** (Manual selection)
- Opp Goal → Opponent scores 3 points
- Opp Point → Opponent scores 1 point
- Opp Wide → Opponent missed shot

#### **Turnovers**
- T/O Won → Dungloe won turnover
- T/O Lost → Dungloe lost turnover
- Our Unforced Error → Dungloe player mistake
- Opp Unforced Error → Opponent player mistake

#### **Our K/O** (Auto-selected after opponent score)
- K/O Won → Dungloe keeper won kickout (select player)
- K/O Lost → Contested, no clear winner
- Break Won → Dungloe player won breaking ball (select player)
- Break Lost → Opponent won breaking ball

#### **Opp K/O** (Auto-selected after Dungloe score)
- K/O Won → Opponent won their kickout
- K/O Lost → Contested, no clear winner
- Break Won → Dungloe player won breaking ball (select player)
- Break Lost → Opponent won breaking ball

---

## Backend Mapping

All opponent scoring events map to the same backend enum:

```typescript
// frontend/src/pages/MatchRecording.tsx - mapEventTypeToBackend()

const mapping: Record<string, string> = {
  // Dungloe scoring
  'goal': 'goal',
  'point': 'point',
  'wide': 'wide',
  
  // Opponent scoring - strip OPP_ prefix, use team field to distinguish
  'opp_goal': 'goal',
  'opp_point': 'point',
  'opp_wide': 'wide',
  // ...
}
```

The `team` field (from `is_home_team`) distinguishes Dungloe vs. opponent in the database.

---

## Testing Scenarios

### Scenario 1: Dungloe Scores, Then Opponent Kickout

```
1. [Our Scoring] Click "Point" → Select player
   ✅ Score: 00-1 - 00-0
   ✅ Ball resets to center
   ✅ [Opp K/O] tab auto-selected

2. [Opp K/O] Click "Opp kickout won"
   ✅ Records immediately (no player modal)
   ✅ AUTO-RETURNS to [Our Scoring] tab

3. Move ball, [Our Scoring] Click "Point" → Select player
   ✅ Score: 00-2 - 00-0 (correct team!)
```

### Scenario 2: Opponent Scores

```
1. [Opp Scoring] Click "Opp Point"
   ✅ Score: 00-0 - 00-1
   ✅ No player modal (we don't track opponent players)
   ✅ Ball resets to center
   ✅ [Our K/O] tab auto-selected

2. [Our K/O] Click "K/O Won" → Select keeper
   ✅ Records keeper winning kickout
   ✅ AUTO-RETURNS to [Our Scoring] tab

3. Move ball, [Our Scoring] Click "Point" → Select player
   ✅ Score: 00-1 - 00-1 (correct!)
```

### Scenario 3: Rapid Scoring Back and Forth

```
1. [Our Scoring] Point → 00-1 - 00-0 → [Opp K/O]
2. [Opp K/O] K/O Won → Back to [Our Scoring]
3. [Opp Scoring] Opp Point → 00-1 - 00-1 → [Our K/O]
4. [Our K/O] K/O Won → Back to [Our Scoring]
5. [Our Scoring] Goal → 00-4 - 00-1 → [Opp K/O]
✅ All scores correct, flow smooth, no manual tab switching
```

---

## Why This Design Works

### Clear Intent
- "Our Scoring" = unambiguous, I want to record OUR score
- "Opp Scoring" = unambiguous, I want to record THEIR score
- No guessing based on possession

### Efficient Workflow
1. Most common action = Dungloe scores
2. Default tab = "Our Scoring"
3. After score → Kickout tab auto-selected
4. After kickout → Back to "Our Scoring"
5. 90% of the time, user never manually switches tabs

### Rare Use Case Handled
- If opponent scores: User manually switches to "Opp Scoring"
- After opponent score: "Our K/O" tab auto-selected
- After our kickout: Back to "Our Scoring" (ready for next Dungloe score)

---

## Commit Hash
`0e96dba` - "fix: Separate 'Our Scoring' and 'Opp Scoring' tabs + auto-return to scoring after kickouts"

---

## Summary

✅ **Separate "Our Scoring" and "Opp Scoring" tabs**  
✅ **Default scoring buttons (GOAL, POINT, WIDE) always go to Dungloe**  
✅ **Explicit opponent scoring buttons (OPP_GOAL, etc.) always go to opponent**  
✅ **After ANY kickout event, automatically return to "Our Scoring" tab**  
✅ **Scores now always attributed to the correct team**  

**Test it - the flow should feel natural now!** 🎯
