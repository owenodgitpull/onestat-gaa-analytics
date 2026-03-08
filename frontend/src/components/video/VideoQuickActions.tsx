/**
 * VideoQuickActions — Sidebar overlay for quick event tagging on video.
 *
 * Semi-transparent sidebar overlaid on right side of video player.
 * Possession-aware: auto-flips on turnovers/scores, disables invalid actions.
 * Tapping an event fires onEventTap to start the three-tap overlay flow.
 *
 * 4-tab layout: Score | T/O | Our KO | Opp KO
 */

import { useState, useCallback, useEffect } from 'react'
import {
  Target, ArrowRightLeft, CircleDot, ArrowLeftRight,
  AlertTriangle, ChevronLeft, Shield,
} from 'lucide-react'
import type { PitchZone } from './PitchZoneSelector'
import { TWO_POINTER_ZONES, xyToZone } from './PitchZoneSelector'
import type { VideoEventCreateData } from '../../services/videoApi'

export type Category = 'scoring' | 'turnovers' | 'our_kickouts' | 'opp_kickouts'

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
  ballPitchX?: number
  ballPitchY?: number
  /** Convert video timestamp to match minute/second (accounts for throw-in offset) */
  calcMatchTime?: (videoMs: number) => { minute: number; second: number; half: number }
}

