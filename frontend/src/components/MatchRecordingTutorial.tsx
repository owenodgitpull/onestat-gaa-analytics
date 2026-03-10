/**
 * MatchRecordingTutorial — Interactive guided walkthrough for match recording.
 *
 * Two phases:
 *   Phase 1 (Observe): Click-through tooltips introducing each control
 *   Phase 2 (Practice): User performs real actions; tutorial advances on completion
 *
 * Uses a spotlight overlay with glassmorphism tooltips matching the app's design.
 * Progress is persisted to localStorage so the tutorial only runs once.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, ChevronRight, ChevronLeft, Sparkles, SkipForward } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TutorialStep {
  id: string
  phase: 'observe' | 'practice'
  target: string | null // CSS selector for spotlight, null = centered modal
  title: string
  description: string
  /** Where to place the tooltip relative to the target */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** For practice steps: condition to auto-advance */
  advanceWhen?: (state: TutorialMatchState) => boolean
  /** Hint text shown below description for practice steps */
  hint?: string
}

export interface TutorialMatchState {
  matchPhase: string
  ballPosition: { x: number; y: number }
  lastEventType: string | null
  eventCount: number
  isStopped: boolean
  activeCarrierId: string | null
  snapshotCount: number
}

// ── Step Definitions ──────────────────────────────────────────────────────────

