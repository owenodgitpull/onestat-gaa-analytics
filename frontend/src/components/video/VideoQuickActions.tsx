/**
 * VideoQuickActions — Sidebar overlay for quick event tagging on video.
 *
 * Semi-transparent sidebar overlaid on right side of video player.
 * Possession-aware: auto-flips on turnovers/scores, disables invalid actions.
 * Tapping an event fires onEventTap to start the three-tap overlay flow.
 *
 * 4-tab layout: Score | T/O | Our KO | Opp KO
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Target, ArrowRightLeft, CircleDot, ArrowLeftRight,
  ChevronLeft, Hand, AlertTriangle, ArrowUpCircle,
  XCircle, ArrowDownCircle,
} from 'lucide-react'
import type { PitchZone } from './PitchZoneSelector'
import { TWO_POINTER_ZONES, xyToZone } from './PitchZoneSelector'
import type { VideoEventCreateData } from '../../services/videoApi'
import { TURNOVER_REASON_CONFIG, FOUL_SUBTYPES, type TurnoverReason } from '../../constants/turnoverSubtypes'

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
  /** Fires when the 45m Free sub-panel opens/closes, so the parent can snap
   * the persistent pitch's ball marker onto the 45m line and highlight it —
   * the same tap-accuracy aid MatchRecording.tsx gives live recording. */
  onFortyFivePanelToggle?: (open: boolean) => void
  /** After a foul is logged, the parent sets this to show the free kick
   * outcome panel — mirrors Live Recording's PitchActionOverlay free flow.
   * 'our_free' = opposition fouled, we take the free.
   * 'opp_free' = we fouled, opposition takes the free. */
  pendingFreeKick?: 'our_free' | 'opp_free' | null
  onFreeKickCancel?: () => void
  /** Name shown for the team in the free kick header */
  opponentName?: string
  /** When true, sidebar shows foul subtype picker (pushing, pulling, etc.)
   * after player has been selected for an "Our Foul". */
  pendingFoulSubtype?: boolean
  onFoulSubtypeSelect?: (subtype?: string) => void
}

