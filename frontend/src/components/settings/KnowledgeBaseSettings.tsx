import { useState, useEffect, useCallback } from 'react'
import { Upload, Trash2, FileText, Loader2, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react'
import { knowledgeBaseAPI } from '../../services/api'
import type { KnowledgeDoc } from '../../types'

const DOC_TYPE_LABELS: Record<string, string> = {
  rules: 'Rules',
  tactics: 'Tactics',
  statsports: 'GPS/Stats',
  other: 'Other',
}

const DOC_TYPE_COLOURS: Record<string, string> = {
  rules: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  tactics: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  statsports: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  other: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle size={12} /> Ready</span>
    case 'processing':
      return <span className="flex items-center gap-1 text-xs text-amber-400"><Loader2 size={12} className="animate-spin" /> Processing</span>
    case 'failed':
      return <span className="flex items-center gap-1 text-xs text-red-400"><XCircle size={12} /> Failed</span>
    default:
      return <span className="flex items-center gap-1 text-xs text-white/40"><Clock size={12} /> Pending</span>
  }
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function KnowledgeBaseSettings() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [customCount, setCustomCount] = useState(0)
  const [maxCustom, setMaxCustom] = useState(5)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [docType, setDocType] = useState('other')

  const fetchDocs = useCallback(async () => {
    try {
      setLoading(true)
      const data = await knowledgeBaseAPI.listDocuments() as { documents: KnowledgeDoc[]; custom_count: number; max_custom: number }
      setDocs(data.documents || [])
      setCustomCount(data.custom_count || 0)
      setMaxCustom(data.max_custom || 5)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  // Poll for processing docs
  useEffect(() => {
    const processing = docs.some(d => d.processing_status === 'processing' || d.processing_status === 'pending')
    if (!processing) return
    const interval = setInterval(fetchDocs, 5000)
    return () => clearInterval(interval)
  }, [docs, fetchDocs])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    // Client-side validation
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    if (!allowed.includes(file.type)) {
      setError('Only PDF and DOCX files are allowed')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be under 10MB')
      return
    }

    setUploading(true)
    setError(null)

    try {
      // Step 1: Get presigned URL
      let initData: { document_id: string; upload_url: string; r2_key: string }
      try {
        initData = await knowledgeBaseAPI.initiateUpload({
          filename: file.name,
          content_type: file.type,
          doc_type: docType,
        }) as { document_id: string; upload_url: string; r2_key: string }
      } catch (e: any) {
        throw new Error(`Step 1 failed (presigned URL): ${e.message}`)
      }

      // Step 2: Upload directly to R2
      try {
        const uploadRes = await fetch(initData.upload_url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        })
        if (!uploadRes.ok) throw new Error(`R2 returned ${uploadRes.status}: ${uploadRes.statusText}`)
      } catch (e: any) {
        throw new Error(`Step 2 failed (R2 upload): ${e.message}`)
      }

      // Step 3: Confirm upload
      try {
        await knowledgeBaseAPI.confirmUpload(initData.document_id)
      } catch (e: any) {
        throw new Error(`Step 3 failed (confirm): ${e.message}`)
      }

      // Refresh list
      await fetchDocs()
    } catch (err: any) {
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (docId: string) => {
    if (!confirm('Delete this document? Its knowledge will be removed from AI context.')) return

    setDeleting(docId)
    try {
      await knowledgeBaseAPI.deleteDocument(docId)
      await fetchDocs()
    } catch (err: any) {
      setError(err.message || 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  const defaults = docs.filter(d => d.is_default)
  const custom = docs.filter(d => !d.is_default)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Knowledge Base</h2>
          <p className="text-sm text-white/50 mt-1">Upload tactical documents, training manuals, or playing philosophy PDFs. The AI agents will draw on these when analysing matches, recommending tactics, and surfacing insights unique to your club.</p>
        </div>
        <button onClick={fetchDocs} className="p-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-colors" title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Default documents */}
      {defaults.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">Default Documents</h3>
          <div className="space-y-2">
            {defaults.map(doc => (
              <DocRow key={doc.id} doc={doc} />
            ))}
          </div>
        </div>
      )}

      {/* Custom documents */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">
            Your Documents ({customCount}/{maxCustom})
          </h3>
        </div>

        {custom.length > 0 && (
          <div className="space-y-2">
            {custom.map(doc => (
              <DocRow key={doc.id} doc={doc} onDelete={() => handleDelete(doc.id)} deleting={deleting === doc.id} />
            ))}
          </div>
        )}

        {custom.length === 0 && !loading && (
          <p className="text-sm text-white/30 italic py-4">No custom documents yet. Upload your first one below.</p>
        )}

        {/* Upload area */}
        {customCount >= maxCustom ? (
          <p className="text-sm text-amber-400/80">Maximum of {maxCustom} custom documents reached. Delete one to upload another.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={docType}
              onChange={e => setDocType(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
            >
              <option value="tactics">Tactics</option>
              <option value="rules">Rules</option>
              <option value="statsports">GPS/Stats</option>
              <option value="other">Other</option>
            </select>

            <label className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
              style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)' }}
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {uploading ? 'Uploading...' : 'Upload Document'}
              <input type="file" accept=".pdf,.docx" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
            <span className="text-xs text-white/30">PDF or DOCX, max 10MB</span>
          </div>
        )}
      </div>

      {loading && <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-white/30" /></div>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}

function DocRow({ doc, onDelete, deleting }: { doc: KnowledgeDoc; onDelete?: () => void; deleting?: boolean }) {
  const typeClass = DOC_TYPE_COLOURS[doc.doc_type] || DOC_TYPE_COLOURS.other

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors">
      <FileText size={18} className="text-white/30 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{doc.original_filename}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs px-1.5 py-0.5 rounded border ${typeClass}`}>{DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}</span>
          <StatusBadge status={doc.processing_status} />
          {doc.chunk_count > 0 && <span className="text-xs text-white/30">{doc.chunk_count} chunks</span>}
          {doc.file_size_bytes && <span className="text-xs text-white/30">{formatBytes(doc.file_size_bytes)}</span>}
        </div>
        {doc.processing_error && <p className="text-xs text-red-400 mt-1">{doc.processing_error}</p>}
      </div>
      {onDelete && (
        <button onClick={onDelete} disabled={deleting} className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/30 hover:text-red-400 transition-colors disabled:opacity-50" title="Delete">
          {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
        </button>
      )}
    </div>
  )
}
