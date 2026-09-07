/**
 * VideoUploadModal — Upload match video directly to R2 via presigned URL.
 *
 * Flow: select file → initiate upload (get presigned URL) → PUT to R2 → confirm complete.
 * Shows progress bar during upload. Navigates to tagging page on success.
 */

import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, X, Video, AlertCircle, Loader2, CheckCircle } from 'lucide-react'
import { videoSessionsAPI, type MultipartPartInfo } from '../services/videoApi'
import {
  useInitiateVideoUpload,
  useCompleteVideoUpload,
} from '../hooks/useVideoSessions'

interface VideoUploadModalProps {
  isOpen: boolean
  onClose: () => void
  matchId: string
}

const MAX_FILE_SIZE_GB = 30
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_GB * 1024 * 1024 * 1024

type UploadStatus = 'idle' | 'initiating' | 'uploading' | 'completing' | 'success' | 'error'

/** Upload a File in sequential chunks, one per presigned part URL, tracking
 * combined progress across all parts. Returns the part number + ETag list
 * needed to complete the multipart upload. */
async function uploadInParts(
  file: File,
  partUrls: string[],
  partSizeBytes: number,
  onProgress: (percent: number) => void
): Promise<MultipartPartInfo[]> {
  const parts: MultipartPartInfo[] = []
  const perPartLoaded = new Array(partUrls.length).fill(0)

  const reportProgress = () => {
    const loaded = perPartLoaded.reduce((sum, n) => sum + n, 0)
    onProgress(Math.round((loaded / file.size) * 100))
  }

  for (let i = 0; i < partUrls.length; i++) {
    const start = i * partSizeBytes
    const end = Math.min(start + partSizeBytes, file.size)
    const chunk = file.slice(start, end)

    const etag = await videoSessionsAPI.uploadPart(partUrls[i], chunk, (loaded) => {
      perPartLoaded[i] = loaded
      reportProgress()
    })

    perPartLoaded[i] = chunk.size
    reportProgress()
    parts.push({ part_number: i + 1, etag })
  }

  return parts
}

