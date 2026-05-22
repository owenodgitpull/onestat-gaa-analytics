import { useState, useMemo } from 'react'
import { X, CheckCircle, AlertTriangle, Info, ChevronDown, ChevronUp, Users, Pencil } from 'lucide-react'
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

  // Override assignments for auto-matched entries (initialized to auto-match value)
  const [matchedOverrides, setMatchedOverrides] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const m of previewData.matched) {
      init[m.csv_name] = m.player_id || ''
    }
    return init
  })

  // Which auto-matched rows are in edit mode
  const [editingMatched, setEditingMatched] = useState<Set<string>>(new Set())

  // Assignments for unmatched GPS entries (empty string = skip)
  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const m of previewData.unmatched) {
      init[m.csv_name] = ''
    }
    return init
  })

  const lineupPlayerIds = useMemo(
    () => new Set(previewData.lineup_players.map(p => p.id)),
    [previewData.lineup_players]
  )

  const allPlayersById = useMemo(
    () => Object.fromEntries(previewData.all_players.map(p => [p.id, p])),
    [previewData.all_players]
  )

  // All player IDs already assigned (prevents double-assignment)
  const usedPlayerIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of previewData.matched) {
      const pid = matchedOverrides[m.csv_name]
      if (pid) ids.add(pid)
    }
    for (const v of Object.values(assignments)) {
      if (v) ids.add(v)
    }
    return ids
  }, [previewData.matched, matchedOverrides, assignments])

  const coveredPlayerIds = usedPlayerIds

  const missingLineupPlayers = previewData.lineup_players.filter(p => !coveredPlayerIds.has(p.id))

  const handleConfirm = () => {
    const entries: { player_id: string; gps_data: Record<string, unknown> }[] = []

    for (const m of previewData.matched) {
      const pid = matchedOverrides[m.csv_name]
      if (pid) entries.push({ player_id: pid, gps_data: m.gps_data })
    }

    for (const u of previewData.unmatched) {
      const pid = assignments[u.csv_name]
      if (pid) entries.push({ player_id: pid, gps_data: u.gps_data })
    }

    onConfirm(entries)
  }

  const toggleEditMatched = (csvName: string) => {
    setEditingMatched(prev => {
      const next = new Set(prev)
      if (next.has(csvName)) next.delete(csvName)
      else next.add(csvName)
      return next
    })
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

  const PlayerSelect = ({
    value,
    onChange,
    excludeIds,
    ownValue,
  }: {
    value: string
    onChange: (v: string) => void
    excludeIds: Set<string>
    ownValue?: string
  }) => {
    const lineupOptions = previewData.all_players.filter(
      p => lineupPlayerIds.has(p.id) && (!excludeIds.has(p.id) || p.id === ownValue)
    )
    const otherOptions = previewData.all_players.filter(
      p => !lineupPlayerIds.has(p.id) && (!excludeIds.has(p.id) || p.id === ownValue)
    )
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white min-w-0"
      >
        <option value="">— Skip —</option>
        {lineupOptions.length > 0 && (
          <optgroup label="In lineup">
            {lineupOptions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
        )}
        {otherOptions.length > 0 && (
          <optgroup label="Other squad players">
            {otherOptions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
        )}
      </select>
    )
  }

  const totalSaving = previewData.matched.filter(m => matchedOverrides[m.csv_name]).length
    + Object.values(assignments).filter(Boolean).length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-6">
      <div className="glass-card w-full max-w-xl mx-4 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h3 className="text-lg font-bold text-white">Confirm GPS Player Assignments</h3>
            <p className="text-xs text-white/50 mt-0.5">
              Review auto-matches and assign any unrecognised names
            </p>
          </div>
          <button onClick={onCancel} className="text-white/50 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* ─── Auto-matched (collapsible, editable) ────────────────── */}
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
                <span className="text-[10px] text-white/30">· click to review or change</span>
              </div>
              {matchedExpanded ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
            </button>

            {matchedExpanded && (
              <div className="border-t border-white/10 divide-y divide-white/5">
                {previewData.matched.map(m => {
                  const isEditing = editingMatched.has(m.csv_name)
                  const currentPid = matchedOverrides[m.csv_name]
                  const currentName = currentPid ? allPlayersById[currentPid]?.name : '— Skipped —'
                  const isSkipped = !currentPid
                  return (
                    <div key={m.csv_name} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-xs text-white/40 font-mono w-24 flex-shrink-0 truncate">{m.csv_name}</span>
                      <span className="text-white/20 text-xs flex-shrink-0">→</span>

                      {isEditing ? (
                        <PlayerSelect
                          value={currentPid}
                          onChange={v => setMatchedOverrides(prev => ({ ...prev, [m.csv_name]: v }))}
                          excludeIds={usedPlayerIds}
                          ownValue={currentPid}
                        />
                      ) : (
                        <span className={`text-sm flex-1 truncate ${isSkipped ? 'text-white/30 italic' : 'text-white/80'}`}>
                          {currentName}
                        </span>
                      )}

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!isEditing && (
                          <span className="text-[10px] text-white/25">{matchTypeLabel[m.match_type] ?? m.match_type}</span>
                        )}
                        <button
                          onClick={() => toggleEditMatched(m.csv_name)}
                          className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/70 transition-colors"
                        >
                          {isEditing ? (
                            <span>Done</span>
                          ) : (
                            <>
                              <Pencil size={10} />
                              <span>Change</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ─── Unmatched GPS entries ────────────────────────────────── */}
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
                    <PlayerSelect
                      value={assignments[u.csv_name] || ''}
                      onChange={v => setAssignments(prev => ({ ...prev, [u.csv_name]: v }))}
                      excludeIds={usedPlayerIds}
                      ownValue={assignments[u.csv_name] || undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── Lineup players with no GPS ──────────────────────────── */}
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
            {totalSaving} players will be saved
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
