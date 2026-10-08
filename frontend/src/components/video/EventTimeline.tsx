/**
 * EventTimeline — Horizontal marker strip showing events along the video timeline.
 *
 * Events displayed as colored dots. Click to seek video to that timestamp.
 */

import { useMemo } from 'react'
import { seekTimeForEvent } from '../../utils/videoSeek'
import type { VideoEvent } from '../../services/videoApi'

interface EventTimelineProps {
  events: VideoEvent[]
  videoDurationMs: number
  currentTimeMs: number
  onSeek: (timestampMs: number) => void
  firstHalfStartMs?: number | null
  secondHalfStartMs?: number | null
  halftimeMs?: number | null
  fullTimeMs?: number | null
}

const EVENT_COLORS: Record<string, string> = {
  GOAL_SCORED: '#10b981',
  POINT_SCORED: '#06b6d4',
  WIDE: '#fbbf24',
  SHORT: '#f59e0b',
  TURNOVER_WON: '#3b82f6',
  TURNOVER_LOST: '#ef4444',
  FREE_KICK: '#a78bfa',
  YELLOW_CARD: '#eab308',
  RED_CARD: '#dc2626',
  BLACK_CARD: '#1f2937',
  KICKOUT_SHORT: '#8b5cf6',
  KICKOUT_LONG: '#8b5cf6',
}

function getEventColor(eventType: string): string {
  return EVENT_COLORS[eventType] || '#94a3b8'
}

function getEventSize(eventType: string): number {
  if (eventType === 'GOAL_SCORED') return 10
  if (eventType === 'POINT_SCORED') return 8
  return 6
}

export default function EventTimeline({
  events,
  videoDurationMs,
  currentTimeMs,
  onSeek,
  firstHalfStartMs,
  secondHalfStartMs,
  halftimeMs,
  fullTimeMs,
}: EventTimelineProps) {
  const sortedEvents = useMemo(
    () => [...events].filter(e => e.video_timestamp_ms != null).sort((a, b) => a.video_timestamp_ms! - b.video_timestamp_ms!),
    [events]
  )

  const progressPercent = videoDurationMs > 0
    ? Math.min((currentTimeMs / videoDurationMs) * 100, 100)
    : 0

  return (
    <div className="relative bg-white/5 rounded-lg border border-white/10 p-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] text-white/40 uppercase tracking-wider">Timeline</span>
        <span className="text-[10px] text-white/30">{sortedEvents.length} events</span>
      </div>

      {/* Timeline bar */}
      <div
        className="relative h-8 bg-white/5 rounded cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const percent = (e.clientX - rect.left) / rect.width
          onSeek(Math.round(percent * videoDurationMs))
        }}
      >
        {/* Progress indicator */}
        <div
          className="absolute top-0 left-0 h-full bg-emerald-500/20 rounded-l transition-all duration-100"
          style={{ width: `${progressPercent}%` }}
        />

        {/* Current position marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-emerald-400 z-20 transition-all duration-100"
          style={{ left: `${progressPercent}%` }}
        />

        {/* Throw-in markers */}
        {firstHalfStartMs != null && videoDurationMs > 0 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-cyan-400/60 z-10"
            style={{ left: `${(firstHalfStartMs / videoDurationMs) * 100}%` }}
            title="1st half throw-in"
          >
            <span className="absolute -top-3.5 -translate-x-1/2 text-[8px] text-cyan-400 font-bold whitespace-nowrap">1H</span>
          </div>
        )}
        {secondHalfStartMs != null && videoDurationMs > 0 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-cyan-400/60 z-10"
            style={{ left: `${(secondHalfStartMs / videoDurationMs) * 100}%` }}
            title="2nd half throw-in"
          >
            <span className="absolute -top-3.5 -translate-x-1/2 text-[8px] text-cyan-400 font-bold whitespace-nowrap">2H</span>
          </div>
        )}
        {halftimeMs != null && videoDurationMs > 0 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-amber-400/60 z-10"
            style={{ left: `${(halftimeMs / videoDurationMs) * 100}%` }}
            title="Half-time"
          >
            <span className="absolute -top-3.5 -translate-x-1/2 text-[8px] text-amber-400 font-bold whitespace-nowrap">HT</span>
          </div>
        )}
        {fullTimeMs != null && videoDurationMs > 0 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-rose-400/60 z-10"
            style={{ left: `${(fullTimeMs / videoDurationMs) * 100}%` }}
            title="Full-time"
          >
            <span className="absolute -top-3.5 -translate-x-1/2 text-[8px] text-rose-400 font-bold whitespace-nowrap">FT</span>
          </div>
        )}

        {/* Event dots */}
        {sortedEvents.map((event) => {
          const percent = videoDurationMs > 0
            ? (event.video_timestamp_ms! / videoDurationMs) * 100
            : 0
          const size = getEventSize(event.event_type)
          const isTwoPointer = event.scoring_context?.is_two_pointer

          return (
            <button
              key={event.id}
              className="absolute top-1/2 -translate-y-1/2 z-10 hover:scale-150 transition-transform"
              style={{
                left: `${percent}%`,
                width: size,
                height: size,
                backgroundColor: getEventColor(event.event_type),
                borderRadius: '50%',
                border: isTwoPointer ? '2px solid #06b6d4' : 'none',
                marginLeft: -size / 2,
              }}
              onClick={(e) => {
                e.stopPropagation()
                onSeek(seekTimeForEvent(event.video_timestamp_ms!))
              }}
              title={`${event.match_minute}:${String(event.match_second).padStart(2, '0')} - ${event.event_type}${isTwoPointer ? ' (2pt)' : ''}`}
            />
          )
        })}
      </div>

      {/* Time labels */}
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-white/30">0:00</span>
        <span className="text-[10px] text-white/30">
          {formatMs(videoDurationMs)}
        </span>
      </div>
    </div>
  )
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
