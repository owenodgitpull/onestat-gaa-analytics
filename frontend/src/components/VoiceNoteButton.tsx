/**
 * VoiceNoteButton — mic control for quick spoken reminders during live
 * recording. Tap to start, tap again to stop and save; speech is transcribed
 * entirely client-side (Web Speech API — no audio is recorded, uploaded, or
 * stored anywhere, only the resulting text). Meant for exactly the "I know
 * that was wrong but I can't stop to fix it right now" moment — e.g. "change
 * turnover won for St Mary's at 21, not us" — so it's there to read back and
 * act on in the next lull, via the event edit UI.
 *
 * Deliberately rendered as a fixed, portaled overlay rather than another icon
 * dropped into the recording toolbars — both MatchRecording.tsx and
 * FullscreenPitchMode.tsx already run their control rows as a hidden-
 * scrollbar overflow-x-auto strip with no visible scroll affordance, so one
 * more icon there just gets silently clipped off the visible edge (that's
 * what happened when this first shipped inline). A fixed corner position and
 * a real centered modal for the notes list side-step that entirely — nothing
 * here can end up clipped by a parent's overflow or anchored off-screen.
 *
 * Also isolated from the recording state machine: it never touches ball
 * position, possession, or the event log, and speech recognition only ever
 * starts on an explicit tap — nothing here runs in the background while
 * recording normally, so it can't add any latency to logging real events.
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, Square, X, Trash2, FileText } from 'lucide-react'
import { api, type MatchVoiceNote } from '@/services/api'

interface VoiceNoteButtonProps {
  matchId: string
  half: number
  minute: number
}

const voiceNoteKeys = {
  byMatch: (matchId: string) => ['voice-notes', 'match', matchId] as const,
}

// Safety ceiling — if the coach forgets to tap Stop, don't leave the mic
// listening indefinitely in the background for the rest of the match.
const MAX_RECORDING_MS = 45_000

export default function VoiceNoteButton({ matchId, half, minute }: VoiceNoteButtonProps) {
  const queryClient = useQueryClient()
  const [showNotes, setShowNotes] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [unsupported, setUnsupported] = useState(false)
  const recognitionRef = useRef<any>(null)
  const finalTranscriptRef = useRef('')
  const startMinuteRef = useRef(minute)
  const startHalfRef = useRef(half)
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetched once on mount — notes are created within this same session in
  // practice, so there's no need to poll; creating/deleting one updates the
  // cache directly below.
  const { data } = useQuery({
    queryKey: voiceNoteKeys.byMatch(matchId),
    queryFn: () => api.matchVoiceNotes.getByMatch(matchId),
    enabled: !!matchId,
    staleTime: 60_000,
    refetchInterval: 0,
  })
  const notes = data?.notes ?? []

  // Never leave recognition running in the background — stop it if this
  // component unmounts mid-recording (navigating away, fullscreen toggle).
  useEffect(() => {
    return () => {
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current)
      try { recognitionRef.current?.stop?.() } catch { /* already stopped */ }
    }
  }, [])

  const saveNote = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      const note = await api.matchVoiceNotes.create({
        match_id: matchId,
        text: trimmed,
        half: startHalfRef.current,
        minute: startMinuteRef.current,
      })
      queryClient.setQueryData(voiceNoteKeys.byMatch(matchId), (old: { notes: MatchVoiceNote[]; total: number } | undefined) => {
        if (!old) return { notes: [note], total: 1 }
        return { notes: [...old.notes, note], total: old.total + 1 }
      })
      setShowNotes(true)
    } catch (err) {
      console.error('Failed to save voice note:', err)
    }
  }

  const startRecording = () => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      setUnsupported(true)
      setShowNotes(true)
      return
    }
    setShowNotes(false)
    finalTranscriptRef.current = ''
    startMinuteRef.current = minute
    startHalfRef.current = half
    setInterimText('')

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-IE'

    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += (finalTranscriptRef.current ? ' ' : '') + transcript.trim()
        } else {
          interim += transcript
        }
      }
      setInterimText(interim)
    }
    recognition.onerror = (e: any) => {
      // 'no-speech' / 'aborted' fire routinely (e.g. a stray tap) — only
      // worth logging anything noisier than that.
      if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') {
        console.error('Speech recognition error:', e.error)
      }
    }
    recognition.onend = () => {
      setIsRecording(false)
      setInterimText('')
      if (autoStopTimerRef.current) { clearTimeout(autoStopTimerRef.current); autoStopTimerRef.current = null }
      if (finalTranscriptRef.current.trim()) {
        saveNote(finalTranscriptRef.current)
      }
      recognitionRef.current = null
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
      setIsRecording(true)
      autoStopTimerRef.current = setTimeout(() => recognitionRef.current?.stop(), MAX_RECORDING_MS)
    } catch (err) {
      console.error('Failed to start voice note recording:', err)
    }
  }

  const stopRecording = () => {
    recognitionRef.current?.stop()
  }

  const handleDelete = async (noteId: string) => {
    queryClient.setQueryData(voiceNoteKeys.byMatch(matchId), (old: { notes: MatchVoiceNote[]; total: number } | undefined) => {
      if (!old) return old
      return { notes: old.notes.filter(n => n.id !== noteId), total: Math.max(0, old.total - 1) }
    })
    try {
      await api.matchVoiceNotes.delete(noteId)
    } catch (err) {
      console.error('Failed to delete voice note:', err)
    }
  }

  return createPortal(
    <>
      {/* Floating control — fixed to the viewport, so it's reachable from
          anywhere on screen and can never get clipped by a toolbar's
          overflow or scrolled out of view. */}
      <div className="fixed top-20 right-3 z-[130] flex flex-col items-end gap-2">
        {isRecording && (
          <div className="w-64 max-w-[70vw] bg-red-950/95 backdrop-blur-xl border border-red-500/30 rounded-xl shadow-2xl p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span className="text-[11px] font-bold text-red-300 uppercase tracking-wide">Listening…</span>
            </div>
            <p className="text-sm text-white/90 leading-snug min-h-[1.5em] break-words">
              {interimText || finalTranscriptRef.current || '…'}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          {!isRecording && notes.length > 0 && (
            <button
              onClick={() => setShowNotes(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-slate-900/90 backdrop-blur-xl border border-cyan-500/30 text-cyan-300 text-xs font-semibold shadow-xl hover:bg-slate-800/90 transition-all"
              title="View voice notes"
            >
              <FileText size={13} />
              <span>{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
            </button>
          )}
          <button
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            className={`flex items-center justify-center w-11 h-11 rounded-full border-2 shadow-xl transition-all ${
              isRecording
                ? 'bg-red-500 border-red-300 text-white animate-pulse'
                : 'bg-slate-900/90 backdrop-blur-xl border-white/20 text-white/80 hover:bg-slate-800/90 hover:text-white'
            }`}
            title={isRecording ? 'Tap to stop and save note' : 'Record a voice note'}
          >
            {isRecording ? <Square size={18} /> : <Mic size={18} />}
          </button>
        </div>
      </div>

      {/* Notes list — a real centered modal, not an anchored dropdown, so it
          always renders fully on screen regardless of where the control sits. */}
      {showNotes && (
        <div
          className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowNotes(false)}
        >
          <div
            className="w-full max-w-sm max-h-[70vh] flex flex-col bg-[#0f1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between flex-shrink-0">
              <span className="text-sm font-bold text-white flex items-center gap-2">
                <FileText size={15} className="text-cyan-400" /> Voice Notes
              </span>
              <button onClick={() => setShowNotes(false)} className="text-white/40 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {unsupported && (
                <p className="px-4 py-4 text-xs text-amber-300/90">
                  Voice notes aren't supported in this browser. Try Chrome or Safari on the device you're recording on.
                </p>
              )}
              {!unsupported && notes.length === 0 && (
                <p className="px-4 py-6 text-xs text-white/40 text-center">No notes yet — tap the mic to record one.</p>
              )}
              <div className="p-2 space-y-1">
                {[...notes].reverse().map(note => (
                  <div key={note.id} className="flex items-start gap-2 px-2.5 py-2.5 rounded-xl hover:bg-white/5 transition-colors">
                    <span className="flex-shrink-0 text-[10px] font-bold text-cyan-400 bg-cyan-500/10 rounded-full px-2 py-1 mt-0.5">
                      {note.minute != null ? `${note.minute}'` : '—'}
                    </span>
                    <p className="flex-1 text-sm text-white/85 leading-snug break-words">{note.text}</p>
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="flex-shrink-0 text-white/25 hover:text-red-400 transition-colors p-1"
                      title="Delete note"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 border-t border-white/10 flex-shrink-0">
              <button
                onClick={() => { setShowNotes(false); startRecording() }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-sm font-semibold transition-all"
              >
                <Mic size={15} /> Record New Note
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