const TUTORIAL_STEPS: TutorialStep[] = [
  // Phase 1: Controls Introduction
  {
    id: 'welcome',
    phase: 'observe',
    target: null,
    title: 'Welcome to Match Recording',
    description: 'This interactive tutorial will walk you through recording a live match — from starting the clock to logging scores, kickouts, and turnovers. You\'ll practice each action on a real pitch.',
  },
  {
    id: 'timer-controls',
    phase: 'observe',
    target: '[data-tour="phase-controls"]',
    title: 'Match Timer & Controls',
    description: 'Start and end each half from here. The timer runs automatically during play. You\'ll also find the lineup selector and manual event entry here.',
    placement: 'bottom',
  },
  {
    id: 'pitch-intro',
    phase: 'observe',
    target: '[data-tour="pitch-container"]',
    title: 'Interactive Pitch',
    description: 'Drag the ball marker to track where play is happening. The ball\'s position determines which zone events are recorded in, and enables context-aware buttons like 2-pointers inside the arc.',
    placement: 'top',
  },
  {
    id: 'possession-intro',
    phase: 'observe',
    target: '[data-tour="possession-indicator"]',
    title: 'Possession & Stoppages',
    description: 'Shows which team has the ball. The possession clock runs continuously — it\'s critical to log stoppages (injuries, frees being taken, water breaks) to prevent possession time accumulating when play is dead. Use the pause button to mark stoppages.',
    placement: 'bottom',
  },
  {
    id: 'action-tabs-intro',
    phase: 'observe',
    target: '[data-tour="action-category-tabs"]',
    title: 'Event Categories',
    description: 'Events are grouped into tabs: Shooting (scores, wides), Turnovers, Our Kickouts, Opponent Kickouts, plus Foul and Discipline buttons. The system auto-switches to the kickout tab after scores.',
    placement: 'top',
  },
  {
    id: 'scoring-intro',
    phase: 'observe',
    target: '[data-tour="scoring-buttons"]',
    title: 'Context-Aware Scoring',
    description: 'Scoring buttons adapt to the ball position. Inside the 2-point arc, the "2PT" button enables and "Point" disables automatically — preventing mistakes during fast play.',
    placement: 'top',
  },
  {
    id: 'jersey-strip-intro',
    phase: 'observe',
    target: '[data-tour="jersey-strip"]',
    title: 'Ball Carrier Tracking',
    description: 'Tap a jersey number to set who\'s carrying the ball. This creates carry maps and passing networks for AI analysis. The active carrier is highlighted — tap another number when possession transfers.',
    placement: 'bottom',
  },
  {
    id: 'snapshot-intro',
    phase: 'observe',
    target: '[data-tour="snapshot-btn"]',
    title: 'Formation Snapshots',
    description: 'Tap the camera icon to capture your team\'s formation at key moments. The button pulses after scores and during stoppages as a reminder. Snapshots help the AI analyse your defensive and attacking shapes.',
    placement: 'left',
  },

  // Phase 2: Interactive Practice
  {
    id: 'practice-start-half',
    phase: 'practice',
    target: '[data-tour="phase-controls"]',
    title: 'Start the Match',
    description: 'Press the "Start 1st Half" button to begin recording.',
    placement: 'bottom',
    hint: 'Tap the green button with the play icon',
    advanceWhen: (s) => s.matchPhase === 'first_half',
  },
  {
    id: 'practice-drag-ball',
    phase: 'practice',
    target: '[data-tour="pitch-container"]',
    title: 'Move the Ball',
    description: 'Drag the ball from your backline up through midfield into the attacking half.',
    placement: 'top',
    hint: 'Drag the ball marker past the halfway line (x > 55)',
    advanceWhen: (s) => s.ballPosition.x > 55,
  },
  {
    id: 'practice-log-point',
    phase: 'practice',
    target: '[data-tour="scoring-buttons"]',
    title: 'Log a Point',
    description: 'Your team has the ball in the attacking half. Tap "Point" to log a score. After logging, you\'ll be asked to select which player scored.',
    placement: 'top',
    hint: 'Tap the "Point" button in the Shooting tab',
    advanceWhen: (s) => s.lastEventType === 'point',
  },
  {
    id: 'practice-log-kickout-1',
    phase: 'practice',
    target: '[data-tour="action-category-tabs"]',
    title: 'Log the Kickout',
    description: 'After a score, the kickout tab opens automatically. Select the kickout position on the pitch, then log who won it. This tracks kickout retention — a key performance metric.',
    placement: 'top',
    hint: 'Log any kickout outcome (e.g. "We Won Clean")',
    advanceWhen: (s) => s.lastEventType?.includes('kickout') ?? false,
  },
  {
    id: 'practice-move-to-2pt',
    phase: 'practice',
    target: '[data-tour="pitch-container"]',
    title: 'Move to 2-Point Range',
    description: 'Drag the ball into the attacking half, outside the 40-meter arc. You\'ll see the "2PT" button enable automatically when the ball is in range.',
    placement: 'top',
    hint: 'Move the ball to x > 70 (deep in the attacking half)',
    advanceWhen: (s) => s.ballPosition.x > 70,
  },
  {
    id: 'practice-log-2pointer',
    phase: 'practice',
    target: '[data-tour="scoring-buttons"]',
    title: 'Log a 2-Pointer',
    description: 'The ball is in 2-point range. Tap "2PT" to log a 2-pointer. Notice how "Point" is disabled to prevent errors — the system knows the ball is outside the arc.',
    placement: 'top',
    hint: 'Tap the "2PT" button',
    advanceWhen: (s) => s.lastEventType === 'two_point',
  },
  {
    id: 'practice-log-turnover',
    phase: 'practice',
    target: '[data-tour="turnovers-tab"]',
    title: 'Log a Turnover',
    description: 'Switch to the Turnovers tab and log a turnover won. This tracks where and when your team wins the ball back — crucial for counter-attack analysis.',
    placement: 'top',
    hint: 'Tap the Turnovers tab, then "T/O Won"',
    advanceWhen: (s) => s.lastEventType === 'turnover_won',
  },
  {
    id: 'practice-stoppage',
    phase: 'practice',
    target: '[data-tour="stoppage-btn"]',
    title: 'Log a Stoppage',
    description: 'Tap the pause button to mark a stoppage. This freezes the possession clock — without this, one team\'s possession percentage would inflate during dead ball time.',
    placement: 'bottom',
    hint: 'Tap the pause icon on the pitch overlay',
    advanceWhen: (s) => s.isStopped,
  },
  {
    id: 'practice-carrier',
    phase: 'practice',
    target: '[data-tour="jersey-strip"]',
    title: 'Set a Ball Carrier',
    description: 'Tap any jersey number to mark who\'s carrying the ball. This creates player carry maps and passing sequences that feed into AI tactical analysis.',
    placement: 'bottom',
    hint: 'Tap any jersey number in the strip',
    advanceWhen: (s) => s.activeCarrierId != null,
  },

  // Completion
  {
    id: 'complete',
    phase: 'observe',
    target: null,
    title: 'You\'re Ready!',
    description: 'You\'ve mastered the core match recording controls. Every event you log feeds into AI analysis — generating charts, insights, and tactical reports. The more you capture, the richer the analysis.\n\nTip: Use fullscreen mode on mobile for the best pitchside experience.',
  },
]

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'gaa-match-tutorial'

function markTutorialComplete() {
  try {
    localStorage.setItem(STORAGE_KEY, 'complete')
  } catch { /* noop */ }
}

export function resetMatchTutorial() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* noop */ }
}

const PENDING_KEY = 'gaa-match-tutorial-pending'

/** Request the tutorial to start on the next match recording page visit */
export function requestMatchTutorial() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.setItem(PENDING_KEY, '1')
  } catch { /* noop */ }
}

