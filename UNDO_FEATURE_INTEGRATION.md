# Undo-to-Point Feature Integration Guide

## ✅ COMPLETED
- ✅ Backend endpoints created
- ✅ Frontend API services updated
- ✅ React hooks created
- ✅ UndoToPointModal component created

## 🚧 TODO: Integrate into VideoTagging.tsx

### 1. Add imports (around line 43)
```typescript
import { Undo2 } from 'lucide-react'  // Add to existing lucide imports
import UndoToPointModal from '../components/video/UndoToPointModal'
import { useDeleteVideoEventsAfter, useDeleteCarrierSegmentsAfter } from '../hooks/useVideoEvents'
```

### 2. Add state (around line 223, after existing state)
```typescript
  // Undo-to-point modal
  const [showUndoModal, setShowUndoModal] = useState(false)
  const deleteEventsAfter = useDeleteVideoEventsAfter()
  const deleteSegmentsAfter = useDeleteCarrierSegmentsAfter()
```

### 3. Add handler function (around line 512, after handleConfirmFinishTracking)
```typescript
  const handleUndoToPoint = useCallback(async (timestampMs: number) => {
    if (!sessionId || !matchData) return

    try {
      // Delete events and segments after the selected point
      await Promise.all([
        deleteEventsAfter.mutateAsync({ sessionId, timestampMs }),
        deleteSegmentsAfter.mutateAsync({ matchId: matchData.id, timestampMs }),
      ])

      // Reset high-water mark to allow re-recording from this point
      setHighWaterMarkMs(timestampMs)
      highWaterMarkRef.current = timestampMs

      // Seek video to this point
      playerRef.current?.seekTo(timestampMs)

      // Refresh events data
      refetchEvents()

      toast.success('Successfully undone to selected point')
    } catch (error) {
      console.error('Failed to undo to point:', error)
      toast.error('Failed to undo - please try again')
    }
  }, [sessionId, matchData, deleteEventsAfter, deleteSegmentsAfter, refetchEvents])
```

### 4. Add "Undo to Point" button in actionButtons function (around line 1881, after "End Tracking" button)
```typescript
          <button
            onClick={handleRequestEndTracking}
            className={`${compact ? 'px-2 py-1.5 text-[10px]' : 'px-3 py-2 text-xs'} rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 hover:text-red-200 font-medium transition-colors whitespace-nowrap`}
          >
            End Tracking
          </button>
          {/* Add Undo button here */}
          {(videoEvents && videoEvents.length > 0) && (
            <button
              onClick={() => setShowUndoModal(true)}
              className={`${compact ? 'px-2 py-1.5 text-[10px]' : 'px-3 py-2 text-xs'} rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 font-medium transition-colors whitespace-nowrap flex items-center gap-1.5`}
            >
              <Undo2 size={compact ? 12 : 14} />
              Undo to Point
            </button>
          )}
```

### 5. Add modal render (at the end of the component, around line 2750, before the final closing tag)
```typescript
      {/* Undo to Point Modal */}
      {showUndoModal && (
        <UndoToPointModal
          isOpen={showUndoModal}
          onClose={() => setShowUndoModal(false)}
          onConfirm={handleUndoToPoint}
          currentTimeMs={highWaterMarkMs}
          videoDurationMs={videoDurationMs}
          events={videoEvents || []}
          segments={ballCarrierSegments || []}
          minUndoTimeMs={session?.first_half_start_ms ?? 0}
        />
      )}
```

### 6. Add ballCarrierSegments data fetch
You need to fetch the ball carrier segments for the current match. Check if there's already a query for this, or add:
```typescript
// Around line 101, with other queries
const { data: ballCarrierSegments } = useQuery({
  queryKey: ['ballCarrierSegments', matchData?.id],
  queryFn: () => matchData ? api.playerMovement.listCarrierSegments(matchData.id) : null,
  enabled: !!matchData?.id && mode === 'tracking',
})
```

## 🚀 DEPLOYMENT

After integration:
1. `cd backend && flyctl deploy --remote-only`
2. `cd frontend && npm run build && npx vercel --prod --yes --scope owenodgitpulls-projects`
3. Test the feature in both tracking modes (live + video)

## 📝 NOTES

**Time Recommendation**: Allow scrubbing back to ANY point since tracking started (not just 1 minute). The modal shows exactly what will be deleted, preventing accidents.

**UX Flow**:
1. User clicks "Undo to Point" (only visible when in tracking mode with data)
2. Modal opens with timeline scrubber
3. User drags to pick rollback point
4. Modal shows: "Will delete: 3 events (2 scores, 1 turnover), ball carrying from 12:30 onwards"
5. Confirm → deletes everything after that point → seeks video there → tracking resumes

**Safety**: The high-water mark prevents backwards scrubbing during normal tracking, so undo is the ONLY way to go back.
