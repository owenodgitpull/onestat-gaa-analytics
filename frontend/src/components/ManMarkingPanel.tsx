/**
 * ManMarkingPanel — record man marking assignments for a match.
 *
 * Allows assigning our player to mark an opposition player (free text name).
 * Shows current assignments with delete option.
 */

import { useState } from 'react'
import { Shield, Plus, Trash2 } from 'lucide-react'
import type { ManMarkingAssignment } from '../services/api'
import type { Player } from '../types'

interface ManMarkingPanelProps {
  matchId: string
  assignments: ManMarkingAssignment[]
  players: Player[]
  onAdd: (playerId: string, opponentName: string, notes?: string) => void
  onDelete: (assignmentId: string) => void
}

export default function ManMarkingPanel({
  assignments,
  players,
  onAdd,
  onDelete,
}: ManMarkingPanelProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [opponentName, setOpponentName] = useState('')
  const [notes, setNotes] = useState('')

  const activePlayers = players.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name))

  const handleSubmit = () => {
    if (!selectedPlayerId || !opponentName.trim()) return
    onAdd(selectedPlayerId, opponentName.trim(), notes.trim() || undefined)
    setSelectedPlayerId('')
    setOpponentName('')
    setNotes('')
    setIsAdding(false)
  }

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Shield size={16} className="text-orange-400" />
          Man Marking Assignments
        </h3>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 text-white/60 hover:text-white text-xs font-medium"
          >
            <Plus size={12} /> Add
          </button>
        )}
      </div>

      {/* Assignment form */}
      {isAdding && (
        <div className="mb-3 p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
          <select
            value={selectedPlayerId}
            onChange={e => setSelectedPlayerId(e.target.value)}
            className="w-full bg-white/10 border border-white/15 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
          >
            <option value="">Select our player...</option>
            {/* No jersey number here — GAA has no fixed squad numbers, only
                per-match lineup numbers (handled separately in Select
                Lineup), so a static Player.jersey_number would be
                misleading rather than useful. */}
            {activePlayers.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            type="text"
            value={opponentName}
            onChange={e => setOpponentName(e.target.value)}
            placeholder="Opposition player name..."
            className="w-full bg-white/10 border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30"
            maxLength={200}
          />
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)..."
            className="w-full bg-white/10 border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30"
            maxLength={500}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={!selectedPlayerId || !opponentName.trim()}
              className="flex-1 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold disabled:opacity-40"
            >
              Assign
            </button>
            <button
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 rounded-lg bg-white/5 text-white/50 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Assignment list */}
      {assignments.length === 0 && !isAdding ? (
        <p className="text-white/30 text-xs py-2">No marking assignments yet. Add one to track who marks who.</p>
      ) : (
        <div className="space-y-1.5">
          {assignments.map(a => (
            <div key={a.id} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-white text-sm font-semibold truncate">{a.player_name || 'Unknown'}</span>
                  <span className="text-white/30 text-xs">marks</span>
                  <span className="text-orange-300 text-sm font-semibold truncate">{a.opponent_player_name}</span>
                </div>
                {a.notes && <p className="text-white/30 text-[10px] mt-0.5 truncate">{a.notes}</p>}
              </div>
              <button
                onClick={() => onDelete(a.id)}
                className="ml-2 text-white/20 hover:text-red-400 transition-colors flex-shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
