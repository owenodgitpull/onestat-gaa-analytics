# Video Tagging Player Selection Alignment Issues

## Problem
Video Tagging player selection after kickout doesn't match Live Recording:
1. Modal/overlay appearance different
2. Colors incorrect  
3. Overall UX not identical

## Root Causes Found:

### 1. Missing ballPosition in PitchPlayerSelector
**MatchRecording** (line 5360):
```tsx
ballPosition={pendingEvent?.position ?? ballPosition}
```

**VideoTagging** (line 2330):
```tsx
ballPosition={ballPosition}  // ✓ Has it
```

### 2. Team prop mismatch
**MatchRecording**: Always uses `team="own"`
**VideoTagging** (line 2324): 
```tsx
team={(pendingOverlay?.eventData.team ?? possession) === 'team_a' ? 'own' : 'opponent'}
```
This could cause opponent color scheme to be used!

### 3. Missing player filtering
**MatchRecording** (line 5355): Uses `playersOnField` (only on-field players)
**VideoTagging** (line 2325): Uses `playerList` (all players, including bench)

## THE FIX:

VideoTagging should EXACTLY match MatchRecording for kickout player selection.
