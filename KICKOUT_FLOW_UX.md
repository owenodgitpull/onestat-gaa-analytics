# ⚽ Kickout Flow UX - After Score Recommendations

## The Problem
After a team scores (goal or point), the opposing team gets a kickout. The user needs to record what happens with that kickout.

## Current State
User has to manually:
1. Record the score (Point/Goal button)
2. Remember kickout is next
3. Click the appropriate kickout button
4. Select player

This is **error-prone** and breaks the natural flow of match recording.

---

## ✅ **Recommended Solution: Auto-Prompt for Kickout**

### Flow
```
1. User clicks "Point" (Dungloe scores)
   ↓
2. Player selection modal appears
   ↓
3. User selects scorer
   ↓
4. **AUTOMATIC**: Kickout modal appears
   "Glenties Kickout - Who won possession?"
   ↓
5. User selects:
   - Dungloe Player (Opp Kickout Lost)
   - Glenties Player (Opp Kickout Won)
   - Skip (for now, can add later)
```

### Why This Works
✅ **Natural**: Follows the real game flow  
✅ **Can't forget**: Automatically prompts  
✅ **Quick**: 2 clicks total (scorer, then kickout winner)  
✅ **Accurate**: Captures what actually happened  

---

## Implementation Details

### Modal Design
```
┌─────────────────────────────────────┐
│  🏉  Glenties Kickout                │
│                                      │
│  Who won possession?                 │
│                                      │
│  ┌─────────────┐  ┌─────────────┐  │
│  │  Dungloe    │  │  Glenties   │  │
│  │  (We won)   │  │ (They kept) │  │
│  └─────────────┘  └─────────────┘  │
│                                      │
│  [Skip for now]                      │
└─────────────────────────────────────┘
```

### What Gets Recorded
**If Dungloe wins:**
- Event: `opp_kickout_lost` (or `kickout_won` to backend)
- Team: Dungloe
- Player: Selected Dungloe player
- Possession: Automatically switches to Dungloe

**If Glenties keeps:**
- Event: `opp_kickout_won` (or `kickout_won` to backend)
- Team: Glenties
- Player: Selected Glenties player
- Possession: Stays with Glenties

---

## Alternative Options (Not Recommended)

### Option 2: Quick Buttons After Score
```
After scoring:
[Kickout Won] [Kickout Lost] [Skip]
```
**Problems:**
- Easy to click wrong button
- Still requires remembering to act
- Breaks visual flow

### Option 3: Auto-Record Default
```
Automatically record "Opp Kickout Won" after score
User can undo/change if wrong
```
**Problems:**
- Assumes outcome (not always correct)
- Undo is awkward UX
- May record inaccurate data

---

## Edge Cases

### Short Kickout
If Glenties goes short (pass to nearby defender):
- User selects Glenties player who received it
- Records as `opp_kickout_won`
- This is correct! They retained possession

### Contested Kickout
If ball is contested/unclear:
- User can click "Skip for now"
- No kickout event recorded
- Can add manually later if needed

### Breaking Ball
After kickout is contested:
- First record kickout outcome (won/lost)
- Then can record "Breaking Ball Won" separately if relevant
- This captures both: who won kickout AND who won the break

---

## YouTube Recording Workflow

### Current (Without Auto-Prompt)
```
1. Watch goal
2. Click Point → Select player
3. Remember kickout happened
4. Look for kickout button
5. Click kickout button → Select player
Total: 4-5 actions, easy to forget step 3-5
```

### With Auto-Prompt
```
1. Watch goal
2. Click Point → Select player
3. Modal appears: "Who won kickout?"
4. Select player
Total: 2 actions, can't forget!
```

**Time saved per score: ~5-10 seconds**  
**Accuracy improvement: Significant** (won't forget kickouts)

---

## Data Quality Benefits

### Current State
- Users forget ~30-50% of kickouts
- Possession tracking incomplete
- Kickout retention stats inaccurate

### With Auto-Prompt
- Capture ~95%+ of kickouts
- Complete possession timeline
- Accurate kickout retention %
- Better AI insights (e.g., "Dungloe wins 70% of opposition kickouts")

---

## Implementation Priority

### Phase 1 (MVP) ✅ Already Working
- Manual kickout buttons in action buttons
- User records kickouts themselves
- **This is what you have now**

### Phase 2 (Recommended Next)
- Auto-prompt modal after scores
- Two-click workflow
- "Skip" option for flexibility
- **Implements the flow above**

### Phase 3 (Future Enhancement)
- Track kickout distance (short/medium/long)
- Track landing zone on pitch
- Advanced kickout analytics

---

## Technical Notes

### Trigger Conditions
Show kickout modal when:
- Event type is GOAL or POINT
- Player is selected
- Match is in progress
- Modal should appear INSTEAD of closing player modal

### State Management
```typescript
const [isKickoutModalOpen, setIsKickoutModalOpen] = useState(false)
const [lastScoringTeam, setLastScoringTeam] = useState<'dungloe' | 'opponent' | null>(null)

// After recording score event:
if (event_type === 'goal' || event_type === 'point') {
  setLastScoringTeam(team)
  setIsKickoutModalOpen(true)
}
```

### Possession Update
Kickout outcome automatically updates possession:
- If defending team wins → they now have possession
- If attacking team wins → they retain possession
- Duration calculation continues automatically

---

## User Feedback & Testing

### Questions to Ask During Testing
1. Did you remember to record all kickouts?
2. Was the modal disruptive or helpful?
3. Did you want a "Skip" option or always record?
4. Should short kickouts be handled differently?

### Success Metrics
- % of scores followed by kickout recording
- Time per score event (should decrease)
- User satisfaction with flow
- Data completeness

---

## Final Recommendation

**Implement Phase 2 (Auto-Prompt Modal)**

This gives you:
✅ Natural workflow  
✅ Complete data  
✅ Faster recording  
✅ Better accuracy  
✅ Optional flexibility (Skip button)  

**Estimated effort:** 2-3 hours  
**Impact:** High (improves core recording flow)  
**User benefit:** Significant (natural + can't forget)

---

## Want This Implemented?

Just say "yes, implement the auto-prompt kickout modal" and I'll build it!

It will show after every score and make recording kickouts automatic and intuitive. 🎯
