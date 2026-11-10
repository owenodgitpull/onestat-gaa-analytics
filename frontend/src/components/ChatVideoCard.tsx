/**
 * A video reel the Analyst built (create_video_compilation), shown inside the chat reply that asked for it: progress
 * while it is being cut, then a player with full screen and download. The reel also stays in Video Compilations.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Loader2, Download, Maximize2, AlertCircle, Film, Library } from 'lucide-react'
import { videoCompilationsAPI } from '@/services/videoCompilationsApi'

export interface ChatVideo { compilation_id: string; title?: string | null; clip_count?: number | null }

function mmss(ms: number | null | undefined) {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function ChatVideoCard({ video }: { video: ChatVideo }) {
  const id = video.compilation_id
  const q = useQuery({
    queryKey: ['video-compilation', id],
    queryFn: () => videoCompilationsAPI.get(id),
    refetchInterval: (query) => {
      const st = query.state.data?.status
      return st === 'completed' || st === 'failed' ? false : 4000
    },
  })
  const item = q.data
  const ready = item?.status === 'completed'

  const [src, setSrc] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const loadSrc = useCallback(async () => {
    try { setSrc((await videoCompilationsAPI.getDownloadUrl(id)).download_url); setUrlError(null) }
    catch (e) { setUrlError(e instanceof Error ? e.message : String(e)) }
  }, [id])
  useEffect(() => { if (ready && !src) loadSrc() }, [ready, src, loadSrc])

  const videoRef = useRef<HTMLVideoElement>(null)
  const fullScreen = () => {
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (!v) return
    if (v.requestFullscreen) v.requestFullscreen().catch(() => v.webkitEnterFullscreen?.())
    else v.webkitEnterFullscreen?.()   // iPhone / older iPad Safari
  }

  const [downloading, setDownloading] = useState(false)
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null)
  const download = async () => {
    setDownloading(true); setDownloadMsg('Preparing the download…')
    try {
      const { download_url } = await videoCompilationsAPI.getDownloadUrl(id, true)
      const a = document.createElement('a')
      a.href = download_url; a.rel = 'noopener'
      document.body.appendChild(a); a.click(); a.remove()
      setDownloadMsg('Download started.')
    } catch (e) {
      setDownloadMsg(`Could not download: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setDownloading(false) }
  }

  const title = item?.title || video.title || 'Video reel'
  const clips = item?.clip_count ?? video.clip_count ?? null

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <Film size={14} className="text-emerald-400 shrink-0" />
        <div className="text-sm font-medium text-white truncate">{title}</div>
        <div className="ml-auto text-xs text-white/50 tabular-nums shrink-0">
          {clips != null ? `${clips} clips` : ''}{ready && item?.output_duration_ms ? ` · ${mmss(item.output_duration_ms)}` : ''}
        </div>
      </div>

      {ready && src ? (
        <video ref={videoRef} src={src} controls playsInline preload="metadata" className="w-full aspect-video bg-black block"
          onError={() => { setSrc(null); loadSrc() }} />
      ) : (
        <div className="aspect-video flex items-center justify-center p-4 text-center">
          {q.isError || urlError ? (
            <div role="status" className="flex items-start gap-2 text-sm text-red-300"><AlertCircle size={16} className="mt-0.5 shrink-0" />Could not load the reel: {urlError || (q.error instanceof Error ? q.error.message : 'unknown error')}</div>
          ) : item?.status === 'failed' ? (
            <div role="status" className="flex items-start gap-2 text-sm text-red-300"><AlertCircle size={16} className="mt-0.5 shrink-0" />The reel could not be built{item.error_message ? `: ${item.error_message}` : '.'}</div>
          ) : (
            <div role="status" className="flex flex-col items-center gap-2 text-sm text-white/70">
              <Loader2 size={22} className="animate-spin text-emerald-400" />
              {ready ? 'Loading the video…' : `Cutting the clips${clips ? ` (${clips}, roughly ${Math.max(1, Math.round(clips * 10 / 60))} min)` : ''}… it will play here when it is ready.`}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-white/10">
        <button type="button" onClick={fullScreen} disabled={!ready || !src}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 text-xs text-white">
          <Maximize2 size={13} /> Full screen
        </button>
        <button type="button" onClick={download} disabled={!ready || downloading}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 text-xs text-white">
          {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download
        </button>
        <Link to="/video-compilations" className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs text-white/60 hover:text-white">
          <Library size={13} /> In your Video Compilations
        </Link>
        {downloadMsg && <span role="status" className="text-xs text-white/55">{downloadMsg}</span>}
      </div>
    </div>
  )
}
