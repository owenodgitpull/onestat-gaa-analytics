import { useState, useMemo } from 'react'
import { X, CheckCircle, AlertTriangle, Info, ChevronDown, ChevronUp, Users } from 'lucide-react'
import type { GPSPreviewData } from '../services/api'

interface GPSConfirmModalProps {
  matchId: string
  previewData: GPSPreviewData
  onConfirm: (entries: { player_id: string; gps_data: Record<string, unknown> }[]) => void
  onCancel: () => void
  isConfirming: boolean
}

export default function GPSConfirmModal({ previewData, onConfirm, onCancel, isConfirming }: GPSConfirmModalProps) {
  const [matchedExpanded, setMatchedExpanded] = useState(false)
  // assignments: csv_name → player_id | '' (empty = skip)
  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const m of previewData.unmatched) {
      init[m.csv_name] = ''
    }
    return init
  })

  // Players already used (matched auto + manually assigned) — prevent double-assignment
  const usedPlayerIds = useMemo(() => {
    const ids = new Set(previewData.matched.map(m => m.player_id).filter(Boolean) as string[])
    for (const v of Object.values(assignments)) {
      if (v) ids.add(v)
    }
    return ids
  }, [previewData.matched, assignments])

  // Lineup players who have no GPS coverage (auto-matched or manually assigned)
  const coveredPlayerIds = useMemo(() => {
    const ids = new Set(previewData.matched.map(m => m.player_id).filter(Boolean) as string[])
    for (const v of Object.values(assignments)) {
      if (v) ids.add(v)
    }
    return ids
  }, [previewData.matched, assignments])

  const missingLineupPlayers = previewData.lineup_players.filter(p => !coveredPlayerIds.has(p.id))

  const handleConfirm = () => {
    const entries: { player_id: string; gps_data: Record<string, unknown> }[] = []

    // All auto-matched
    for (const m of previewData.matched) {
      if (m.player_id) {
        entries.push({ player_id: m.player_id, gps_data: m.gps_data })
      }
    }

    // Manually assigned unmatched
    for (const u of previewData.unmatched) {
      const playerId = assignments[u.csv_name]
      if (playerId) {
        entries.push({ player_id: playerId, gps_data: u.gps_data })
      }
    }

    onConfirm(entries)
  }

  const matchTypeLabel: Record<string, string> = {
    exact: 'Exact',
    alias: 'Alias',
    first_name: 'First name',
    initial_surname: 'Initial',
    initial_surname2: 'Initial',
    abbrev: 'Abbrev',
    substring: 'Partial',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-6">
      <div className="glass-card w-full max-w-xl mx-4 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h3 className="text-lg font-bold text-white">Confirm GPS Player Assignments</h3>
            <p className="text-xs text-white/50 mt-0.5">
              Review the auto-matched players and assign any that weren't recognised
            </p>
          </div>
          <button onClick={onCancel} className="text-white/50 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* ─── Confirmed matches (collapsible) ─────────────────────── */}
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <button
              onClick={() => setMatchedExpanded(x => !x)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className="text-emerald-400" />
                <span className="text-sm font-semibold text-white">
                  Auto-matched ({previewData.matched.length})
                </span>
              </div>
              {matchedExpanded ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
            </button>
            {matchedExpanded && (
              <div className="border-t border-white/10 divide-y divide-white/5">
                {previewData.matched.map(m => (
                  <div key={m.csv_name} className="flex items-center justify-between px-4 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-white/40 font-mono truncate max-w-[120px]">{m.csv_name}</span>
                      <span className="text-white/20 text-xs">→</span>
                      <span className="text-sm text-white/80 truncate">{m.player_name}</span>
                    </div>
                    <span className="text-[10px] text-white/30 ml-2 flex-shrink-0">{matchTypeLabel[m.match_type] ?? m.match_type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ─── Unmatched GPS entries ─────────────────────────────────── */}
          {previewData.unmatched.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-500/10">
                <AlertTriangle size={16} className="text-amber-400" />
                <span className="text-sm font-semibold text-amber-300">
                  Needs assignment ({previewData.unmatched.length})
                </span>
              </div>
              <div className="divide-y divide-white/5">
                {previewData.unmatched.map(u => (
                  <div key={u.csv_name} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-sm font-mono text-white/60 w-28 flex-shrink-0 truncate">"{u.csv_name}"</span>
                    <select
                      value={assignments[u.csv_name] || ''}
                      onChange={e => setAssignments(prev => ({ ...prev, [u.csv_name]: e.target.value }))}
                      className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white min-w-0"
                    >
                      <option value="">— Skip —</option>
                      {previewData.all_players
                        .filter(p => !usedPlayerIds.has(p.id) || assignments[u.csv_name] === p.id)
                        .map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── Lineup players with no GPS ───────────────────────────── */}
          {missingLineupPlayers.length > 0 && (
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-white/5">
                <Info size={16} className="text-white/40" />
                <span className="text-sm font-medium text-white/50">
                  No GPS data ({missingLineupPlayers.length} lineup players)
                </span>
              </div>
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {missingLineupPlayers.map(p => (
                  <span key={p.id} className="text-xs bg-white/5 text-white/40 px-2 py-1 rounded-md">
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/10">
          <div className="text-xs text-white/40 flex items-center gap-1">
            <Users size={12} />
            {previewData.matched.length + Object.values(assignments).filter(Boolean).length} players will be saved
          </div>
          <div className="flex gap-3">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={isConfirming}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {isConfirming ? 'Saving…' : 'Confirm & Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
