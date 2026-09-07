import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { RotateCw, Clock, Trash2, X, MapPin, ArrowRight, ArrowLeft, BarChart3 } from 'lucide-react'
import GAAPitch from '@/components/GAAPitch'
import CategorizedActionButtons from '@/components/CategorizedActionButtons'
import PlayerSelectionModal from '@/components/SimplePlayerSelectionModal'
import PossessionSelectionModal from '@/components/PossessionSelectionModal'
import ConfirmationModal from '@/components/ConfirmationModal'
import ChartZoomModal from '@/components/ChartZoomModal'
import ScoringTimeline from '@/components/charts/ScoringTimeline'
import ShotOutcomeChart from '@/components/charts/ShotOutcomeChart'
import MatchKickoutZones from '@/components/charts/MatchKickoutZones'
import MatchKickoutOutcomes from '@/components/charts/MatchKickoutOutcomes'
import ScoringZoneMap from '@/components/charts/ScoringZoneMap'
import TurnoverMap from '@/components/charts/TurnoverMap'
import ScoreOrigins from '@/components/charts/ScoreOrigins'
import ScoreableFreesAnalysis from '@/components/charts/ScoreableFreesAnalysis'
import AttackEfficiencyCard from '@/components/charts/AttackEfficiencyCard'
import SeasonBenchmarkCard from '@/components/charts/SeasonBenchmarkCard'
import KickoutSequence from '@/components/charts/KickoutSequence'
import ShootingEfficiencyHeatmap from '@/components/charts/ShootingEfficiencyHeatmap'
import { BallPosition, EventType, Player, PossessionTeam } from '@/types'
import { useMatch, useMatchStats, useStartMatch, useCompleteMatch, useUpdateMatchPhase } from '@/hooks/useMatches'
import { useRecordEvent, useMatchEvents, useDeleteEvent } from '@/hooks/useMatchEvents'
import { useRecordPossession } from '@/hooks/usePossession'
import { usePlayers } from '@/hooks/usePlayers'
import { api } from '@/services/api'
import { useClubName } from '@/contexts/ClubContext'
import { getWeatherIcon, getWeatherLabel } from '@/components/WeatherPickerPopover'
import { PITCH } from '@/utils/pitchGeometry'
import {
  type TwoPointDirection,
  closeZonePath,
  arcStrokePath,
  validZonePath,
  isValidTwoPointerSpot,
} from '@/utils/twoPointZoneGeometry'

type MatchPhase = 'not_started' | 'first_half' | 'half_time' | 'second_half' | 'finished'

/** Which direction the given team is shooting, for the 2-pointer geometry above. */
function attackingDirectionFor(isHomeTeam: boolean, teamAttackingRight: boolean): TwoPointDirection {
  const attackingRight = isHomeTeam ? teamAttackingRight : !teamAttackingRight
  return attackingRight ? 'right' : 'left'
}

/**
 * Same identity-with-two-exceptions mapping MatchRecording.tsx's
 * mapEventTypeToBackend uses — every EventType value already matches the
 * backend enum string except the two "unforced_error" split types.
 */
function toBackendEventType(t: EventType): string {
  const s = String(t).toLowerCase()
  if (s === 'our_unforced_error' || s === 'opp_unforced_error') return 'unforced_error'
  return s
}

// Events where "Opposition Won"/no-player-tracked outcomes don't need a
// player selected — mirrors MatchRecording.tsx's noPlayerNeeded list.
const NO_PLAYER_NEEDED = new Set<string>([
  EventType.OWN_KICKOUT_OPPOSITION_WON,
  EventType.OPP_KICKOUT_OPPOSITION_WON,
  EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
  EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
  EventType.OWN_KICKOUT_SIDELINE,
  EventType.OPP_KICKOUT_SIDELINE,
  EventType.SIDELINE_BALL,
  EventType.OPP_UNFORCED_ERROR,
])

// Opponent scoring/shooting/defensive events — we don't track opposition
// players, so these never need a player selection either.
const OPPONENT_NO_PLAYER_EVENTS = new Set<string>([
  EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.WIDE,
  EventType.SAVED, EventType.SHORT, EventType.HIT_POST,
  EventType.INTERCEPTION, EventType.BLOCK,
])

// Every open-play shot attempt — whatever the outcome, the shooting team
// always ends up conceding the restart to the other side (a score or wide
// goes to the defending team's kickout; a save/drop-short/post is claimed
// by the defence the same way). MatchRecording.tsx's own ball-reposition
// logic auto-flips for GOAL/POINT/TWO_POINT/WIDE explicitly (its
// `scoringEvents`/`deadBallEvents` lists) and leaves SAVED/SHORT/HIT_POST
// for the coach to drag manually — Basic Mode has no drag to fall back on,
// so it applies the same real-world outcome to all seven for consistency
// rather than leaving half of them stuck on whatever possession showed
// beforehand.
//
// An unforced error belongs in the same "team just lost the ball" bucket —
// MatchRecording.tsx has its own explicit rule for this too (`// Unforced
// error — opponent gets possession`, ball forced to PossessionTeam.OPPONENT
// after OUR_UNFORCED_ERROR) that Basic Mode was missing entirely.
const SHOT_OUTCOME_EVENTS = new Set<EventType>([
  EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.WIDE,
  EventType.SAVED, EventType.SHORT, EventType.HIT_POST,
  EventType.OUR_UNFORCED_ERROR, EventType.OPP_UNFORCED_ERROR,
])

// Events that hand the ball outright to one team — auto-syncing
// currentPossession on these means the next ambiguous button tap (a plain
// Point/Wide/Goal with no team prefix) is still attributed correctly
// without the coach having to separately hit "Possession Changed" first.
//
// Deliberately NOT derived from `isHomeTeam` (event attribution — whose
// action this is credited to) — the two diverge for a couple of event
// types: a Turnover Lost is always credited to OUR player (we're tracking
// who made the error), but the ball itself goes to the OPPONENT. Same
// shape for a kickout going out over the sideline — is_home_team reflects
// whose kickout it was, but the sideline ball goes to whichever team
// DIDN'T kick out, which is the opposite team for one of the two event
// types. (MatchRecording.tsx used to get is_home_team wrong for these too
// — always false regardless of prefix — fixed 2026-09-02; this function
// stays independent of isHomeTeam regardless, since Turnover Lost/Won's
// divergence is permanent, not a bug.) Getting this backwards was a real
// bug found in testing: Turnover Lost was leaving possession with "own"
// instead of flipping it to "opponent".
function possessionOwnerAfter(eventType: EventType): 'own' | 'opponent' | null {
  switch (eventType) {
    case EventType.OWN_KICKOUT_WON:
    case EventType.OWN_KICKOUT_WON_BREAK:
    case EventType.OPP_KICKOUT_WON:
    case EventType.OPP_KICKOUT_WON_BREAK:
    case EventType.TURNOVER_WON:
    case EventType.TACKLE_WON: // same as Turnover Won — always credited to us, we now have the ball
    case EventType.OPP_KICKOUT_SIDELINE: // their kickout goes out — we take the sideline ball
      return 'own'
    case EventType.OWN_KICKOUT_OPPOSITION_WON:
    case EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK:
    case EventType.OPP_KICKOUT_OPPOSITION_WON:
    case EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK:
    case EventType.TURNOVER_LOST: // our player lost it — the OPPONENT now has the ball
    case EventType.OWN_KICKOUT_SIDELINE: // our kickout goes out — opponent takes the sideline ball
      return 'opponent'
    default:
      return null
  }
}

