# Reverted to Possession-Based Scoring + Auto-Close Kickout Tabs ✅

## User Feedback

> "I like the single scoring tab based on who is in possession - we're going to provide a facility for user to be able to log a goal outside of the possession based recording if they forgot to for example they can do this but we don't need to do that yet. Possession based works as it's context aware and intuitive but the button categories need to be closing and resetting to make it intuitive, e.g when I select Opp Kickout won, that menu category should close. Revert to the menu we had please"

---

## What Was Reverted

### ❌ Removed: Separate "Our Scoring" and "Opp Scoring" Tabs

**Before revert (didn't work well):**
```
[Our Scoring] [Opp Scoring] [Turnovers] [Our K/O] [Opp K/O]
     ↓             ↓
   Always        Always
   Dungloe      Opponent
```

### ✅ Back to: Single "Scoring" Tab (Possession-Based)

**After revert (intuitive):**
```
[Scoring] [Turnovers] [Our K/O] [Opp K/O]
    ↓
Based on current possession (context-aware)
```

---

## How It Works Now

### Single "Scoring" Tab

**Buttons:** Goal, Point, Wide

**Team Attribution:**
- If **Dungloe** has possession → Score goes to Dungloe ✅
- If **Opponent** has possession → Score goes to opponent ✅

**Why This Works:**
- **Context-aware**: System knows who has the ball
- **Intuitive**: You're watching the match, you know who scored
- **Less clicking**: One tab for all scoring, not two

---

## NEW: Auto-Close Kickout Tabs ✅

### User Flow (Before Fix)

```
1. Dungloe scores → [Opp K/O] tab opens
2. Click "K/O Won" → Records event
3. Tab stays on [Opp K/O] ❌ (annoying)
4. User manually clicks [Scoring] tab
5. Record next action
```

### User Flow (After Fix)

```
1. Dungloe scores → [Opp K/O] tab opens ✅
2. Click "K/O Won" → Records event → AUTO-RETURNS to [Scoring] ✅
3. Ready to record next action immediately! ✅
```

### What Auto-Closes the Kickout Tab?

**ALL kickout/breaking ball events:**
- K/O Won (Dungloe player)
- K/O Lost (opponent secured)
- Break Won (Dungloe player)
- Break Lost (opponent secured)

After ANY of these → **Automatically returns to [Scoring] tab** ✅

---

## Complete Workflow Example

### Scenario: Dungloe Scores, Then Opponent Kickout

```
1. Dungloe has possession
2. [Scoring] Click "Point"
   → Select player #14
   → Score: 00-1 - 00-0 ✅
   → Ball resets to center
   → [Opp K/O] tab AUTO-SELECTED ✅

3. Opponent kicks out, Dungloe player #8 intercepts
4. [Opp K/O] Click "K/O Won"
   → Select player #8
   → Records: "Dungloe #8 won opponent kickout" ✅
   → AUTO-RETURNS to [Scoring] tab ✅

5. Move ball upfield, Dungloe has possession
6. [Scoring] Click "Point"
   → Select player #12
   → Score: 00-2 - 00-0 ✅
   → Ball resets to center
   → [Opp K/O] tab AUTO-SELECTED ✅

7. Opponent kicks out, their player secures it
8. [Opp K/O] Click "K/O Lost"
   → No player modal (opponent secured it)
   → AUTO-RETURNS to [Scoring] tab ✅

9. Move ball, opponent has possession
10. [Scoring] Click "Point"
    → No player modal (opponent scored)
    → Score: 00-2 - 00-1 ✅
    → Ball resets to center
    → [Our K/O] tab AUTO-SELECTED ✅
```

**Zero manual tab switching required!** 🎯

---

## Tab Structure (Current)

```
[Scoring] [Turnovers] [Our K/O] [Opp K/O]
```

### Scoring (Default tab)
- **Goal** → Team determined by possession
- **Point** → Team determined by possession
- **Wide** → Team determined by possession

### Turnovers
- T/O Won → Dungloe won turnover (select player)
- T/O Lost → Dungloe lost turnover (select player)
- Our Unforced Error → Dungloe player mistake (select player)
- Opp Unforced Error → Opponent mistake (no player)

### Our K/O (Auto-selected after opponent scores)
- K/O Won → Dungloe secured our kickout (select player)
- K/O Lost → Opponent intercepted our kickout (no player)
- Break Won → Dungloe won breaking ball (select player)
- Break Lost → Opponent won breaking ball (no player)
- **After ANY action → Auto-return to [Scoring]** ✅

### Opp K/O (Auto-selected after Dungloe scores)
- K/O Won → Dungloe intercepted their kickout (select player)
- K/O Lost → Opponent secured their kickout (no player)
- Break Won → Dungloe won breaking ball (select player)
- Break Lost → Opponent won breaking ball (no player)
- **After ANY action → Auto-return to [Scoring]** ✅

---

## Technical Changes

### Removed from `EventType` Enum
```typescript
// ❌ Removed
OPP_GOAL = 'opp_goal',
OPP_POINT = 'opp_point',
OPP_WIDE = 'opp_wide',
```

### Team Determination Logic (Reverted)
```typescript
// For scoring events (GOAL, POINT, WIDE)
isHomeTeam = ballPosition.team === PossessionTeam.DUNGLOE

// For kickout events (Won/Lost)
if (isWonEvent) {
  isHomeTeam = true   // Dungloe won it
} else if (isLostEvent) {
  isHomeTeam = false  // Opponent won it
}
```

### Auto-Close Logic (NEW!)
```typescript
// After kickout event recorded
const isKickoutEvent = eventType.includes('KICKOUT') || eventType.includes('BREAK')

if (isKickoutEvent) {
  setActiveKickoutTab(null)  // ← Returns to 'Scoring' tab
  console.log('Kickout event resolved, returning to scoring tab')
}
```

---

## Future Enhancement (TODO Item Exists)

### Manual Score Entry Feature

**User Request:**
> "We're going to provide a facility for user to be able to log a goal outside of the possession based recording if they forgot to for example"

**Planned Implementation:**
- Off-side button or modal for manual score entry
- Select team explicitly (not based on possession)
- Select player, event type, minute, etc.
- Use case: Correcting missed events or logging after the fact

**Status:** TODO item already exists (`manual-score-entry`)

---

## Why Possession-Based is Better

### Advantages ✅

1. **Context-Aware**
   - System tracks who has the ball at all times
   - Natural for live match recording
   - Mirrors how you watch the game

2. **Fewer Clicks**
   - One "Scoring" tab instead of two
   - Don't need to think "Our score or their score?"
   - Just click the action that happened

3. **Intuitive Flow**
   - Move ball → Click action → System knows who scored
   - Auto-tab switching handles kickouts seamlessly
   - No manual tab navigation needed

4. **Less Error-Prone**
   - Can't accidentally click wrong scoring tab
   - Possession state is always visible on pitch
   - Visual feedback confirms team

### Edge Case Covered ✅

**"What if I forgot to record a score?"**
- Future manual entry feature (TODO)
- Can log missed events with explicit team selection
- Best of both worlds: Fast live recording + correction ability

---

## Commit Hash
`f68854e` - "revert: Back to possession-based single 'Scoring' tab + auto-close kickout tabs"

---

## Summary

✅ **Reverted to single possession-based 'Scoring' tab**  
✅ **Scoring events (GOAL, POINT, WIDE) determined by current possession**  
✅ **Kickout tabs auto-close and return to 'Scoring' after any kickout event**  
✅ **Zero manual tab switching required for normal flow**  
✅ **More intuitive, context-aware, and efficient**  

**Test it - the flow should feel natural and seamless now!** 🎯
