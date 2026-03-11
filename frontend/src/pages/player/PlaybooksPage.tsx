/**
 * PlaybooksPage — player portal view of pushed tactical plays.
 *
 * Shows plays the manager has shared, with interactive animation playback.
 */

import { useState, useEffect, useCallback } from 'react'
import { Play, Volume2, MessageSquare, Clock } from 'lucide-react'
import PlayerHeader from '../../components/PlayerHeader'
import { api } from '@/services/api'
import { PlaybackEngine } from '@/components/playbook'
import type { Phase } from '@/components/playbook/types'

interface PlaybookItem {
  push_id: string
  routine_id: string
  routine_name: string
  routine_category: string
  elements: Array<Record<string, unknown>>
  animation_settings?: Record<string, number> | null
  has_voiceover: boolean
  voiceover_url?: string | null
  coach_message?: string | null
  pushed_at: string
  viewed_at?: string | null
}

function parsePhases(elements: Array<Record<string, unknown>>): Phase[] {
  const phaseElements = elements.filter(el => el.type === 'phase')
  if (phaseElements.length > 0) {
    return phaseElements.map(ph => {
      const items = (ph.items as Array<Record<string, unknown>>) || []
      return parsePhaseItems(items)
    })
  }
  // Single phase (legacy)
  return [parsePhaseItems(elements)]
}

function parsePhaseItems(items: Array<Record<string, unknown>>): Phase {
  const players = items.filter(el => el.type === 'player').map(el => ({
    id: `p-${el.jerseyNumber}-${el.isOpponent}`,
    x: el.x as number,
    y: el.y as number,
    playerId: el.playerId as string | undefined,
    playerName: (el.playerName as string) || `#${el.jerseyNumber}`,
    jerseyNumber: el.jerseyNumber as number,
    isOpponent: (el.isOpponent as boolean) || false,
  }))
  const arrows = items.filter(el => el.type === 'arrow').map((el, i) => ({
    id: `a-${i}`,
    points: el.points as { x: number; y: number }[],
    color: (el.color as string) || '#FBBF24',
    dashed: el.dashed as boolean | undefined,
    curved: el.curved as boolean | undefined,
  }))
  const labels = items.filter(el => el.type === 'label').map((el, i) => ({
    id: `l-${i}`,
    x: el.x as number,
    y: el.y as number,
    text: el.text as string,
    rotation: el.rotation as number | undefined,
  }))
  return { players, arrows, labels }
}

const CATEGORY_COLORS: Record<string, string> = {
  attacking: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  defensive: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  kickout: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
}

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<PlaybookItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPlay, setSelectedPlay] = useState<PlaybookItem | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.playbook.getMyPlaybooks()
        setPlaybooks(data as PlaybookItem[])
      } catch {
        // Silently fail
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleOpenPlay = useCallback(async (play: PlaybookItem) => {
    setSelectedPlay(play)
    // Mark as viewed
    if (!play.viewed_at) {
      try {
        await api.playbook.markPlaybookViewed(play.push_id)
        setPlaybooks(prev =>
          prev.map(p => p.push_id === play.push_id ? { ...p, viewed_at: new Date().toISOString() } : p)
        )
      } catch {}
    }
  }, [])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-4">
      <PlayerHeader title="Playbooks" />

      {playbooks.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-white/40">No plays shared yet.</p>
          <p className="text-white/25 text-sm mt-1">Your manager will push tactical plays here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {playbooks.map(play => (
            <button
              key={play.push_id}
              onClick={() => handleOpenPlay(play)}
              className="w-full glass-card p-4 text-left hover:bg-white/5 transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {!play.viewed_at && (
                      <span className="w-2 h-2 rounded-full bg-cyan-400 flex-shrink-0" />
                    )}
                    <h3 className="text-sm font-semibold text-white truncate">{play.routine_name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                      CATEGORY_COLORS[play.routine_category] || 'bg-white/10 text-white/50'
                    }`}>
                      {play.routine_category}
                    </span>
                  </div>

                  {play.coach_message && (
                    <div className="flex items-start gap-1.5 mt-1.5">
                      <MessageSquare size={12} className="text-white/30 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-white/50 leading-relaxed">{play.coach_message}</p>
                    </div>
                  )}

                  <div className="flex items-center gap-3 mt-2 text-[11px] text-white/30">
                    <span className="flex items-center gap-1">
                      <Clock size={10} /> {formatDate(play.pushed_at)}
                    </span>
                    {play.has_voiceover && (
                      <span className="flex items-center gap-1 text-emerald-400/60">
                        <Volume2 size={10} /> Voiceover
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0 ml-3 p-2.5 rounded-xl bg-white/5 group-hover:bg-cyan-500/20 transition-all">
                  <Play size={18} className="text-white/40 group-hover:text-cyan-300" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Playback modal */}
      {selectedPlay && (
        <PlaybackEngine
          phases={parsePhases(selectedPlay.elements)}
          routineName={selectedPlay.routine_name}
          voiceoverUrl={selectedPlay.voiceover_url}
          onClose={() => setSelectedPlay(null)}
        />
      )}
    </div>
  )
}
