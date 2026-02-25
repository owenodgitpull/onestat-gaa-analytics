/**
 * VideoEventForm — Event type selector with context panel for video tagging.
 *
 * Organized into categories: Scoring, Possession, Defensive, Set Piece, Discipline, Other.
 * Context panel shows scoring/kickout fields when relevant event types are selected.
 */

import { useState, useEffect } from 'react'
import type { VideoEventCreateData, ScoringContext, KickoutContext } from '../../services/videoApi'
import type { PitchZone } from './PitchZoneSelector'
import { TWO_POINTER_ZONES } from './PitchZoneSelector'

interface VideoEventFormProps {
  onSubmit: (data: VideoEventCreateData) => void
  selectedZone: PitchZone | null
  currentTimestampMs: number | null
  half: number
  players: Array<{ id: string; name: string; jersey_number?: number }>
  disabled?: boolean
}

const EVENT_CATEGORIES = {
  Scoring: ['POINT_SCORED', 'GOAL_SCORED', 'WIDE', 'SHORT', 'POST_HIT', 'GOAL_CHANCE'],
  Possession: ['PASS_HAND', 'PASS_KICK', 'SOLO_RUN', 'CATCH', 'PICKUP', 'MARK_CLAIMED'],
  Defensive: ['TACKLE', 'BLOCK_SHOT', 'BLOCK_PASS', 'INTERCEPTION', 'HOOK', 'SPOIL', 'BALL_WON', 'TURNOVER_WON', 'TURNOVER_LOST'],
  'Set Piece': ['FREE_KICK', 'FORTY_FIVE', 'SIDELINE_KICK', 'PENALTY', 'KICKOUT_SHORT', 'KICKOUT_LONG', 'THROW_IN'],
  Discipline: ['YELLOW_CARD', 'RED_CARD', 'BLACK_CARD'],
  Other: ['SUB_ON', 'SUB_OFF', 'HALF_TIME', 'FULL_TIME', 'INJURY_STOPPAGE', 'WATER_BREAK'],
} as const

const EVENT_LABELS: Record<string, string> = {
  POINT_SCORED: 'Point', GOAL_SCORED: 'Goal', WIDE: 'Wide', SHORT: 'Short',
  POST_HIT: 'Post', GOAL_CHANCE: 'Goal Chance',
  PASS_HAND: 'Hand Pass', PASS_KICK: 'Kick Pass', SOLO_RUN: 'Solo',
  CATCH: 'Catch', PICKUP: 'Pick Up', MARK_CLAIMED: 'Mark',
  TACKLE: 'Tackle', BLOCK_SHOT: 'Block Shot', BLOCK_PASS: 'Block Pass',
  INTERCEPTION: 'Intercept', HOOK: 'Hook', SPOIL: 'Spoil',
  BALL_WON: 'Ball Won', TURNOVER_WON: 'T/O Won', TURNOVER_LOST: 'T/O Lost',
  FREE_KICK: 'Free', FORTY_FIVE: '45m Free', SIDELINE_KICK: 'Sideline',
  PENALTY: 'Penalty', KICKOUT_SHORT: 'KO Short', KICKOUT_LONG: 'KO Long',
  THROW_IN: 'Throw In',
  YELLOW_CARD: 'Yellow', RED_CARD: 'Red', BLACK_CARD: 'Black',
  SUB_ON: 'Sub On', SUB_OFF: 'Sub Off',
  HALF_TIME: 'Half Time', FULL_TIME: 'Full Time',
  INJURY_STOPPAGE: 'Injury Stop', WATER_BREAK: 'Water Break',
}

const SCORING_EVENTS = ['POINT_SCORED', 'GOAL_SCORED', 'FREE_KICK', 'FORTY_FIVE', 'PENALTY']
const KICKOUT_EVENTS = ['KICKOUT_SHORT', 'KICKOUT_LONG']

