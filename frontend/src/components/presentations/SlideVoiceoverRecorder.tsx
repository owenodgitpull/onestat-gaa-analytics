/**
 * SlideVoiceoverRecorder — records mic-only narration for a Presentation
 * slide. Same MediaRecorder pattern as playbook/VoiceoverRecorder.tsx, but
 * without that component's animation-sync coupling — a presentation slide
 * voiceover just narrates over whatever's already on screen (a still frame,
 * a clip continuing to play, a text card), it doesn't drive anything.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Mic, Square, Play, Pause, Trash2, Loader2 } from 'lucide-react'
import { presentationsAPI } from '@/services/presentationsApi'

interface SlideVoiceoverRecorderProps {
  presentationId: string
  slideId: string
  hasVoiceover: boolean
}

export default function SlideVoiceoverRecorder({ presentationId, slideId, hasVoiceover }: SlideVoiceoverRecorderProps) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<'idle' | 'recording' | 'preview' | 'uploading'>('idle')
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playerRef = useRef<HTMLAudioElement>(null)

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); if (timerRef.current) clearInterval(timerRef.current) }, [audioUrl])

  const { data: existing } = useQuery({
    queryKey: ['slide-voiceover-url', presentationId, slideId],
    queryFn: () => presentationsAPI.getVoiceoverUrl(presentationId, slideId),
    enabled: hasVoiceover && state === 'idle',
  })

  const deleteMutation = useMutation({
    mutationFn: () => presentationsAPI.deleteVoiceover(presentationId, slideId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] }),
  })

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        setState('preview')
        if (timerRef.current) clearInterval(timerRef.current)
      }
      recorder.start(100)
      startTimeRef.current = Date.now()
      setDuration(0)
      timerRef.current = setInterval(() => setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000)), 500)
      setState('recording')
    } catch {
      setError('Microphone access denied.')
    }
  }, [])

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop()
  }

  const discard = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setState('idle')
  }

  const save = async () => {
    if (!audioBlob) return
    setState('uploading')
    try {
      const { upload_url, key } = await presentationsAPI.getVoiceoverUploadUrl(presentationId, slideId)
      await fetch(upload_url, { method: 'PUT', body: audioBlob, headers: { 'Content-Type': 'audio/webm' } })
      await presentationsAPI.confirmVoiceoverUpload(presentationId, slideId, key)
      queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] })
      discard()
    } catch {
      setError('Upload failed — try again.')
      setState('preview')
    }
  }

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  if (hasVoiceover && state === 'idle') {
    return (
      <div className="flex items-center gap-2">
        {existing?.voiceover_url && (
          <audio ref={playerRef} src={existing.voiceover_url} onEnded={() => setIsPlaying(false)} className="hidden" />
        )}
        <button
          onClick={() => { if (isPlaying) { playerRef.current?.pause(); setIsPlaying(false) } else { playerRef.current?.play(); setIsPlaying(true) } }}
          className="btn-glass flex items-center gap-1.5 px-3 py-1.5 text-xs"
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} />} Voiceover
        </button>
        <button onClick={() => deleteMutation.mutate()} className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/20">
          <Trash2 size={12} />
        </button>
      </div>
    )
  }

  if (state === 'idle') {
    return (
      <button onClick={startRecording} className="btn-glass flex items-center gap-1.5 px-3 py-1.5 text-xs">
        <Mic size={12} /> Record Voiceover
      </button>
    )
  }

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-red-300 text-xs tabular-nums">{formatDuration(duration)}</span>
        <button onClick={stopRecording} className="btn-glass flex items-center gap-1.5 px-3 py-1.5 text-xs">
          <Square size={12} /> Stop
        </button>
      </div>
    )
  }

  if (state === 'preview') {
    return (
      <div className="flex items-center gap-2">
        <audio src={audioUrl!} controls className="h-8" style={{ maxWidth: 200 }} />
        <button onClick={save} className="btn-primary px-3 py-1.5 text-xs">Save</button>
        <button onClick={discard} className="btn-glass px-3 py-1.5 text-xs">Discard</button>
      </div>
    )
  }

  // uploading
  return (
    <div className="flex items-center gap-2 text-white/50 text-xs">
      <Loader2 size={14} className="animate-spin" /> Uploading…
      {error && <span className="text-red-400">{error}</span>}
    </div>
  )
}
