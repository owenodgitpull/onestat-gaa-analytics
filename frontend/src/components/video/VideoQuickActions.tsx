/**
 * VideoQuickActions — Sidebar overlay for quick event tagging on video.
 *
 * Semi-transparent sidebar overlaid on right side of video player.
 * Possession-aware: auto-flips on turnovers/scores, disables invalid actions.
 * Tapping an event fires onEventTap to start the three-tap overlay flow.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  Target, ArrowRightLeft, CircleDot,
  AlertTriangle, ChevronLeft, Shield,
} from 'lucide-react'
import type { PitchZone } from './PitchZoneSelector'
import { TWO_POINTER_ZONES } from './PitchZoneSelector'
import type { VideoEventCreateData } from '../../services/videoApi'

export type Category = 'scoring' | 'turnovers' | 'kickouts'

export interface ActionButton {
  id: string
  label: string
  eventType: string
  icon?: string
  disabledWhen?: 'us' | 'them'
  autoFlipTo?: 'us' | 'them'
  autoSwitchTab?: Category
  needsPlayer?: boolean
  needsPitch?: boolean
  playerModalTitle?: string
  playerModalEventType?: string
}

/** Pending event data passed to the overlay flow */
export interface OverlayPendingEvent {
  action: ActionButton
  eventData: VideoEventCreateData
  freeKickContext?: boolean
}

export interface VideoQuickActionsProps {
  possession: 'team_a' | 'team_b'
  onPossessionChange: (team: 'team_a' | 'team_b') => void
  selectedZone: PitchZone | null
  currentTimestampMs: number | null
  half: number
  onEventTap: (pending: OverlayPendingEvent) => void
  onCreateEvent: (data: VideoEventCreateData) => void
  activeTab: Category
  onTabChange: (tab: Category) => void
  disabled?: boolean
  teamName?: string
}

