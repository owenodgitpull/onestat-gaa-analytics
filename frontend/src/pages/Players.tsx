/**
 * Players List Page
 * Shows all players with search, filter, and quick stats
 */

import { useState, useMemo, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Users,
  Search,
  ChevronRight,
  Trophy,
  Target,
  Filter,
  Link2,
  Copy,
  Check,
  RefreshCw,
  GitCompareArrows,
  X,
  Pencil,
  Trash2,
  MoreVertical,
  Calendar,
  UserPlus
} from 'lucide-react'
import { api, TopScorer, fetchAPI } from '@/services/api'
import { usePlayers } from '@/hooks/usePlayers'
import { useAuth } from '@/contexts/AuthContext'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import AddPlayerModal from '@/components/AddPlayerModal'

const POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const

// Position categories for filtering
const positionCategories = [
  { id: 'all', label: 'All Positions' },
  { id: 'goalkeeper', label: 'Goalkeepers' },
  { id: 'defender', label: 'Defenders' },
  { id: 'midfielder', label: 'Midfielders' },
  { id: 'forward', label: 'Forwards' }
]

const positionMapping: Record<string, string> = {
  goalkeeper: 'goalkeeper',
  defender: 'defender',
  midfielder: 'midfielder',
  forward: 'forward',
}

