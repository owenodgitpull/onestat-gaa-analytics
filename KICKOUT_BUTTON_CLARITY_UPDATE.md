# Kickout Button Label Clarity Update

## Issue
Kickout button labels were ambiguous and caused confusion:
- **"K/O Won"** / **"K/O Lost"** - unclear from whose perspective
- **"Break Won"** / **"Break Lost"** - same ambiguity
- User reported: "Opp K/O break won" was asking for opposition player instead of Dungloe player

## Root Cause
The old labels ("Won"/"Lost") could be interpreted from either:
1. **The kicking team's perspective** (Opp K/O Lost = opponent lost their kickout)
2. **Dungloe's perspective** (Opp K/O Lost = Dungloe lost the contest for opponent's kickout)

This led to incorrect logic for player selection and stat attribution.

## Solution: Explicit Labels

Changed all kickout buttons to explicitly state **WHO WON THE BALL**:

### Old Labels (Ambiguous)
```
Our K/O:
  - K/O Won
  - K/O Lost
  - Break Won
  - Break Lost

Opp K/O:
  - K/O Won
  - K/O Lost
  - Break Won
  - Break Lost
```

### New Labels (Crystal Clear)
```
Our K/O:
  - Dungloe Won ✅
  - Opposition Won ❌
  - Dungloe Won Break ⚡
  - Opposition Won Break ❌

Opp K/O:
  - Dungloe Won ✅
  - Opposition Won ❌
  - Dungloe Won Break ⚡
  - Opposition Won Break ❌
```

## Logic Changes

### Player Selection
- **"Dungloe Won"** buttons → Show Dungloe player selection modal
- **"Opposition Won"** buttons → No modal (we don't track opponent players)

### Backend Event Mapping

| Frontend Button | Backend Event Type | Team | Stat Incremented |
|----------------|-------------------|------|------------------|
| **Our K/O → Dungloe Won** | `kickout_won` | `DUNGLOE` | `dungloe_kickouts_won` |
| **Our K/O → Opposition Won** | `kickout_lost` | `DUNGLOE` | `dungloe_kickouts_lost` |
| **Opp K/O → Dungloe Won** | `kickout_won` | `DUNGLOE` | `dungloe_kickouts_won` |
| **Opp K/O → Opposition Won** | `kickout_won` | `OPPONENT` | `opponent_kickouts_won` |

### Breaking Ball Mapping

| Frontend Button | Backend Event Type | Team | Stat Incremented |
|----------------|-------------------|------|------------------|
| **Our K/O → Dungloe Won Break** | `breaking_ball_won` | `DUNGLOE` | `dungloe_breaking_balls_won` |
| **Our K/O → Opposition Won Break** | `breaking_ball_lost` | `DUNGLOE` | `dungloe_breaking_balls_lost` |
| **Opp K/O → Dungloe Won Break** | `breaking_ball_won` | `DUNGLOE` | `dungloe_breaking_balls_won` |
| **Opp K/O → Opposition Won Break** | `breaking_ball_won` | `OPPONENT` | `opponent_breaking_balls_won` |

## Code Changes

### 1. Updated EventType Enum
**File**: `frontend/src/types/index.ts`

```typescript
// OLD
OWN_KICKOUT_WON = 'own_kickout_won',
OWN_KICKOUT_LOST = 'own_kickout_lost',
OPP_KICKOUT_WON = 'opp_kickout_won',
OPP_KICKOUT_LOST = 'opp_kickout_lost',
// ... breaks

// NEW
OWN_KICKOUT_DUNGLOE_WON = 'own_kickout_dungloe_won',
OWN_KICKOUT_OPPOSITION_WON = 'own_kickout_opposition_won',
OPP_KICKOUT_DUNGLOE_WON = 'opp_kickout_dungloe_won',
OPP_KICKOUT_OPPOSITION_WON = 'opp_kickout_opposition_won',
// ... breaks with same pattern
```

### 2. Updated Button Labels
**File**: `frontend/src/components/CategorizedActionButtons.tsx`

All kickout buttons now explicitly say "Dungloe Won" or "Opposition Won".

### 3. Updated handleQuickAction Logic
**File**: `frontend/src/pages/MatchRecording.tsx`

```typescript
// NEW LOGIC - Crystal clear
const isDungloeWon = eventStr.includes('DUNGLOE_WON')
const isOppositionWon = eventStr.includes('OPPOSITION_WON')

if (isDungloeWon) {
  isHomeTeam = true  // Always Dungloe player needed
} else if (isOppositionWon) {
  isHomeTeam = false  // No player needed
}
```

### 4. Updated PlayerSelectionModal
**File**: `frontend/src/components/PlayerSelectionModal.tsx`

Updated `EVENT_LABELS` to recognize new event type names.

## Benefits

✅ **Zero Ambiguity**: No more confusion about whose perspective "Won"/"Lost" refers to  
✅ **Correct Player Selection**: Dungloe Won → Dungloe players, Opposition Won → no modal  
✅ **Accurate Stats**: Correct attribution of kickout wins/losses  
✅ **Better UX**: User immediately knows which button to press  
✅ **Future-Proof**: Clear semantics for AI analysis

## Testing Checklist

- [x] "Our K/O → Dungloe Won" asks for Dungloe player → increments `dungloe_kickouts_won`
- [x] "Our K/O → Opposition Won" no modal → increments `dungloe_kickouts_lost`
- [x] "Opp K/O → Dungloe Won" asks for Dungloe player → increments `dungloe_kickouts_won`
- [x] "Opp K/O → Opposition Won" no modal → increments `opponent_kickouts_won`
- [x] Same logic for all "Break" buttons
- [x] Kickout menu auto-closes after any selection

## Files Modified
- `frontend/src/types/index.ts`
- `frontend/src/components/CategorizedActionButtons.tsx`
- `frontend/src/pages/MatchRecording.tsx`
- `frontend/src/components/PlayerSelectionModal.tsx`

## Date
2026-01-18
