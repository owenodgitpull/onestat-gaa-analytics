/**
 * PlaybackControls — control bar for playbook animation playback.
 *
 * Play/Pause, Stop, Restart, Loop, Speed, Phase progress dots, Fullscreen.
 */

import {
  Play, Pause, Square, RotateCcw, Repeat, Maximize, Volume2, VolumeX, Mic,
} from 'lucide-react'
import type { AnimationEngine } from './useAnimationEngine'

interface PlaybackControlsProps {
  engine: AnimationEngine
  totalPhases: number
  onFullscreen?: () => void
  onRecordVoiceover?: () => void
  voiceoverUrl?: string | null
  isMuted?: boolean
  onToggleMute?: () => void
  showVoiceoverButton?: boolean
}

const SPEEDS = [0.5, 1, 1.5, 2]

export default function PlaybackControls({
  engine,
  totalPhases,
  onFullscreen,
  onRecordVoiceover,
  voiceoverUrl,
  isMuted = false,
  onToggleMute,
  showVoiceoverButton = false,
}: PlaybackControlsProps) {
  const {
    currentPhaseIdx, playbackState, speed, loop,
    play, pause, stop, restart, seekToPhase, setSpeed, toggleLoop,
  } = engine

  const isPlaying = playbackState === 'playing'

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-white/5 border-t border-white/10 rounded-b-xl backdrop-blur-sm">
      {/* Play/Pause + Stop */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={isPlaying ? pause : play}
          className={`p-2 rounded-lg transition-all ${
            isPlaying
              ? 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30'
              : 'bg-white/10 text-white hover:bg-white/15'
          }`}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          onClick={stop}
          disabled={playbackState === 'idle'}
          className="p-2 rounded-lg bg-white/5 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all"
          title="Stop"
        >
          <Square size={14} />
        </button>
        <button
          onClick={restart}
          className="p-2 rounded-lg bg-white/5 text-white/50 hover:text-white hover:bg-white/10 transition-all"
          title="Restart"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      {/* Phase progress dots */}
      <div className="flex items-center gap-1.5 flex-1 justify-center">
        {Array.from({ length: totalPhases }, (_, i) => (
          <button
            key={i}
            onClick={() => seekToPhase(i)}
            className={`w-3 h-3 rounded-full transition-all border ${
              i === currentPhaseIdx
                ? 'bg-cyan-400 border-cyan-400 scale-125 shadow-[0_0_8px_rgba(34,211,238,0.5)]'
                : i < currentPhaseIdx
                  ? 'bg-cyan-400/40 border-cyan-400/40'
                  : 'bg-white/10 border-white/20'
            }`}
            title={`Phase ${i + 1}`}
          />
        ))}
        <span className="text-white/40 text-[11px] ml-2 tabular-nums">
          Phase {currentPhaseIdx + 1} of {totalPhases}
        </span>
      </div>

      {/* Speed control */}
      <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5">
        {SPEEDS.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all ${
              speed === s
                ? 'bg-white/15 text-white'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Loop toggle */}
      <button
        onClick={toggleLoop}
        className={`p-2 rounded-lg transition-all ${
          loop
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-white/5 text-white/30 hover:text-white/60'
        }`}
        title={loop ? 'Loop on' : 'Loop off'}
      >
        <Repeat size={14} />
      </button>

      {/* Voiceover controls */}
      {voiceoverUrl && onToggleMute && (
        <button
          onClick={onToggleMute}
          className={`p-2 rounded-lg transition-all ${
            isMuted
              ? 'bg-white/5 text-white/30'
              : 'bg-white/10 text-white/70'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      )}

      {showVoiceoverButton && onRecordVoiceover && (
        <button
          onClick={onRecordVoiceover}
          className={`p-2 rounded-lg transition-all ${
            voiceoverUrl
              ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
              : 'bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10'
          }`}
          title={voiceoverUrl ? 'Re-record voiceover' : 'Record voiceover'}
        >
          <Mic size={14} />
        </button>
      )}

      {/* Fullscreen */}
      {onFullscreen && (
        <button
          onClick={onFullscreen}
          className="p-2 rounded-lg bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-all"
          title="Fullscreen"
        >
          <Maximize size={14} />
        </button>
      )}
    </div>
  )
}