const SCORING_ACTIONS: ActionButton[] = [
  { id: 'goal', label: 'Goal', eventType: 'GOAL_SCORED', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Scored?', playerModalEventType: 'goal', autoFlipTo: 'them', autoSwitchTab: 'kickouts' },
  { id: 'point', label: 'Point', eventType: 'POINT_SCORED', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Scored?', playerModalEventType: 'point', autoFlipTo: 'them', autoSwitchTab: 'kickouts' },
  { id: 'wide', label: 'Wide', eventType: 'WIDE', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Took?', playerModalEventType: 'wide', autoFlipTo: 'them', autoSwitchTab: 'kickouts' },
  { id: 'short', label: 'Short/Saved', eventType: 'SHORT', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Shot?', playerModalEventType: 'saved', autoFlipTo: 'them', autoSwitchTab: 'kickouts' },
  { id: 'free_won', label: 'Free Won', eventType: 'FREE_WON_MARKER', needsPlayer: false, needsPitch: true },
]

const TURNOVER_ACTIONS: ActionButton[] = [
  { id: 'to_won', label: 'T/O Won', eventType: 'TURNOVER_WON', disabledWhen: 'us', autoFlipTo: 'us', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Won Turnover?', playerModalEventType: 'turnover_won' },
  { id: 'to_lost', label: 'T/O Lost', eventType: 'TURNOVER_LOST', disabledWhen: 'them', autoFlipTo: 'them', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Lost Possession?', playerModalEventType: 'turnover_lost' },
]

const KICKOUT_ACTIONS: ActionButton[] = [
  { id: 'ko_won', label: 'KO Won', eventType: 'KICKOUT_WON_MARKER', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  { id: 'ko_lost', label: 'KO Lost', eventType: 'KICKOUT_LOST_MARKER', needsPlayer: false, needsPitch: false },
]

const CATEGORY_ACTIONS: Record<Category, ActionButton[]> = {
  scoring: SCORING_ACTIONS,
  turnovers: TURNOVER_ACTIONS,
  kickouts: KICKOUT_ACTIONS,
}

const CATEGORY_TABS: { id: Category; label: string; icon: typeof Target }[] = [
  { id: 'scoring', label: 'Score', icon: Target },
  { id: 'turnovers', label: 'T/O', icon: ArrowRightLeft },
  { id: 'kickouts', label: 'K/O', icon: CircleDot },
]

const FREE_KICK_ACTIONS: ActionButton[] = [
  { id: 'free_point', label: 'Point (Free)', eventType: 'POINT_SCORED', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Scored?', playerModalEventType: 'point', autoFlipTo: 'them', autoSwitchTab: 'kickouts' },
  { id: 'free_wide', label: 'Wide (Free)', eventType: 'WIDE', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'wide', autoFlipTo: 'them', autoSwitchTab: 'kickouts' },
  { id: 'free_short', label: 'Short Free', eventType: 'SHORT', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'saved', autoFlipTo: 'them', autoSwitchTab: 'kickouts' },
]

export default function VideoQuickActions({
  possession,
  onPossessionChange,
  selectedZone,
  currentTimestampMs,
  half,
  onEventTap,
  onCreateEvent,
  activeTab,
  onTabChange,
  disabled = false,
  teamName = 'Team',
}: VideoQuickActionsProps) {
  const [flashButton, setFlashButton] = useState<string | null>(null)
  const [showFreePanel, setShowFreePanel] = useState(false)

  const isUs = possession === 'team_a'

  useEffect(() => {
    if (!flashButton) return
    const timer = setTimeout(() => setFlashButton(null), 200)
    return () => clearTimeout(timer)
  }, [flashButton])

  const buildEventData = useCallback((action: ActionButton, freeKickContext?: boolean): VideoEventCreateData => {
    const totalSec = currentTimestampMs ? Math.floor(currentTimestampMs / 1000) : 0
    const isTwoPointer = selectedZone ? TWO_POINTER_ZONES.includes(selectedZone) : false

    const data: VideoEventCreateData = {
      event_type: action.eventType,
      team: possession,
      half,
      match_minute: Math.floor(totalSec / 60),
      match_second: totalSec % 60,
      video_timestamp_ms: currentTimestampMs ?? undefined,
      pitch_zone: selectedZone ?? undefined,
      source: 'human_tag',
    }

    if (['POINT_SCORED', 'GOAL_SCORED', 'WIDE', 'SHORT'].includes(action.eventType)) {
      data.scoring_context = {
        is_two_pointer: action.eventType === 'POINT_SCORED' ? isTwoPointer : false,
        source: freeKickContext ? 'FROM_FREE' : 'FROM_PLAY',
      }
    }

    return data
  }, [possession, half, currentTimestampMs, selectedZone])

  const handleActionTap = useCallback((action: ActionButton, freeKickContext?: boolean) => {
    if (disabled) return

    // Handle Free Won marker — create FREE_KICK event then show sub-panel
    if (action.eventType === 'FREE_WON_MARKER') {
      const freeData = buildEventData({ ...action, eventType: 'FREE_KICK' })
      // Free won needs pitch location via overlay
      onEventTap({
        action: { ...action, eventType: 'FREE_KICK', needsPlayer: false, needsPitch: true },
        eventData: freeData,
      })
      setFlashButton(action.id)
      // After pitch tap completes, show free kick sub-panel
      setShowFreePanel(true)
      return
    }

    // Handle kickout markers — translate to real event types
    let effectiveAction = action
    if (action.eventType === 'KICKOUT_WON_MARKER') {
      effectiveAction = { ...action, eventType: 'KICKOUT_SHORT' }
    } else if (action.eventType === 'KICKOUT_LOST_MARKER') {
      effectiveAction = { ...action, eventType: 'KICKOUT_LONG' }
    }

    const eventData = buildEventData(effectiveAction, freeKickContext)
    setFlashButton(action.id)

    // If needs pitch or player, start the overlay flow
    if (action.needsPitch || action.needsPlayer) {
      onEventTap({ action: effectiveAction, eventData, freeKickContext })
    } else {
      // Direct creation (e.g. KO Lost)
      onCreateEvent(eventData)
      // Auto-flip possession
      if (action.autoFlipTo) {
        onPossessionChange(action.autoFlipTo === 'us' ? 'team_a' : 'team_b')
      }
      if (action.autoSwitchTab) {
        onTabChange(action.autoSwitchTab)
      }
    }

    if (freeKickContext) setShowFreePanel(false)
  }, [disabled, buildEventData, onEventTap, onCreateEvent, onPossessionChange, onTabChange])

  const isButtonDisabled = (action: ActionButton): boolean => {
    if (disabled) return true
    if (action.disabledWhen === 'us' && isUs) return true
    if (action.disabledWhen === 'them' && !isUs) return true
    return false
  }

  const handleDiscipline = (type: 'YELLOW_CARD' | 'RED_CARD' | 'SUB_ON') => {
    if (disabled) return
    const totalSec = currentTimestampMs ? Math.floor(currentTimestampMs / 1000) : 0
    const data: VideoEventCreateData = {
      event_type: type,
      team: possession,
      half,
      match_minute: Math.floor(totalSec / 60),
      match_second: totalSec % 60,
      video_timestamp_ms: currentTimestampMs ?? undefined,
      source: 'human_tag',
    }
    onCreateEvent(data)
  }

  const actions = CATEGORY_ACTIONS[activeTab]

  return (
    <div className="flex flex-col h-full bg-slate-900/80 backdrop-blur-sm w-[180px] border-l border-white/10">
      {/* Possession indicator */}
      <div className="p-2 border-b border-white/10">
        <button
          onClick={() => onPossessionChange(isUs ? 'team_b' : 'team_a')}
          className={`w-full py-1.5 rounded-full text-xs font-bold transition-all ${
            isUs
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30'
              : 'bg-white/10 text-orange-300 border border-orange-500/30 hover:bg-white/15'
          }`}
        >
          {isUs ? teamName : 'Opposition'}
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex border-b border-white/10">
        {CATEGORY_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { onTabChange(id); setShowFreePanel(false) }}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-all ${
              activeTab === id
                ? 'text-emerald-400 bg-white/5'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {showFreePanel ? (
          <>
            <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1 text-center">
              Free Kick Outcome
            </div>
            {FREE_KICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                onClick={() => handleActionTap(action, true)}
                disabled={disabled}
                className={`w-full py-2.5 px-2 rounded-lg text-xs font-medium transition-all
                  ${flashButton === action.id
                    ? 'bg-emerald-500/60 text-white'
                    : 'bg-white/5 text-white/70 hover:bg-white/10'
                  }
                  disabled:opacity-30 disabled:cursor-not-allowed
                `}
              >
                {action.label}
              </button>
            ))}
            <button
              onClick={() => setShowFreePanel(false)}
              className="w-full py-2 px-2 rounded-lg text-xs text-white/40 hover:text-white/60 bg-white/[0.03] hover:bg-white/5 flex items-center justify-center gap-1"
            >
              <ChevronLeft size={12} />
              Back
            </button>
          </>
        ) : (
          actions.map((action) => {
            const isDisabled = isButtonDisabled(action)
            return (
              <button
                key={action.id}
                onClick={() => handleActionTap(action)}
                disabled={isDisabled}
                className={`w-full py-2.5 px-2 rounded-lg text-xs font-medium transition-all
                  ${flashButton === action.id
                    ? 'bg-emerald-500/60 text-white'
                    : isDisabled
                      ? 'bg-white/[0.02] text-white/20 cursor-not-allowed'
                      : 'bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15'
                  }
                `}
              >
                {action.label}
              </button>
            )
          })
        )}
      </div>

      {/* Discipline row */}
      <div className="flex gap-1 p-2 border-t border-white/10">
        <button
          onClick={() => handleDiscipline('YELLOW_CARD')}
          disabled={disabled}
          className="flex-1 py-1.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 disabled:opacity-30 transition-all"
          title="Yellow Card"
        >
          <AlertTriangle size={12} className="mx-auto" />
        </button>
        <button
          onClick={() => handleDiscipline('RED_CARD')}
          disabled={disabled}
          className="flex-1 py-1.5 rounded text-[10px] font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-30 transition-all"
          title="Red Card"
        >
          <AlertTriangle size={12} className="mx-auto" />
        </button>
        <button
          onClick={() => handleDiscipline('SUB_ON')}
          disabled={disabled}
          className="flex-1 py-1.5 rounded text-[10px] font-medium bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-30 transition-all"
          title="Substitution"
        >
          <Shield size={12} className="mx-auto" />
        </button>
      </div>
    </div>
  )
}
