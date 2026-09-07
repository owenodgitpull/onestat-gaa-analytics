import { useMutation, useQueryClient } from '@tanstack/react-query'
import { offlinePossession } from '@/services/offline'

interface RecordPossessionParams {
  match_id: string
  // Optional: Simple Scoring's "Possession Changed" button records a
  // possession change with no location step at all — pass null/omit.
  x_coord?: number | null
  y_coord?: number | null
  team: 'home' | 'away'
  timestamp: Date
  minute: number
  half: number
}

export function useRecordPossession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: RecordPossessionParams) => {
      return offlinePossession.create({
        match_id: data.match_id,
        x_coord: data.x_coord ?? null,
        y_coord: data.y_coord ?? null,
        is_home_team: data.team === 'home',
        minute: data.minute,
        half: data.half,
      })
    },
    onSuccess: (_, variables) => {
      // Invalidate match stats to refresh possession percentages
      queryClient.invalidateQueries({
        queryKey: ['matches', variables.match_id, 'stats']
      })
    },
  })
}
