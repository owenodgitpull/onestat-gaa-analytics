import { CloudOff } from 'lucide-react'
import { usePendingVideoWrites } from '../../hooks/useVideoEvents'

/** Small unobtrusive pill shown only while tagged events are saved locally and still waiting for the server. */
export default function PendingWritesPill({ sessionId }: { sessionId: string | null }) {
  const n = usePendingVideoWrites(sessionId)
  if (n === 0) return null
  return (
    <div
      className="fixed bottom-3 left-3 z-[60] flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-amber-200 pointer-events-none"
      style={{ background: 'rgba(120,53,15,0.85)', border: '1px solid rgba(251,191,36,0.4)', backdropFilter: 'blur(8px)' }}
      role="status"
    >
      <CloudOff size={13} />
      {n} event{n === 1 ? '' : 's'} waiting to save — retrying
    </div>
  )
}
