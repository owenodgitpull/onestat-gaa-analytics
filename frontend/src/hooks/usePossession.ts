import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'

interface RecordPossessionParams {
  match_id: number
  x_coord: number
  y_coord: number
  team: 'home' | 'away'
  timestamp: Date
}

export function useRecordPossession() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: RecordPossessionParams) => {
      return api.possession.record({
        match_id: data.match_id,
        x_coord: data.x_coord,
        y_coord: data.y_coord,
        team: data.team,
        timestamp: data.timestamp.toISOString(),
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

