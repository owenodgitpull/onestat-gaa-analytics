import { useEffect, useState, useRef, useMemo } from 'react'
import GAAPitch from '@/components/GAAPitch'
import BallCarrierPicker from '@/components/BallCarrierPicker'
import PitchReceiverDots from '@/components/PitchReceiverDots'
import BallQuickActionIcon from '@/components/video/BallQuickActionIcon'
import CategorizedActionButtons from '@/components/CategorizedActionButtons'
import TacticalTagButton from '@/components/TacticalTagButton'
import FormationSnapshotButton from '@/components/FormationSnapshotButton'
import { BallPosition, PossessionTeam, EventType } from '@/types'
import { Clock, Minimize2, ArrowLeftRight, Pause, Play, CircleSlash, Plus, Minus, RotateCw, Zap } from 'lucide-react'
import { BroughtForwardOptIn, HighBallChips, type BroughtForwardReason } from './video/VideoPitchPrompts'
import BlackCardTimer, { type BlackCardEntry } from '@/components/BlackCardTimer'
import PitchActionOverlay from '@/components/PitchActionOverlay'
import JerseyNumberStrip, { getPositionLine, type JerseyPlayer } from '@/components/JerseyNumberStrip'
import CarrierSideColumn from '@/components/CarrierSideColumn'
import OppositionScorerStrip from '@/components/OppositionScorerStrip'
import NetworkStatusIndicator from '@/components/NetworkStatusIndicator'
import { useClubName } from '@/contexts/ClubContext'

interface FullscreenPitchModeProps {
  isOpen: boolean
  onClose: () => void
  ballPosition: BallPosition
  onBallMove: (position: BallPosition) => void
  readonly?: boolean
  trail?: Array<{ x: number; y: number }>
  onTrailUpdate?: (trail: Array<{ x: number; y: number }>) => void
  onDragPath?: (waypoints: Array<{ x: number; y: number }>) => void
  matchPhase: string
  minute: number
  /** Configured half length — the injury-time banner and auto-freeze both key off this, not a hardcoded 30. */
  halfDurationMins?: number
  seconds: number
  teamGoals: number
  teamPoints: number
  opponentGoals: number
  opponentPoints: number
  opponent: string
  matchStats?: {
    possession: { team: number; opponent: number }
    shots: { team: number; opponent: number }
    scores: { team: number; opponent: number }
    wides: { team: number; opponent: number }
    accuracy: { team: string; opponent: string }
    conversion: { team: string; opponent: string }
    turnovers: { team: number; opponent: number }
    kickouts: { team: string; opponent: string }
    kickoutRetention: { team: string; opponent: string }
  } | null
  latestEventDescription?: string
  // Action handling — same as CategorizedActionButtons
  onActionSelect: (eventType: EventType) => void
  onFoulClick?: (team: 'own' | 'opponent') => void
  on45Click?: () => void
  onDiscipline?: (eventType: EventType) => void
  currentPossession: PossessionTeam
  isIn2PointZone: boolean
  isInPenaltyArea: boolean
  pendingFreeKick: boolean
  pendingFoul: 'own' | 'opponent' | null
  pendingBlockRecovery?: boolean
  onBlockRecovery?: (weRecovered: boolean) => void
  onBlockResultSideline?: () => void
  onBlockResultFortyFive?: () => void
  pendingSidelineDecision?: boolean
  onSidelineDecision?: (weWonIt: boolean) => void
  pending45: boolean
  pendingKickoutPosition: boolean
  pendingKickoutEventType?: string
  pendingKickoutTargetPlayerId?: string
  /** True while the pending kickout is specifically "went out over the sideline" */
  highlightSidelines?: boolean
  /** Pitch-% x of the 45m line to highlight, or null when no 45 is pending — see GAAPitch */
  highlight45LineX?: number | null
  /** True once "45 Scored"/"45 Missed" has been picked and we're waiting on a tap for the line position */
  pendingFortyFivePosition?: boolean
  onCancelFortyFivePosition?: () => void
  onSelectKickoutTarget?: (playerId: string) => void
  onCancelFree?: () => void
  onCancel45?: () => void
  onCancelKickout?: () => void
  isAdjustingFreePosition?: boolean
  onAdjustFreePosition?: () => void
  onDoneAdjustingFreePosition?: () => void
  /** Optional reason the ref brought the free forward (chosen while adjusting its spot) */
  broughtForwardReason?: BroughtForwardReason | null
  onBroughtForwardReason?: (r: BroughtForwardReason | null) => void
  /** High ball clean / break chips (optional, fade after a few seconds) */
  showHighBallChips?: boolean
  onHighBallContact?: (contact: 'clean' | 'break' | null) => void
  activeCategory?: string | null
  onCategoryChange?: (cat: string | null) => void
  awaitingKickout?: boolean
  /** Owned by MatchRecording.tsx, not local state here — so minimising
   *  survives opening/closing fullscreen and both views always agree. */
  kickoutBannerMinimised?: boolean
  onMinimizeKickout?: () => void
  onRestoreKickout?: () => void
  teamAttackingRight: boolean
  statusText: string
  statusAccent: string
  onSwapPossession?: () => void
  onManualEntry?: () => void
  selectingFoulPlayer?: boolean
  onStartSecondHalf?: () => void
  onEndFirstHalf?: () => void
  onEndMatch?: () => void
  fullTimeReached?: boolean
  blackCardTimers?: BlackCardEntry[]
  onRemoveBlackCard?: (id: string) => void
  jerseyStripPlayers?: Array<{ playerId: string; jerseyNumber: number | null; playerName: string; isOnField: boolean; positionLabel?: string; positionId?: string }>
  activeCarrierId?: string | null
  onCarrierSelect?: (playerId: string, jerseyNumber: number | null) => void
  /** Players recently on the ball — passed through to BallCarrierPicker /
   * PitchReceiverDots (recency bias) and used to group the side columns. */
  recentCarrierIds?: string[]
  carrierJerseyNumber?: number | null
  isStopped?: boolean
  onToggleStoppage?: () => void
  isDeadBall?: boolean
  onToggleDeadBall?: () => void
  onSubstitution?: () => void
  teamPrimaryColor?: string
  teamSecondaryColor?: string
  // Opposition scorer
  pendingOpponentScore?: { eventType: EventType; position: BallPosition } | null
  oppositionRoster?: string[]
  onOpponentScorerSelect?: (name: string, foot?: 'L' | 'R') => void
  onOpponentScorerSkip?: () => void
  // Opposition turnover-forced-from — same banner, 'turnover_forced' mode
  pendingTurnoverForcedFrom?: boolean
  onTurnoverForcedFromSelect?: (name?: string) => void
  // High Ball + opposition Pass — same ball-anchored icons normal mode has,
  // previously missing here entirely since this component owns its own
  // separate <GAAPitch> render rather than sharing MatchRecording.tsx's.
  pendingLongKickArmed?: boolean
  onToggleLongKickArm?: () => void
  /** Long Kick Pass (LK) icon — the direct-kick counterpart to High Ball */
  pendingLongKickPassArmed?: boolean
  onToggleLongKickPassArm?: () => void
  oppPassCount?: number
  onLogOppositionPass?: () => void
  // Press Trigger, Tactical Tag, Formation Snapshot — same toolbar buttons
  // non-fullscreen mode has, previously missing here entirely (fullscreen's
  // top bar is a separate row from normal mode's, built independently).
  pressTriggerActive?: boolean
  onTogglePressTrigger?: () => void
  tacticalTagCount?: number
  onTacticalTag?: (tagType: string, label?: string) => void
  onOpenSnapshot?: () => void
  shouldPulseSnapshot?: boolean
  snapshotCount?: number
}