export default function VideoEventForm({
  onSubmit,
  selectedZone,
  currentTimestampMs,
  half,
  players,
  disabled = false,
}: VideoEventFormProps) {
  const [activeCategory, setActiveCategory] = useState<string>('Scoring')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [team, setTeam] = useState<'team_a' | 'team_b'>('team_a')
  const [playerId, setPlayerId] = useState<string>('')
  const [minute, setMinute] = useState(0)
  const [second, setSecond] = useState(0)
  const [description, setDescription] = useState('')

  // Scoring context
  const [scoringSource, setScoringSource] = useState('FROM_PLAY')
  const [foot, setFoot] = useState<string>('')
  const [underPressure, setUnderPressure] = useState(false)

  // Kickout context
  const [kickoutDirection, setKickoutDirection] = useState<string>('')
  const [cleanCatch, setCleanCatch] = useState(false)

  // Auto-detect two-pointer from zone
  const isTwoPointer = selectedZone ? TWO_POINTER_ZONES.includes(selectedZone) : false
  const isScoringEvent = selectedType ? SCORING_EVENTS.includes(selectedType) : false
  const isKickoutEvent = selectedType ? KICKOUT_EVENTS.includes(selectedType) : false

  // Update minute from timestamp
  useEffect(() => {
    if (currentTimestampMs != null) {
      const totalSec = Math.floor(currentTimestampMs / 1000)
      setMinute(Math.floor(totalSec / 60))
      setSecond(totalSec % 60)
    }
  }, [currentTimestampMs])

  const handleSubmit = () => {
    if (!selectedType) return

    const data: VideoEventCreateData = {
      event_type: selectedType,
      team,
      half,
      match_minute: minute,
      match_second: second,
      video_timestamp_ms: currentTimestampMs ?? undefined,
      pitch_zone: selectedZone ?? undefined,
      player_id: playerId || undefined,
      description: description || undefined,
      source: 'human_tag',
    }

    if (isScoringEvent) {
      const ctx: ScoringContext = {
        source: scoringSource,
        is_two_pointer: isTwoPointer,
      }
      if (foot) ctx.foot = foot
      if (underPressure) ctx.under_pressure = true
      data.scoring_context = ctx
    }

    if (isKickoutEvent) {
      const ctx: KickoutContext = {}
      if (kickoutDirection) ctx.direction = kickoutDirection
      if (cleanCatch) ctx.clean_catch = true
      data.kickout_context = ctx
    }

    onSubmit(data)

    // Reset form (keep team and half)
    setSelectedType(null)
    setPlayerId('')
    setDescription('')
    setScoringSource('FROM_PLAY')
    setFoot('')
    setUnderPressure(false)
    setKickoutDirection('')
    setCleanCatch(false)
  }

  return (
    <div className="space-y-3">
      {/* Team selector */}
      <div className="flex gap-2">
        {(['team_a', 'team_b'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTeam(t)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-all ${
              team === t
                ? t === 'team_a'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-orange-600 text-white'
                : 'bg-white/5 text-white/50 hover:bg-white/10'
            }`}
          >
            {t === 'team_a' ? 'Team A (Own)' : 'Team B (Opp)'}
          </button>
        ))}
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto scrollbar-none">
        {Object.keys(EVENT_CATEGORIES).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              activeCategory === cat
                ? 'bg-emerald-500/30 text-emerald-300'
                : 'bg-white/5 text-white/40 hover:text-white/60'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Event type buttons */}
      <div className="grid grid-cols-3 gap-1.5">
        {EVENT_CATEGORIES[activeCategory as keyof typeof EVENT_CATEGORIES]?.map((type) => (
          <button
            key={type}
            onClick={() => setSelectedType(selectedType === type ? null : type)}
            className={`py-2 px-2 rounded-lg text-xs font-medium transition-all ${
              selectedType === type
                ? 'bg-emerald-500/40 text-white ring-1 ring-emerald-400'
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {EVENT_LABELS[type] || type}
          </button>
        ))}
      </div>

      {/* Two-pointer indicator */}
      {isScoringEvent && isTwoPointer && selectedType === 'POINT_SCORED' && (
        <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2">
          <span className="text-cyan-400 font-bold text-sm">2pt</span>
          <span className="text-xs text-cyan-300/80">Outside 40m arc — worth 2 points</span>
        </div>
      )}

      {/* Context panel — Scoring */}
      {isScoringEvent && selectedType && (
        <div className="bg-white/5 rounded-lg p-3 space-y-2">
          <span className="text-xs text-white/40 uppercase tracking-wider">Scoring Context</span>
          <div className="flex gap-1.5">
            {['FROM_PLAY', 'FROM_FREE', 'FROM_MARK', 'FROM_45'].map((src) => (
              <button
                key={src}
                onClick={() => setScoringSource(src)}
                className={`px-2 py-1 rounded text-xs ${
                  scoringSource === src ? 'bg-emerald-500/30 text-emerald-300' : 'bg-white/5 text-white/40'
                }`}
              >
                {src.replace('FROM_', '')}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {['LEFT', 'RIGHT'].map((f) => (
              <button
                key={f}
                onClick={() => setFoot(foot === f ? '' : f)}
                className={`px-2 py-1 rounded text-xs ${
                  foot === f ? 'bg-emerald-500/30 text-emerald-300' : 'bg-white/5 text-white/40'
                }`}
              >
                {f} Foot
              </button>
            ))}
            <button
              onClick={() => setUnderPressure(!underPressure)}
              className={`px-2 py-1 rounded text-xs ${
                underPressure ? 'bg-amber-500/30 text-amber-300' : 'bg-white/5 text-white/40'
              }`}
            >
              Under Pressure
            </button>
          </div>
        </div>
      )}

      {/* Context panel — Kickout */}
      {isKickoutEvent && (
        <div className="bg-white/5 rounded-lg p-3 space-y-2">
          <span className="text-xs text-white/40 uppercase tracking-wider">Kickout Context</span>
          <div className="flex gap-1.5">
            {['LEFT', 'RIGHT', 'CENTRE', 'LONG'].map((dir) => (
              <button
                key={dir}
                onClick={() => setKickoutDirection(kickoutDirection === dir ? '' : dir)}
                className={`px-2 py-1 rounded text-xs ${
                  kickoutDirection === dir ? 'bg-purple-500/30 text-purple-300' : 'bg-white/5 text-white/40'
                }`}
              >
                {dir}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCleanCatch(!cleanCatch)}
            className={`px-2 py-1 rounded text-xs ${
              cleanCatch ? 'bg-purple-500/30 text-purple-300' : 'bg-white/5 text-white/40'
            }`}
          >
            Clean Catch
          </button>
        </div>
      )}

      {/* Player selector */}
      <div>
        <select
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
        >
          <option value="">Select Player (optional)</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.jersey_number ? `#${p.jersey_number} ` : ''}{p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Time inputs */}
      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <label className="text-[10px] text-white/40">Min</label>
          <input
            type="number"
            value={minute}
            onChange={(e) => setMinute(parseInt(e.target.value) || 0)}
            min={0}
            max={99}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
        <span className="text-white/30 mt-4">:</span>
        <div className="flex-1">
          <label className="text-[10px] text-white/40">Sec</label>
          <input
            type="number"
            value={second}
            onChange={(e) => setSecond(parseInt(e.target.value) || 0)}
            min={0}
            max={59}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
      </div>

      {/* Notes */}
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Add note (optional)"
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
      />

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!selectedType || disabled}
        className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-semibold transition-all"
      >
        {selectedType ? `Tag ${EVENT_LABELS[selectedType] || selectedType}` : 'Select Event Type'}
      </button>
    </div>
  )
}