const SCORING_ACTIONS: ActionButton[] = [
  { id: 'goal', label: 'Goal', eventType: 'GOAL_SCORED', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Scored?', playerModalEventType: 'goal', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'point', label: 'Point', eventType: 'POINT_SCORED', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Scored?', playerModalEventType: 'point', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'wide', label: 'Wide', eventType: 'WIDE', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Took?', playerModalEventType: 'wide', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'short', label: 'Short', eventType: 'SHORT', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Shot?', playerModalEventType: 'saved', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'block', label: 'Block', eventType: 'BLOCK_SHOT', needsPlayer: false, needsPitch: false },
  { id: 'free_won', label: 'Free Won', eventType: 'FREE_WON_MARKER', needsPlayer: false, needsPitch: true },
  { id: 'forty_five', label: '45m Free', eventType: 'FORTY_FIVE_MARKER', needsPlayer: false, needsPitch: false },
  { id: 'pen_goal', label: 'Pen Goal', eventType: 'PENALTY_GOAL_MARKER', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'goal', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'pen_miss', label: 'Pen Miss', eventType: 'PENALTY_MISS_MARKER', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'wide', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
]

const TURNOVER_ACTIONS: ActionButton[] = [
  { id: 'to_won', label: 'T/O Won', eventType: 'TURNOVER_WON', disabledWhen: 'us', autoFlipTo: 'us', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Won Turnover?', playerModalEventType: 'turnover_won' },
  { id: 'to_lost', label: 'T/O Lost', eventType: 'TURNOVER_LOST', disabledWhen: 'them', autoFlipTo: 'them', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Lost Possession?', playerModalEventType: 'turnover_lost' },
  { id: 'intercept', label: 'Intercept', eventType: 'INTERCEPTION', autoFlipTo: 'us', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Intercepted?', playerModalEventType: 'turnover_won' },
  { id: 'our_error', label: 'Our Error', eventType: 'OUR_UNFORCED_ERROR', disabledWhen: 'them', autoFlipTo: 'them', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Made the Error?', playerModalEventType: 'turnover_lost' },
  { id: 'opp_error', label: 'Opp Error', eventType: 'OPP_UNFORCED_ERROR', disabledWhen: 'us', autoFlipTo: 'us', needsPlayer: false, needsPitch: false },
]

const OUR_KICKOUT_ACTIONS: ActionButton[] = [
  { id: 'own_ko_won', label: 'We Won', eventType: 'OWN_KICKOUT_WON', needsPlayer: true, needsPitch: false, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  { id: 'own_ko_opp', label: 'Opp Won', eventType: 'OWN_KICKOUT_OPPOSITION_WON', needsPlayer: false, needsPitch: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  { id: 'own_ko_won_brk', label: 'We Won Brk', eventType: 'OWN_KICKOUT_WON_BREAK', needsPlayer: true, needsPitch: false, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  { id: 'own_ko_opp_brk', label: 'Opp Won Brk', eventType: 'OWN_KICKOUT_OPPOSITION_WON_BREAK', needsPlayer: false, needsPitch: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
]

const OPP_KICKOUT_ACTIONS: ActionButton[] = [
  { id: 'opp_ko_won', label: 'We Won', eventType: 'OPP_KICKOUT_WON', needsPlayer: true, needsPitch: false, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  { id: 'opp_ko_opp', label: 'Opp Won', eventType: 'OPP_KICKOUT_OPPOSITION_WON', needsPlayer: false, needsPitch: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  { id: 'opp_ko_won_brk', label: 'We Won Brk', eventType: 'OPP_KICKOUT_WON_BREAK', needsPlayer: true, needsPitch: false, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  { id: 'opp_ko_opp_brk', label: 'Opp Won Brk', eventType: 'OPP_KICKOUT_OPPOSITION_WON_BREAK', needsPlayer: false, needsPitch: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
]

const CATEGORY_ACTIONS: Record<Category, ActionButton[]> = {
  scoring: SCORING_ACTIONS,
  turnovers: TURNOVER_ACTIONS,
  our_kickouts: OUR_KICKOUT_ACTIONS,
  opp_kickouts: OPP_KICKOUT_ACTIONS,
}

const CATEGORY_TABS: { id: Category; label: string; icon: typeof Target }[] = [
  { id: 'scoring', label: 'Score', icon: Target },
  { id: 'turnovers', label: 'T/O', icon: ArrowRightLeft },
  { id: 'our_kickouts', label: 'Our KO', icon: CircleDot },
  { id: 'opp_kickouts', label: 'Opp KO', icon: CircleDot },
]

const FREE_KICK_ACTIONS: ActionButton[] = [
  { id: 'free_point', label: 'Point (Free)', eventType: 'POINT_SCORED', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Scored?', playerModalEventType: 'point', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'free_wide', label: 'Wide (Free)', eventType: 'WIDE', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'wide', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
]

const FORTY_FIVE_ACTIONS: ActionButton[] = [
  { id: '45_scored', label: '45 Scored', eventType: 'FORTY_FIVE', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'point', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: '45_missed', label: '45 Missed', eventType: 'FORTY_FIVE', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'wide', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
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
  ballPitchX,
  ballPitchY,
  calcMatchTime,
}: VideoQuickActionsProps) {
  const [flashButton, setFlashButton] = useState<string | null>(null)
  const [showFreePanel, setShowFreePanel] = useState(false)
  const [showFortyFivePanel, setShowFortyFivePanel] = useState(false)

  const isUs = possession === 'team_a'

  useEffect(() => {
    if (!flashButton) return
    const timer = setTimeout(() => setFlashButton(null), 200)
    return () => clearTimeout(timer)
  }, [flashButton])

  const buildEventData = useCallback((action: ActionButton, freeKickContext?: boolean): VideoEventCreateData => {
    const videoMs = currentTimestampMs ?? 0
    const time = calcMatchTime
      ? calcMatchTime(videoMs)
      : { minute: Math.floor(videoMs / 60000), second: Math.floor((videoMs % 60000) / 1000), half }
    const isTwoPointer = selectedZone ? TWO_POINTER_ZONES.includes(selectedZone) : false

    // Derive zone from minimap ball position when no zone overlay will be shown
    const effectiveZone = selectedZone ?? (
      ballPitchX != null && ballPitchY != null ? xyToZone(ballPitchX, ballPitchY) : undefined
    )

    const data: VideoEventCreateData = {
      event_type: action.eventType,
      team: possession,
      half: time.half,
      match_minute: time.minute,
      match_second: time.second,
      video_timestamp_ms: currentTimestampMs ?? undefined,
      pitch_zone: effectiveZone ?? undefined,
      source: 'human_tag',
    }

    // Populate pitch_x/y from minimap when available
    if (ballPitchX != null && ballPitchY != null) {
      data.pitch_x = ballPitchX
      data.pitch_y = ballPitchY
    }

    if (['POINT_SCORED', 'GOAL_SCORED', 'WIDE', 'SHORT'].includes(action.eventType)) {
      data.scoring_context = {
        is_two_pointer: action.eventType === 'POINT_SCORED' ? isTwoPointer : false,
        source: freeKickContext ? 'FROM_FREE' : 'FROM_PLAY',
      }
    }

    return data
  }, [possession, half, currentTimestampMs, selectedZone, ballPitchX, ballPitchY, calcMatchTime])

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

    // Handle 45m Free marker — show sub-panel
    if (action.eventType === 'FORTY_FIVE_MARKER') {
      setFlashButton(action.id)
      setShowFortyFivePanel(true)
      return
    }

    // Handle Penalty Goal marker → map to PENALTY with scoring_context
    if (action.eventType === 'PENALTY_GOAL_MARKER') {
      const penData = buildEventData({ ...action, eventType: 'PENALTY' })
      penData.scoring_context = { scored: true }
      setFlashButton(action.id)
      if (action.needsPlayer) {
        onEventTap({ action: { ...action, eventType: 'PENALTY' }, eventData: penData })
      } else {
        onCreateEvent(penData)
        if (action.autoFlipTo) onPossessionChange(action.autoFlipTo === 'us' ? 'team_a' : 'team_b')
        if (action.autoSwitchTab) onTabChange(action.autoSwitchTab)
      }
      return
    }

    // Handle Penalty Miss marker → map to PENALTY with scoring_context
    if (action.eventType === 'PENALTY_MISS_MARKER') {
      const penData = buildEventData({ ...action, eventType: 'PENALTY' })
      penData.scoring_context = { scored: false }
      setFlashButton(action.id)
      if (action.needsPlayer) {
        onEventTap({ action: { ...action, eventType: 'PENALTY' }, eventData: penData })
      } else {
        onCreateEvent(penData)
        if (action.autoFlipTo) onPossessionChange(action.autoFlipTo === 'us' ? 'team_a' : 'team_b')
        if (action.autoSwitchTab) onTabChange(action.autoSwitchTab)
      }
      return
    }

    const eventData = buildEventData(action, freeKickContext)
    setFlashButton(action.id)

    // If needs pitch or player, start the overlay flow
    if (action.needsPitch || action.needsPlayer) {
      onEventTap({ action, eventData, freeKickContext })
    } else {
      // Direct creation (e.g. Block, Opp Error, KO Lost)
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

  const handleFortyFiveTap = useCallback((scored: boolean) => {
    if (disabled) return
    const action = scored ? FORTY_FIVE_ACTIONS[0] : FORTY_FIVE_ACTIONS[1]
    const data = buildEventData({ ...action, eventType: 'FORTY_FIVE' })
    data.scoring_context = { scored }
    setFlashButton(action.id)
    setShowFortyFivePanel(false)

    if (action.needsPlayer) {
      onEventTap({ action: { ...action, eventType: 'FORTY_FIVE' }, eventData: data })
    } else {
      onCreateEvent(data)
      if (action.autoFlipTo) onPossessionChange(action.autoFlipTo === 'us' ? 'team_a' : 'team_b')
      if (action.autoSwitchTab) onTabChange(action.autoSwitchTab)
    }
  }, [disabled, buildEventData, onEventTap, onCreateEvent, onPossessionChange, onTabChange])

  const isButtonDisabled = (action: ActionButton): boolean => {
    if (disabled) return true
    if (action.disabledWhen === 'us' && isUs) return true
    if (action.disabledWhen === 'them' && !isUs) return true
    return false
  }

  const handleDiscipline = (type: 'YELLOW_CARD' | 'BLACK_CARD' | 'RED_CARD' | 'SUB_ON') => {
    if (disabled) return
    const videoMs = currentTimestampMs ?? 0
    const time = calcMatchTime
      ? calcMatchTime(videoMs)
      : { minute: Math.floor(videoMs / 60000), second: Math.floor((videoMs % 60000) / 1000), half }
    const data: VideoEventCreateData = {
      event_type: type,
      team: possession,
      half: time.half,
      match_minute: time.minute,
      match_second: time.second,
      video_timestamp_ms: currentTimestampMs ?? undefined,
      source: 'human_tag',
    }
    const modalTitle = type === 'YELLOW_CARD' ? 'Yellow Card — Who?'
      : type === 'BLACK_CARD' ? 'Black Card — Who?'
      : type === 'RED_CARD' ? 'Red Card — Who?'
      : 'Substitution — Who?'
    // Route through overlay flow for player selection
    onEventTap({
      action: {
        id: type.toLowerCase(),
        label: modalTitle,
        eventType: type,
        needsPlayer: true,
        needsPitch: false,
        playerModalTitle: modalTitle,
        playerModalEventType: type.toLowerCase(),
      },
      eventData: data,
    })
  }

  const actions = CATEGORY_ACTIONS[activeTab]

  return (
    <div
      className="flex flex-col h-full backdrop-blur-xl w-[180px] border-l border-white/[0.08]"
      style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, rgba(255,255,255,0.04) 100%)' }}
    >
      {/* Possession indicator with flip icon */}
      <div className="p-2 border-b border-white/[0.08]">
        <button
          onClick={() => onPossessionChange(isUs ? 'team_b' : 'team_a')}
          className={`w-full py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-[0.97] ${
            isUs
              ? 'text-emerald-300 border border-emerald-400/25 shadow-emerald-500/10 hover:shadow-emerald-500/20'
              : 'text-orange-300 border border-orange-400/25 shadow-orange-500/10 hover:shadow-orange-500/20'
          }`}
          style={{
            background: isUs
              ? 'linear-gradient(135deg, rgba(16,185,129,0.25) 0%, rgba(16,185,129,0.10) 100%)'
              : 'linear-gradient(135deg, rgba(249,115,22,0.25) 0%, rgba(249,115,22,0.10) 100%)',
          }}
        >
          <ArrowLeftRight size={12} />
          {isUs ? teamName : 'Opposition'}
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex border-b border-white/[0.08]">
        {CATEGORY_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { onTabChange(id); setShowFreePanel(false); setShowFortyFivePanel(false) }}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-all ${
              activeTab === id
                ? 'text-emerald-400 bg-emerald-500/10 border-b-2 border-emerald-400'
                : 'text-white/35 hover:text-white/55 hover:bg-white/[0.03]'
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
            <div className="text-[10px] text-white/30 uppercase tracking-widest mb-1 text-center font-semibold">
              Free Kick Outcome
            </div>
            {FREE_KICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                onClick={() => handleActionTap(action, true)}
                disabled={disabled}
                className={`w-full py-2.5 px-2 rounded-xl text-xs font-semibold transition-all border active:scale-[0.96]
                  ${flashButton === action.id
                    ? 'bg-emerald-500/50 text-white border-emerald-400/40 shadow-md shadow-emerald-500/20'
                    : 'text-white/70 border-white/[0.08] hover:border-white/15 hover:text-white/90'
                  }
                  disabled:opacity-30 disabled:cursor-not-allowed
                `}
                style={flashButton === action.id ? undefined : { background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)' }}
              >
                {action.label}
              </button>
            ))}
            <button
              onClick={() => setShowFreePanel(false)}
              disabled={disabled}
              className="w-full py-2.5 px-2 rounded-xl text-xs font-semibold transition-all border active:scale-[0.96] text-white/70 border-white/[0.08] hover:border-white/15 hover:text-white/90"
              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)' }}
            >
              Short Pass
            </button>
            <button
              onClick={() => setShowFreePanel(false)}
              className="w-full py-2 px-2 rounded-xl text-xs text-white/35 hover:text-white/55 border border-white/[0.05] hover:border-white/10 flex items-center justify-center gap-1 transition-all"
            >
              <ChevronLeft size={12} />
              Back
            </button>
          </>
        ) : showFortyFivePanel ? (
          <>
            <div className="text-[10px] text-white/30 uppercase tracking-widest mb-1 text-center font-semibold">
              45m Free Outcome
            </div>
            <button
              onClick={() => handleFortyFiveTap(true)}
              disabled={disabled}
              className={`w-full py-2.5 px-2 rounded-xl text-xs font-semibold transition-all border active:scale-[0.96]
                ${flashButton === '45_scored'
                  ? 'bg-emerald-500/50 text-white border-emerald-400/40 shadow-md shadow-emerald-500/20'
                  : 'text-white/70 border-white/[0.08] hover:border-white/15 hover:text-white/90'
                }
                disabled:opacity-30 disabled:cursor-not-allowed
              `}
              style={flashButton === '45_scored' ? undefined : { background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)' }}
            >
              45 Scored
            </button>
            <button
              onClick={() => handleFortyFiveTap(false)}
              disabled={disabled}
              className={`w-full py-2.5 px-2 rounded-xl text-xs font-semibold transition-all border active:scale-[0.96]
                ${flashButton === '45_missed'
                  ? 'bg-emerald-500/50 text-white border-emerald-400/40 shadow-md shadow-emerald-500/20'
                  : 'text-white/70 border-white/[0.08] hover:border-white/15 hover:text-white/90'
                }
                disabled:opacity-30 disabled:cursor-not-allowed
              `}
              style={flashButton === '45_missed' ? undefined : { background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)' }}
            >
              45 Missed
            </button>
            <button
              onClick={() => setShowFortyFivePanel(false)}
              className="w-full py-2 px-2 rounded-xl text-xs text-white/35 hover:text-white/55 border border-white/[0.05] hover:border-white/10 flex items-center justify-center gap-1 transition-all"
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
                className={`w-full py-2.5 px-2 rounded-xl text-xs font-semibold transition-all border active:scale-[0.96] whitespace-nowrap
                  ${flashButton === action.id
                    ? 'bg-emerald-500/50 text-white border-emerald-400/40 shadow-md shadow-emerald-500/20'
                    : isDisabled
                      ? 'text-white/15 cursor-not-allowed border-white/[0.03]'
                      : 'text-white/70 border-white/[0.08] hover:border-white/15 hover:text-white/90 hover:shadow-sm hover:shadow-white/5'
                  }
                `}
                style={flashButton === action.id || isDisabled ? undefined : { background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)' }}
              >
                {action.label}
              </button>
            )
          })
        )}
      </div>

      {/* Discipline row */}
      <div className="flex gap-1 p-2 border-t border-white/[0.08]">
        <button
          onClick={() => handleDiscipline('YELLOW_CARD')}
          disabled={disabled}
          className="flex-1 py-1.5 rounded-lg text-[10px] font-medium border border-yellow-400/20 text-yellow-300 hover:border-yellow-400/35 disabled:opacity-30 transition-all active:scale-[0.95]"
          style={{ background: 'linear-gradient(135deg, rgba(234,179,8,0.2) 0%, rgba(234,179,8,0.08) 100%)' }}
          title="Yellow Card"
        >
          <AlertTriangle size={12} className="mx-auto" />
        </button>
        <button
          onClick={() => handleDiscipline('BLACK_CARD')}
          disabled={disabled}
          className="flex-1 py-1.5 rounded-lg text-[10px] font-medium border border-slate-400/20 text-slate-300 hover:border-slate-400/35 disabled:opacity-30 transition-all active:scale-[0.95]"
          style={{ background: 'linear-gradient(135deg, rgba(30,41,59,0.6) 0%, rgba(30,41,59,0.3) 100%)' }}
          title="Black Card (10 min sin bin)"
        >
          <div className="w-3 h-4 rounded-[2px] bg-slate-800 border border-slate-400/40 mx-auto" />
        </button>
        <button
          onClick={() => handleDiscipline('RED_CARD')}
          disabled={disabled}
          className="flex-1 py-1.5 rounded-lg text-[10px] font-medium border border-red-400/20 text-red-300 hover:border-red-400/35 disabled:opacity-30 transition-all active:scale-[0.95]"
          style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.2) 0%, rgba(239,68,68,0.08) 100%)' }}
          title="Red Card"
        >
          <AlertTriangle size={12} className="mx-auto" />
        </button>
        <button
          onClick={() => handleDiscipline('SUB_ON')}
          disabled={disabled}
          className="flex-1 py-1.5 rounded-lg text-[10px] font-medium border border-white/[0.08] text-white/40 hover:border-white/15 hover:text-white/60 disabled:opacity-30 transition-all active:scale-[0.95]"
          style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)' }}
          title="Substitution"
        >
          <Shield size={12} className="mx-auto" />
        </button>
      </div>
    </div>
  )
}
