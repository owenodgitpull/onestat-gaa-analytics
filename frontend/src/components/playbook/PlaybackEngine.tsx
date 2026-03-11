/**
 * PlaybackEngine — read-only animated renderer for playbook phases.
 *
 * Renders the GAA pitch SVG with smoothly animated player dots, progressive
 * arrow drawing, and text label fade-in. Uses useAnimationEngine for timing.
 *
 * Supports: fullscreen, tap-to-advance (when paused), voiceover audio sync.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { useAnimationEngine } from './useAnimationEngine'
import PlaybackControls from './PlaybackControls'
import type { Phase, AnimationSettings } from './types'
import {
  DEFAULT_ANIMATION_SETTINGS,
  toSvgX, toSvgY,
  buildCurvedPath, buildStraightPath, arrowheadPoints,
  OPPONENT_COLOR, OPPONENT_BORDER, DEFAULT_PRIMARY, DEFAULT_SECONDARY,
  PITCH_VIEWBOX,
} from './types'

interface PlaybackEngineProps {
  phases: Phase[]
  settings?: AnimationSettings
  routineName?: string
  voiceoverUrl?: string | null
  teamPrimaryColor?: string
  teamSecondaryColor?: string
  onClose: () => void
  showVoiceoverButton?: boolean
  onRecordVoiceover?: () => void
}

export default function PlaybackEngine({
  phases,
  settings = DEFAULT_ANIMATION_SETTINGS,
  routineName = 'Tactical Play',
  voiceoverUrl = null,
  teamPrimaryColor = DEFAULT_PRIMARY,
  teamSecondaryColor = DEFAULT_SECONDARY,
  onClose,
  showVoiceoverButton = false,
  onRecordVoiceover,
}: PlaybackEngineProps) {
  const engine = useAnimationEngine(phases, settings)
  const containerRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMuted, setIsMuted] = useState(false)

  const {
    currentPhaseIdx, playbackState, interpolatedPlayers,
    prevArrowFadeOut, arrowDrawProgress, labelOpacity,
    advanceOnePhase,
  } = engine

  // Current phase data (for arrows and labels)
  const currentPhase = phases[currentPhaseIdx] || phases[0]
  const prevPhaseIdx = Math.max(0, currentPhaseIdx - 1)
  const prevPhase = currentPhaseIdx > 0 ? phases[prevPhaseIdx] : null

  // ── Audio sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !voiceoverUrl) return

    if (playbackState === 'playing') {
      audio.playbackRate = engine.speed
      audio.play().catch(() => {})
    } else if (playbackState === 'paused') {
      audio.pause()
    } else if (playbackState === 'idle' || playbackState === 'finished') {
      audio.pause()
      audio.currentTime = 0
    }
  }, [playbackState, voiceoverUrl, engine.speed])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.muted = isMuted
  }, [isMuted])

  // ── Fullscreen ───────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // ── Tap-to-advance (when paused) ────────────────────────────────────────
  const handlePitchClick = useCallback(() => {
    if (playbackState === 'paused' || playbackState === 'idle') {
      if (currentPhaseIdx < phases.length - 1) {
        advanceOnePhase()
      }
    }
  }, [playbackState, currentPhaseIdx, phases.length, advanceOnePhase])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Space') {
        e.preventDefault()
        if (playbackState === 'playing') engine.pause()
        else engine.play()
      } else if (e.key === 'Escape') {
        if (isFullscreen) document.exitFullscreen()
        else onClose()
      } else if (e.key === 'ArrowRight') {
        advanceOnePhase()
      } else if (e.key === 'ArrowLeft') {
        engine.seekToPhase(Math.max(0, currentPhaseIdx - 1))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [playbackState, isFullscreen, currentPhaseIdx, engine, advanceOnePhase, onClose])

  // Determine which arrows to show based on transition state
  const showPrevArrows = prevPhase && prevArrowFadeOut < 1
  const showCurrentArrows = arrowDrawProgress > 0

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col" ref={containerRef}>
      {/* Header */}
      {!isFullscreen && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">{routineName}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X size={20} />
          </button>
        </div>
      )}

      {/* Pitch area */}
      <div
        className="flex-1 flex items-center justify-center p-4 cursor-pointer"
        onClick={handlePitchClick}
      >
        <div className="relative w-full max-w-5xl" style={{ aspectRatio: '2332/1446' }}>
          <svg viewBox={PITCH_VIEWBOX} className="w-full h-full rounded-xl overflow-hidden">
            {/* Background */}
            <rect width="2332" height="1446" fill="#2d5016" />
            <image
              href="/pitch-svg.svg"
              width="2332"
              height="1446"
              preserveAspectRatio="xMidYMid meet"
            />

            {/* Previous phase arrows (fading out) */}
            {showPrevArrows && prevPhase!.arrows.map(arrow => {
              const result = arrow.curved
                ? buildCurvedPath(arrow.points)
                : buildStraightPath(arrow.points)
              if (!result.d) return null
              return (
                <g key={`prev-${arrow.id}`} opacity={1 - prevArrowFadeOut}>
                  <path
                    d={result.d}
                    fill="none"
                    stroke={arrow.color}
                    strokeWidth="6"
                    strokeDasharray={arrow.dashed ? '15 8' : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points={arrowheadPoints(result.endPt, result.endAngle, 20)}
                    fill={arrow.color}
                  />
                </g>
              )
            })}

            {/* Current phase arrows (drawing in progressively) */}
            {showCurrentArrows && currentPhase.arrows.map(arrow => {
              const result = arrow.curved
                ? buildCurvedPath(arrow.points)
                : buildStraightPath(arrow.points)
              if (!result.d) return null
              return (
                <ArrowWithDrawIn
                  key={`curr-${arrow.id}`}
                  d={result.d}
                  endPt={result.endPt}
                  endAngle={result.endAngle}
                  color={arrow.color}
                  dashed={arrow.dashed}
                  progress={arrowDrawProgress}
                />
              )
            })}

            {/* Previous phase labels (fading out with arrows) */}
            {showPrevArrows && prevPhase!.labels.map(label => {
              const lx = toSvgX(label.x)
              const ly = toSvgY(label.y)
              const rot = label.rotation || 0
              return (
                <g
                  key={`prev-lbl-${label.id}`}
                  transform={rot ? `rotate(${rot} ${lx} ${ly})` : undefined}
                  opacity={1 - prevArrowFadeOut}
                >
                  <rect
                    x={lx - 8} y={ly - 20}
                    width={label.text.length * 14 + 16} height="32" rx="6"
                    fill="rgba(168,85,247,0.3)"
                    stroke="rgba(168,85,247,0.7)"
                    strokeWidth="2.5"
                  />
                  <text
                    x={lx} y={ly + 4}
                    fill="#E9D5FF" fontSize="22" fontWeight="700" fontFamily="sans-serif"
                  >
                    {label.text}
                  </text>
                </g>
              )
            })}

            {/* Current phase labels (fading in) */}
            {labelOpacity > 0 && currentPhase.labels.map(label => {
              const lx = toSvgX(label.x)
              const ly = toSvgY(label.y)
              const rot = label.rotation || 0
              const scale = 0.9 + 0.1 * labelOpacity
              return (
                <g
                  key={`lbl-${label.id}`}
                  transform={`${rot ? `rotate(${rot} ${lx} ${ly}) ` : ''}translate(${lx}, ${ly}) scale(${scale}) translate(${-lx}, ${-ly})`}
                  opacity={labelOpacity}
                >
                  <rect
                    x={lx - 8} y={ly - 20}
                    width={label.text.length * 14 + 16} height="32" rx="6"
                    fill="rgba(168,85,247,0.3)"
                    stroke="rgba(168,85,247,0.7)"
                    strokeWidth="2.5"
                  />
                  <text
                    x={lx} y={ly + 4}
                    fill="#E9D5FF" fontSize="22" fontWeight="700" fontFamily="sans-serif"
                  >
                    {label.text}
                  </text>
                </g>
              )
            })}

            {/* Player dots (interpolated positions) */}
            {interpolatedPlayers.map(p => {
              const cx = toSvgX(p.x)
              const cy = toSvgY(p.y)
              const bgColor = p.isOpponent ? OPPONENT_COLOR : teamPrimaryColor
              const borderColor = p.isOpponent ? OPPONENT_BORDER : teamSecondaryColor
              const textColor = p.isOpponent ? '#FFFFFF' : teamSecondaryColor
              return (
                <g key={`${p.isOpponent ? 'opp' : 'own'}-${p.jerseyNumber}`} opacity={p.opacity}>
                  <circle
                    cx={cx} cy={cy} r="40"
                    fill={bgColor}
                    stroke={borderColor}
                    strokeWidth={p.isOpponent ? '4' : '5'}
                  />
                  {p.isOpponent && (
                    <>
                      <line x1={cx - 14} y1={cy - 14} x2={cx + 14} y2={cy + 14} stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                      <line x1={cx + 14} y1={cy - 14} x2={cx - 14} y2={cy + 14} stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                    </>
                  )}
                  <text
                    x={cx} y={cy + 10}
                    textAnchor="middle"
                    fill={textColor} fontSize="32" fontWeight="bold" fontFamily="sans-serif"
                  >
                    {p.jerseyNumber}
                  </text>
                  <rect
                    x={cx - Math.min(p.playerName.length * 8 + 10, 120)}
                    y={cy + 44}
                    width={Math.min(p.playerName.length * 16 + 20, 240)}
                    height="30" rx="6"
                    fill="rgba(0,0,0,0.75)"
                  />
                  <text
                    x={cx} y={cy + 64}
                    textAnchor="middle"
                    fill="white" fontSize="20" fontWeight="600" fontFamily="sans-serif"
                  >
                    {p.playerName.length > 14 ? p.playerName.substring(0, 12) + '\u2026' : p.playerName}
                  </text>
                </g>
              )
            })}

            {/* Phase badge */}
            {phases.length > 1 && (
              <g>
                <rect x="30" y="25" width="220" height="55" rx="12"
                  fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                <rect x="30" y="25" width="220" height="55" rx="12" fill="rgba(0,176,255,0.08)" />
                <text x="140" y="62" textAnchor="middle"
                  fill="rgba(255,255,255,0.85)" fontSize="28" fontWeight="bold" fontFamily="sans-serif">
                  Phase {currentPhaseIdx + 1} of {phases.length}
                </text>
              </g>
            )}

            {/* Tap-to-advance hint (when paused) */}
            {(playbackState === 'paused' || playbackState === 'idle') && phases.length > 1 && currentPhaseIdx < phases.length - 1 && (
              <g>
                <rect x="916" y="680" width="500" height="55" rx="12"
                  fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                <text x="1166" y="715" textAnchor="middle"
                  fill="rgba(255,255,255,0.5)" fontSize="22" fontFamily="sans-serif">
                  Tap to advance  |  Space to play
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* Controls */}
      <PlaybackControls
        engine={engine}
        totalPhases={phases.length}
        onFullscreen={toggleFullscreen}
        voiceoverUrl={voiceoverUrl}
        isMuted={isMuted}
        onToggleMute={() => setIsMuted(prev => !prev)}
        showVoiceoverButton={showVoiceoverButton}
        onRecordVoiceover={onRecordVoiceover}
      />

      {/* Hidden audio element for voiceover */}
      {voiceoverUrl && (
        <audio ref={audioRef} src={voiceoverUrl} preload="auto" />
      )}
    </div>
  )
}

// ── ArrowWithDrawIn — progressive arrow drawing via stroke-dashoffset ──────
function ArrowWithDrawIn({
  d, endPt, endAngle, color, dashed, progress,
}: {
  d: string
  endPt: { x: number; y: number }
  endAngle: number
  color: string
  dashed?: boolean
  progress: number
}) {
  const pathRef = useRef<SVGPathElement>(null)
  const [totalLength, setTotalLength] = useState(1000)

  useEffect(() => {
    if (pathRef.current) {
      setTotalLength(pathRef.current.getTotalLength())
    }
  }, [d])

  const dashOffset = totalLength * (1 - progress)
  const arrowOpacity = progress >= 0.9 ? (progress - 0.9) / 0.1 : 0 // Arrowhead appears at end

  return (
    <g>
      <path
        ref={pathRef}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeDasharray={dashed ? `15 8` : `${totalLength}`}
        strokeDashoffset={dashed ? undefined : dashOffset}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={dashed ? progress : 1}
      />
      <polygon
        points={arrowheadPoints(endPt, endAngle, 20)}
        fill={color}
        opacity={arrowOpacity}
      />
    </g>
  )
}