/** Check and consume a pending tutorial request */
export function consumePendingTutorial(): boolean {
  try {
    if (localStorage.getItem(PENDING_KEY) === '1') {
      localStorage.removeItem(PENDING_KEY)
      return true
    }
  } catch { /* noop */ }
  return false
}

// ── Spotlight Positioning ─────────────────────────────────────────────────────

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function getElementRect(selector: string): Rect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function getTooltipPosition(
  targetRect: Rect | null,
  placement: string,
  tooltipWidth: number,
  tooltipHeight: number,
): { top: number; left: number } {
  if (!targetRect) {
    // Center on screen
    return {
      top: Math.max(60, (window.innerHeight - tooltipHeight) / 2),
      left: Math.max(16, (window.innerWidth - tooltipWidth) / 2),
    }
  }

  const gap = 16
  const cx = targetRect.left + targetRect.width / 2

  switch (placement) {
    case 'bottom':
      return {
        top: targetRect.top + targetRect.height + gap,
        left: Math.max(16, Math.min(cx - tooltipWidth / 2, window.innerWidth - tooltipWidth - 16)),
      }
    case 'top':
      return {
        top: Math.max(16, targetRect.top - tooltipHeight - gap),
        left: Math.max(16, Math.min(cx - tooltipWidth / 2, window.innerWidth - tooltipWidth - 16)),
      }
    case 'left':
      return {
        top: Math.max(16, targetRect.top + targetRect.height / 2 - tooltipHeight / 2),
        left: Math.max(16, targetRect.left - tooltipWidth - gap),
      }
    case 'right':
      return {
        top: Math.max(16, targetRect.top + targetRect.height / 2 - tooltipHeight / 2),
        left: Math.min(targetRect.left + targetRect.width + gap, window.innerWidth - tooltipWidth - 16),
      }
    default:
      return {
        top: targetRect.top + targetRect.height + gap,
        left: Math.max(16, Math.min(cx - tooltipWidth / 2, window.innerWidth - tooltipWidth - 16)),
      }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  active: boolean
  onComplete: () => void
  matchState: TutorialMatchState
}

export default function MatchRecordingTutorial({ active, onComplete, matchState }: Props) {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const practiceAdvancedRef = useRef(false)

  const step = TUTORIAL_STEPS[stepIndex]
  const isLastStep = stepIndex === TUTORIAL_STEPS.length - 1
  const isPractice = step?.phase === 'practice'
  const totalSteps = TUTORIAL_STEPS.length
  // Progress within current phase
  const phaseLabel = useMemo(() => {
    if (!step) return ''
    if (step.id === 'welcome' || step.id === 'complete') return ''
    return isPractice ? 'Practice' : 'Learn'
  }, [step, isPractice])

  // ── Position tracking ───────────────────────────────────────────────────

  const updatePosition = useCallback(() => {
    if (!step || !active) return

    const rect = step.target ? getElementRect(step.target) : null
    setTargetRect(rect)

    const tw = 380
    const th = tooltipRef.current?.offsetHeight ?? 200
    const pos = getTooltipPosition(rect, step.placement || 'bottom', tw, th)
    setTooltipPos(pos)

    rafRef.current = requestAnimationFrame(updatePosition)
  }, [step, active])

  useEffect(() => {
    if (active) {
      rafRef.current = requestAnimationFrame(updatePosition)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [active, updatePosition])

  // ── Practice step auto-advance ──────────────────────────────────────────

  useEffect(() => {
    if (!active || !isPractice || !step?.advanceWhen) return

    if (step.advanceWhen(matchState) && !practiceAdvancedRef.current) {
      practiceAdvancedRef.current = true
      // Small delay so user sees the action complete
      const timer = setTimeout(() => {
        practiceAdvancedRef.current = false
        setStepIndex(i => Math.min(i + 1, TUTORIAL_STEPS.length - 1))
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [active, isPractice, step, matchState])

  // ── Navigation ──────────────────────────────────────────────────────────

  const handleNext = useCallback(() => {
    if (isLastStep) {
      markTutorialComplete()
      onComplete()
    } else {
      practiceAdvancedRef.current = false
      setStepIndex(i => i + 1)
    }
  }, [isLastStep, onComplete])

  const handlePrev = useCallback(() => {
    if (stepIndex > 0) {
      practiceAdvancedRef.current = false
      setStepIndex(i => i - 1)
    }
  }, [stepIndex])

  const handleSkip = useCallback(() => {
    markTutorialComplete()
    onComplete()
  }, [onComplete])

  // ── Keyboard navigation ─────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip()
      if (e.key === 'ArrowRight' && !isPractice) handleNext()
      if (e.key === 'ArrowLeft') handlePrev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, handleSkip, handleNext, handlePrev, isPractice])

  if (!active || !step) return null

  const spotlightPadding = 8

  return (
    <>
      {/* Overlay — dark backdrop with spotlight cutout */}
      <div
        className="fixed inset-0 z-[9998] transition-opacity duration-300"
        style={{
          pointerEvents: isPractice ? 'none' : undefined,
          background: targetRect
            ? undefined
            : 'rgba(0, 0, 0, 0.7)',
        }}
        onClick={isPractice ? undefined : (e) => {
          // Don't close if clicking the tooltip
          if (tooltipRef.current?.contains(e.target as Node)) return
          // For observe steps, clicking overlay does nothing (use buttons)
        }}
      >
        {/* SVG mask for spotlight cutout */}
        {targetRect && (
          <svg
            className="fixed inset-0 w-full h-full"
            style={{ pointerEvents: isPractice ? 'none' : 'auto' }}
          >
            <defs>
              <mask id="tutorial-spotlight-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <rect
                  x={targetRect.left - spotlightPadding}
                  y={targetRect.top - spotlightPadding}
                  width={targetRect.width + spotlightPadding * 2}
                  height={targetRect.height + spotlightPadding * 2}
                  rx="12"
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              x="0" y="0"
              width="100%" height="100%"
              fill="rgba(0,0,0,0.7)"
              mask="url(#tutorial-spotlight-mask)"
            />
          </svg>
        )}

        {/* Spotlight border glow */}
        {targetRect && (
          <div
            className="fixed rounded-xl pointer-events-none transition-all duration-300"
            style={{
              top: targetRect.top - spotlightPadding,
              left: targetRect.left - spotlightPadding,
              width: targetRect.width + spotlightPadding * 2,
              height: targetRect.height + spotlightPadding * 2,
              border: '2px solid rgba(0, 230, 118, 0.5)',
              boxShadow: '0 0 20px rgba(0, 230, 118, 0.15)',
            }}
          />
        )}
      </div>

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="fixed z-[9999] w-[380px] max-w-[calc(100vw-32px)] transition-all duration-300 ease-out"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          pointerEvents: 'auto',
        }}
      >
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(15, 23, 42, 0.97)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 24px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {/* Top gradient bar */}
          <div
            className="h-[2px]"
            style={{ background: 'linear-gradient(90deg, #00E676, #00B0FF)' }}
          />

          {/* Header */}
          <div className="px-5 pt-4 pb-0 flex items-start justify-between">
            <div className="flex items-center gap-2">
              {isPractice && (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  PRACTICE
                </span>
              )}
              {phaseLabel && !isPractice && (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  LEARN
                </span>
              )}
            </div>
            <button
              onClick={handleSkip}
              className="p-1 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
              title="Skip tutorial"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="px-5 pt-2 pb-4">
            <h3 className="text-[15px] font-bold text-white mb-2">{step.title}</h3>
            <p className="text-[13px] leading-relaxed text-white/65 whitespace-pre-line">
              {step.description}
            </p>
            {isPractice && step.hint && (
              <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <Sparkles size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                <span className="text-xs text-emerald-400/80">{step.hint}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pb-4 flex items-center justify-between">
            {/* Progress */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-white/30 font-medium">
                {stepIndex + 1} / {totalSteps}
              </span>
              <div className="flex gap-1">
                {TUTORIAL_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className="h-1 rounded-full transition-all duration-300"
                    style={{
                      width: i === stepIndex ? 16 : 4,
                      background: i < stepIndex
                        ? 'rgba(0, 230, 118, 0.6)'
                        : i === stepIndex
                          ? 'linear-gradient(90deg, #00E676, #00B0FF)'
                          : 'rgba(255,255,255,0.15)',
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              {stepIndex > 0 && (
                <button
                  onClick={handlePrev}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white/70 bg-white/8 hover:bg-white/14 transition-colors"
                >
                  <ChevronLeft size={12} />
                  Back
                </button>
              )}

              {isPractice ? (
                <button
                  onClick={handleNext}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white/50 bg-white/5 hover:bg-white/10 transition-colors"
                  title="Skip this step"
                >
                  <SkipForward size={12} />
                  Skip
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all hover:-translate-y-px"
                  style={{
                    background: 'linear-gradient(135deg, #00E676, #00B0FF)',
                    color: '#0a1a10',
                    boxShadow: '0 4px 15px -3px rgba(0, 230, 118, 0.35)',
                  }}
                >
                  {isLastStep ? 'Done' : 'Next'}
                  {!isLastStep && <ChevronRight size={12} />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
