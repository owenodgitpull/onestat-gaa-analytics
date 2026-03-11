/**
 * VoiceoverRecorder — records audio narration synced to playbook animation.
 *
 * Flow: 3-2-1 countdown → animation plays + audio records → preview → save/discard.
 * Uses MediaRecorder API with audio/webm;codecs=opus.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, MicOff, Save, Trash2, Square } from 'lucide-react'

interface VoiceoverRecorderProps {
  /** Called when recording is saved — receives audio blob */
  onSave: (blob: Blob) => void
  onCancel: () => void
  /** Trigger to start the animation when recording begins */
  onStartAnimation: () => void
  /** Trigger to stop the animation */
  onStopAnimation: () => void
  /** Whether the animation is currently playing */
  isAnimating: boolean
}

export default function VoiceoverRecorder({
  onSave,
  onCancel,
  onStartAnimation,
  onStopAnimation,
  isAnimating,
}: VoiceoverRecorderProps) {
  const [state, setState] = useState<'idle' | 'countdown' | 'recording' | 'preview'>('idle')
  const [countdown, setCountdown] = useState(3)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [audioUrl])

  const startCountdown = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Determine supported format
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setAudioBlob(blob)
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
        setState('preview')
        if (timerRef.current) clearInterval(timerRef.current)
      }

      // Start countdown
      setState('countdown')
      setCountdown(3)

      let count = 3
      const countdownInterval = setInterval(() => {
        count--
        if (count === 0) {
          clearInterval(countdownInterval)
          // Start recording + animation
          recorder.start(100) // collect data every 100ms
          startTimeRef.current = Date.now()
          setDuration(0)
          timerRef.current = setInterval(() => {
            setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
          }, 500)
          setState('recording')
          onStartAnimation()
        } else {
          setCountdown(count)
        }
      }, 1000)
    } catch (err) {
      setError('Microphone access denied. Please allow microphone access to record voiceover.')
      setState('idle')
    }
  }, [onStartAnimation])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    onStopAnimation()
  }, [onStopAnimation])

  // Auto-stop when animation finishes (only if recording has been going for at least 2s)
  useEffect(() => {
    if (state === 'recording' && !isAnimating) {
      const elapsed = Date.now() - startTimeRef.current
      if (elapsed < 2000) return // Don't auto-stop if recording just started (isAnimating may not have kicked in yet)
      // Small delay to capture any trailing audio
      setTimeout(() => {
        stopRecording()
      }, 500)
    }
  }, [state, isAnimating, stopRecording])

  const handleSave = useCallback(() => {
    if (audioBlob) onSave(audioBlob)
  }, [audioBlob, onSave])

  const handleDiscard = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setState('idle')
  }, [audioUrl])

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
      {/* Countdown overlay */}
      {state === 'countdown' && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="text-8xl font-bold text-white animate-pulse drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]">
            {countdown}
          </div>
        </div>
      )}

      {/* Control bar */}
      <div className="bg-slate-900/95 border border-white/15 rounded-xl px-4 py-3 backdrop-blur-sm shadow-xl flex items-center gap-3">
        {state === 'idle' && (
          <>
            <button
              onClick={startCountdown}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-all text-sm font-medium"
            >
              <Mic size={16} /> Record Voiceover
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-2 rounded-lg text-white/40 hover:text-white text-sm"
            >
              Cancel
            </button>
          </>
        )}

        {state === 'recording' && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-300 text-sm font-medium">Recording</span>
              <span className="text-white/50 text-sm tabular-nums">{formatDuration(duration)}</span>
            </div>
            <button
              onClick={stopRecording}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 text-white hover:bg-white/15 transition-all text-sm"
            >
              <Square size={14} /> Stop
            </button>
          </>
        )}

        {state === 'preview' && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-white/60 text-sm">{formatDuration(duration)}s recorded</span>
              {audioUrl && (
                <audio controls src={audioUrl} className="h-8 w-48" />
              )}
            </div>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-all text-sm font-medium"
            >
              <Save size={14} /> Save
            </button>
            <button
              onClick={handleDiscard}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white/40 hover:text-red-400 text-sm"
            >
              <Trash2 size={14} /> Discard
            </button>
          </>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs">
            <MicOff size={14} /> {error}
          </div>
        )}
      </div>
    </div>
  )
}
