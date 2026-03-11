/**
 * PlaybackExport — exports playbook animation as WebM video or shares natively.
 *
 * Uses canvas.captureStream() + MediaRecorder to capture the SVG animation
 * as a video file. Optionally merges voiceover audio track.
 */

import { useState, useCallback } from 'react'
import { Film, Loader2 } from 'lucide-react'

interface PlaybackExportProps {
  /** SVG element ref to capture */
  getSvgElement: () => SVGSVGElement | null
  /** Voiceover audio URL (if attached) */
  voiceoverUrl?: string | null
  routineName: string
  totalDurationMs: number
}

export default function PlaybackExport({
  getSvgElement,
  voiceoverUrl,
  routineName,
  totalDurationMs,
}: PlaybackExportProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const exportVideo = useCallback(async () => {
    const svg = getSvgElement()
    if (!svg) return

    setIsExporting(true)
    setError(null)
    setProgress(0)

    try {
      // Create offscreen canvas
      const canvas = document.createElement('canvas')
      canvas.width = 1920
      canvas.height = 1192 // Maintain 2332:1446 aspect ratio at 1920 width
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas context not available')

      // Capture stream from canvas
      const canvasStream = canvas.captureStream(30) // 30fps

      // If voiceover exists, merge audio
      let combinedStream = canvasStream
      if (voiceoverUrl) {
        try {
          const audioEl = new Audio(voiceoverUrl)
          audioEl.crossOrigin = 'anonymous'
          await new Promise<void>((resolve, reject) => {
            audioEl.oncanplaythrough = () => resolve()
            audioEl.onerror = () => reject(new Error('Audio load failed'))
            audioEl.load()
          })
          const audioCtx = new AudioContext()
          const source = audioCtx.createMediaElementSource(audioEl)
          const dest = audioCtx.createMediaStreamDestination()
          source.connect(dest)
          // Merge audio + video tracks
          const combined = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...dest.stream.getAudioTracks(),
          ])
          combinedStream = combined
          audioEl.play()
        } catch {
          // Continue without audio
        }
      }

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm'

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 4000000,
      })

      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      const exportPromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(chunks, { type: mimeType }))
        }
      })

      recorder.start(100)

      // Render SVG frames to canvas at 30fps
      const frameDuration = 1000 / 30
      const totalFrames = Math.ceil(totalDurationMs / frameDuration)

      for (let frame = 0; frame < totalFrames; frame++) {
        // Serialize current SVG state to canvas
        const svgData = new XMLSerializer().serializeToString(svg)
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
        const url = URL.createObjectURL(svgBlob)

        await new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

            // Title overlay for first 2 seconds
            if (frame < 60) {
              const titleOpacity = frame < 30 ? frame / 30 : (60 - frame) / 30
              ctx.globalAlpha = titleOpacity * 0.8
              ctx.fillStyle = '#000000'
              ctx.fillRect(0, canvas.height - 80, canvas.width, 80)
              ctx.globalAlpha = titleOpacity
              ctx.fillStyle = '#FFFFFF'
              ctx.font = 'bold 28px sans-serif'
              ctx.textAlign = 'center'
              ctx.fillText(routineName, canvas.width / 2, canvas.height - 35)
              ctx.globalAlpha = 1
              ctx.textAlign = 'start'
            }

            URL.revokeObjectURL(url)
            resolve()
          }
          img.onerror = () => {
            URL.revokeObjectURL(url)
            resolve()
          }
          img.src = url
        })

        setProgress(Math.round((frame / totalFrames) * 100))

        // Wait for next frame timing
        await new Promise(r => setTimeout(r, frameDuration))
      }

      recorder.stop()
      const videoBlob = await exportPromise

      // Download or share
      if (navigator.canShare && navigator.canShare({ files: [new File([videoBlob], 'play.webm')] })) {
        try {
          await navigator.share({
            files: [new File([videoBlob], `${routineName.replace(/\s+/g, '_')}.webm`, { type: mimeType })],
            title: routineName,
          })
        } catch {
          downloadBlob(videoBlob, mimeType)
        }
      } else {
        downloadBlob(videoBlob, mimeType)
      }
    } catch (err: any) {
      setError(err.message || 'Export failed')
    } finally {
      setIsExporting(false)
      setProgress(0)
    }
  }, [getSvgElement, voiceoverUrl, routineName, totalDurationMs])

  const downloadBlob = (blob: Blob, mimeType: string) => {
    const ext = mimeType.includes('webm') ? 'webm' : 'mp4'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${routineName.replace(/\s+/g, '_')}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={exportVideo}
        disabled={isExporting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 text-xs font-medium disabled:opacity-40 transition-all"
      >
        {isExporting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Exporting {progress}%
          </>
        ) : (
          <>
            <Film size={14} /> Export Video
          </>
        )}
      </button>
      {error && <span className="text-red-400 text-xs">{error}</span>}
    </div>
  )
}