export default function VideoUploadModal({ isOpen, onClose, matchId }: VideoUploadModalProps) {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [half, setHalf] = useState<number | null>(null)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [, setSessionId] = useState<string | null>(null)

  const initiateUpload = useInitiateVideoUpload()
  const completeUpload = useCompleteVideoUpload()

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    if (selected.size > MAX_FILE_SIZE_BYTES) {
      setError(`File too large (${(selected.size / (1024 * 1024 * 1024)).toFixed(1)}GB). Maximum is ${MAX_FILE_SIZE_GB}GB.`)
      return
    }

    if (!selected.type.startsWith('video/')) {
      setError('Please select a video file (MP4, MOV, etc.)')
      return
    }

    setFile(selected)
    setError(null)
    // Auto-fill title from filename if empty
    if (!title) {
      const name = selected.name.replace(/\.[^/.]+$/, '')
      const prefix = half === null ? 'Full Match' : `Half ${half}`
      setTitle(`${prefix} - ${name}`)
    }
  }, [title, half])

  const handleUpload = async () => {
    if (!file) return

    setError(null)
    setStatus('initiating')

    try {
      // Step 1: Get presigned URL from backend
      const initResult = await initiateUpload.mutateAsync({
        matchId,
        title: title || (half === null ? 'Full Match' : `Half ${half}`),
        half: half ?? undefined,
        contentType: file.type || 'video/mp4',
        fileSizeBytes: file.size,
      })

      setSessionId(initResult.session_id)
      setStatus('uploading')

      let parts: MultipartPartInfo[] | undefined

      if (initResult.is_multipart && initResult.part_urls && initResult.part_size_bytes) {
        // Step 2 (large files): upload in chunks — same one file, transferred
        // as separate parts because a single PUT can't exceed R2's 5GiB cap.
        try {
          parts = await uploadInParts(
            file,
            initResult.part_urls,
            initResult.part_size_bytes,
            (percent) => setProgress(percent)
          )
        } catch (uploadErr) {
          // Best-effort cleanup so the abandoned parts don't linger in R2
          if (initResult.upload_id) {
            videoSessionsAPI.abortMultipartUpload(initResult.session_id, initResult.upload_id).catch(() => {})
          }
          throw uploadErr
        }
      } else if (initResult.upload_url) {
        // Step 2 (smaller files): single presigned PUT
        await videoSessionsAPI.uploadToR2(
          initResult.upload_url,
          file,
          file.type || 'video/mp4',
          (percent) => setProgress(percent)
        )
      } else {
        throw new Error('Upload could not be initiated (no upload URL returned)')
      }

      setStatus('completing')

      // Step 3: Confirm upload complete
      await completeUpload.mutateAsync({
        sessionId: initResult.session_id,
        matchId,
        sizeBytes: file.size,
        uploadId: initResult.is_multipart ? initResult.upload_id : undefined,
        parts,
      })

      setStatus('success')

      // Navigate to tagging page after short delay
      setTimeout(() => {
        navigate(`/video/${initResult.session_id}`)
      }, 1500)

    } catch (err: any) {
      setStatus('error')
      setError(err.message || 'Upload failed. Please try again.')
    }
  }

  const handleClose = () => {
    if (status === 'uploading') return // Don't close during upload
    setFile(null)
    setTitle('')
    setHalf(1)
    setStatus('idle')
    setProgress(0)
    setError(null)
    setSessionId(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={status !== 'uploading' ? handleClose : undefined}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg glass-card p-8">
        {/* Close button */}
        {status !== 'uploading' && (
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        )}

        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="p-4 rounded-full bg-white/5 text-emerald-400">
            <Video size={48} />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-white text-center mb-6">
          Upload Match Video
        </h2>

        {status === 'success' ? (
          <div className="text-center">
            <CheckCircle size={48} className="mx-auto mb-4 text-emerald-400" />
            <p className="text-white/80">Upload complete! Redirecting to tagging...</p>
          </div>
        ) : (
          <>
            {/* Title input */}
            <div className="mb-4">
              <label className="block text-sm text-white/60 mb-1">Video Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 1st Half vs Gaoth Dobhair"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                disabled={status !== 'idle'}
              />
            </div>

            {/* Half selector */}
            <div className="mb-4">
              <label className="block text-sm text-white/60 mb-1">Coverage</label>
              <div className="flex gap-2">
                {([null, 1, 2] as const).map((h) => (
                  <button
                    key={String(h)}
                    onClick={() => setHalf(h)}
                    disabled={status !== 'idle'}
                    className={`flex-1 py-2.5 rounded-lg font-medium text-sm transition-all ${
                      half === h
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                  >
                    {h === null ? 'Full Match' : h === 1 ? '1st Half' : '2nd Half'}
                  </button>
                ))}
              </div>
            </div>

            {/* File picker */}
            <div className="mb-6">
              <label className="block text-sm text-white/60 mb-1">Video File</label>
              {!file ? (
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/20 rounded-lg cursor-pointer hover:border-emerald-500/50 hover:bg-white/5 transition-all">
                  <Upload size={24} className="text-white/40 mb-2" />
                  <span className="text-sm text-white/40">Click to select video</span>
                  <span className="text-xs text-white/30 mt-1">MP4, MOV • Max {MAX_FILE_SIZE_GB}GB</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                  <Video size={20} className="text-emerald-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{file.name}</p>
                    <p className="text-xs text-white/50">
                      {(file.size / (1024 * 1024)).toFixed(0)} MB
                    </p>
                  </div>
                  {status === 'idle' && (
                    <button
                      onClick={() => setFile(null)}
                      className="p-1 text-white/40 hover:text-white"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Progress bar */}
            {(status === 'uploading' || status === 'completing') && (
              <div className="mb-6">
                <div className="flex justify-between text-sm text-white/60 mb-1">
                  <span>{status === 'completing' ? 'Finalizing...' : 'Uploading...'}</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2.5">
                  <div
                    className="bg-emerald-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
                <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* File size warning */}
            {file && file.size > 2 * 1024 * 1024 * 1024 && status === 'idle' && (
              <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-4">
                <AlertCircle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-300">
                  Large file ({(file.size / (1024 * 1024 * 1024)).toFixed(1)}GB). Upload may take several minutes on slow connections.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                disabled={status === 'uploading' || status === 'completing'}
                className="flex-1 btn-glass"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={!file || !title || status !== 'idle'}
                className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg flex items-center justify-center gap-2"
              >
                {status === 'initiating' ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Upload size={18} />
                    Upload Video
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
