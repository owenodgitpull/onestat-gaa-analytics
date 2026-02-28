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
}

interface VideoPlayerProps {
  src: string | null
  onTimeUpdate?: (currentTimeMs: number) => void
  onDurationChange?: (durationMs: number) => void
  onPlayStateChange?: (playing: boolean) => void
  halftimeMs?: number
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  ({ src, onTimeUpdate, onDurationChange, onPlayStateChange, halftimeMs }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [playing, setPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [playbackRate, setPlaybackRate] = useState(1)
    const [showRateMenu, setShowRateMenu] = useState(false)

    useImperativeHandle(ref, () => ({
      seekTo: (ms: number) => {
        if (videoRef.current) {
          videoRef.current.currentTime = ms / 1000
        }
      },
      getCurrentTimeMs: () => {
        return videoRef.current ? Math.round(videoRef.current.currentTime * 1000) : 0
      },
      play: () => videoRef.current?.play(),
      pause: () => videoRef.current?.pause(),
      isPlaying: () => playing,
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
      }
    }, [onDurationChange])

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
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + seconds)
      }
    }

    const changeRate = (rate: number) => {
      if (videoRef.current) {
        videoRef.current.playbackRate = rate
        setPlaybackRate(rate)
        setShowRateMenu(false)
      }
    }

    useEffect(() => {
      const video = videoRef.current
      if (!video) return

      const onPlay = () => { setPlaying(true); onPlayStateChange?.(true) }
      const onPause = () => { setPlaying(false); onPlayStateChange?.(false) }

      video.addEventListener('play', onPlay)
      video.addEventListener('pause', onPause)
      return () => {
        video.removeEventListener('play', onPlay)
        video.removeEventListener('pause', onPause)
      }
    }, [onPlayStateChange])

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
      <div className="space-y-2">
        {/* Video element */}
        <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
          {src ? (
            <video
              ref={videoRef}
              src={src}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleDurationChange}
              onClick={togglePlay}
              className="w-full h-full object-contain cursor-pointer"
              preload="metadata"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30">
              <span>No video loaded</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
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
          <div className="flex-1 relative">
            <input
              type="range"
              min={0}
              max={duration}
              value={currentTime}
              onChange={(e) => {
                const ms = parseInt(e.target.value)
                if (videoRef.current) {
                  videoRef.current.currentTime = ms / 1000
                }
              }}
              className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-500"
            />
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

          {/* Playback speed */}
          <div className="relative">
            <button
              onClick={() => setShowRateMenu(!showRateMenu)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-white/60 hover:text-white bg-white/5 rounded transition-colors"
              title="Playback speed"
            >
              <Gauge size={14} />
              {playbackRate}x
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
    )
  }
)

VideoPlayer.displayName = 'VideoPlayer'

export default VideoPlayer
