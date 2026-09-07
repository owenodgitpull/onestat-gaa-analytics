import { useParams } from 'react-router-dom'
import { useMatch } from '@/hooks/useMatches'
import MatchRecording from './MatchRecording'
import SimpleMatchRecording from './SimpleMatchRecording'

/**
 * Routes /match/:matchId to the right recording UI based on the match's
 * precise_tracking_enabled flag — the normal drag-tracking MatchRecording
 * page (default, unchanged) or the tap-only SimpleMatchRecording page (Simple
 * Scoring, chosen from the "Recording without a tablet?" link on MatchSetup).
 */
export default function MatchRecordingRouter() {
  const { matchId } = useParams<{ matchId: string }>()
  const { data: match, isLoading } = useMatch(matchId ?? null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (match?.precise_tracking_enabled === false) {
    return <SimpleMatchRecording />
  }

  return <MatchRecording />
}
