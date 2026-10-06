/**
 * VideoPlayer — Native HTML5 video wrapper with imperative controls for tagging.
 *
 * Provides: play/pause, seek to timestamp, skip ±5s, playback speed control,
 * and continuous time reporting via onTimeUpdate.
 *
 * Uses native <video> element (no external lib). Sufficient for human tagging.
 * Can be swapped to video.js later if frame-accurate seeking is needed.
 */

import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Play, Pause, SkipBack, SkipForward, Gauge } from 'lucide-react'

export interface VideoPlayerHandle {
  seekTo: (ms: number) => void
  getCurrentTimeMs: () => number
  play: () => void
  pause: () => void
  isPlaying: () => boolean
  getVideoElement: () => HTMLVideoElement | null
}

interface VideoPlayerProps {
  src: string | null
  onTimeUpdate?: (currentTimeMs: number) => void
  onDurationChange?: (durationMs: number) => void
  onPlayStateChange?: (playing: boolean) => void
  halftimeMs?: number
  /** Match-timing markers shown on the scrub bar alongside halftimeMs —
   * throw-in (1H), 2nd-half restart (2H), full-time (FT). */
  firstHalfStartMs?: number
  secondHalfStartMs?: number
  fullTimeMs?: number
  /** Forward-seek ceiling (ms) — while set, scrubbing/skip-forward/seekTo
   * can't jump past this point. Used during tracking mode so events are
   * always logged in chronological order; rewinding is never restricted. */
  maxSeekMs?: number
  /** Position to restore to the first time this instance loads metadata.
   * The parent page toggles fullscreen by branching its whole return tree,
   * which remounts this component (a fresh <video> element resets
   * currentTime to 0) — passing the last known position back in here
   * restores it once metadata is available, so toggling fullscreen never
   * loses scrub position. Ignored on ordinary playback (only consulted
   * once per mount). */
  initialTimeMs?: number
  /** True only in fullscreen mode. The video box normally sizes itself via
   * `aspect-video` (height derived from width) — harmless on a scrollable
   * page, but fullscreen sits in a fixed-height flex column with
   * `overflow-hidden`, so a width-derived height taller than the actual
   * available space clips the controls row (and its scrub bar) right off
   * the bottom. When true, the video box fills whatever height its flex
   * parent actually has (`flex-1 min-h-0`) instead of deriving one from
   * width, guaranteeing the controls row stays visible. */
  fillHeight?: boolean
  /** Disable all video controls (play/pause/seek/speed) — used during setup
   * flow when video scrubbing is allowed but tracking hasn't started yet. */
  disabled?: boolean
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ src, onTimeUpdate, onDurationChange, onPlayStateChange, halftimeMs, firstHalfStartMs, secondHalfStartMs, fullTimeMs, maxSeekMs, initialTimeMs, fillHeight, disabled = false }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const hasRestoredPositionRef = useRef(false)
    const [playing, setPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [playbackRate, setPlaybackRate] = useState(1)
    const [showRateMenu, setShowRateMenu] = useState(false)
    const [flashIcon, setFlashIcon] = useState<'play' | 'pause' | null>(null)
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Hover-time preview on the scrub bar — percent (0-1) of the hovered
    // position, null when not hovering. Purely informational, no seek.
    const [hoverPercent, setHoverPercent] = useState<number | null>(null)

    useImperativeHandle(ref, () => ({
      seekTo: (ms: number) => {
        if (videoRef.current) {
          const clamped = maxSeekMs != null ? Math.min(ms, maxSeekMs) : ms
          videoRef.current.currentTime = clamped / 1000
        }
      },
      getCurrentTimeMs: () => {
        return videoRef.current ? Math.round(videoRef.current.currentTime * 1000) : 0
      },
      play: () => videoRef.current?.play(),
      pause: () => videoRef.current?.pause(),
      isPlaying: () => (videoRef.current ? !videoRef.current.paused : playing),
      getVideoElement: () => videoRef.current,
    }))

    const handleTimeUpdate = useCallback(() => {
      if (videoRef.current) {
        const ms = Math.round(videoRef.current.currentTime * 1000)
        setCurrentTime(ms)
        onTimeUpdate?.(ms)
      }
    }, [onTimeUpdate])

    const handleDurationChange = useCallback(() => {
      if (videoRef.current) {
        const ms = Math.round(videoRef.current.duration * 1000)
        setDuration(ms)
        onDurationChange?.(ms)
        // Restore scrub position once per mount (see initialTimeMs doc) —
        // metadata must be loaded before currentTime can be set reliably.
        if (!hasRestoredPositionRef.current && initialTimeMs) {
          hasRestoredPositionRef.current = true
          videoRef.current.currentTime = initialTimeMs / 1000
          setCurrentTime(initialTimeMs)
        }
      }
    }, [onDurationChange, initialTimeMs])

    const togglePlay = () => {
      if (!videoRef.current) return
      if (playing) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
    }

    const skip = (seconds: number) => {
      if (videoRef.current) {
        let target = Math.max(0, videoRef.current.currentTime + seconds)
        if (maxSeekMs != null && seconds > 0) {
          target = Math.min(target, maxSeekMs / 1000)
        }
        videoRef.current.currentTime = target
      }
    }

    const changeRate = (rate: number) => {
      if (videoRef.current) {
        videoRef.current.playbackRate = rate
        setPlaybackRate(rate)
        setShowRateMenu(false)
      }
    }

    const triggerFlash = useCallback((icon: 'play' | 'pause') => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
      setFlashIcon(icon)
      flashTimer.current = setTimeout(() => setFlashIcon(null), 600)
    }, [])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return

      const onPlay = () => { setPlaying(true); onPlayStateChange?.(true); triggerFlash('play') }
      const onPause = () => { setPlaying(false); onPlayStateChange?.(false); triggerFlash('pause') }
      // Sync playing state if video paused externally (e.g. end of video, error)
      const onEnded = () => { setPlaying(false); onPlayStateChange?.(false) }

      video.addEventListener('play', onPlay)
      video.addEventListener('pause', onPause)
      video.addEventListener('ended', onEnded)
      return () => {
        video.removeEventListener('play', onPlay)
        video.removeEventListener('pause', onPause)
        video.removeEventListener('ended', onEnded)
      }
    }, [onPlayStateChange, triggerFlash])

    // Re-sync playing state after re-renders (e.g. parent refetch causing remount)
    useEffect(() => {
      const video = videoRef.current
      if (video) {
        setPlaying(!video.paused)
      }
    })

    // Keyboard shortcuts
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

        switch (e.key) {
          case ' ':
            e.preventDefault()
            togglePlay()
            break
          case 'ArrowLeft':
            e.preventDefault()
            skip(-5)
            break
          case 'ArrowRight':
            e.preventDefault()
            skip(5)
            break
        }
      }

      window.addEventListener('keydown', handler)
      return () => window.removeEventListener('keydown', handler)
    }, [playing])

    const formatTime = (ms: number) => {
      const s = Math.floor(ms / 1000)
      const min = Math.floor(s / 60)
      const sec = s % 60
      return `${min}:${String(sec).padStart(2, '0')}`
    }

    return (
      <div className={fillHeight ? 'h-full flex flex-col gap-2' : 'space-y-2'}>
        {/* Video element */}
        <div className={`relative bg-black rounded-lg overflow-hidden ${fillHeight ? 'flex-1 min-h-0' : 'aspect-video'}`}>
          {src ? (
            <>
              <video
                ref={videoRef}
                src={src}
                crossOrigin="anonymous"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleDurationChange}
                onClick={togglePlay}
                className="w-full h-full object-contain cursor-pointer"
                preload="metadata"
              />

              {/* Centre play button — visible when paused */}
              {!playing && (
                <div
                  className="absolute inset-0 flex items-center justify-center cursor-pointer z-10"
                  onClick={togglePlay}
                >
                  <div className="flex items-center justify-center w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 shadow-xl shadow-black/30 transition-transform hover:scale-110 active:scale-95">
                    <Play size={28} className="text-white ml-1" fill="white" />
                  </div>
                </div>
              )}

              {/* Flash icon — brief indicator on play/pause transition */}
              {flashIcon && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 animate-[fadeOut_0.6s_ease-out_forwards]">
                  <div className="flex items-center justify-center w-20 h-20 rounded-full bg-black/40 backdrop-blur-sm">
                    {flashIcon === 'play'
                      ? <Play size={36} className="text-white ml-1" fill="white" />
                      : <Pause size={36} className="text-white" fill="white" />
                    }
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30">
              <span>No video loaded</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className={`flex-shrink-0 flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 transition-opacity ${
          disabled ? 'opacity-30 pointer-events-none' : ''
        }`}>
          {/* Skip back */}
          <button
            onClick={() => skip(-5)}
            className="p-1.5 text-white/60 hover:text-white transition-colors"
            title="Back 5s (Left Arrow)"
          >
            <SkipBack size={18} />
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="p-2 bg-emerald-600 hover:bg-emerald-700 rounded-full text-white transition-colors"
            title="Play/Pause (Space)"
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>

          {/* Skip forward */}
          <button
            onClick={() => skip(5)}
            className="p-1.5 text-white/60 hover:text-white transition-colors"
            title="Forward 5s (Right Arrow)"
          >
            <SkipForward size={18} />
          </button>

          {/* Time display */}
          <span className="text-sm text-white/60 font-mono ml-2">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Scrubber */}
          <div
            className="flex-1 relative"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
              setHoverPercent(percent)
            }}
            onMouseLeave={() => setHoverPercent(null)}
          >
            {hoverPercent != null && duration > 0 && (
              <div
                className="absolute bottom-full mb-1.5 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/85 text-[10px] font-mono text-white pointer-events-none whitespace-nowrap z-20"
                style={{ left: `${hoverPercent * 100}%` }}
              >
                {formatTime(hoverPercent * duration)}
              </div>
            )}
            <input
              type="range"
              min={0}
              // Always the full duration — this MUST match the scale the tick
              // marks and hover-preview tooltip use (both position by
              // `x / duration`), or a click/drag lands at a completely
              // different time than what's shown under the pointer. The
              // forward-scrub lock is enforced entirely in onChange below
              // (clamping the actual seek) and in the `value` clamp for
              // display, not by shrinking the slider's own range.
              max={duration}
              value={Math.min(currentTime, maxSeekMs != null ? Math.min(duration, maxSeekMs) : duration)}
              onChange={(e) => {
                const ms = parseInt(e.target.value)
                if (videoRef.current) {
                  const clamped = maxSeekMs != null ? Math.min(ms, maxSeekMs) : ms
                  videoRef.current.currentTime = clamped / 1000
                }
              }}
              className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-500"
            />
            {maxSeekMs != null && duration > 0 && maxSeekMs < duration && (
              <div
                className="absolute top-0 bottom-0 right-0 bg-black/40 rounded-r-full pointer-events-none"
                style={{ left: `${(maxSeekMs / duration) * 100}%` }}
                title="Can't skip ahead while tracking — rewinding is fine"
              />
            )}
            {firstHalfStartMs != null && duration > 0 && (
              <div
                className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
                style={{ left: `${(firstHalfStartMs / duration) * 100}%` }}
              >
                <span className="text-[9px] font-bold text-cyan-400 -translate-y-3.5 select-none">1H</span>
                <div className="w-0.5 h-full bg-cyan-400 rounded-full" />
              </div>
            )}
            {secondHalfStartMs != null && duration > 0 && (
              <div
                className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
                style={{ left: `${(secondHalfStartMs / duration) * 100}%` }}
              >
                <span className="text-[9px] font-bold text-cyan-400 -translate-y-3.5 select-none">2H</span>
                <div className="w-0.5 h-full bg-cyan-400 rounded-full" />
              </div>
            )}
            {fullTimeMs != null && duration > 0 && (
              <div
                className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
                style={{ left: `${(fullTimeMs / duration) * 100}%` }}
              >
                <span className="text-[9px] font-bold text-rose-400 -translate-y-3.5 select-none">FT</span>
                <div className="w-0.5 h-full bg-rose-400 rounded-full" />
              </div>
            )}
            {halftimeMs != null && duration > 0 && (
              <div
                className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
                style={{ left: `${(halftimeMs / duration) * 100}%` }}
              >
                <span className="text-[9px] font-bold text-amber-400 -translate-y-3.5 select-none">HT</span>
                <div className="w-0.5 h-full bg-amber-400 rounded-full" />
              </div>
            )}
          </div>

          {/* Playback speed - quick access buttons + full menu */}
          <div className="flex items-center gap-1">
            {/* Quick speed presets */}
            {[0.5, 0.75, 1].map((rate) => (
              <button
                key={rate}
                onClick={() => changeRate(rate)}
                className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                  playbackRate === rate
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'
                }`}
                title={`${rate}x speed`}
              >
                {rate}x
              </button>
            ))}

            {/* Full menu for all speeds */}
            <div className="relative">
              <button
                onClick={() => setShowRateMenu(!showRateMenu)}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  [0.5, 0.75, 1].includes(playbackRate)
                    ? 'text-white/50 hover:text-white/70 bg-white/5'
                    : 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                }`}
                title="More speeds"
              >
                <Gauge size={13} />
              </button>
              {showRateMenu && (
                <div className="absolute bottom-full right-0 mb-1 bg-gray-800 rounded-lg shadow-lg border border-white/10 overflow-hidden z-30">
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      onClick={() => changeRate(rate)}
                      className={`block w-full px-4 py-1.5 text-xs text-left hover:bg-white/10 ${
                        playbackRate === rate ? 'text-emerald-400' : 'text-white/70'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }
)

VideoPlayer.displayName = 'VideoPlayer'

export default VideoPlayer
