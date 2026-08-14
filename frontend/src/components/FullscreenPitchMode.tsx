import { useEffect, useState, useRef, useMemo } from 'react'
import GAAPitch from '@/components/GAAPitch'
import CategorizedActionButtons from '@/components/CategorizedActionButtons'
import { BallPosition, PossessionTeam, EventType } from '@/types'
import { Clock, Minimize2, ArrowLeftRight, Pause, Play, ArrowUpDown, CircleSlash } from 'lucide-react'
import BlackCardTimer, { type BlackCardEntry } from '@/components/BlackCardTimer'
import PitchActionOverlay from '@/components/PitchActionOverlay'
import JerseyNumberStrip from '@/components/JerseyNumberStrip'
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
  pending45: boolean
  pendingKickoutPosition: boolean
  onCancelFree?: () => void
  onCancel45?: () => void
  onCancelKickout?: () => void
  activeCategory?: string | null
  onCategoryChange?: (cat: string | null) => void
  awaitingKickout?: boolean
  teamAttackingRight: boolean
  statusText: string
  statusAccent: string
  onSwapPossession?: () => void
  selectingFoulPlayer?: boolean
  onStartSecondHalf?: () => void
  onEndFirstHalf?: () => void
  onEndMatch?: () => void
  fullTimeReached?: boolean
  blackCardTimers?: BlackCardEntry[]
  onRemoveBlackCard?: (id: string) => void
  jerseyStripPlayers?: Array<{ playerId: string; jerseyNumber: number | null; playerName: string; isOnField: boolean; positionLabel?: string }>
  activeCarrierId?: string | null
  onCarrierSelect?: (playerId: string, jerseyNumber: number | null) => void
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
  onOpponentScorerSelect?: (name: string) => void
  onOpponentScorerSkip?: () => void
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
  pending45,
  pendingKickoutPosition,
  awaitingKickout,
  onCancelFree,
  onCancel45,
  onCancelKickout,
  activeCategory,
  onCategoryChange,
  teamAttackingRight,
  statusText,
  onSwapPossession,
  onStartSecondHalf,
  onEndFirstHalf,
  onEndMatch,
  fullTimeReached = false,
  blackCardTimers = [],
  onRemoveBlackCard,
  jerseyStripPlayers = [],
  activeCarrierId = null,
  onCarrierSelect,
  carrierJerseyNumber,
  isStopped = false,
  onToggleStoppage,
  isDeadBall = false,
  onToggleDeadBall,
  onSubstitution,
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
  pendingOpponentScore,
  oppositionRoster = [],
  onOpponentScorerSelect,
  onOpponentScorerSkip,
}: FullscreenPitchModeProps) {
  const clubName = useClubName()
  const [toastVisible, setToastVisible] = useState(false)
  const [toastText, setToastText] = useState('')
  const [tickerIndex, setTickerIndex] = useState(0)
  const prevOverflowRef = useRef('')
  const [isPhoneLandscape, setIsPhoneLandscape] = useState(false)

  // Detect phone landscape: landscape orientation + short viewport height (phone, not tablet/desktop)
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape) and (max-height: 500px)')
    setIsPhoneLandscape(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsPhoneLandscape(e.matches)
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

  if (!isOpen) return null

  const formatTime = `${minute}:${seconds.toString().padStart(2, '0')}`
  const phaseLabel = matchPhase === 'first_half' ? '1st Half'
    : matchPhase === 'second_half' ? '2nd Half'
    : matchPhase === 'half_time' ? 'HT'
    : matchPhase === 'finished' ? 'FT'
    : 'Pre'

  const actionsDisabled = matchPhase === 'not_started' || matchPhase === 'finished'
  const currentTicker = tickerItems[tickerIndex]

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: 'linear-gradient(160deg, #070c18 0%, #0a1024 35%, #0b1420 65%, #080c16 100%)' }}>
      {/* Top bar — hidden in phone landscape (overlaid on pitch instead) */}
      {!isPhoneLandscape && (
        <div className="flex-shrink-0 grid grid-cols-3 items-center px-3 py-2 backdrop-blur-xl bg-white/5 border-b border-white/10">
          {/* Left — Exit + Pause + Network Status */}
          <div className="flex justify-start items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 text-white transition-all"
              title="Exit fullscreen (Esc)"
            >
              <Minimize2 size={16} />
            </button>
            {onToggleStoppage && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <button
                onClick={onToggleStoppage}
                className="p-2 rounded-xl border border-white/15 transition-all"
                style={{
                  background: isStopped ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.1)',
                  borderColor: isStopped ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.15)',
                  color: isStopped ? '#fbbf24' : 'rgba(255,255,255,0.7)',
                }}
                title={isStopped ? 'Resume play' : 'Stoppage'}
              >
                {isStopped ? <Play size={16} /> : <Pause size={16} />}
              </button>
            )}
            {onToggleDeadBall && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <button
                onClick={onToggleDeadBall}
                className="p-2 rounded-xl border border-white/15 transition-all"
                style={{
                  background: isDeadBall ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.1)',
                  borderColor: isDeadBall ? 'rgba(56,189,248,0.6)' : 'rgba(255,255,255,0.15)',
                  color: isDeadBall ? '#38bdf8' : 'rgba(255,255,255,0.7)',
                }}
                title={isDeadBall ? 'Ball back in play' : 'Dead ball — clock keeps running'}
              >
                <CircleSlash size={16} />
              </button>
            )}
            {onSwapPossession && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
              <button
                onClick={onSwapPossession}
                className="p-2 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 text-white/70 hover:text-white transition-all"
                title="Swap possession"
              >
                <ArrowLeftRight size={16} />
              </button>
            )}
            {onSubstitution && (matchPhase === 'first_half' || matchPhase === 'second_half' || matchPhase === 'half_time') && (
              <button
                onClick={onSubstitution}
                className="p-2 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 text-white/70 hover:text-white transition-all"
                title="Substitution"
              >
                <ArrowUpDown size={16} />
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

      {/* Injury time — hidden in phone landscape */}
      {!isPhoneLandscape && matchPhase === 'first_half' && minute >= 30 && (
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

      {/* Pitch — fills all remaining space (in landscape, controls overlay on pitch) */}
      <div className="flex-1 relative overflow-hidden min-h-0 flex items-center justify-center">
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
            <NetworkStatusIndicator compact />
          </div>
        )}
        <GAAPitch
          ballPosition={ballPosition}
          onBallMove={onBallMove}
          showZones={true}
          readonly={readonly}
          containerClassName="w-full max-h-full aspect-[16/10]"
          gradientBorder
          trail={trail}
          onTrailUpdate={onTrailUpdate}
          onDragPath={onDragPath}
          carrierJerseyNumber={carrierJerseyNumber}
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
          awaitingKickout={!!awaitingKickout && !pendingKickoutPosition}
          pendingFreeKick={pendingFreeKick}
          pendingFoul={pendingFoul}
          kickoutTab={activeCategory ?? null}
          isIn2PointZone={isIn2PointZone}
          onAction={onActionSelect}
          onCancelFree={onCancelFree ?? (() => {})}
          onCancelKickout={onCancelKickout ?? (() => {})}
        />

        {/* Kickout landing strip — floats at bottom of pitch, visible without blocking tap area */}
        {pendingKickoutPosition && (
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
                <span className="text-amber-200 text-sm font-bold">Tap landing position</span>
                <span className="text-amber-300/60 text-xs hidden sm:block">tap the pitch to mark where the ball lands</span>
              </div>
              {onCancelKickout && (
                <button
                  onClick={onCancelKickout}
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
      </div>

      {/* Opposition scorer strip */}
      {pendingOpponentScore && onOpponentScorerSelect && onOpponentScorerSkip && (
        <div className="flex-shrink-0 px-3 py-1">
          <OppositionScorerStrip
            players={oppositionRoster}
            onSelect={onOpponentScorerSelect}
            onSkip={onOpponentScorerSkip}
            eventType={String(pendingOpponentScore.eventType).toLowerCase()}
          />
        </div>
      )}

      {/* Jersey Number Strip — hidden when opposition scorer strip showing or phone landscape */}
      {!pendingOpponentScore && !isPhoneLandscape && jerseyStripPlayers.length > 0 && onCarrierSelect && !actionsDisabled && (
        <div className="flex-shrink-0 backdrop-blur-xl bg-white/5 border-t border-white/10 px-2 flex justify-center">
          <JerseyNumberStrip
            players={jerseyStripPlayers}
            activeCarrierId={activeCarrierId}
            currentPossession={currentPossession}
            onCarrierSelect={onCarrierSelect}
            disabled={actionsDisabled}
            teamPrimaryColor={teamPrimaryColor}
            teamSecondaryColor={teamSecondaryColor}
            attackingRight={teamAttackingRight}
          />
        </div>
      )}

      {/* Bottom — CategorizedActionButtons (same layout in both orientations) */}
      <div className="flex-shrink-0 backdrop-blur-xl bg-white/5 border-t border-white/10 px-3 py-2">
        <div className="max-w-2xl mx-auto">
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
            pending45={pending45}
            pendingKickoutPosition={pendingKickoutPosition}
            awaitingKickout={awaitingKickout}
            onCancelFree={onCancelFree}
            onCancel45={onCancel45}
            onCancelKickout={onCancelKickout}
          />
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