const SCORING_ACTIONS: ActionButton[] = [
  { id: 'goal', label: 'Goal', eventType: 'GOAL_SCORED', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Scored?', playerModalEventType: 'goal', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'point', label: 'Point', eventType: 'POINT_SCORED', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Scored?', playerModalEventType: 'point', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'two_point', label: '2 PT', eventType: 'TWO_POINT_SCORED', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Scored?', playerModalEventType: 'point', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'wide', label: 'Wide', eventType: 'WIDE', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Took?', playerModalEventType: 'wide', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'short', label: 'Short', eventType: 'SHORT', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Shot?', playerModalEventType: 'saved', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'saved', label: 'Saved', eventType: 'SAVED', needsPlayer: false, needsPitch: false, autoFlipTo: 'us', autoSwitchTab: 'our_kickouts' },
  { id: 'block', label: 'Block', eventType: 'BLOCK_SHOT', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Blocked?', playerModalEventType: 'block' },
  { id: 'hit_post', label: 'Hit Post', eventType: 'HIT_POST', needsPlayer: true, needsPitch: true, playerModalTitle: 'Who Shot?', playerModalEventType: 'wide', autoFlipTo: 'us', autoSwitchTab: 'our_kickouts' },
  { id: 'forty_five', label: '45m Free', eventType: 'FORTY_FIVE_MARKER', needsPlayer: false, needsPitch: false },
  { id: 'pen_goal', label: 'Pen Goal', eventType: 'PENALTY_GOAL_MARKER', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'goal', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'pen_miss', label: 'Pen Miss', eventType: 'PENALTY_MISS_MARKER', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'wide', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
]

const TURNOVER_ACTIONS: ActionButton[] = [
  { id: 'to_won', label: 'T/O Won', eventType: 'TURNOVER_WON', disabledWhen: 'us', autoFlipTo: 'us', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Won Turnover?', playerModalEventType: 'turnover_won' },
  { id: 'tackle_won', label: 'Tackle Won', eventType: 'TACKLE_WON', disabledWhen: 'them', autoFlipTo: 'us', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Won Tackle?', playerModalEventType: 'turnover_won' },
  { id: 'to_lost', label: 'T/O Lost', eventType: 'TURNOVER_LOST', disabledWhen: 'them', autoFlipTo: 'them', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Lost Possession?', playerModalEventType: 'turnover_lost' },
  { id: 'intercept', label: 'Intercept', eventType: 'INTERCEPTION', autoFlipTo: 'us', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Intercepted?', playerModalEventType: 'turnover_won' },
  { id: 'our_error', label: 'Our Error', eventType: 'OUR_UNFORCED_ERROR', disabledWhen: 'them', autoFlipTo: 'them', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Made the Error?', playerModalEventType: 'turnover_lost' },
  { id: 'opp_error', label: 'Opp Error', eventType: 'OPP_UNFORCED_ERROR', disabledWhen: 'us', autoFlipTo: 'us', needsPlayer: false, needsPitch: false },
  // Open-play ball goes out over the sideline — distinct from SIDELINE_KICK
  // (a kickout restart going straight out). Doesn't auto-flip possession;
  // the parent follows up with a "who's got it now?" decision instead.
  { id: 'sideline_ball', label: 'Sideline Ball', eventType: 'SIDELINE_BALL', needsPlayer: false, needsPitch: false },
]

const OUR_KICKOUT_ACTIONS: ActionButton[] = [
  { id: 'own_ko_won', label: 'We Won', eventType: 'OWN_KICKOUT_WON', needsPlayer: true, needsPitch: true, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  { id: 'own_ko_opp', label: 'Opp Won', eventType: 'OWN_KICKOUT_OPPOSITION_WON', needsPlayer: false, needsPitch: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  { id: 'own_ko_won_brk', label: 'We Won Break', eventType: 'OWN_KICKOUT_WON_BREAK', needsPlayer: true, needsPitch: true, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  { id: 'own_ko_opp_brk', label: 'Opp Won Break', eventType: 'OWN_KICKOUT_OPPOSITION_WON_BREAK', needsPlayer: false, needsPitch: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  // Kickout goes out over the sideline — parity with live recording's
  // "Over Sideline" button (PitchActionOverlay.tsx). Unlike live recording
  // (which bakes team into own_kickout_sideline/opp_kickout_sideline as
  // separate event_type strings), video events already carry team as its
  // own field, so both tabs share the one SIDELINE_KICK video event type —
  // no backend change needed. The restart goes to whoever didn't take the
  // kickout, same flip direction as "Opp Won".
  { id: 'own_ko_sideline', label: 'Over Sideline', eventType: 'SIDELINE_KICK', needsPlayer: false, needsPitch: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
]

const OPP_KICKOUT_ACTIONS: ActionButton[] = [
  { id: 'opp_ko_won', label: 'We Won', eventType: 'OPP_KICKOUT_WON', needsPlayer: true, needsPitch: true, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  { id: 'opp_ko_opp', label: 'Opp Won', eventType: 'OPP_KICKOUT_OPPOSITION_WON', needsPlayer: false, needsPitch: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  { id: 'opp_ko_won_brk', label: 'We Won Break', eventType: 'OPP_KICKOUT_WON_BREAK', needsPlayer: true, needsPitch: true, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  { id: 'opp_ko_opp_brk', label: 'Opp Won Break', eventType: 'OPP_KICKOUT_OPPOSITION_WON_BREAK', needsPlayer: false, needsPitch: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  { id: 'opp_ko_sideline', label: 'Over Sideline', eventType: 'SIDELINE_KICK', needsPlayer: false, needsPitch: false, autoFlipTo: 'us', autoSwitchTab: 'scoring' },
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
  { id: 'free_2pt', label: '2PT (Free)', eventType: 'TWO_POINT_SCORED', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Scored?', playerModalEventType: 'point', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'free_wide', label: 'Wide (Free)', eventType: 'WIDE', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'wide', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
  { id: 'free_short', label: 'Dropped Short', eventType: 'SHORT', needsPlayer: true, needsPitch: false, playerModalTitle: 'Who Took?', playerModalEventType: 'saved', autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts' },
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
  onFortyFivePanelToggle,
  pendingFreeKick,
  onFreeKickCancel,
  opponentName = 'Opposition',
  pendingFoulSubtype,
  onFoulSubtypeSelect,
}: VideoQuickActionsProps) {
  const [flashButton, setFlashButton] = useState<string | null>(null)
  const [showFreePanel, setShowFreePanel] = useState(false)
  const [showFortyFivePanel, setShowFortyFivePanel] = useState(false)
  const [showFoulTeamPanel, setShowFoulTeamPanel] = useState(false)
  // Turnover reason/subtype picker — parity with MatchRecording.tsx's flat
  // single-screen picker (all 3 reason groups + their subtype buttons shown
  // and directly tappable at once, no "pick reason, then pick type" as two
  // sequential steps). Video tagging has no separate FOUL_COMMITTED event
  // type, so "Offensive Foul" is tagged as TURNOVER_LOST with a
  // distinguishing subtype rather than replicating live recording's
  // foul-committed + free-kick-conceded flow. `onlyReason` narrows the
  // panel to a single group — used by "Our Error" (already its own button
  // here, unlike live recording where it's a second interception of the
  // same event type) so that shortcut still only shows unforced-error
  // subtypes, not all 3 groups.
  const [turnoverPanel, setTurnoverPanel] = useState<{ onlyReason?: TurnoverReason } | null>(null)

  const isUs = possession === 'team_a'

  // Draw the eye to the button panel whenever the tab changes — most
  // usefully when it's an auto-switch after logging a score (e.g. straight
  // to the kickout tab), which otherwise requires scanning the sidebar to
  // notice the context moved. A brief pulse, not a persistent state.
  const [tabJustChanged, setTabJustChanged] = useState(false)
  const isFirstTabRenderRef = useRef(true)
  useEffect(() => {
    if (isFirstTabRenderRef.current) {
      isFirstTabRenderRef.current = false
      return
    }
    setTabJustChanged(true)
    const timer = setTimeout(() => setTabJustChanged(false), 1600)
    return () => clearTimeout(timer)
  }, [activeTab])

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
    // Zone comes from the live tracking-pitch ball position — selectedZone
    // is a legacy fallback from the old pitch-tap-to-confirm overlay (now
    // removed; position is always known by the time an event is tapped).
    const effectiveZone = selectedZone ?? (
      ballPitchX != null && ballPitchY != null ? xyToZone(ballPitchX, ballPitchY) : undefined
    )
    const isTwoPointer = effectiveZone ? TWO_POINTER_ZONES.includes(effectiveZone) : false

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

    if (['POINT_SCORED', 'GOAL_SCORED', 'TWO_POINT_SCORED', 'WIDE', 'SHORT'].includes(action.eventType)) {
      data.scoring_context = {
        is_two_pointer: action.eventType === 'POINT_SCORED' ? isTwoPointer : false,
        source: freeKickContext ? 'FROM_FREE' : 'FROM_PLAY',
      }
    }

    return data
  }, [possession, half, currentTimestampMs, selectedZone, ballPitchX, ballPitchY, calcMatchTime])

  const handleActionTap = useCallback((action: ActionButton, freeKickContext?: boolean) => {
    if (disabled) return

    // T/O Lost — route through the 3-way reason picker instead of recording
    // a bare TURNOVER_LOST immediately, matching live recording's macro/
    // micro turnover framework.
    if (action.id === 'to_lost') {
      setFlashButton(action.id)
      setTurnoverPanel({})
      return
    }

    // Our Error — already a distinct button/event type here (unlike live
    // recording, where it's a second interception of the same TURNOVER_LOST
    // flow), so it narrows straight to just the unforced-error group.
    if (action.id === 'our_error') {
      setFlashButton(action.id)
      setTurnoverPanel({ onlyReason: 'unforced' })
      return
    }

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
      onFortyFivePanelToggle?.(true)
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

    if (freeKickContext) {
      setShowFreePanel(false)
      onFreeKickCancel?.()
    }
  }, [disabled, buildEventData, onEventTap, onCreateEvent, onPossessionChange, onTabChange, onFortyFivePanelToggle, onFreeKickCancel])

  const handleFortyFiveTap = useCallback((scored: boolean) => {
    if (disabled) return
    const action = scored ? FORTY_FIVE_ACTIONS[0] : FORTY_FIVE_ACTIONS[1]
    const data = buildEventData({ ...action, eventType: 'FORTY_FIVE' })
    data.scoring_context = { scored }
    setFlashButton(action.id)
    setShowFortyFivePanel(false)
    onFortyFivePanelToggle?.(false)

    if (action.needsPlayer) {
      onEventTap({ action: { ...action, eventType: 'FORTY_FIVE' }, eventData: data })
    } else {
      onCreateEvent(data)
      if (action.autoFlipTo) onPossessionChange(action.autoFlipTo === 'us' ? 'team_a' : 'team_b')
      if (action.autoSwitchTab) onTabChange(action.autoSwitchTab)
    }
  }, [disabled, buildEventData, onEventTap, onCreateEvent, onPossessionChange, onTabChange, onFortyFivePanelToggle])

  // Finalize the flat reason+subtype picker in one tap — `subtype` is
  // omitted when a group header (not a specific subtype button) was tapped.
  const handleTurnoverFlatTap = useCallback((reason: TurnoverReason, subtype?: string) => {
    const { eventType } = TURNOVER_REASON_CONFIG[reason]
    const videoEventType =
      eventType === 'unforced_error' ? 'OUR_UNFORCED_ERROR'
      : eventType === 'foul_committed' ? 'FOUL_COMMITTED'
      : 'TURNOVER_LOST'
    setTurnoverPanel(null)
    const action: ActionButton = {
      id: videoEventType === 'OUR_UNFORCED_ERROR' ? 'our_error'
          : videoEventType === 'FOUL_COMMITTED' ? 'foul'
          : 'to_lost',
      label: videoEventType === 'OUR_UNFORCED_ERROR' ? 'Our Error'
             : videoEventType === 'FOUL_COMMITTED' ? 'Offensive Foul'
             : 'T/O Lost',
      eventType: videoEventType,
      autoFlipTo: 'them',
      needsPlayer: true,
      needsPitch: false,
      playerModalTitle: videoEventType === 'OUR_UNFORCED_ERROR' ? 'Who Made the Error?'
                        : videoEventType === 'FOUL_COMMITTED' ? 'Who Fouled?'
                        : 'Who Lost Possession?',
      playerModalEventType: videoEventType === 'FOUL_COMMITTED' ? 'foul_committed' : 'turnover_lost',
    }
    const eventData = buildEventData(action)
    if (subtype) eventData.sub_type = subtype
    setFlashButton(action.id)
    onEventTap({ action, eventData })
  }, [buildEventData, onEventTap])

  const isButtonDisabled = (action: ActionButton): boolean => {
    if (disabled) return true
    if (action.disabledWhen === 'us' && isUs) return true
    if (action.disabledWhen === 'them' && !isUs) return true
    return false
  }

  const handleFoulTeamSelect = useCallback((foulTeam: 'own' | 'opponent') => {
    if (disabled) return
    setShowFoulTeamPanel(false)
    const videoMs = currentTimestampMs ?? 0
    const time = calcMatchTime
      ? calcMatchTime(videoMs)
      : { minute: Math.floor(videoMs / 60000), second: Math.floor((videoMs % 60000) / 1000), half }

    if (foulTeam === 'own') {
      // Our team fouled — select which player committed it.
      // team='team_a' because OUR player committed the foul.
      const data: VideoEventCreateData = {
        event_type: 'FOUL_COMMITTED',
        team: 'team_a',
        half: time.half,
        match_minute: time.minute,
        match_second: time.second,
        video_timestamp_ms: currentTimestampMs ?? undefined,
        pitch_x: ballPitchX ?? undefined,
        pitch_y: ballPitchY ?? undefined,
        source: 'human_tag',
      }
      onEventTap({
        action: {
          id: 'foul_own',
          label: 'Our Foul',
          eventType: 'FOUL_COMMITTED',
          needsPlayer: true,
          needsPitch: false,
          playerModalTitle: 'Who Fouled?',
          playerModalEventType: 'foul_committed',
        },
        eventData: data,
      })
    } else {
      // Opposition fouled us — create FOUL_COMMITTED with team_b (opp committed it),
      // no player selection needed (we don't track opposition players).
      const data: VideoEventCreateData = {
        event_type: 'FOUL_COMMITTED',
        team: 'team_b',
        half: time.half,
        match_minute: time.minute,
        match_second: time.second,
        video_timestamp_ms: currentTimestampMs ?? undefined,
        pitch_x: ballPitchX ?? undefined,
        pitch_y: ballPitchY ?? undefined,
        source: 'human_tag',
      }
      onCreateEvent(data)
      // Possession flips to us (we won the free) + show scoring tab
      onPossessionChange('team_a')
      onTabChange('scoring')
    }
  }, [disabled, currentTimestampMs, calcMatchTime, half, ballPitchX, ballPitchY, onEventTap, onCreateEvent, onPossessionChange, onTabChange])

  const handleDiscipline = (type: 'YELLOW_CARD' | 'BLACK_CARD' | 'RED_CARD' | 'SUB_ON') => {
    if (disabled) return
    // For cards and subs, route through normal player selection flow
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
      pitch_x: ballPitchX ?? undefined,
      pitch_y: ballPitchY ?? undefined,
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
            onClick={() => { onTabChange(id); setShowFreePanel(false); setShowFortyFivePanel(false); onFortyFivePanelToggle?.(false); setTurnoverPanel(null) }}
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
      <div className={`flex-1 overflow-y-auto p-2 space-y-1.5 rounded-lg ${tabJustChanged ? 'qa-tab-pulse' : ''}`}>
        {pendingFoulSubtype ? (
          <>
            <div className="rounded-xl border border-red-500/30 overflow-hidden">
              <div
                className="px-2.5 py-2 border-b border-red-500/20"
                style={{ background: 'linear-gradient(90deg, rgba(239,68,68,0.22), rgba(220,38,38,0.10))' }}
              >
                <div className="flex items-center gap-1.5">
                  <Hand size={12} className="text-red-400" />
                  <span className="text-[11px] font-bold text-red-300">What type of foul?</span>
                </div>
              </div>
              <div className="p-1.5 space-y-1">
                {FOUL_SUBTYPES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => onFoulSubtypeSelect?.(value)}
                    className="w-full py-2 px-2 rounded-xl text-xs font-semibold transition-all border active:scale-[0.96] text-white/70 border-white/[0.08] hover:border-red-400/30 hover:text-white/90 hover:bg-red-500/10"
                    style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)' }}
                  >
                    {label}
                  </button>
                ))}
                <button
                  onClick={() => onFoulSubtypeSelect?.(undefined)}
                  className="w-full py-2 px-2 rounded-xl text-xs text-white/35 hover:text-white/55 border border-white/[0.05] hover:border-white/10 transition-all"
                >
                  Skip — log without type
                </button>
              </div>
            </div>
          </>
        ) : showFoulTeamPanel ? (
          <>
            <div className="rounded-xl border border-red-500/30 overflow-hidden">
              <div
                className="px-2.5 py-2 flex items-center justify-between border-b border-red-500/20"
                style={{ background: 'linear-gradient(90deg, rgba(239,68,68,0.22), rgba(220,38,38,0.10))' }}
              >
                <div className="flex items-center gap-1.5">
                  <Hand size={12} className="text-red-400" />
                  <span className="text-[11px] font-bold text-red-300">Who Committed the Foul?</span>
                </div>
                <button
                  onClick={() => setShowFoulTeamPanel(false)}
                  className="text-[10px] text-white/40 hover:text-white/70 px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
              </div>
              <div className="p-1.5 space-y-1.5">
                <button
                  onClick={() => handleFoulTeamSelect('own')}
                  disabled={disabled}
                  className="w-full py-3 rounded-xl border-2 font-semibold flex flex-col items-center gap-0.5 transition-all active:scale-[0.96] bg-emerald-500/20 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-30"
                >
                  <span className="text-xs font-bold">Our Foul</span>
                  <span className="text-[10px] text-white/40">Select who fouled</span>
                </button>
                <button
                  onClick={() => handleFoulTeamSelect('opponent')}
                  disabled={disabled}
                  className="w-full py-3 rounded-xl border-2 font-semibold flex flex-col items-center gap-0.5 transition-all active:scale-[0.96] bg-rose-500/20 border-rose-400/40 text-rose-200 hover:bg-rose-500/30 disabled:opacity-30"
                >
                  <span className="text-xs font-bold">Opp Foul</span>
                  <span className="text-[10px] text-white/40">We win free</span>
                </button>
              </div>
            </div>
          </>
        ) : pendingFreeKick ? (
          <>
            <div className="qa-free-kick-pulse rounded-xl border border-cyan-500/30 overflow-hidden">
              <div
                className="px-2.5 py-2 flex items-center justify-between border-b border-cyan-500/20"
                style={{ background: 'linear-gradient(90deg, rgba(6,182,212,0.22), rgba(59,130,246,0.10))' }}
              >
                <div className="flex items-center gap-1.5">
                  <AlertTriangle size={12} className="text-cyan-400" />
                  <span className="text-[11px] font-bold text-cyan-300">
                    {pendingFreeKick === 'our_free' ? `${teamName} Free` : `${opponentName} Free`}
                  </span>
                </div>
                <button
                  onClick={onFreeKickCancel}
                  className="text-[10px] text-white/40 hover:text-white/70 px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
              </div>

              <div className="p-1.5 grid grid-cols-2 gap-1.5">
                {FREE_KICK_ACTIONS.map((action) => {
                  const isPoint = action.id === 'free_point'
                  const is2pt = action.id === 'free_2pt'
                  const isWide = action.id === 'free_wide'
                  const isShort = action.id === 'free_short'
                  const variant = (isPoint || is2pt) ? 'emerald' : isWide ? 'rose' : 'amber'
                  return (
                    <button
                      key={action.id}
                      onClick={() => handleActionTap(action, true)}
                      disabled={disabled}
                      className={`py-2.5 rounded-xl border-2 font-semibold flex flex-col items-center gap-1 transition-all active:scale-[0.96] disabled:opacity-30
                        ${variant === 'emerald' ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/30' : ''}
                        ${variant === 'rose' ? 'bg-rose-500/20 border-rose-400/40 text-rose-200 hover:bg-rose-500/30' : ''}
                        ${variant === 'amber' ? 'bg-amber-500/20 border-amber-400/40 text-amber-200 hover:bg-amber-500/30' : ''}
                      `}
                    >
                      {(isPoint || is2pt) && <Target size={16} />}
                      {isWide && <XCircle size={16} />}
                      {isShort && <ArrowDownCircle size={16} />}
                      <span className="text-[10px] leading-tight text-center">{action.label}</span>
                    </button>
                  )
                })}
                <button
                  onClick={() => { onFreeKickCancel?.(); }}
                  disabled={disabled}
                  className="py-2 rounded-xl border-2 font-semibold text-[10px] flex items-center justify-center gap-1.5 transition-all active:scale-[0.96] bg-teal-500/20 border-teal-400/40 text-teal-200 hover:bg-teal-500/30 disabled:opacity-30"
                >
                  <ArrowLeftRight size={14} />
                  Short Pass
                </button>
                <button
                  onClick={() => { onFreeKickCancel?.(); }}
                  disabled={disabled}
                  className="py-2 rounded-xl border-2 font-semibold text-[10px] flex items-center justify-center gap-1.5 transition-all active:scale-[0.96] bg-teal-500/20 border-teal-400/40 text-teal-200 hover:bg-teal-500/30 disabled:opacity-30"
                >
                  <ArrowUpCircle size={14} />
                  High Ball
                </button>
              </div>
            </div>
          </>
        ) : showFreePanel ? (
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
              onClick={() => { setShowFortyFivePanel(false); onFortyFivePanelToggle?.(false) }}
              className="w-full py-2 px-2 rounded-xl text-xs text-white/35 hover:text-white/55 border border-white/[0.05] hover:border-white/10 flex items-center justify-center gap-1 transition-all"
            >
              <ChevronLeft size={12} />
              Back
            </button>
          </>
        ) : turnoverPanel ? (
          <>
            <div className="text-[10px] text-white/30 uppercase tracking-widest mb-1 text-center font-semibold">
              {turnoverPanel.onlyReason ? TURNOVER_REASON_CONFIG[turnoverPanel.onlyReason].label : 'Turnover'}
            </div>
            {(turnoverPanel.onlyReason ? [turnoverPanel.onlyReason] : (Object.keys(TURNOVER_REASON_CONFIG) as TurnoverReason[])).map((reason) => (
              <div key={reason} className="space-y-1">
                <button
                  onClick={() => handleTurnoverFlatTap(reason)}
                  disabled={disabled}
                  className="w-full py-2 px-2 rounded-xl text-xs font-semibold transition-all border active:scale-[0.96] text-white/70 border-white/[0.08] hover:border-white/15 hover:text-white/90 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)' }}
                >
                  {TURNOVER_REASON_CONFIG[reason].label}
                </button>
                <div className="pl-2 space-y-1">
                  {TURNOVER_REASON_CONFIG[reason].subtypeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleTurnoverFlatTap(reason, opt.value)}
                      disabled={disabled}
                      className="w-full py-1.5 px-2 rounded-lg text-[11px] font-medium transition-all border active:scale-[0.96] text-white/55 border-white/[0.06] hover:border-white/15 hover:text-white/85 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button
              onClick={() => setTurnoverPanel(null)}
              className="w-full py-2 px-2 rounded-xl text-xs text-white/35 hover:text-white/55 border border-white/[0.05] hover:border-white/10 flex items-center justify-center gap-1 transition-all"
            >
              <ChevronLeft size={12} />
              Cancel
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

      {/* Foul button - prominent, always visible */}
      <button
        onClick={() => setShowFoulTeamPanel(true)}
        disabled={disabled}
        className="mx-2 my-1 py-2.5 px-3 rounded-xl text-sm font-bold transition-all border border-red-400/30 text-red-300 hover:border-red-400/50 hover:text-red-200 disabled:opacity-30 active:scale-[0.96] flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.25) 0%, rgba(220,38,38,0.15) 100%)' }}
        title="Record a foul"
      >
        <Hand size={16} />
        <span>Foul</span>
      </button>

      {/* Discipline row */}
      <div className="flex gap-1 p-2 border-t border-white/[0.08]">
        <button
          onClick={() => handleDiscipline('YELLOW_CARD')}
          disabled={disabled}
          className="flex-1 py-1.5 rounded-lg text-[10px] font-medium border border-yellow-400/20 text-yellow-300 hover:border-yellow-400/35 disabled:opacity-30 transition-all active:scale-[0.95]"
          style={{ background: 'linear-gradient(135deg, rgba(234,179,8,0.2) 0%, rgba(234,179,8,0.08) 100%)' }}
          title="Yellow Card"
        >
          <div className="w-3.5 h-5 rounded-[2px] bg-yellow-400 border border-yellow-500/50 mx-auto" />
        </button>
        <button
          onClick={() => handleDiscipline('BLACK_CARD')}
          disabled={disabled}
          className="flex-1 py-1.5 rounded-lg text-[10px] font-medium border border-slate-400/20 text-slate-300 hover:border-slate-400/35 disabled:opacity-30 transition-all active:scale-[0.95]"
          style={{ background: 'linear-gradient(135deg, rgba(30,41,59,0.6) 0%, rgba(30,41,59,0.3) 100%)' }}
          title="Black Card (10 min sin bin)"
        >
          <div className="w-3.5 h-5 rounded-[2px] bg-slate-900 border border-slate-400/50 mx-auto" />
        </button>
        <button
          onClick={() => handleDiscipline('RED_CARD')}
          disabled={disabled}
          className="flex-1 py-1.5 rounded-lg text-[10px] font-medium border border-red-400/20 text-red-300 hover:border-red-400/35 disabled:opacity-30 transition-all active:scale-[0.95]"
          style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.2) 0%, rgba(239,68,68,0.08) 100%)' }}
          title="Red Card"
        >
          <div className="w-3.5 h-5 rounded-[2px] bg-red-500 border border-red-600/50 mx-auto" />
        </button>
        <button
          onClick={() => handleDiscipline('SUB_ON')}
          disabled={disabled}
          className="flex-1 py-2 rounded-lg text-[11px] font-medium border border-white/[0.12] text-white/50 hover:border-white/20 hover:text-white/70 disabled:opacity-30 transition-all active:scale-[0.95] flex items-center justify-center gap-1"
          style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)' }}
          title="Substitution"
        >
          <ArrowLeftRight size={13} className="shrink-0" />
          <span className="text-[9px] font-semibold">Sub</span>
        </button>
      </div>

      <style>{`
        @keyframes qa-tab-pulse-glow {
          0%, 100% { box-shadow: 0 0 0 2px rgba(16,185,129,0.65), 0 0 22px 4px rgba(16,185,129,0.35); }
          50% { box-shadow: 0 0 0 2px rgba(6,182,212,0.65), 0 0 28px 8px rgba(6,182,212,0.45); }
        }
        .qa-tab-pulse {
          animation: qa-tab-pulse-glow 0.8s ease-in-out 2;
        }
        @keyframes qa-free-kick-pulse-glow {
          0%, 100% { box-shadow: 0 0 0 2px rgba(6,182,212,0.5), 0 0 16px 4px rgba(6,182,212,0.25); }
          50% { box-shadow: 0 0 0 3px rgba(6,182,212,0.7), 0 0 24px 8px rgba(6,182,212,0.4); }
        }
        .qa-free-kick-pulse {
          animation: qa-free-kick-pulse-glow 1.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