export default function FullscreenPitchMode({
  isOpen,
  onClose,
  ballPosition,
  onBallMove,
  readonly = false,
  trail,
  onTrailUpdate,
  onDragPath,
  matchPhase,
  minute,
  halfDurationMins = 30,
  seconds,
  teamGoals,
  teamPoints,
  opponentGoals,
  opponentPoints,
  opponent,
  matchStats,
  latestEventDescription,
  onActionSelect,
  onFoulClick,
  on45Click,
  onDiscipline,
  currentPossession,
  isIn2PointZone,
  isInPenaltyArea,
  pendingFreeKick,
  pendingFoul,
  pendingBlockRecovery = false,
  onBlockRecovery,
  onBlockResultSideline,
  onBlockResultFortyFive,
  pendingSidelineDecision = false,
  onSidelineDecision,
  pending45,
  pendingKickoutPosition,
  pendingKickoutEventType,
  pendingKickoutTargetPlayerId,
  highlightSidelines = false,
  highlight45LineX = null,
  pendingFortyFivePosition = false,
  onCancelFortyFivePosition,
  onSelectKickoutTarget,
  awaitingKickout,
  onCancelFree,
  onCancel45,
  onCancelKickout,
  isAdjustingFreePosition = false,
  onAdjustFreePosition,
  onDoneAdjustingFreePosition,
  broughtForwardReason = null,
  onBroughtForwardReason,
  showHighBallChips = false,
  onHighBallContact,
  activeCategory,
  onCategoryChange,
  kickoutBannerMinimised = false,
  onMinimizeKickout,
  onRestoreKickout,
  teamAttackingRight,
  statusText,
  onSwapPossession,
  onManualEntry,
  onStartSecondHalf,
  onEndFirstHalf,
  onEndMatch,
  fullTimeReached = false,
  blackCardTimers = [],
  onRemoveBlackCard,
  jerseyStripPlayers = [],
  activeCarrierId = null,
  onCarrierSelect,
  recentCarrierIds = [],
  carrierJerseyNumber,
  isStopped = false,
  onToggleStoppage,
  isDeadBall = false,
  onToggleDeadBall,
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
  pendingOpponentScore,
  oppositionRoster = [],
  onOpponentScorerSelect,
  onOpponentScorerSkip,
  pendingTurnoverForcedFrom = false,
  onTurnoverForcedFromSelect,
  pendingLongKickArmed = false,
  onToggleLongKickArm,
  pendingLongKickPassArmed = false,
  onToggleLongKickPassArm,
  oppPassCount = 0,
  onLogOppositionPass,
  pressTriggerActive = false,
  onTogglePressTrigger,
  tacticalTagCount = 0,
  onTacticalTag,
  onOpenSnapshot,
  shouldPulseSnapshot = false,
  snapshotCount = 0,
}: FullscreenPitchModeProps) {
  const clubName = useClubName()
  const [toastVisible, setToastVisible] = useState(false)
  const [toastText, setToastText] = useState('')
  const [tickerIndex, setTickerIndex] = useState(0)
  const prevOverflowRef = useRef('')
  const [isPhoneLandscape, setIsPhoneLandscape] = useState(false)
  const [isCarrierRadialOpen, setIsCarrierRadialOpen] = useState(false)

  // Detect phone landscape: landscape orientation + short viewport height (phone, not tablet/desktop)
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape) and (max-height: 500px)')
    setIsPhoneLandscape(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsPhoneLandscape(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // The side carrier columns need real spare width beside a height-driven
  // 16:10 pitch — on a squarer-aspect display (iPad Pro-style ~4:3 landscape,
  // ratio ~1.33) the pitch alone already claims nearly the full width,
  // leaving the columns nowhere to go. Widescreen laptops (~16:9-16:10,
  // ratio 1.6+) have real spare width and keep the side columns. Below the
  // threshold, fall back to the same bottom-attached strip normal
  // (non-fullscreen) mode already uses.
  const [useBottomCarrierStrip, setUseBottomCarrierStrip] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-aspect-ratio: 3/2)')
    setUseBottomCarrierStrip(mq.matches)
    const handler = (e: MediaQueryListEvent) => setUseBottomCarrierStrip(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Portrait isn't supported at all — the pitch never fits into view
  // correctly. Rather than build full portrait support before release,
  // block interaction with a clear rotate prompt (+ an escape hatch back to
  // normal mode, which does support both orientations) whenever the device
  // is rotated while fullscreen is open.
  const [isPortrait, setIsPortrait] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    setIsPortrait(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsPortrait(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Lock body scroll — save and restore previous value
  useEffect(() => {
    if (isOpen) {
      prevOverflowRef.current = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prevOverflowRef.current
      }
    }
  }, [isOpen])

  // Event toast
  useEffect(() => {
    if (latestEventDescription && isOpen) {
      setToastText(latestEventDescription)
      setToastVisible(true)
      const timer = setTimeout(() => setToastVisible(false), 4000)
      return () => clearTimeout(timer)
    }
  }, [latestEventDescription, isOpen])

  // Ticker items — mirrors all stats from the normal-mode match stats table
  const tickerItems = useMemo(() => {
    if (!matchStats) return []
    return [
      { label: 'Possession', own: `${matchStats.possession.team}%`, opp: `${matchStats.possession.opponent}%` },
      { label: 'Shots', own: `${matchStats.shots.team}`, opp: `${matchStats.shots.opponent}` },
      { label: 'Scores', own: `${matchStats.scores.team}`, opp: `${matchStats.scores.opponent}` },
      { label: 'Wides', own: `${matchStats.wides.team}`, opp: `${matchStats.wides.opponent}` },
      { label: 'Accuracy', own: `${matchStats.accuracy.team}%`, opp: `${matchStats.accuracy.opponent}%` },
      { label: 'Conversion', own: `${matchStats.conversion.team}%`, opp: `${matchStats.conversion.opponent}%` },
      { label: 'Turnovers Won', own: `${matchStats.turnovers.team}`, opp: `${matchStats.turnovers.opponent}` },
      { label: 'Kickouts Won', own: matchStats.kickouts.team, opp: matchStats.kickouts.opponent },
      { label: 'K/O Retention', own: `${matchStats.kickoutRetention.team}%`, opp: `${matchStats.kickoutRetention.opponent}%` },
    ]
  }, [matchStats])

  // Rotate ticker every 3s
  useEffect(() => {
    if (!isOpen || tickerItems.length === 0) return
    const interval = setInterval(() => {
      setTickerIndex(prev => (prev + 1) % tickerItems.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [isOpen, tickerItems.length])

  // Split on-field players into the two side columns that flank the pitch:
  // left gets GK/FB/HB (lines 0-2), right gets HF/FF (lines 4-5), and MF
  // (line 3) splits one player to each side (mf-right goes right, everything
  // else in that line — mf-left or unlabelled MF — goes left) to keep both
  // columns roughly balanced.
  const { leftColumnPlayers, rightColumnPlayers } = useMemo(() => {
    const onField = (jerseyStripPlayers as JerseyPlayer[]).filter(p => p.isOnField)
    const left: JerseyPlayer[] = []
    const right: JerseyPlayer[] = []
    for (const p of onField) {
      const line = getPositionLine(p.positionId)
      if (line <= 2) left.push(p)
      else if (line >= 4) right.push(p)
      else if (p.positionId === 'mf-right') right.push(p)
      else left.push(p)
    }
    const byLineThenNumber = (a: JerseyPlayer, b: JerseyPlayer) => {
      const lineA = getPositionLine(a.positionId)
      const lineB = getPositionLine(b.positionId)
      if (lineA !== lineB) return lineA - lineB
      if (a.jerseyNumber != null && b.jerseyNumber != null) return a.jerseyNumber - b.jerseyNumber
      if (a.jerseyNumber != null) return -1
      if (b.jerseyNumber != null) return 1
      return a.playerName.localeCompare(b.playerName)
    }
    left.sort(byLineThenNumber)
    right.sort(byLineThenNumber)
    return { leftColumnPlayers: left, rightColumnPlayers: right }
  }, [jerseyStripPlayers])

  if (!isOpen) return null

  const formatTime = `${minute}:${seconds.toString().padStart(2, '0')}`
  const phaseLabel = matchPhase === 'first_half' ? '1st Half'
    : matchPhase === 'second_half' ? '2nd Half'
    : matchPhase === 'half_time' ? 'HT'
    : matchPhase === 'finished' ? 'FT'
    : 'Pre'

  const actionsDisabled = matchPhase === 'not_started' || matchPhase === 'finished'
  const currentTicker = tickerItems[tickerIndex]

  // The user must tap a landing spot (kickout / 45 line / long kick or high ball): hide the player circles and pulse the ball
  const landingTapActive = pendingKickoutPosition || pendingFortyFivePosition || pendingLongKickArmed || pendingLongKickPassArmed
  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: 'linear-gradient(160deg, #070c18 0%, #0a1024 35%, #0b1420 65%, #080c16 100%)' }}>
      {/* Top bar — hidden in phone landscape (overlaid on pitch instead) */}
      {!isPhoneLandscape && (
        <div className="flex-shrink-0 grid grid-cols-3 items-center px-3 py-2 backdrop-blur-xl bg-white/5 border-b border-white/10">
          {/* Left — Exit + Pause + Network Status */}
          <div className="flex justify-start items-center gap-1.5 flex-nowrap overflow-x-auto min-w-0 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={onClose}
              className="flex-shrink-0 p-2 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 text-white transition-all"
              title="Exit fullscreen (Esc)"
            >
              <Minimize2 size={16} />
            </button>
            {onToggleStoppage && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <button
                onClick={onToggleStoppage}
                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-semibold transition-all"
                style={{
                  background: isStopped ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.1)',
                  borderColor: isStopped ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.15)',
                  color: isStopped ? '#fbbf24' : 'rgba(255,255,255,0.7)',
                }}
                title={isStopped ? 'Resume play — clock was frozen' : 'Stoppage — freezes the clock (injury, sideline delay, etc.)'}
              >
                {isStopped ? <Play size={16} /> : <Pause size={16} />}
                <span>{isStopped ? 'Resume' : 'Stoppage'}</span>
              </button>
            )}
            {onToggleDeadBall && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <button
                onClick={onToggleDeadBall}
                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-semibold transition-all"
                style={{
                  background: isDeadBall ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.1)',
                  borderColor: isDeadBall ? 'rgba(56,189,248,0.6)' : 'rgba(255,255,255,0.15)',
                  color: isDeadBall ? '#38bdf8' : 'rgba(255,255,255,0.7)',
                }}
                title={isDeadBall ? 'Ball back in play' : 'Dead ball — clock keeps running (unlike Stoppage)'}
              >
                <CircleSlash size={16} />
                <span>{isDeadBall ? 'Ball Live' : 'Dead Ball'}</span>
              </button>
            )}
            {onTogglePressTrigger && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <button
                onClick={onTogglePressTrigger}
                disabled={!pressTriggerActive && currentPossession === PossessionTeam.OWN}
                className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-semibold transition-all ${pressTriggerActive ? 'animate-pulse' : ''}`}
                style={{
                  background: pressTriggerActive
                    ? 'rgba(249,115,22,0.3)'
                    : currentPossession === PossessionTeam.OWN ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                  borderColor: pressTriggerActive
                    ? 'rgba(249,115,22,0.6)'
                    : currentPossession === PossessionTeam.OWN ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)',
                  color: pressTriggerActive
                    ? '#fb923c'
                    : currentPossession === PossessionTeam.OWN ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.7)',
                  cursor: !pressTriggerActive && currentPossession === PossessionTeam.OWN ? 'not-allowed' : 'pointer',
                }}
                title={
                  pressTriggerActive
                    ? 'Press active — tap to end manually'
                    : currentPossession === PossessionTeam.OWN
                      ? 'Press Trigger only applies while the opposition has the ball'
                      : 'Mark the start of a high press — auto-ends on turnover won or opposition score'
                }
              >
                <Zap size={16} />
                <span>{pressTriggerActive ? 'Press Active' : 'Press Trigger'}</span>
              </button>
            )}
            {onTacticalTag && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <TacticalTagButton onTag={onTacticalTag} tagCount={tacticalTagCount} />
            )}
            {onOpenSnapshot && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <FormationSnapshotButton onClick={onOpenSnapshot} shouldPulse={shouldPulseSnapshot} snapshotCount={snapshotCount} />
            )}
            {kickoutBannerMinimised && (awaitingKickout || pendingKickoutPosition) && onRestoreKickout && (
              <button
                onClick={onRestoreKickout}
                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-200 hover:bg-amber-500/30 text-xs font-semibold transition-all animate-fade-in"
                title="Resume the kickout prompt"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                <span>Kickout pending</span>
              </button>
            )}
            {onSwapPossession && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <button
                onClick={onSwapPossession}
                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 text-white/70 hover:text-white text-xs font-semibold transition-all"
                title="Swap possession — flip which team has the ball"
              >
                <ArrowLeftRight size={16} />
                <span>Possession</span>
              </button>
            )}
            {onManualEntry && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <button
                onClick={onManualEntry}
                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 text-white/70 hover:text-white text-xs font-semibold transition-all"
                title="Manual Event Entry — log something not covered by the quick-action buttons"
              >
                <Plus size={16} />
                <span>Event</span>
              </button>
            )}
            <NetworkStatusIndicator compact />
          </div>

          {/* Center — Score + Timer */}
          <div className="flex items-center justify-center gap-4">
            <div className="text-right">
              <span className="text-xl font-black text-white tracking-tight">
                {teamGoals}-{String(teamPoints).padStart(2, '0')}
              </span>
              <div className="text-[9px] text-white/50">{clubName}</div>
            </div>
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-1 bg-white/10 rounded-lg px-2.5 py-0.5 border border-white/15">
                <Clock size={11} className="text-emerald-400" />
                <span className="font-mono text-sm font-bold text-white">{formatTime}</span>
              </div>
              <span className="text-[8px] font-semibold text-emerald-400/80 mt-0.5">{phaseLabel}</span>
            </div>
            <div className="text-left">
              <span className="text-xl font-black text-white/70 tracking-tight">
                {opponentGoals}-{String(opponentPoints).padStart(2, '0')}
              </span>
              <div className="text-[9px] text-white/50">{opponent}</div>
            </div>
          </div>

          {/* Right — Rotating stat ticker */}
          <div className="flex justify-end">
            <div className="min-w-[100px] text-center">
              {currentTicker ? (
                <div key={tickerIndex} className="animate-[fadeSlideIn_0.4s_ease-out]">
                  <div className="text-[8px] font-medium text-white/40 uppercase tracking-wider">{currentTicker.label}</div>
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="text-sm font-bold text-white">{currentTicker.own}</span>
                    <span className="text-white/30 text-[9px]">-</span>
                    <span className="text-sm font-bold text-white/60">{currentTicker.opp}</span>
                  </div>
                </div>
              ) : (
                <div className="text-[9px] text-white/30">--</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Half Time banner — hidden in phone landscape */}
      {!isPhoneLandscape && matchPhase === 'half_time' && (
        <div className="flex-shrink-0 backdrop-blur-xl bg-white/5 border-b border-emerald-500/20 px-4 py-2.5 flex items-center justify-center gap-4">
          <Clock size={14} className="text-emerald-400" />
          <span className="text-sm font-medium text-white/90">Half Time</span>
          {onStartSecondHalf && (
            <button
              onClick={onStartSecondHalf}
              className="px-4 py-1.5 rounded-xl backdrop-blur-xl bg-white/10 border border-emerald-500/40 text-emerald-300 text-sm font-semibold hover:bg-white/20 transition-all"
            >
              Start Second Half
            </button>
          )}
        </div>
      )}

      {/* Injury time — hidden in phone landscape (compact stand-in above).
          Keyed off the match's actual configured half length, not a
          hardcoded 30 — a club running shorter halves (e.g. underage, or a
          quick tutorial-recording test) would have the clock auto-freeze at
          their real half_duration_mins while this banner never appeared
          (still waiting for minute 30), leaving the freeze with no visible
          explanation at all. */}
      {!isPhoneLandscape && matchPhase === 'first_half' && minute >= halfDurationMins && (
        <div className="flex-shrink-0 backdrop-blur-xl bg-white/5 border-b border-amber-500/20 px-4 py-2.5 flex items-center justify-center gap-4">
          <Clock size={14} className="text-amber-400" />
          <span className="text-sm font-medium text-white/90">Injury time</span>
          {onEndFirstHalf && (
            <button
              onClick={onEndFirstHalf}
              className="px-4 py-1.5 rounded-xl backdrop-blur-xl bg-white/10 border border-amber-500/40 text-amber-300 text-sm font-semibold hover:bg-white/20 transition-all"
            >
              End First Half (HT)
            </button>
          )}
        </div>
      )}

      {/* Full time reached — hidden in phone landscape */}
      {!isPhoneLandscape && matchPhase === 'second_half' && fullTimeReached && (
        <div className="flex-shrink-0 backdrop-blur-xl bg-white/5 border-b border-emerald-500/20 px-4 py-2.5 flex items-center justify-center gap-4">
          <Clock size={14} className="text-emerald-400" />
          <span className="text-sm font-medium text-white/90">Full time</span>
          {onEndMatch && (
            <button
              onClick={onEndMatch}
              className="px-4 py-1.5 rounded-xl backdrop-blur-xl bg-white/10 border border-emerald-500/40 text-emerald-300 text-sm font-semibold hover:bg-white/20 transition-all"
            >
              End Match (FT)
            </button>
          )}
        </div>
      )}

      {/* Stoppage banner — hidden in phone landscape */}
      {!isPhoneLandscape && isStopped && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
        <div className="flex-shrink-0 backdrop-blur-xl bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center justify-center gap-3">
          <Pause size={14} className="text-amber-400" />
          <span className="text-sm font-semibold text-amber-300">Stoppage — timer paused</span>
          {onToggleStoppage && (
            <button
              onClick={onToggleStoppage}
              className="px-4 py-1.5 rounded-xl backdrop-blur-xl bg-white/10 border border-emerald-500/40 text-emerald-300 text-sm font-semibold hover:bg-white/20 transition-all flex items-center gap-1.5"
            >
              <Play size={14} /> Resume
            </button>
          )}
        </div>
      )}

      {/* Dead ball banner — hidden in phone landscape */}
      {!isPhoneLandscape && isDeadBall && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
        <div className="flex-shrink-0 backdrop-blur-xl bg-sky-500/10 border-b border-sky-500/30 px-4 py-2 flex items-center justify-center gap-3">
          <CircleSlash size={14} className="text-sky-400" />
          <span className="text-sm font-semibold text-sky-300">Dead ball — clock still running</span>
          {onToggleDeadBall && (
            <button
              onClick={onToggleDeadBall}
              className="px-4 py-1.5 rounded-xl backdrop-blur-xl bg-white/10 border border-emerald-500/40 text-emerald-300 text-sm font-semibold hover:bg-white/20 transition-all"
            >
              Back in play
            </button>
          )}
        </div>
      )}

      {/* Black card sin bin timers — hidden in phone landscape */}
      {!isPhoneLandscape && blackCardTimers.length > 0 && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-1 bg-slate-900/50 border-b border-white/5">
          <BlackCardTimer entries={blackCardTimers} onRemove={(id) => onRemoveBlackCard?.(id)} />
        </div>
      )}

      {/* Pitch — fills all remaining space (in landscape, controls overlay on pitch).
          The two carrier side columns are flex siblings of the pitch's own
          relative wrapper below, so the pitch shrinks to make room for them
          in what was previously empty gutter space, while everything that
          overlays the pitch itself (kickout/free banners, toast, etc.) stays
          scoped to that inner wrapper and keeps aligning to the pitch only —
          not the full width including the side columns. */}
      <div className="flex-1 relative overflow-hidden min-h-0 flex items-center justify-center gap-3 px-1.5">
        {!useBottomCarrierStrip && !pendingOpponentScore && !pendingTurnoverForcedFrom && !isPhoneLandscape && !actionsDisabled && onCarrierSelect && leftColumnPlayers.length > 0 && (
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-[9px] text-white/40 font-semibold uppercase tracking-wider">Carrier</span>
            <CarrierSideColumn
              players={leftColumnPlayers}
              activeCarrierId={activeCarrierId}
              onCarrierSelect={onCarrierSelect}
              disabled={actionsDisabled}
              teamPrimaryColor={teamPrimaryColor}
              teamSecondaryColor={teamSecondaryColor}
            />
          </div>
        )}

        {/* Sized to exactly match the pitch's own rendered box (same
            aspect-[16/10] the pitch uses, computed from height) rather than
            flex-1 — flex-1 let this wrapper claim all leftover row width and
            then centered the (narrower) pitch inside itself, leaving a gap
            between the pitch's actual edge and the carrier columns sitting
            at the wrapper's outer edge instead of the pitch's. Now this
            wrapper's boundary IS the pitch's edge, so `gap-3` above is the
            true, exact distance from pitch to carriers. */}
        <div className="relative h-full aspect-[16/10] flex items-center justify-center">
        {/* Phone landscape: floating scoreboard overlay on pitch */}
        {isPhoneLandscape && (
          <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 backdrop-blur-xl bg-black/60 border border-white/15 rounded-xl px-3 py-1">
            <button
              onClick={onClose}
              className="p-1 rounded-lg bg-white/10 text-white"
              title="Exit fullscreen (Esc)"
            >
              <Minimize2 size={12} />
            </button>
            <span className="text-sm font-black text-white">{teamGoals}-{String(teamPoints).padStart(2, '0')}</span>
            <div className="flex items-center gap-1 bg-white/10 rounded px-1.5 py-0.5">
              <Clock size={9} className="text-emerald-400" />
              <span className="font-mono text-xs font-bold text-white">{formatTime}</span>
            </div>
            <span className="text-sm font-black text-white/70">{opponentGoals}-{String(opponentPoints).padStart(2, '0')}</span>
            {/* Compact stand-in for the full-width Stoppage/Injury-time
                banners below, which are hidden in this narrow layout —phone
                landscape was otherwise the one mode where the clock could
                silently auto-freeze at half time with zero explanation,
                reading exactly like an accidental Stoppage tap. */}
            {isStopped && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <div className="flex items-center gap-1 bg-amber-500/25 border border-amber-400/40 rounded px-1.5 py-0.5" title="Timer paused — tap Stoppage to resume, or Half Time if the half is over">
                <Pause size={9} className="text-amber-300" />
                <span className="text-[10px] font-bold text-amber-200">Paused</span>
              </div>
            )}
            {!isStopped && matchPhase === 'first_half' && minute >= halfDurationMins && (
              <span className="text-[10px] font-bold text-amber-300 whitespace-nowrap">Injury time</span>
            )}
            <NetworkStatusIndicator compact />
          </div>
        )}
        <GAAPitch
          ballPosition={ballPosition}
          onBallMove={onBallMove}
          showZones={true}
          readonly={readonly}
          containerClassName="w-full h-full"
          gradientBorder
          trail={trail}
          onTrailUpdate={onTrailUpdate}
          onDragPath={onDragPath}
          carrierJerseyNumber={carrierJerseyNumber}
          highlightSidelines={highlightSidelines}
          highlight45LineX={highlight45LineX}
          pulseBall={landingTapActive}
          ballAnchoredOverlay={
            (ballSvgX, ballSvgY, ballPctX, ballPctY) => (
              <>
                {(matchPhase === 'first_half' || matchPhase === 'second_half') && !awaitingKickout && !pendingFreeKick && !landingTapActive && jerseyStripPlayers && onCarrierSelect && currentPossession === PossessionTeam.OWN && (
                  <BallCarrierPicker
                    players={jerseyStripPlayers}
                    activeCarrierId={activeCarrierId ?? null}
                    onSelect={onCarrierSelect}
                    attackingRight={teamAttackingRight}
                    teamPrimaryColor={teamPrimaryColor}
                    teamSecondaryColor={teamSecondaryColor}
                    ballSvgX={ballSvgX}
                    ballSvgY={ballSvgY}
                    ballPctX={ballPctX}
                    ballPctY={ballPctY}
                    recentCarrierIds={recentCarrierIds}
                    onOpenChange={setIsCarrierRadialOpen}
                  />
                )}
                {(matchPhase === 'first_half' || matchPhase === 'second_half') && currentPossession !== PossessionTeam.OWN && onLogOppositionPass && (
                  <BallQuickActionIcon
                    ballSvgX={ballSvgX}
                    ballSvgY={ballSvgY}
                    angleDeg={-45}
                    label="P"
                    title="Log Pass (Opposition)"
                    color="#0891b2"
                    onTap={onLogOppositionPass}
                    count={oppPassCount}
                    disabled={
                      isStopped || isDeadBall || awaitingKickout ||
                      pendingFreeKick || pending45 || pendingFortyFivePosition || pendingKickoutPosition ||
                      pendingBlockRecovery || pendingSidelineDecision
                    }
                  />
                )}
                {(matchPhase === 'first_half' || matchPhase === 'second_half') && onToggleLongKickPassArm && (
                  <BallQuickActionIcon
                    ballSvgX={ballSvgX}
                    ballSvgY={ballSvgY}
                    angleDeg={-135}
                    label="LK"
                    title="Log Long Kick Pass"
                    color="#0d9488"
                    onTap={onToggleLongKickPassArm}
                    armed={pendingLongKickPassArmed}
                    disabled={
                      isStopped || isDeadBall || awaitingKickout ||
                      pendingFreeKick || pending45 || pendingFortyFivePosition || pendingKickoutPosition ||
                      pendingBlockRecovery || pendingSidelineDecision
                    }
                  />
                )}
                {(matchPhase === 'first_half' || matchPhase === 'second_half') && onToggleLongKickArm && (
                  <BallQuickActionIcon
                    ballSvgX={ballSvgX}
                    ballSvgY={ballSvgY}
                    angleDeg={-90}
                    label="HB"
                    title="Log High Ball"
                    color="#d97706"
                    onTap={onToggleLongKickArm}
                    armed={pendingLongKickArmed}
                    disabled={
                      isStopped || isDeadBall || awaitingKickout ||
                      pendingFreeKick || pending45 || pendingFortyFivePosition || pendingKickoutPosition ||
                      pendingBlockRecovery || pendingSidelineDecision
                    }
                  />
                )}
              </>
            )
          }
          pitchOverlay={
            (matchPhase === 'first_half' || matchPhase === 'second_half') && !awaitingKickout && !pendingFreeKick && !landingTapActive && jerseyStripPlayers && onCarrierSelect && currentPossession === PossessionTeam.OWN
              ? (ballPctX, ballPctY) => (
                <PitchReceiverDots
                  players={jerseyStripPlayers}
                  activeCarrierId={activeCarrierId ?? null}
                  onSelect={onCarrierSelect}
                  attackingRight={teamAttackingRight}
                  teamPrimaryColor={teamPrimaryColor}
                  teamSecondaryColor={teamSecondaryColor}
                  disabled={isCarrierRadialOpen}
                  ballPctX={ballPctX}
                  ballPctY={ballPctY}
                  recentCarrierIds={recentCarrierIds}
                />
              )
              : undefined
          }
          svgOverlay={
            (matchPhase === 'first_half' || matchPhase === 'second_half' || matchPhase === 'half_time') ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 22px',
                  borderRadius: 16,
                  background: 'rgba(0,0,0,0.75)',
                  border: `2px solid ${currentPossession === PossessionTeam.OWN ? 'rgba(16,185,129,0.5)' : 'rgba(249,115,22,0.4)'}`,
                }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: currentPossession === PossessionTeam.OWN ? '#34d399' : '#fb923c',
                  }} />
                  <span style={{
                    fontSize: 32, fontWeight: 700, whiteSpace: 'nowrap',
                    color: currentPossession === PossessionTeam.OWN ? '#6ee7b7' : '#fdba74',
                  }}>
                    {statusText}
                  </span>
                </div>
              </div>
            ) : undefined
          }
        />

        {/* Action-required overlay — kickout & free kick */}
        <PitchActionOverlay
          awaitingKickout={!!awaitingKickout && !pendingKickoutPosition && !kickoutBannerMinimised}
          pendingFreeKick={pendingFreeKick && !isAdjustingFreePosition}
          pendingFoul={pendingFoul}
          kickoutTab={activeCategory ?? null}
          isIn2PointZone={isIn2PointZone}
          onAction={onActionSelect}
          onCancelFree={onCancelFree ?? (() => {})}
          onCancelKickout={onCancelKickout ?? (() => {})}
          onAdjustFreePosition={onAdjustFreePosition}
          onMinimize={onMinimizeKickout}
        />

        {/* Opposition scorer selector — centered overlay, same treatment as the
            kickout/free-kick modal above, since this also blocks the flow until resolved */}
        {pendingOpponentScore && onOpponentScorerSelect && onOpponentScorerSkip && (
          <OppositionScorerStrip
            players={oppositionRoster}
            onSelect={onOpponentScorerSelect}
            onSkip={onOpponentScorerSkip}
            eventType={String(pendingOpponentScore.eventType).toLowerCase()}
          />
        )}

        {/* Opposition turnover-forced-from selector — same overlay,
            'turnover_forced' mode (no footedness step). */}
        {pendingTurnoverForcedFrom && onTurnoverForcedFromSelect && (
          <OppositionScorerStrip
            players={oppositionRoster}
            onSelect={(name) => onTurnoverForcedFromSelect(name)}
            onSkip={() => onTurnoverForcedFromSelect(undefined)}
            eventType="turnover_won"
            mode="turnover_forced"
          />
        )}

        {showHighBallChips && onHighBallContact && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
            <HighBallChips onPick={onHighBallContact} onDismiss={() => onHighBallContact(null)} />
          </div>
        )}

        {/* Adjust Free Position mode — overlay hidden, pitch is draggable */}
        {pendingFreeKick && isAdjustingFreePosition && (
          <div className="absolute inset-x-3 top-3 z-20 animate-fade-in">
            <div
              className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5"
              style={{
                background: 'linear-gradient(90deg, rgba(6,182,212,0.25), rgba(59,130,246,0.12))',
                border: '1px solid rgba(6,182,212,0.4)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
              }}
            >
              <span className="text-cyan-200 text-sm font-semibold">Drag the ball to the free's real spot</span>
              <button
                onClick={onDoneAdjustingFreePosition}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-cyan-500/25 border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/35 transition-colors flex-shrink-0"
              >
                Done
              </button>
            </div>
            {onBroughtForwardReason && (
              <div className="mt-1.5">
                <BroughtForwardOptIn reason={broughtForwardReason} onChange={onBroughtForwardReason} />
              </div>
            )}
          </div>
        )}

        {/* Kickout landing strip — floats at bottom of pitch normally, but a
            sideline kickout needs the touchline itself tappable, which this
            banner would otherwise sit right on top of — moved to the top
            for that case (same slot the free-kick-adjust banner uses). */}
        {pendingKickoutPosition && !kickoutBannerMinimised && (
          <div className={`absolute inset-x-3 z-20 animate-fade-in space-y-1.5 ${highlightSidelines ? 'top-3' : 'bottom-3'}`}>
            <div
              className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5"
              style={{
                background: 'linear-gradient(90deg, rgba(245,158,11,0.22), rgba(234,179,8,0.10))',
                border: '1px solid rgba(245,158,11,0.38)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                <span className="text-amber-200 text-sm font-bold">Tap landing position</span>
                <span className="text-amber-300/60 text-xs hidden sm:block">tap the pitch to mark where the ball lands</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {onMinimizeKickout && (
                  <button
                    onClick={onMinimizeKickout}
                    title="Minimise — log a sub, card, or correction first"
                    className="text-amber-400/60 hover:text-amber-300 p-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
                  >
                    <Minus size={13} />
                  </button>
                )}
                {onCancelKickout && (
                  <button
                    onClick={onCancelKickout}
                    className="text-amber-400/60 hover:text-amber-300 text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
            {/* Optional "aimed for" jersey tap — own kickouts only. Purely
                additive: tapping the pitch above always completes the
                kickout regardless of whether a target was tapped here. */}
            {String(pendingKickoutEventType || '').toLowerCase().startsWith('own_kickout') && onSelectKickoutTarget && jerseyStripPlayers.filter(p => p.isOnField).length > 0 && (
              <div
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 overflow-x-auto no-scrollbar"
                style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
              >
                <span className="text-white/40 text-[10px] font-semibold flex-shrink-0 pr-0.5">Aimed for (optional):</span>
                {jerseyStripPlayers.filter(p => p.isOnField).sort((a, b) => (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99)).map(p => (
                  <button
                    key={p.playerId}
                    onClick={() => onSelectKickoutTarget(p.playerId)}
                    className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                      pendingKickoutTargetPlayerId === p.playerId
                        ? 'bg-amber-400 text-black scale-110'
                        : 'bg-white/10 text-white/60 hover:bg-white/20'
                    }`}
                  >
                    {p.jerseyNumber ?? '?'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 45 line strip — same slot/style as the kickout landing strip
            above (only one of the two is ever pending at once). Outcome
            (Scored/Missed) is already picked; this is purely "where on the
            45m line", which GAAPitch highlights for exactly this reason. */}
        {pendingFortyFivePosition && (
          <div className="absolute inset-x-3 bottom-3 z-20 animate-fade-in">
            <div
              className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5"
              style={{
                background: 'linear-gradient(90deg, rgba(245,158,11,0.22), rgba(234,179,8,0.10))',
                border: '1px solid rgba(245,158,11,0.38)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                <span className="text-amber-200 text-sm font-bold">Tap the 45m line</span>
                <span className="text-amber-300/60 text-xs hidden sm:block">level with where it went out — left or right of the posts</span>
              </div>
              {onCancelFortyFivePosition && (
                <button
                  onClick={onCancelFortyFivePosition}
                  className="text-amber-400/60 hover:text-amber-300 text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors flex-shrink-0"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {/* Event Toast */}
        <div
          className={`absolute bottom-20 left-1/2 -translate-x-1/2 z-30 transition-all duration-500 ${
            toastVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 text-white text-sm px-4 py-2 rounded-2xl shadow-xl max-w-md text-center">
            {toastText}
          </div>
        </div>

        {/* Narrow-aspect fallback: bottom-attached carrier strip, same
            treatment as normal (non-fullscreen) mode, for displays too
            square (e.g. iPad Pro landscape) for the side columns to fit
            beside a height-driven pitch. Suppressed while the kickout-
            landing banner is showing, same reasoning as normal mode: at
            that point you're tapping a landing spot, not picking a carrier. */}
        {useBottomCarrierStrip && !pendingOpponentScore && !pendingTurnoverForcedFrom && !isPhoneLandscape && !actionsDisabled && onCarrierSelect &&
          jerseyStripPlayers.length > 0 && !(pendingKickoutPosition && !kickoutBannerMinimised) && (
          <div className="absolute bottom-2 left-2 right-2 z-10">
            <div className="text-center text-[9px] text-white/40 font-semibold uppercase tracking-wider mb-1">
              Switch Carrier
            </div>
            <JerseyNumberStrip
              players={jerseyStripPlayers}
              activeCarrierId={activeCarrierId ?? null}
              currentPossession={currentPossession}
              onCarrierSelect={onCarrierSelect}
              teamPrimaryColor={teamPrimaryColor}
              teamSecondaryColor={teamSecondaryColor}
              attackingRight={teamAttackingRight}
            />
          </div>
        )}
        </div>

        {!useBottomCarrierStrip && !pendingOpponentScore && !pendingTurnoverForcedFrom && !isPhoneLandscape && !actionsDisabled && onCarrierSelect && rightColumnPlayers.length > 0 && (
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-[9px] text-white/40 font-semibold uppercase tracking-wider">Carrier</span>
            <CarrierSideColumn
              players={rightColumnPlayers}
              activeCarrierId={activeCarrierId}
              onCarrierSelect={onCarrierSelect}
              disabled={actionsDisabled}
              teamPrimaryColor={teamPrimaryColor}
              teamSecondaryColor={teamSecondaryColor}
            />
          </div>
        )}
      </div>

      {/* Bottom — CategorizedActionButtons (same layout in both orientations) */}
      <div className="flex-shrink-0 backdrop-blur-xl bg-white/5 border-t border-white/10 px-3 py-2">
        <div className="max-w-3xl mx-auto">
          <CategorizedActionButtons
            onActionSelect={onActionSelect}
            onFoulClick={onFoulClick}
            on45Click={on45Click}
            onDiscipline={onDiscipline}
            disabled={actionsDisabled}
            activeCategory={activeCategory}
            onCategoryChange={onCategoryChange}
            currentPossession={currentPossession}
            isIn2PointZone={isIn2PointZone}
            isInPenaltyArea={isInPenaltyArea}
            pendingFreeKick={false}
            pendingFoul={pendingFoul}
            pendingBlockRecovery={pendingBlockRecovery}
            onBlockRecovery={onBlockRecovery}
            onBlockResultSideline={onBlockResultSideline}
            onBlockResultFortyFive={onBlockResultFortyFive}
            pendingSidelineDecision={pendingSidelineDecision}
            onSidelineDecision={onSidelineDecision}
            pending45={pending45}
            pendingKickoutPosition={pendingKickoutPosition}
            pendingFortyFivePosition={pendingFortyFivePosition}
            awaitingKickout={awaitingKickout && !kickoutBannerMinimised}
            onCancelFree={onCancelFree}
            onCancel45={onCancel45}
            onCancelKickout={onCancelKickout}
            onCancelFortyFivePosition={onCancelFortyFivePosition}
          />
        </div>
      </div>

      {isPortrait && (
        <div
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 px-8 text-center"
          style={{ background: 'rgba(7,12,24,0.97)', backdropFilter: 'blur(8px)' }}
        >
          <RotateCw size={48} className="text-emerald-400 animate-pulse" />
          <div>
            <h2 className="text-xl font-bold text-white mb-2">Rotate your device</h2>
            <p className="text-sm text-white/60 max-w-xs">
              Fullscreen mode needs landscape orientation to show the pitch properly.
            </p>
          </div>
          <button
            onClick={onClose}
            className="mt-2 px-5 py-2.5 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 text-white text-sm font-semibold transition-all"
          >
            Exit Fullscreen
          </button>
        </div>
      )}

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
