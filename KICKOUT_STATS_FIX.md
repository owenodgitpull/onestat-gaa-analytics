# Kickout Stats & Tab Auto-Close Fix

## Issue
User reported two problems:
1. When clicking **"Opp kickout lost"**, the opponent's kickouts won stat did not increment
2. The kickout menu category did not auto-close after selecting a kickout event

## Root Causes

### Problem 1: Incorrect Event Type Mapping
The semantic meaning of **"Opp K/O Lost"** was being mapped incorrectly:

- **What it means**: Opponent's kickout → Opponent retained possession
- **What should increment**: `opponent_kickouts_won`
- **What was happening**: Backend received `event_type: 'kickout_lost'`, which incremented `opponent_kickouts_lost` ❌

The confusion arose because "Lost" was being interpreted as "the kickout was lost" rather than "Dungloe lost the contest for the opponent's kickout".

### Problem 2: String Comparison Issue
The auto-close logic was checking `eventType.includes('KICKOUT')` on an enum value, but TypeScript enums don't support `.includes()` method.

## Solution

### 1. Fixed Event Type Mapping

Updated the mapping in `mapEventTypeToBackend()`:

```typescript
// OLD - Incorrect
'opp_kickout_lost': 'kickout_lost',
'opp_kickout_break_lost': 'breaking_ball_lost',

// NEW - Correct
'opp_kickout_lost': 'kickout_won',  // Opponent won their own kickout
'opp_kickout_break_lost': 'breaking_ball_won',  // Opponent won the break
```

### 2. Fixed String Comparison for Auto-Close

Updated both `recordEventWithoutPlayer` and `handlePlayerSelected`:

```typescript
// OLD - Doesn't work with enum
const isKickoutEvent = eventType.includes('KICKOUT') || eventType.includes('BREAK')

// NEW - Convert to string first
const eventTypeStr = String(eventType).toUpperCase()
const isKickoutEvent = eventTypeStr.includes('KICKOUT') || eventTypeStr.includes('BREAK')
```

### 3. Fixed Type Definition

Changed `activeKickoutTab` state type to allow `null`:

```typescript
// OLD
const [activeKickoutTab, setActiveKickoutTab] = useState<string>('scoring')

// NEW
const [activeKickoutTab, setActiveKickoutTab] = useState<string | null>('scoring')
```

## Complete Kickout Semantics

| Button | Who Kicked Out? | Who Won? | Backend Mapping | Stat Incremented |
|--------|----------------|----------|-----------------|------------------|
| **Our K/O → K/O Won** | Dungloe | Dungloe | `team: DUNGLOE`, `type: kickout_won` | `dungloe_kickouts_won` |
| **Our K/O → K/O Lost** | Dungloe | Opponent | `team: OPPONENT`, `type: kickout_lost` | `dungloe_kickouts_lost` |
| **Opp K/O → K/O Won** | Opponent | Dungloe | `team: DUNGLOE`, `type: kickout_won` | `dungloe_kickouts_won` |
| **Opp K/O → K/O Lost** | Opponent | Opponent | `team: OPPONENT`, `type: kickout_won` | `opponent_kickouts_won` ✅ |

## Testing

To verify the fix:
1. Record a Dungloe score
2. Click **"Opp K/O → K/O Lost"** (opponent retained their kickout)
3. Verify that **`opponent_kickouts_won`** increments in the stats panel
4. Verify that the kickout menu closes and returns to "Scoring" tab

## Files Modified
- `frontend/src/pages/MatchRecording.tsx`

## Date
2026-01-18
