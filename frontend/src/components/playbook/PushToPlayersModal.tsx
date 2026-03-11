/**
 * PushToPlayersModal — select players and push a playbook routine to their portal.
 */

import { useState, useMemo } from 'react'
import { X, Send, Users, Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { Player } from '@/types'

interface PushToPlayersModalProps {
  routineId: string
  routineName: string
  players: Player[]
  onPush: (routineId: string, playerIds: string[], message?: string) => Promise<void>
  onClose: () => void
}

const POSITION_GROUPS: Record<string, string[]> = {
  Goalkeepers: ['GK'],
  Defenders: ['FB', 'CB', 'HB', 'RCB', 'LCB', 'RHB', 'LHB', 'RFB', 'LFB', 'SW'],
  Midfielders: ['MF', 'CM', 'LM', 'RM', 'CDM', 'CAM'],
  Forwards: ['HF', 'FF', 'CF', 'RHF', 'LHF', 'RFF', 'LFF', 'IF'],
}

function getPositionGroup(position?: string): string {
  if (!position) return 'Other'
  const upper = position.toUpperCase()
  for (const [group, positions] of Object.entries(POSITION_GROUPS)) {
    if (positions.includes(upper)) return group
  }
  return 'Other'
}

export default function PushToPlayersModal({
  routineId,
  routineName,
  players,
  onPush,
  onClose,
}: PushToPlayersModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [isPushing, setIsPushing] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const activePlayers = useMemo(() => players.filter(p => p.active), [players])

  const grouped = useMemo(() => {
    const groups: Record<string, Player[]> = {}
    for (const p of activePlayers) {
      const group = getPositionGroup(p.position)
      if (!groups[group]) groups[group] = []
      groups[group].push(p)
    }
    // Sort each group by jersey number
    for (const g of Object.values(groups)) {
      g.sort((a, b) => (a.jersey_number ?? 99) - (b.jersey_number ?? 99))
    }
    return groups
  }, [activePlayers])

  const togglePlayer = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selectedIds.size === activePlayers.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(activePlayers.map(p => p.id)))
    }
  }

  const selectGroup = (groupPlayers: Player[]) => {
    const groupIds = groupPlayers.map(p => p.id)
    const allSelected = groupIds.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const id of groupIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const handlePush = async () => {
    if (selectedIds.size === 0) return
    setIsPushing(true)
    try {
      await onPush(routineId, Array.from(selectedIds), message || undefined)
      onClose()
    } catch {
      // Error handled by parent
    } finally {
      setIsPushing(false)
    }
  }

  const groupOrder = ['Goalkeepers', 'Defenders', 'Midfielders', 'Forwards', 'Other']

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl border border-white/10 w-full max-w-md max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <h3 className="text-base font-bold text-white">Push to Players</h3>
            <p className="text-xs text-white/40 mt-0.5">{routineName}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Select All */}
        <div className="px-5 py-2 border-b border-white/5">
          <button
            onClick={selectAll}
            className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-all"
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
              selectedIds.size === activePlayers.length
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : 'border-white/30'
            }`}>
              {selectedIds.size === activePlayers.length && <Check size={10} />}
            </div>
            <Users size={14} />
            Select All ({activePlayers.length} players)
          </button>
        </div>

        {/* Player list grouped by position */}
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {groupOrder.filter(g => grouped[g]?.length).map(group => (
            <div key={group} className="mb-2">
              <button
                onClick={() => toggleGroup(group)}
                className="flex items-center justify-between w-full py-1.5 text-xs font-semibold text-white/40 uppercase tracking-wider"
              >
                <div className="flex items-center gap-2">
                  <span>{group}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); selectGroup(grouped[group]) }}
                    className="text-[10px] font-normal text-cyan-400/60 hover:text-cyan-400 normal-case tracking-normal"
                  >
                    {grouped[group].every(p => selectedIds.has(p.id)) ? 'Deselect' : 'Select'} all
                  </button>
                </div>
                {collapsedGroups.has(group) ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </button>
              {!collapsedGroups.has(group) && (
                <div className="space-y-0.5">
                  {grouped[group].map(player => (
                    <button
                      key={player.id}
                      onClick={() => togglePlayer(player.id)}
                      className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-all text-left ${
                        selectedIds.has(player.id)
                          ? 'bg-emerald-500/10 border border-emerald-500/20'
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                        selectedIds.has(player.id)
                          ? 'bg-emerald-500 border-emerald-500'
                          : 'border-white/30'
                      }`}>
                        {selectedIds.has(player.id) && <Check size={10} className="text-white" />}
                      </div>
                      <span className="text-white/30 text-xs w-6 text-right">
                        {player.jersey_number ?? '-'}
                      </span>
                      <span className="text-white text-sm flex-1">{player.name}</span>
                      <span className="text-white/20 text-xs">{player.position || ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Message + Send */}
        <div className="px-5 py-3 border-t border-white/10 space-y-3">
          <input
            type="text"
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Optional note (e.g. 'Watch before Thursday training')"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30"
            maxLength={200}
          />
          <button
            onClick={handlePush}
            disabled={selectedIds.size === 0 || isPushing}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 transition-all"
          >
            <Send size={16} />
            {isPushing ? 'Sending...' : `Push to ${selectedIds.size} Player${selectedIds.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