interface PendingLocation {
  purpose: 'action' | 'foul' | 'fortyfive'
  eventType?: EventType
  isHomeTeam?: boolean
  needsPlayer?: boolean
  foulTeam?: 'own' | 'opponent'
}

interface PendingPlayerSelection {
  eventType: EventType
  isHomeTeam: boolean
  x: number
  y: number
}

/**
 * Simple Scoring — phone-first, tap-only match recording for coaches without
 * a tablet. Instead of continuously dragging the ball, every event is: tap a
 * button -> tap the pitch once (if the event needs a location) -> optionally
 * pick a player. A single "Possession Changed" button replaces continuous
 * drag-based possession tracking (own↔opponent, no location step).
 *
 * Reuses the same offline-aware hooks MatchRecording.tsx uses (useRecordEvent,
 * useRecordPossession, etc.) so both flows go through the same IndexedDB
 * outbox — this page never calls api.ts directly for event/possession writes.
 */
export default function SimpleMatchRecording() {
  const { matchId: matchIdParam } = useParams()
  const matchId = matchIdParam || null
  const navigate = useNavigate()
  const clubName = useClubName()

  const { data: match } = useMatch(matchId, { live: true })
  const { data: matchStats } = useMatchStats(matchId, undefined, true)
  const { data: players = [] } = usePlayers()
  const { data: matchEventsData } = useMatchEvents(matchId, { live: true })

  // Live match-stats charts (see the "Scroll to Stats" section near the
  // bottom of the page) — same data-fetching MatchRecording.tsx's own
  // matchInsightsCharts block uses, copied here rather than shared/imported
  // since that file must stay untouched. Deliberately excludes
  // PathsTakenChart — it needs continuous ball-carrier path data, which
  // Simple Scoring genuinely cannot produce (no dragging).
  const hasTaggedEvents = (matchEventsData?.events?.length ?? 0) > 0
  const { data: scoreOriginsData } = useQuery({
    queryKey: ['score-origins', matchId],
    queryFn: () => api.matchAnalytics.getScoreOrigins(matchId!),
    enabled: !!matchId && hasTaggedEvents,
    refetchInterval: 20_000,
  })
  const { data: scoreableFreesData } = useQuery({
    queryKey: ['scoreable-frees', matchId],
    queryFn: () => api.matchAnalytics.getScoreableFrees(matchId!),
    enabled: !!matchId && hasTaggedEvents,
    refetchInterval: 20_000,
  })
  const { data: attackEfficiencyData } = useQuery({
    queryKey: ['attack-efficiency', matchId],
    queryFn: () => api.matchAnalytics.getAttackEfficiency(matchId!),
    enabled: !!matchId && hasTaggedEvents,
    refetchInterval: 20_000,
  })
  const { data: seasonBenchmarkData } = useQuery({
    queryKey: ['season-benchmark', matchId],
    queryFn: () => api.matchAnalytics.getSeasonBenchmark(matchId!),
    enabled: !!matchId,
    refetchInterval: 20_000,
  })

  const startMatch = useStartMatch()
  const completeMatch = useCompleteMatch()
  const recordEvent = useRecordEvent()
  const recordPossession = useRecordPossession()
  const deleteEvent = useDeleteEvent()
  useUpdateMatchPhase() // kept for parity with MatchRecording.tsx — not called directly here

  const onFieldPlayers = useMemo(() => players.filter(p => p.active), [players])

  // ---- Match phase / clock (mirrors MatchRecording.tsx's server-sync + tick pattern, simplified) ----
  const [matchPhase, setMatchPhase] = useState<MatchPhase>('not_started')
  const [minute, setMinute] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [currentHalf, setCurrentHalf] = useState<1 | 2>(1)
  const [teamAttackingRight, setTeamAttackingRight] = useState(true)
  const [isPossessionModalOpen, setIsPossessionModalOpen] = useState(false)

  useEffect(() => {
    if (!match) return
    if (match.status === 'completed') {
      setMatchPhase('finished')
      return
    }
    if (match.status === 'in_progress') {
      const serverPhase = (match.current_phase as MatchPhase) || 'first_half'
      const phase: MatchPhase = (serverPhase === 'not_started' || serverPhase === 'finished') ? 'first_half' : serverPhase
      setMatchPhase(phase)
      setCurrentHalf(phase === 'second_half' ? 2 : 1)
      if (match.attacking_right_first_half != null) {
        setTeamAttackingRight(phase === 'second_half' ? !match.attacking_right_first_half : match.attacking_right_first_half)
      }

      const parseTS = (ts: string) => new Date(ts + (ts.endsWith('Z') ? '' : 'Z')).getTime()
      const hdm = match.half_duration_mins || 30
      if (phase === 'first_half' && match.started_at) {
        const elapsed = Date.now() - parseTS(match.started_at)
        setMinute(Math.min(Math.floor(elapsed / 60000), hdm))
        setSeconds(Math.floor((elapsed % 60000) / 1000))
      } else if (phase === 'half_time') {
        setMinute(hdm)
        setSeconds(0)
      } else if (phase === 'second_half' && match.second_half_started_at) {
        const elapsed = Date.now() - parseTS(match.second_half_started_at)
        setMinute(hdm + Math.floor(elapsed / 60000))
        setSeconds(Math.floor((elapsed % 60000) / 1000))
      }
    }
  }, [match])

  useEffect(() => {
    if (matchPhase !== 'first_half' && matchPhase !== 'second_half') return
    const hdm = match?.half_duration_mins || 30
    const t = setInterval(() => {
      setSeconds(s => {
        if (s >= 59) {
          setMinute(m => {
            const next = Math.min(m + 1, 120)
            if (matchPhase === 'first_half' && next >= hdm) return hdm
            return next
          })
          return 0
        }
        return s + 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [matchPhase, match?.half_duration_mins])

  // ---- Possession (local state — Simple Scoring has no continuous ball tracking) ----
  const [currentPossession, setCurrentPossession] = useState<'own' | 'opponent'>('own')
  const [isTwoPointZone, setIsTwoPointZone] = useState(false)

  const handlePossessionChanged = () => {
    if (!matchId || (matchPhase !== 'first_half' && matchPhase !== 'second_half')) return
    const next = currentPossession === 'own' ? 'opponent' : 'own'
    setCurrentPossession(next)
    recordPossession.mutate({
      match_id: matchId,
      x_coord: null,
      y_coord: null,
      team: next === 'own' ? 'home' : 'away',
      timestamp: new Date(),
      minute,
      half: currentHalf,
    })
  }

  // ---- Sideline ball — ask who's in possession, rather than leaving it
  // unflipped (a contested ball can go either way regardless of whatever
  // currentPossession happened to show beforehand). ----
  const [pendingSidelineDecision, setPendingSidelineDecision] = useState(false)
  const handleSidelineDecision = (weWonIt: boolean) => {
    setCurrentPossession(weWonIt ? 'own' : 'opponent')
    setPendingSidelineDecision(false)
  }

  // ---- Foul / 45 outcome state (drives CategorizedActionButtons' own sub-menus) ----
  const [pendingFoul, setPendingFoul] = useState<'own' | 'opponent' | null>(null)
  const [pending45, setPending45] = useState(false)
  const [pendingOutcomePosition, setPendingOutcomePosition] = useState<{ x: number; y: number } | null>(null)

  // ---- Location capture (fullscreen pitch tap) ----
  const [pendingLocation, setPendingLocation] = useState<PendingLocation | null>(null)
  // A tap only stages a candidate spot (shown as a dot) — nothing is
  // recorded until the coach explicitly confirms it, so a mis-tap on a
  // touch screen doesn't silently log the wrong location.
  const [stagedTap, setStagedTap] = useState<BallPosition | null>(null)

  // ---- Player attribution ----
  const [pendingPlayerSelection, setPendingPlayerSelection] = useState<PendingPlayerSelection | null>(null)
  const [isPlayerModalOpen, setIsPlayerModalOpen] = useState(false)
  const [selectingFoulPlayer, setSelectingFoulPlayer] = useState(false)

  const [errorAlert, setErrorAlert] = useState<string | null>(null)
  const [deleteConfirmEventId, setDeleteConfirmEventId] = useState<string | null>(null)
  const [showEndConfirm, setShowEndConfirm] = useState(false)

  // -----------------------------------------------------------------------
  // Event submission — same payload shape MatchRecording.tsx sends via
  // useRecordEvent (x_coord/y_coord, is_home_team, minute/half).
  // -----------------------------------------------------------------------
  const submitEvent = async (eventType: EventType, isHomeTeam: boolean, x: number, y: number, playerId?: string) => {
    if (!matchId) return
    try {
      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: playerId,
        event_type: toBackendEventType(eventType),
        minute,
        half: currentHalf,
        x_coord: x,
        y_coord: y,
        is_home_team: isHomeTeam,
      })
    } catch (err) {
      console.error('Failed to record event:', err)
      setErrorAlert('Failed to record event. Please try again.')
    }
  }

  // Resolve a captured pitch tap against whatever we were waiting for.
  const handlePitchTap = (pos: BallPosition) => {
    const action = pendingLocation
    if (!action) return
    setPendingLocation(null)

    if (action.purpose === 'foul') {
      if (action.foulTeam === 'opponent') {
        // Opposition fouled — we get the free. No player tracked for this half of it.
        void submitEvent(EventType.FOUL_WON, true, pos.x, pos.y)
        setPendingOutcomePosition({ x: pos.x, y: pos.y })
        setPendingFoul('opponent')
      } else {
        // Our team fouled — ask which player committed it before recording.
        setPendingPlayerSelection({ eventType: EventType.FOUL_COMMITTED, isHomeTeam: true, x: pos.x, y: pos.y })
        setSelectingFoulPlayer(true)
        setIsPlayerModalOpen(true)
      }
      return
    }

    if (action.purpose === 'fortyfive') {
      setPendingOutcomePosition({ x: pos.x, y: pos.y })
      setPending45(true)
      return
    }

    // purpose === 'action'
    if (action.needsPlayer) {
      setPendingPlayerSelection({ eventType: action.eventType!, isHomeTeam: action.isHomeTeam!, x: pos.x, y: pos.y })
      setIsPlayerModalOpen(true)
    } else {
      void submitEvent(action.eventType!, action.isHomeTeam!, pos.x, pos.y).then(() => {
        if (action.eventType === EventType.SIDELINE_BALL) {
          setPendingSidelineDecision(true)
        }
      })
    }
  }

  const handlePlayerSelected = (player: Player) => {
    if (!pendingPlayerSelection) return
    const { eventType, isHomeTeam, x, y } = pendingPlayerSelection
    const wasFoulSelect = selectingFoulPlayer
    setIsPlayerModalOpen(false)
    setPendingPlayerSelection(null)
    setSelectingFoulPlayer(false)
    void submitEvent(eventType, isHomeTeam, x, y, player.id).then(() => {
      if (wasFoulSelect) {
        // Our foul is logged — now open the free-kick outcome menu (opponent takes it).
        setPendingOutcomePosition({ x, y })
        setPendingFoul('own')
      }
    })
  }

  // Skip player — event still logged with no player, matching
  // PlayerSelectionModal's own "Event will still be logged" footer copy.
  const handlePlayerModalClose = () => {
    setIsPlayerModalOpen(false)
    const pending = pendingPlayerSelection
    const wasFoulSelect = selectingFoulPlayer
    setPendingPlayerSelection(null)
    setSelectingFoulPlayer(false)
    if (!pending) return
    const { eventType, isHomeTeam, x, y } = pending
    void submitEvent(eventType, isHomeTeam, x, y).then(() => {
      if (wasFoulSelect) {
        setPendingOutcomePosition({ x, y })
        setPendingFoul('own')
      }
    })
  }

  // -----------------------------------------------------------------------
  // Main action handler — mirrors MatchRecording.tsx's handleQuickAction,
  // with local `currentPossession` standing in for continuous ball tracking,
  // and a pitch tap always following the button press instead of using an
  // already-known position.
  // -----------------------------------------------------------------------
  const handleActionSelect = (eventType: EventType) => {
    const eventStr = String(eventType).toUpperCase()
    const isFreeKickResult = eventStr.includes('FREE') || (eventType === EventType.SHORT && !!pendingFoul)
    const is45Result = eventStr.includes('FORTY_FIVE')

    // Free-kick / 45 outcome — reuse the position already tapped for the foul/45 itself.
    if ((isFreeKickResult && pendingFoul) || (is45Result && pending45)) {
      const pos = pendingOutcomePosition
      const isHomeTeam = isFreeKickResult ? pendingFoul === 'opponent' : currentPossession === 'own'
      setPendingFoul(null)
      setPending45(false)
      setPendingOutcomePosition(null)
      // Every free/45 OUTCOME hands the ball to whichever team did NOT take
      // it — a score or wide free/45 is followed by the conceding team's
      // kickout, and a short free/45 (EventType.SHORT/FORTY_FIVE_MISSED) is
      // caught by the defence the same way a save is. Same rule for all of
      // them: the taking team never keeps the ball. This was the gap behind
      // a real bug report — logging a short free taken by the opposition
      // (after our own foul) left possession showing "own" instead of
      // flipping to "opponent".
      setCurrentPossession(isHomeTeam ? 'opponent' : 'own')
      if (!pos) return
      if (isHomeTeam) {
        setPendingPlayerSelection({ eventType, isHomeTeam, x: pos.x, y: pos.y })
        setIsPlayerModalOpen(true)
      } else {
        void submitEvent(eventType, isHomeTeam, pos.x, pos.y)
      }
      return
    }

    const isTeamWon = eventStr.includes('_WON') && !eventStr.includes('OPPOSITION_WON')
    const isOppositionWon = eventStr.includes('OPPOSITION_WON') || eventStr.includes('KICKOUT_SIDELINE')

    let isHomeTeam: boolean
    if (isTeamWon) isHomeTeam = true
    else if (isOppositionWon) isHomeTeam = false
    else if (eventType === EventType.TURNOVER_WON) isHomeTeam = true
    else if (eventType === EventType.INTERCEPTION || eventType === EventType.BLOCK) isHomeTeam = currentPossession !== 'own'
    else if (eventType === EventType.TURNOVER_LOST) isHomeTeam = true
    else if (eventStr.startsWith('OWN_')) isHomeTeam = true
    else isHomeTeam = currentPossession === 'own'

    const isOpponentNoPlayer = !isHomeTeam && OPPONENT_NO_PLAYER_EVENTS.has(eventType)
    const needsPlayer = !(NO_PLAYER_NEEDED.has(eventType) || isOpponentNoPlayer)

    if (eventType === EventType.INTERCEPTION || eventType === EventType.BLOCK) {
      // Whoever wins the interception/block has the ball — isHomeTeam already
      // encodes exactly that here (see the branch above), unlike turnovers/
      // sideline kickouts where attribution and "who has it now" diverge.
      setCurrentPossession(isHomeTeam ? 'own' : 'opponent')
    } else if (SHOT_OUTCOME_EVENTS.has(eventType)) {
      // Open-play shot attempt (not via the free/45 outcome branch above,
      // which already handles its own six outcome types) — the shooting
      // team always concedes the restart to the other side.
      setCurrentPossession(isHomeTeam ? 'opponent' : 'own')
    } else {
      const newOwner = possessionOwnerAfter(eventType)
      if (newOwner) setCurrentPossession(newOwner)
    }

    setPendingLocation({ purpose: 'action', eventType, isHomeTeam, needsPlayer })
  }

  const handleFoulClick = (team: 'own' | 'opponent') => {
    setPendingLocation({ purpose: 'foul', foulTeam: team })
  }

  const handle45Click = () => {
    setPendingLocation({ purpose: 'fortyfive' })
  }

  const handleCancelFree = () => {
    setPendingFoul(null)
    setPendingOutcomePosition(null)
  }
  const handleCancel45 = () => {
    setPending45(false)
    setPendingOutcomePosition(null)
  }
  const cancelPitchCapture = () => {
    setPendingLocation(null)
    setStagedTap(null)
  }
  // Tapping the pitch only stages a dot — it does NOT commit the event.
  const handlePitchStage = (pos: BallPosition) => setStagedTap(pos)
  // "Confirm Location" commits whatever's currently staged.
  const handleConfirmLocation = () => {
    if (!stagedTap) return
    const pos = stagedTap
    setStagedTap(null)
    handlePitchTap(pos)
  }

  // Cards — no pitch location needed, just who received it.
  const handleDiscipline = (eventType: EventType) => {
    setPendingPlayerSelection({ eventType, isHomeTeam: true, x: 50, y: 50 })
    setIsPlayerModalOpen(true)
  }

  // -----------------------------------------------------------------------
  // Match lifecycle
  // -----------------------------------------------------------------------
  const handlePossessionSelected = async (team: 'home' | 'away', attackingRight: boolean) => {
    setIsPossessionModalOpen(false)
    setCurrentPossession(team === 'home' ? 'own' : 'opponent')

    if (!matchId) return
    if (matchPhase === 'not_started') {
      setTeamAttackingRight(attackingRight)
      try {
        await startMatch.mutateAsync(matchId)
        await api.matches.updatePhase(matchId, 'first_half', attackingRight)
        setMatchPhase('first_half')
        setCurrentHalf(1)
        setMinute(0)
        setSeconds(0)
      } catch (err) {
        console.error('Failed to start match:', err)
        setErrorAlert('Failed to start match. Please try again.')
      }
    } else if (matchPhase === 'half_time') {
      setTeamAttackingRight(!teamAttackingRight)
      api.matches.updatePhase(matchId, 'second_half').catch(console.error)
      setMatchPhase('second_half')
      setCurrentHalf(2)
      setMinute(match?.half_duration_mins || 30)
      setSeconds(0)
    }
  }

  const handleHalfOrFullTime = async () => {
    if (!matchId) return
    if (matchPhase === 'first_half') {
      setPendingFoul(null)
      setPending45(false)
      setPendingOutcomePosition(null)
      setMatchPhase('half_time')
      api.matches.updatePhase(matchId, 'half_time').catch(console.error)
    } else if (matchPhase === 'second_half') {
      setShowEndConfirm(true)
    }
  }

  const handleConfirmEndMatch = async () => {
    if (!matchId) return
    try {
      await completeMatch.mutateAsync(matchId)
      setMatchPhase('finished')
      navigate(`/results/${matchId}`)
    } catch (err) {
      console.error('Failed to end match:', err)
      setErrorAlert('Failed to end match. Please try again.')
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirmEventId || !matchId) return
    try {
      await deleteEvent.mutateAsync({ eventId: deleteConfirmEventId, matchId })
    } catch (err) {
      console.error('Failed to delete event:', err)
    } finally {
      setDeleteConfirmEventId(null)
    }
  }

  // -----------------------------------------------------------------------
  // Derived display data
  // -----------------------------------------------------------------------
  // Shot locations for the shooting-efficiency heatmap — same half-aware
  // normalization MatchRecording.tsx uses (which end a team is attacking
  // flips at half-time, so a raw pitch_x alone isn't enough).
  const shotLocations = useMemo(() => {
    const shotTypes = new Set(['goal', 'penalty_goal', 'point', 'two_point', 'wide', 'short', 'saved', 'point_free', 'two_point_free', 'wide_free', 'forty_five', 'forty_five_missed', 'penalty_miss'])
    const scoreTypes = new Set(['goal', 'penalty_goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five'])
    const halfDuration = match?.half_duration_mins || 30
    const attackingRightFirstHalf = match?.attacking_right_first_half ?? true
    const normalizeX = (rawX: number, isOwn: boolean, minute: number | null | undefined): number => {
      const isFirstHalf = (minute ?? 0) <= halfDuration
      const teamAttackingRight = isFirstHalf ? attackingRightFirstHalf : !attackingRightFirstHalf
      const attackingRight = isOwn ? teamAttackingRight : !teamAttackingRight
      return attackingRight ? rawX : 100 - rawX
    }
    return (matchEventsData?.events || [])
      .filter((e: any) => shotTypes.has(e.event_type) && e.pitch_x != null)
      .map((e: any) => {
        const isOwn = e.team === 'own' || e.is_home_team
        return {
          x: normalizeX(e.pitch_x as number, isOwn, e.minute),
          y: e.pitch_y ?? 50,
          event_type: e.event_type,
          is_score: scoreTypes.has(e.event_type),
          team: e.team || (e.is_home_team ? 'own' : 'opponent'),
          match_id: e.match_id,
        }
      })
  }, [matchEventsData, match?.half_duration_mins, match?.attacking_right_first_half])

  // Match Statistics table rows — same fields/pairing MatchRecording.tsx's
  // sidebar table reads, all sourced from the same matchStats API response.
  const matchStatsRows = useMemo(() => {
    const ms: any = matchStats || {}
    const rawTeamPct = ms.team_possession_percentage ?? 0
    const rawOppPct = ms.opponent_possession_percentage ?? 0
    const hasPossessionData = rawTeamPct > 0 || rawOppPct > 0
    const teamPossessionPct = hasPossessionData ? Math.round(rawTeamPct) : 0
    const opponentPossessionPct = hasPossessionData ? 100 - teamPossessionPct : 0
    const teamShots = ms.team_total_shots || 0
    const opponentShots = ms.opponent_total_shots || 0
    const teamScoresN = ms.team_scores || 0
    const opponentScoresN = ms.opponent_scores || 0
    const teamWidesN = ms.team_wides || 0
    const opponentWidesN = ms.opponent_wides || 0
    const teamAccuracy = ms.team_accuracy != null ? Number(ms.team_accuracy.toFixed(1)) : 0
    const opponentAccuracy = opponentShots > 0 ? Number((opponentScoresN / opponentShots * 100).toFixed(1)) : 0
    const teamConversion = teamShots > 0 ? Number((teamScoresN / teamShots * 100).toFixed(1)) : 0
    const opponentConversion = (opponentScoresN + opponentWidesN) > 0 ? Number((opponentScoresN / (opponentScoresN + opponentWidesN) * 100).toFixed(1)) : 0
    const teamKickoutsWon = ms.team_kickouts_won || 0
    const teamKickoutsLost = ms.team_kickouts_lost || 0
    const opponentKickoutsWon = ms.opponent_kickouts_won || 0
    const opponentKickoutsLost = ms.opponent_kickouts_lost || 0
    const totalTeamKickouts = teamKickoutsWon + teamKickoutsLost
    const totalOpponentKickouts = opponentKickoutsWon + opponentKickoutsLost
    const teamKickoutRetention = totalTeamKickouts > 0 ? (teamKickoutsWon / totalTeamKickouts * 100).toFixed(1) : '0.0'
    const opponentKickoutRetention = totalOpponentKickouts > 0 ? (opponentKickoutsWon / totalOpponentKickouts * 100).toFixed(1) : '0.0'

    return [
      { label: 'Possession', left: `${teamPossessionPct}%`, right: `${opponentPossessionPct}%`, leftVal: teamPossessionPct, rightVal: opponentPossessionPct },
      { label: 'Poss. Count', left: ms.team_possession_count ?? 0, right: ms.opponent_possession_count ?? 0, leftVal: ms.team_possession_count ?? 0, rightVal: ms.opponent_possession_count ?? 0 },
      { label: 'Shots', left: teamShots, right: opponentShots, leftVal: teamShots, rightVal: opponentShots },
      { label: 'Scores', left: teamScoresN, right: opponentScoresN, leftVal: teamScoresN, rightVal: opponentScoresN },
      { label: 'Goal Chances', left: ms.team_goal_chances ?? 0, right: ms.opponent_goal_chances ?? 0, leftVal: ms.team_goal_chances ?? 0, rightVal: ms.opponent_goal_chances ?? 0 },
      { label: 'Wides', left: teamWidesN, right: opponentWidesN, leftVal: opponentWidesN, rightVal: teamWidesN },
      { label: 'Accuracy', left: `${teamAccuracy}%`, right: `${opponentAccuracy}%`, leftVal: teamAccuracy, rightVal: opponentAccuracy },
      { label: 'Conversion', left: `${teamConversion}%`, right: `${opponentConversion}%`, leftVal: teamConversion, rightVal: opponentConversion },
      { label: 'Turnovers Won', left: ms.team_turnovers_won || 0, right: ms.team_turnovers_lost || 0, leftVal: ms.team_turnovers_won || 0, rightVal: ms.team_turnovers_lost || 0 },
      ...((ms.team_ball_recovery_avg_min != null || ms.opponent_ball_recovery_avg_min != null) ? [{
        label: 'Ball Recovery',
        left: ms.team_ball_recovery_avg_min != null ? `${ms.team_ball_recovery_avg_min}m` : '–',
        right: ms.opponent_ball_recovery_avg_min != null ? `${ms.opponent_ball_recovery_avg_min}m` : '–',
        leftVal: ms.opponent_ball_recovery_avg_min ?? 0,
        rightVal: ms.team_ball_recovery_avg_min ?? 0,
      }] : []),
      { label: 'Unforced Errors', left: ms.team_unforced_errors ?? 0, right: ms.opponent_unforced_errors ?? 0, leftVal: ms.opponent_unforced_errors ?? 0, rightVal: ms.team_unforced_errors ?? 0 },
      { label: 'Kickouts Won', left: `${teamKickoutsWon}/${totalTeamKickouts}`, right: `${opponentKickoutsWon}/${totalOpponentKickouts}`, leftVal: teamKickoutsWon, rightVal: opponentKickoutsWon },
      { label: 'Kickout Ret. %', left: `${teamKickoutRetention}%`, right: `${opponentKickoutRetention}%`, leftVal: parseFloat(teamKickoutRetention), rightVal: parseFloat(opponentKickoutRetention) },
      { label: 'Fouls', left: ms.team_fouls || 0, right: ms.opponent_fouls || 0, leftVal: ms.opponent_fouls || 0, rightVal: ms.team_fouls || 0 },
      { label: '🟡 Yellow', left: ms.team_yellow_cards || 0, right: ms.opponent_yellow_cards || 0, leftVal: ms.opponent_yellow_cards || 0, rightVal: ms.team_yellow_cards || 0 },
      ...((ms.team_black_cards || 0) + (ms.opponent_black_cards || 0) > 0 ? [{ label: '⬛ Black', left: ms.team_black_cards || 0, right: ms.opponent_black_cards || 0, leftVal: ms.opponent_black_cards || 0, rightVal: ms.team_black_cards || 0 }] : []),
      ...((ms.team_red_cards || 0) + (ms.opponent_red_cards || 0) > 0 ? [{ label: '🔴 Red', left: ms.team_red_cards || 0, right: ms.opponent_red_cards || 0, leftVal: ms.opponent_red_cards || 0, rightVal: ms.team_red_cards || 0 }] : []),
    ]
  }, [matchStats])

  const teamGoals = match?.team_goals || 0
  const teamPoints = match?.team_points || 0
  const opponentGoals = match?.opponent_goals || 0
  const opponentPoints = match?.opponent_points || 0
  // Resolved locally against the roster rather than trusted from the event
  // object — a just-recorded offline event only ever carries player_id (see
  // offlineMatchEvents.create, which returns immediately from IndexedDB with
  // no server round trip yet, so it has no way to know the player's name).
  // Without this, a freshly-logged event showed no name at all until the
  // next 20s poll replaced it with the server's joined copy — confirmed as
  // a real bug in testing ("only shows after refresh").
  const playerNameById = useMemo(() => {
    const map = new Map<string, string>()
    players.forEach(p => map.set(p.id, p.name))
    return map
  }, [players])
  const recentEvents = useMemo(() => {
    return [...(matchEventsData?.events || [])].reverse().slice(0, 12).map((e: any) => ({
      ...e,
      player_name: e.player_name || (e.player_id ? playerNameById.get(String(e.player_id)) : undefined),
    }))
  }, [matchEventsData, playerNameById])

  const phaseLabel: Record<MatchPhase, string> = {
    not_started: 'Not Started',
    first_half: '1st Half',
    half_time: 'Half Time',
    second_half: '2nd Half',
    finished: 'Full Time',
  }

  const endButtonLabel = matchPhase === 'first_half' ? 'Half Time' : matchPhase === 'second_half' ? 'Full Time' : ''
  const isLive = matchPhase === 'first_half' || matchPhase === 'second_half'
  const pitchOverlayOpen = !!pendingLocation
  const statsRef = useRef<HTMLDivElement>(null)
  const scrollToStats = () => statsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="max-w-md mx-auto space-y-4 pb-8">
      {/* Header */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-2">
          {/* Weather — captured at match setup (MatchSetup.tsx), same icon
              as the precise-tracking header badge. Display only here (no
              click-to-edit) — this page is about logging events fast, not
              revisiting setup details. */}
          {match?.weather_condition ? (() => {
            const WeatherIcon = getWeatherIcon(match.weather_condition)
            return (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/60">
                <WeatherIcon size={13} className="text-white/70" />
                <span className="text-[10px]">{getWeatherLabel(match.weather_condition)}</span>
                {match.temperature_celsius != null && (
                  <span className="text-[10px]">{match.temperature_celsius}°C</span>
                )}
              </span>
            )
          })() : <span />}
          <span className="flex items-center gap-1.5 text-white/60 text-sm">
            <Clock size={14} />
            {phaseLabel[matchPhase]}{isLive ? ` · ${minute}:${seconds.toString().padStart(2, '0')}` : ''}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <p className="text-white/60 text-xs font-semibold truncate">{clubName}</p>
            <p className="text-2xl font-bold text-emerald-400 tabular-nums">{teamGoals}-{teamPoints}</p>
          </div>
          <span className="text-white/20 text-sm px-2">vs</span>
          <div className="text-center flex-1">
            <p className="text-white/60 text-xs font-semibold truncate">{match?.opponent || '...'}</p>
            <p className="text-2xl font-bold text-orange-400 tabular-nums">{opponentGoals}-{opponentPoints}</p>
          </div>
        </div>
        {matchStats && (matchStats.team_possession_percentage > 0 || matchStats.opponent_possession_percentage > 0) && (
          <p className="text-center text-white/30 text-[11px] mt-1">
            Possession {Math.round(matchStats.team_possession_percentage)}% – {Math.round(matchStats.opponent_possession_percentage)}%
          </p>
        )}
      </div>

      {hasTaggedEvents && (
        <button
          onClick={scrollToStats}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 active:scale-95 text-sm font-medium transition-all"
        >
          <BarChart3 size={15} />
          Scroll to Stats
        </button>
      )}

      {errorAlert && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm flex items-center justify-between">
          {errorAlert}
          <button onClick={() => setErrorAlert(null)}><X size={16} /></button>
        </div>
      )}

      {/* Match lifecycle controls */}
      {matchPhase === 'not_started' && (
        <button
          onClick={() => setIsPossessionModalOpen(true)}
          className="w-full py-4 rounded-xl font-bold text-lg text-white"
          style={{ background: 'var(--gradient-primary, linear-gradient(135deg,#10b981,#06b6d4))' }}
        >
          Start Match
        </button>
      )}

      {matchPhase === 'half_time' && (
        <button
          onClick={() => setIsPossessionModalOpen(true)}
          className="w-full py-4 rounded-xl font-bold text-lg bg-emerald-600 text-white active:scale-95 transition-all"
        >
          Start 2nd Half
        </button>
      )}

      {isLive && (
        <>
          {/* Possession status + manual override — most possession changes
              now happen automatically (turnover won/lost, kickouts, etc. —
              see possessionOwnerAfter above), so this is a status readout
              first and a correction button second, not the main event-sized
              button it used to be. */}
          <div
            className={`w-full py-3 px-4 rounded-xl flex items-center justify-between transition-colors ${
              currentPossession === 'own' ? 'bg-emerald-600/20' : 'bg-orange-600/20'
            }`}
          >
            <span className={`font-semibold text-sm ${currentPossession === 'own' ? 'text-emerald-400' : 'text-orange-400'}`}>
              {currentPossession === 'own' ? (clubName || 'We') : (match?.opponent || 'Opponent')} in possession
            </span>
            <button
              onClick={handlePossessionChanged}
              title="Correct possession"
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:scale-90 transition-all text-white/80"
            >
              <RotateCw size={16} />
            </button>
          </div>

          {/* Shot zone toggle — Simple Scoring picks the event type before the pitch
              tap, so there's no continuously-tracked position to auto-derive this
              from the way MatchRecording.tsx does. */}
          <div className="flex bg-white/10 rounded-lg p-0.5">
            <button
              onClick={() => setIsTwoPointZone(false)}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                !isTwoPointZone ? 'bg-white/20 text-white' : 'text-white/50'
              }`}
            >
              Inside 40m (Point)
            </button>
            <button
              onClick={() => setIsTwoPointZone(true)}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                isTwoPointZone ? 'bg-white/20 text-white' : 'text-white/50'
              }`}
            >
              Outside 40m (2 PT)
            </button>
          </div>

          {/* Event logging buttons */}
          <div className="w-full">
            <CategorizedActionButtons
              onActionSelect={handleActionSelect}
              onFoulClick={handleFoulClick}
              on45Click={handle45Click}
              onDiscipline={handleDiscipline}
              currentPossession={currentPossession === 'own' ? PossessionTeam.OWN : PossessionTeam.OPPONENT}
              isIn2PointZone={isTwoPointZone}
              pendingFreeKick={!!pendingFoul}
              pendingFoul={pendingFoul}
              pending45={pending45}
              onCancelFree={handleCancelFree}
              onCancel45={handleCancel45}
              pendingSidelineDecision={pendingSidelineDecision}
              onSidelineDecision={handleSidelineDecision}
            />
          </div>

          <button
            onClick={handleHalfOrFullTime}
            className="w-full py-3 rounded-xl font-semibold text-white/80 bg-white/10 hover:bg-white/15 transition-all"
          >
            {endButtonLabel}
          </button>
        </>
      )}

      {/* Recent events */}
      {recentEvents.length > 0 && (
        <div className="glass-card p-4">
          <h3 className="text-white/70 text-sm font-semibold mb-2">Recent Events</h3>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {recentEvents.map((e: any) => (
              <div key={e.id} className="flex items-center justify-between text-sm bg-white/5 rounded-lg px-3 py-2">
                <span className="text-white/70 truncate">
                  {e.minute}' — {String(e.event_type).replace(/_/g, ' ')}
                  {e.player_name ? ` · ${e.player_name}` : ''}
                </span>
                <button
                  onClick={() => setDeleteConfirmEventId(String(e.id))}
                  className="text-white/30 hover:text-red-400 transition-colors ml-2 flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live match stats — same chart set MatchRecording.tsx's own
          matchInsightsCharts block uses (copied rather than shared/imported,
          per this file's policy of never touching that file), minus
          PathsTakenChart AND PossessionTerritoryChart — both need continuous
          location data this mode can't produce (Paths needs carrier drag
          paths; Territory needs many location samples per possession to
          time-weight which third of the pitch the ball sat in, not just a
          team + duration). Possession % alone (the one part of that chart
          that IS valid here — team + duration, no coordinates needed) is
          already shown in the header above. Everything below runs on
          tapped-location MatchEvent rows, so it works exactly the same as
          full precision mode — Territory Distribution and Possession Funnel
          are the two season-level charts that degrade for these matches,
          not any of these per-match ones. */}
      {hasTaggedEvents && matchId && (
        <div ref={statsRef} className="space-y-4 pt-2">
          <h2 className="text-white/50 text-xs font-semibold uppercase tracking-wide text-center">Match Stats</h2>

          {/* Match Statistics table — same rows/values as the "Match
              Statistics" card in MatchRecording.tsx's sidebar (every value
              comes straight off the same matchStats API response this page
              already fetches, so this is just the display, not new data). */}
          <div className="glass-card p-4">
            <h3 className="text-white font-semibold text-sm mb-3">Match Statistics</h3>
            <div className="rounded-xl border border-white/[0.08] overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2 px-3 bg-white/[0.06] border-b border-white/[0.08]">
                <div className="text-center text-[11px] font-bold text-emerald-400 uppercase tracking-wider truncate">{clubName}</div>
                <div className="min-w-[70px]" />
                <div className="text-center text-[11px] font-bold text-white/50 uppercase tracking-wider truncate">{match?.opponent || 'Opponent'}</div>
              </div>
              {matchStatsRows.map((row, idx) => {
                const leftWins = row.leftVal > row.rightVal
                const rightWins = row.rightVal > row.leftVal
                return (
                  <div key={row.label} className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2 px-3 ${idx % 2 === 0 ? 'bg-white/[0.02]' : ''} ${idx > 0 ? 'border-t border-white/[0.05]' : ''}`}>
                    <div className={`text-center text-sm font-bold ${leftWins ? 'text-emerald-400' : 'text-white/80'}`}>{row.left}</div>
                    <div className="text-center text-[10px] font-semibold text-white/35 uppercase tracking-wider min-w-[70px]">{row.label}</div>
                    <div className={`text-center text-sm font-bold ${rightWins ? 'text-emerald-400' : 'text-white/80'}`}>{row.right}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <ChartZoomModal title="Shooting Efficiency">
            <ShootingEfficiencyHeatmap shots={shotLocations} />
          </ChartZoomModal>
          <ChartZoomModal title="Scoring Timeline">
            <ScoringTimeline events={matchEventsData?.events || []} opponent={match?.opponent || 'Opponent'} teamName={clubName} />
          </ChartZoomModal>
          <ChartZoomModal title="Shot Outcomes">
            <ShotOutcomeChart events={matchEventsData?.events || []} opponent={match?.opponent || 'Opponent'} />
          </ChartZoomModal>
          <ChartZoomModal title="Kickout Zones">
            <MatchKickoutZones events={matchEventsData?.events || []} attackingRightFirstHalf={match?.attacking_right_first_half} teamName={clubName} opponentName={match?.opponent || 'Opponent'} />
          </ChartZoomModal>
          <ChartZoomModal title="Kickout Outcomes">
            <MatchKickoutOutcomes events={matchEventsData?.events || []} teamName={clubName} opponentName={match?.opponent || 'Opponent'} />
          </ChartZoomModal>
          <ChartZoomModal title="Kickout Sequence">
            <KickoutSequence events={matchEventsData?.events || []} teamName={clubName} opponentName={match?.opponent || 'Opponent'} />
          </ChartZoomModal>
          <ChartZoomModal title="Scoring Zone Map">
            <ScoringZoneMap events={matchEventsData?.events || []} teamName={clubName || 'Us'} opponent={match?.opponent || 'Opponent'} />
          </ChartZoomModal>
          <ChartZoomModal title="Possession Battle Map">
            <TurnoverMap events={matchEventsData?.events || []} teamName={clubName || 'Us'} />
          </ChartZoomModal>
          {scoreOriginsData && (
            <ChartZoomModal title="Score Origins">
              <ScoreOrigins data={scoreOriginsData} teamName={clubName} opponentName={match?.opponent || 'Opponent'} />
            </ChartZoomModal>
          )}
          {scoreableFreesData && (
            <ChartZoomModal title="Scoreable Frees">
              <ScoreableFreesAnalysis data={scoreableFreesData} teamName={clubName} />
            </ChartZoomModal>
          )}
          {attackEfficiencyData && (
            <ChartZoomModal title="Attack Efficiency">
              <AttackEfficiencyCard data={attackEfficiencyData} teamName={clubName} opponentName={match?.opponent || 'Opponent'} />
            </ChartZoomModal>
          )}
          {seasonBenchmarkData && (
            <ChartZoomModal title="vs Season Average">
              <SeasonBenchmarkCard data={seasonBenchmarkData} teamName={clubName} />
            </ChartZoomModal>
          )}
        </div>
      )}

      {/* Fullscreen pitch tap overlay — tap-only, no drag props wired.
          Tapping stages a dot; nothing is recorded until "Confirm Location"
          is pressed, so a mis-tap on a touch screen can be corrected. */}
      {pitchOverlayOpen && (() => {
        const isTwoPointer = pendingLocation?.purpose === 'action' && pendingLocation.eventType === EventType.TWO_POINT
        const direction = isTwoPointer
          ? attackingDirectionFor(pendingLocation!.isHomeTeam ?? true, teamAttackingRight)
          : null
        const tapIsValid = !isTwoPointer || !stagedTap || direction === null
          ? true
          : isValidTwoPointerSpot(stagedTap.x, stagedTap.y, direction)

        // Which team this tap is actually being recorded for — only known
        // for 'action' events (foul/45 taps don't carry isHomeTeam until
        // their outcome is picked, so those fall back to our own direction).
        const eventIsHomeTeam = pendingLocation?.purpose === 'action' ? pendingLocation.isHomeTeam : undefined
        const labelTeamName = eventIsHomeTeam === false ? (match?.opponent || 'Opponent') : (clubName || 'We')
        const labelAttackingRight = eventIsHomeTeam === false ? !teamAttackingRight : teamAttackingRight

        return (
          <div className="fixed inset-0 z-[130] bg-black/95 flex flex-col p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-white font-semibold flex items-center gap-2">
                <MapPin size={18} className={stagedTap ? (tapIsValid ? 'text-emerald-400' : 'text-red-400') : 'text-white/40'} />
                {isTwoPointer
                  ? (stagedTap
                      ? (tapIsValid ? 'Confirm location, or tap again to move it' : 'Too close for a 2-pointer — tap outside the shaded area')
                      : 'Tap outside the shaded area for a 2-pointer')
                  : (stagedTap ? 'Confirm location, or tap again to move it' : 'Tap where this happened')}
              </p>
              <button
                onClick={cancelPitchCapture}
                className="p-2 rounded-lg bg-white/10 text-white/70 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            {/* Attacking-direction reminder — which side of the pitch this
                SPECIFIC event belongs on. Named for whichever team the
                event is actually attributed to (own or opponent), not
                always "us" — showing our own direction for an event the app
                has attributed to the opponent would silently hide a wrong
                attribution instead of surfacing it. This is exactly what
                made a 2-pointer's shaded zone look "backwards" in testing:
                the event had been attributed to the opponent (their
                direction is the reverse of ours), which wasn't visible
                anywhere until this label named it. */}
            <div className="flex items-center justify-center gap-1.5 mb-3 text-white/45 text-xs font-medium">
              <span>{labelTeamName} attacking</span>
              {labelAttackingRight ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
            </div>
            <div className="flex-1 relative">
              <GAAPitch
                containerClassName="w-full h-full"
                onBallMove={handlePitchStage}
                ballPosition={stagedTap}
                ballAnchoredOverlay={(svgX, svgY) => (
                  // Pulsing ring around the staged (not-yet-confirmed) tap —
                  // nested <g transform="translate(...)"> so the ping scales
                  // around the ball's own point regardless of SVG transform-box
                  // quirks, rather than relying on transform-origin alone.
                  // Red + no pulse when the spot isn't valid for a 2-pointer.
                  <g transform={`translate(${svgX}, ${svgY})`}>
                    {tapIsValid ? (
                      <>
                        <circle r={40} fill="none" stroke="#10b981" strokeWidth={6} className="animate-ping" style={{ transformOrigin: '0 0' }} />
                        <circle r={40} fill="none" stroke="#10b981" strokeWidth={2} opacity={0.6} />
                      </>
                    ) : (
                      <circle r={40} fill="none" stroke="#ef4444" strokeWidth={6} opacity={0.85} />
                    )}
                  </g>
                )}
              />
              {/* 2-pointer zone shading — a fully independent overlay <svg>
                  (same viewBox/sizing as GAAPitch's own, stacked on top via
                  absolute positioning) rather than GAAPitch's own pitchOverlay
                  prop, because that prop only renders once a ball position
                  exists — the shading needs to be visible from the moment
                  this screen opens, before any tap. pointer-events:none so
                  taps pass straight through to GAAPitch's own svg beneath. */}
              {isTwoPointer && direction && (
                <svg viewBox="0 0 2332 1446" className="absolute inset-0 w-full h-full pointer-events-none">
                  {/* Own defensive half — a distinct neutral colour from the
                      "too close" arc zone below, since it's excluded for a
                      different reason (not realistic, not "too close"). */}
                  <rect
                    x={direction === 'right' ? PITCH.left : PITCH.left + PITCH.playW / 2}
                    y={PITCH.top}
                    width={PITCH.playW / 2}
                    height={PITCH.playH}
                    fill="rgba(100,116,139,0.35)"
                  />
                  {/* Valid zone — purple-zone-equivalent plus the rest of
                      midfield, pulsing so it reads as "tap here". */}
                  <path d={validZonePath(direction)} fill="rgba(16,185,129,0.3)" className="animate-pulse" />
                  {/* Too close (inside the 40m arc) — traced to the pitch
                      artwork's own arc line, not an approximation. */}
                  <path d={closeZonePath(direction)} fill="rgba(239,68,68,0.4)" />
                  <path d={arcStrokePath(direction)} fill="none" stroke="rgba(239,68,68,0.85)" strokeWidth={5} strokeDasharray="14 10" />
                </svg>
              )}
            </div>
            <button
              onClick={handleConfirmLocation}
              disabled={!stagedTap || !tapIsValid}
              className={`w-full py-4 mt-3 rounded-xl font-bold text-lg transition-all ${
                stagedTap && tapIsValid
                  ? 'bg-emerald-600 text-white active:scale-95'
                  : 'bg-white/5 text-white/25 cursor-not-allowed'
              }`}
            >
              Confirm Location
            </button>
          </div>
        )
      })()}

      {/* Player attribution */}
      <PlayerSelectionModal
        isOpen={isPlayerModalOpen}
        onClose={handlePlayerModalClose}
        onSelectPlayer={handlePlayerSelected}
        eventType={String(pendingPlayerSelection?.eventType ?? EventType.OTHER)}
        team="own"
        players={onFieldPlayers}
        attackingRight={teamAttackingRight}
      />

      {/* Kickoff / second-half direction */}
      <PossessionSelectionModal
        isOpen={isPossessionModalOpen}
        homeTeam={clubName}
        awayTeam={match?.opponent || 'Opponent'}
        onSelect={handlePossessionSelected}
        skipDirection={matchPhase === 'half_time'}
        defaultAttackingRight={!teamAttackingRight}
      />

      {/* Delete event confirmation */}
      <ConfirmationModal
        isOpen={!!deleteConfirmEventId}
        onClose={() => setDeleteConfirmEventId(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Event?"
        message="Are you sure you want to delete this event? The match scores and statistics will be recalculated automatically."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Full time confirmation */}
      <ConfirmationModal
        isOpen={showEndConfirm}
        onClose={() => setShowEndConfirm(false)}
        onConfirm={handleConfirmEndMatch}
        title="End Match?"
        message="This will mark the match as complete and generate the post-match report."
        confirmText="End Match"
        cancelText="Cancel"
        variant="warning"
      />
    </div>
  )
}