export default function Players() {
  const navigate = useNavigate()
  const { canEdit } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [positionFilter, setPositionFilter] = useState('all')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [generatingCode, setGeneratingCode] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([])
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null)
  const [editingDobId, setEditingDobId] = useState<string | null>(null)
  const [editingGpsAliasId, setEditingGpsAliasId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)

  const queryClient = useQueryClient()
  const { data: players, isLoading } = usePlayers()

  const { data: topScorers } = useQuery({
    queryKey: ['top-scorers'],
    queryFn: () => api.analytics.getTopScorers(50)
  })

  // Create a map of player scores for quick lookup
  const playerScores = useMemo(() => {
    const map = new Map<string, TopScorer>()
    topScorers?.forEach(scorer => {
      map.set(scorer.player_id, scorer)
    })
    return map
  }, [topScorers])

  // Filter players
  const filteredPlayers = useMemo(() => {
    if (!players) return []

    return players.filter(player => {
      // Search filter
      const matchesSearch = player.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (player.jersey_number?.toString() || '').includes(searchQuery)

      // Position filter
      const playerCategory = positionMapping[player.position] || 'other'
      const matchesPosition = positionFilter === 'all' || playerCategory === positionFilter

      return matchesSearch && matchesPosition
    })
  }, [players, searchQuery, positionFilter])

  // Sort by total score descending
  const sortedPlayers = useMemo(() => {
    return [...filteredPlayers].sort((a, b) => {
      const scoreA = playerScores.get(a.id)?.total_score || 0
      const scoreB = playerScores.get(b.id)?.total_score || 0
      return scoreB - scoreA
    })
  }, [filteredPlayers, playerScores])

  // Player name lookup for floating bar
  const playerNameMap = useMemo(() => {
    const map = new Map<string, string>()
    players?.forEach(p => map.set(p.id, p.name))
    return map
  }, [players])

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpenId) return
    const handler = () => setMenuOpenId(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [menuOpenId])

  const inviteLink = inviteCode ? `${window.location.origin}/join/${inviteCode}` : null

  // Fetch existing invite code on mount
  useEffect(() => {
    fetchAPI<{ invite_code: string }>('/auth/invite-code')
      .then(data => { if (data.invite_code) setInviteCode(data.invite_code) })
      .catch(() => {})
  }, [])

  const generateInviteCode = async () => {
    setGeneratingCode(true)
    try {
      const data = await fetchAPI<{ invite_code: string }>('/auth/invite-code/generate', { method: 'POST' })
      setInviteCode(data.invite_code)
      setCopied(false)
    } catch {
      // silently fail
    } finally {
      setGeneratingCode(false)
    }
  }

  const copyLink = async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  const toggleCompareMode = () => {
    if (compareMode) {
      setSelectedForCompare([])
    }
    setCompareMode(!compareMode)
  }

  const togglePlayerSelection = (playerId: string) => {
    setSelectedForCompare(prev => {
      if (prev.includes(playerId)) {
        return prev.filter(id => id !== playerId)
      }
      if (prev.length >= 2) return prev
      return [...prev, playerId]
    })
  }

  const handlePositionChange = async (playerId: string, position: string) => {
    try {
      await api.players.update(playerId, { position } as Partial<import('@/types').Player>)
      queryClient.invalidateQueries({ queryKey: ['players'] })
    } catch {
      // silently fail
    }
    setEditingPositionId(null)
    setMenuOpenId(null)
  }

  const handleDobSave = async (playerId: string) => {
    const input = document.getElementById(`dob-input-${playerId}`) as HTMLInputElement | null
    if (!input?.value) { setEditingDobId(null); return }
    try {
      await api.players.update(playerId, { date_of_birth: input.value } as Partial<import('@/types').Player>)
      await queryClient.invalidateQueries({ queryKey: ['players'] })
    } catch {
      // silently fail
    }
    setEditingDobId(null)
  }

  const handleGpsAliasSave = async (playerId: string) => {
    const input = document.getElementById(`gps-alias-input-${playerId}`) as HTMLInputElement | null
    try {
      await api.players.update(playerId, { gps_alias: input?.value ?? '' } as Partial<import('@/types').Player>)
      await queryClient.invalidateQueries({ queryKey: ['players'] })
    } catch {
      // silently fail
    }
    setEditingGpsAliasId(null)
  }

  const getAge = (dob: string | null): number | null => {
    if (!dob) return null
    const birth = new Date(dob)
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    const m = today.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
    return age
  }

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirm) return
    setDeleting(deleteConfirm.id)
    try {
      await api.players.delete(deleteConfirm.id, true)
      await queryClient.invalidateQueries({ queryKey: ['players'] })
    } catch {
      // silently fail
    }
    setDeleting(null)
    setDeleteConfirm(null)
    setMenuOpenId(null)
  }

  if (isLoading) {
    return <LoadingSkeleton variant="list" />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
            <Users size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Players</h1>
            <p className="text-white/60 text-sm">
              {players?.length || 0} player{players?.length !== 1 ? 's' : ''} in squad
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-md text-sm font-semibold transition-all"
              style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}
            >
              <UserPlus size={16} />
              <span className="hidden sm:inline">Player</span>
            </button>
          )}
          <button
            onClick={toggleCompareMode}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              compareMode
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'bg-white/10 text-white hover:bg-white/20 border border-white/20'
            }`}
          >
            {compareMode ? <X size={16} /> : <GitCompareArrows size={16} />}
            {compareMode ? 'Cancel' : 'Compare'}
          </button>
        </div>
      </div>

      {compareMode && (
        <div className="glass-card p-3 border border-amber-500/30">
          <p className="text-sm text-amber-300">
            Select 2 players to compare side-by-side. Tap a player card to select.
          </p>
        </div>
      )}

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={20} />
          <input
            type="text"
            placeholder="Search by name or number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-10 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Filter size={20} className="text-white/40" />
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {positionCategories.map(cat => (
              <option key={cat.id} value={cat.id} className="bg-slate-800 text-white">{cat.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Player Invite Link */}
      {!compareMode && (
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Link2 size={18} className="text-emerald-400" />
            <span className="text-sm font-semibold text-white">Player Invite Link</span>
            <span className="text-[11px] text-white/40 ml-1">Share with team players to self-register</span>
          </div>
          {inviteLink ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white/70 truncate font-mono">
                {inviteLink}
              </div>
              <button
                onClick={copyLink}
                className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${
                  copied
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={generateInviteCode}
                disabled={generatingCode}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-white/10 text-white hover:bg-white/20 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title="Generate new link (invalidates old one)"
              >
                <RefreshCw size={14} className={generatingCode ? 'animate-spin' : ''} />
              </button>
            </div>
          ) : (
            <button
              onClick={generateInviteCode}
              disabled={generatingCode}
              className="relative px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] backdrop-blur-md overflow-hidden flex items-center gap-2 disabled:opacity-50"
              style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}
            >
              {generatingCode ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Link2 size={14} />
              )}
              Generate Invite Link
            </button>
          )}
        </div>
      )}

      {/* Top Scorers Banner */}
      {!compareMode && topScorers && topScorers.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={18} className="text-amber-400" />
            <span className="text-sm font-semibold text-white">Top Scorers</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {topScorers.slice(0, 5).map((scorer, i) => (
              <Link
                key={scorer.player_id}
                to={`/players/${scorer.player_id}`}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors min-w-[180px]"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                  i === 0 ? 'bg-gradient-to-br from-yellow-500 to-amber-600' :
                  i === 1 ? 'bg-gradient-to-br from-slate-400 to-slate-500' :
                  i === 2 ? 'bg-gradient-to-br from-orange-600 to-orange-700' :
                  'bg-slate-600'
                }`}>
                  {i + 1}
                </div>
                <div>
                  <div className="font-medium text-white text-sm">{scorer.player_name}</div>
                  <div className="text-xs text-white/60">
                    {[scorer.goals > 0 && `${scorer.goals}G`, scorer.points > 0 && `${scorer.points}P`, scorer.two_pointers > 0 && `${scorer.two_pointers}×2pt`].filter(Boolean).join(' · ')} <span className="text-white/80 font-semibold">({scorer.total_score})</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Players List */}
      <div className="space-y-3">
        {sortedPlayers.map(player => {
          const stats = playerScores.get(player.id)
          const isSelected = selectedForCompare.includes(player.id)

          const cardContent = (
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                {compareMode && (
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected
                      ? 'border-amber-400 bg-amber-400'
                      : 'border-white/30'
                  }`}>
                    {isSelected && <Check size={14} className="text-slate-900" />}
                  </div>
                )}
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center text-lg font-bold text-white">
                  {player.jersey_number || player.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-semibold text-white">{player.name}</h3>
                  <div className="flex items-center gap-2">
                    {editingPositionId === player.id ? (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => e.stopPropagation()}
                      >
                        <select
                          id={`pos-select-${player.id}`}
                          className="mt-0.5 px-2 py-1 rounded bg-white/10 border border-white/20 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          defaultValue={player.position || ''}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => e.stopPropagation()}
                        >
                          <option value="" className="bg-slate-800">Select position</option>
                          {POSITIONS.map(pos => (
                            <option key={pos} value={pos} className="bg-slate-800 capitalize">{pos.charAt(0).toUpperCase() + pos.slice(1)}</option>
                          ))}
                        </select>
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            const sel = document.getElementById(`pos-select-${player.id}`) as HTMLSelectElement | null
                            if (sel?.value) handlePositionChange(player.id, sel.value)
                            else setEditingPositionId(null)
                          }}
                          className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30"
                        >
                          Save
                        </button>
                        <button
                          onClick={(e) => { e.preventDefault(); setEditingPositionId(null) }}
                          className="px-2 py-1 rounded bg-white/10 text-white/60 text-xs hover:bg-white/20"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-white/60 capitalize">
                        {(player.position || 'unknown').replace(/_/g, ' ')}
                      </p>
                    )}
                    {editingDobId === player.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
                        <input
                          id={`dob-input-${player.id}`}
                          type="date"
                          className="px-2 py-1 rounded bg-white/10 border border-white/20 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 [color-scheme:dark]"
                          defaultValue={player.date_of_birth || ''}
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') handleDobSave(player.id) }}
                        />
                        <button
                          onClick={(e) => { e.preventDefault(); handleDobSave(player.id) }}
                          className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30"
                        >
                          Save
                        </button>
                        <button
                          onClick={(e) => { e.preventDefault(); setEditingDobId(null) }}
                          className="px-2 py-1 rounded bg-white/10 text-white/60 text-xs hover:bg-white/20"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-white/40">
                        {getAge(player.date_of_birth) !== null
                          ? `Age ${getAge(player.date_of_birth)}`
                          : ''}
                      </span>
                    )}

                  </div>

                  {/* GPS alias — its own row below position/age */}
                  {editingGpsAliasId === player.id ? (
                    <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        id={`gps-alias-input-${player.id}`}
                        type="text"
                        placeholder="GPS device name, e.g. Damo McG"
                        className="px-2 py-1 rounded bg-white/10 border border-white/20 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 w-48"
                        defaultValue={player.gps_alias || ''}
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') handleGpsAliasSave(player.id) }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleGpsAliasSave(player.id) }}
                        className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30"
                      >
                        Save
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingGpsAliasId(null) }}
                        className="px-2 py-1 rounded bg-white/10 text-white/60 text-xs hover:bg-white/20"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingGpsAliasId(player.id) }}
                      className="mt-1 text-xs text-white/40 hover:text-cyan-400 transition-colors"
                    >
                      {player.gps_alias ? `GPS: ${player.gps_alias}` : '+ GPS alias'}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-6">
                {stats && (
                  <div className="hidden sm:flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <Target size={14} className="text-emerald-400" />
                      <span className="text-white">{stats.goals}G</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Target size={14} className="text-emerald-400" />
                      <span className="text-white">{stats.points}P</span>
                    </div>
                    {stats.two_pointers > 0 && (
                      <div className="flex items-center gap-1">
                        <Target size={14} className="text-amber-400" />
                        <span className="text-white">{stats.two_pointers}×2pt</span>
                      </div>
                    )}
                    <div className="text-lg font-bold text-white">
                      {stats.total_score}
                    </div>
                  </div>
                )}
                <div className={`px-2 py-1 rounded text-xs font-medium ${
                  player.active
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  {player.active ? 'Active' : 'Inactive'}
                </div>
                {!compareMode && canEdit && (
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setMenuOpenId(menuOpenId === player.id ? null : player.id)
                      }}
                      className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/40 hover:text-white"
                    >
                      <MoreVertical size={18} />
                    </button>
                    {menuOpenId === player.id && (
                      <div
                        className="absolute right-0 top-full mt-1 z-[100] w-44 rounded-xl bg-slate-800 border border-white/20 shadow-xl overflow-hidden"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                      >
                        <button
                          onClick={() => {
                            setEditingPositionId(player.id)
                            setMenuOpenId(null)
                          }}
                          className="w-full px-4 py-2.5 text-sm text-left text-white hover:bg-white/10 flex items-center gap-2"
                        >
                          <Pencil size={14} />
                          Edit Position
                        </button>
                        <button
                          onClick={() => {
                            setEditingDobId(player.id)
                            setMenuOpenId(null)
                          }}
                          className="w-full px-4 py-2.5 text-sm text-left text-white hover:bg-white/10 flex items-center gap-2"
                        >
                          <Calendar size={14} />
                          Edit DOB
                        </button>
                        <button
                          onClick={() => {
                            setDeleteConfirm({ id: player.id, name: player.name })
                            setMenuOpenId(null)
                          }}
                          className="w-full px-4 py-2.5 text-sm text-left text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                        >
                          <Trash2 size={14} />
                          Delete Player
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {!compareMode && (
                  <ChevronRight size={20} className="text-white/40 group-hover:text-white transition-colors" />
                )}
              </div>
            </div>
          )

          if (compareMode) {
            return (
              <button
                key={player.id}
                onClick={() => togglePlayerSelection(player.id)}
                className={`glass-card p-4 hover:bg-white/10 transition-all cursor-pointer group block w-full text-left ${
                  isSelected ? 'ring-2 ring-amber-400/60' : ''
                }`}
              >
                {cardContent}
              </button>
            )
          }

          return (
            <Link
              key={player.id}
              to={`/players/${player.id}`}
              className={`glass-card p-4 hover:bg-white/10 transition-all cursor-pointer group block ${menuOpenId === player.id ? 'relative z-[90]' : 'relative'}`}
            >
              {cardContent}
            </Link>
          )
        })}

        {sortedPlayers.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Users size={48} className="mx-auto text-white/20 mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Players Found</h3>
            <p className="text-white/60">
              {searchQuery || positionFilter !== 'all'
                ? 'Try adjusting your search or filters'
                : 'No players in the squad yet'}
            </p>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative glass-card p-6 max-w-sm w-full border border-white/20 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                <Trash2 size={20} className="text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Delete Player</h3>
            </div>
            <p className="text-white/70 text-sm mb-6">
              Are you sure you want to permanently delete <span className="text-white font-medium">{deleteConfirm.name}</span> from the squad? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white/10 text-white hover:bg-white/20 transition-colors border border-white/20"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirmed}
                disabled={deleting === deleteConfirm.id}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors border border-red-500/30 disabled:opacity-50"
              >
                {deleting === deleteConfirm.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Compare Bar */}
      {compareMode && selectedForCompare.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass-card px-6 py-4 border border-amber-500/40 shadow-2xl flex items-center gap-4 max-w-lg w-[calc(100%-2rem)]">
          <div className="flex-1 flex items-center gap-3 min-w-0">
            {selectedForCompare.map((id, i) => (
              <span key={id} className="text-sm font-medium text-white truncate">
                {i > 0 && <span className="text-white/40 mx-1">vs</span>}
                {playerNameMap.get(id) || 'Player'}
              </span>
            ))}
            {selectedForCompare.length === 1 && (
              <span className="text-sm text-white/40">Select 1 more...</span>
            )}
          </div>
          <button
            disabled={selectedForCompare.length !== 2}
            onClick={() => navigate(`/players/compare?a=${selectedForCompare[0]}&b=${selectedForCompare[1]}`)}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all hover:scale-[1.02] active:scale-[0.98] flex-shrink-0"
            style={{
              background: selectedForCompare.length === 2
                ? 'linear-gradient(135deg, rgba(251,191,36,0.4), rgba(245,158,11,0.3))'
                : 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(251,191,36,0.5)',
            }}
          >
            <GitCompareArrows size={16} className="inline mr-1.5" />
            Compare
          </button>
        </div>
      )}

      <AddPlayerModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={async (data) => {
          await api.players.create({
            name: data.name,
            position: data.position,
            jersey_number: null,
            date_of_birth: data.date_of_birth,
            status: 'active',
            active: true,
          })
          queryClient.invalidateQueries({ queryKey: ['players'] })
        }}
      />
    </div>
  )
}
