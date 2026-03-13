import { useState, useEffect, useCallback } from 'react'
import { Loader2, ChevronLeft, ChevronRight, Filter, X, Clock, Globe, User } from 'lucide-react'
import { auditLogAPI } from '../../services/api'
import type { AuditLogEntry, AuditSummary } from '../../services/api'

const ACTION_COLORS: Record<string, string> = {
  created: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  updated: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  uploaded: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  generated: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  used: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  pushed: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  viewed: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  log_in: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  log_out: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  logout: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  invited_player: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  setup_profile: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  changed_role: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  deactivated: 'bg-red-500/10 text-red-400 border-red-500/20',
  reactivated: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  switched_team: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  imported: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  seeded: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  exported: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
}

const DEFAULT_COLOR = 'bg-white/5 text-white/60 border-white/10'

function formatAction(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatResource(type: string | null): string {
  if (!type) return ''
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function AuditLogSettings() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [summary, setSummary] = useState<AuditSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // Filters
  const [filterAction, setFilterAction] = useState('')
  const [filterResource, setFilterResource] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const hasFilters = filterAction || filterResource || filterUser

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const params: Record<string, string | number> = { page, per_page: 25 }
      if (filterAction) params.action = filterAction
      if (filterResource) params.resource_type = filterResource
      if (filterUser) params.user_email = filterUser
      const data = await auditLogAPI.list(params)
      setLogs(data.logs)
      setTotalPages(data.total_pages)
      setTotal(data.total)
    } catch {
      // silently handle
    } finally {
      setLoading(false)
    }
  }, [page, filterAction, filterResource, filterUser])

  const fetchSummary = useCallback(async () => {
    try {
      const data = await auditLogAPI.summary()
      setSummary(data)
    } catch {
      // silently handle
    }
  }, [])

  useEffect(() => { fetchLogs() }, [fetchLogs])
  useEffect(() => { fetchSummary() }, [fetchSummary])

  const clearFilters = () => {
    setFilterAction('')
    setFilterResource('')
    setFilterUser('')
    setPage(1)
  }

  const actionOptions = summary ? Object.keys(summary.action_counts).sort() : []
  const resourceOptions = summary ? Object.keys(summary.resource_counts).sort() : []

  const inputClass = "w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors text-sm [&>option]:bg-slate-800 [&>option]:text-white"

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Audit Log</h2>
        <p className="text-sm text-white/50 mt-1">Track admin activity across your club</p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
            <p className="text-2xl font-bold text-white">{total}</p>
            <p className="text-xs text-white/40 mt-1">Total Actions</p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
            <p className="text-2xl font-bold text-white">{summary.active_users.length}</p>
            <p className="text-xs text-white/40 mt-1">Active Users</p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
            <p className="text-2xl font-bold text-white">{Object.keys(summary.action_counts).length}</p>
            <p className="text-xs text-white/40 mt-1">Action Types</p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
            <p className="text-2xl font-bold text-white">{Object.keys(summary.resource_counts).length}</p>
            <p className="text-xs text-white/40 mt-1">Resource Types</p>
          </div>
        </div>
      )}

      {/* Most active users */}
      {summary && summary.active_users.length > 0 && (
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <User size={14} className="text-white/40" /> Most Active Users
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.active_users.slice(0, 5).map(u => (
              <button
                key={u.email}
                onClick={() => { setFilterUser(u.email); setPage(1); setShowFilters(true) }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors text-sm"
              >
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-white/70">
                    {(u.name || u.email).split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                </div>
                <span className="text-white/70">{u.name || u.email}</span>
                <span className="text-white/30 text-xs">{u.actions}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors border ${
            showFilters || hasFilters
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
          }`}
        >
          <Filter size={14} />
          Filters
          {hasFilters && (
            <span className="ml-1 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center">
              {[filterAction, filterResource, filterUser].filter(Boolean).length}
            </span>
          )}
        </button>
        {hasFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 px-2 py-2 rounded-lg text-xs text-white/40 hover:text-white/70 transition-colors">
            <X size={12} /> Clear
          </button>
        )}
        <div className="flex-1" />
        <span className="text-xs text-white/30">{total} entries</span>
      </div>

      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div>
            <label className="block text-xs text-white/50 mb-1">Action</label>
            <select className={inputClass} value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1) }}>
              <option value="">All actions</option>
              {actionOptions.map(a => <option key={a} value={a}>{formatAction(a)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1">Resource</label>
            <select className={inputClass} value={filterResource} onChange={e => { setFilterResource(e.target.value); setPage(1) }}>
              <option value="">All resources</option>
              {resourceOptions.map(r => <option key={r} value={r}>{formatResource(r)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1">User email</label>
            <input
              className={inputClass}
              placeholder="Search by email..."
              value={filterUser}
              onChange={e => { setFilterUser(e.target.value); setPage(1) }}
            />
          </div>
        </div>
      )}

      {/* Log entries */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-white/30" /></div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12">
          <Clock size={32} className="mx-auto text-white/20 mb-3" />
          <p className="text-white/40 text-sm">No audit log entries yet</p>
          <p className="text-white/25 text-xs mt-1">Actions will appear here as admins use the platform</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {logs.map(log => (
            <div key={log.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors">
              {/* User avatar */}
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-bold text-white/70">
                  {(log.user_name || log.user_email || '??').split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)}
                </span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-white/80 font-medium">
                    {log.user_name || log.user_email?.split('@')[0] || 'Unknown'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${ACTION_COLORS[log.action] || DEFAULT_COLOR}`}>
                    {formatAction(log.action)}
                  </span>
                  {log.resource_type && (
                    <span className="text-xs text-white/40">{formatResource(log.resource_type)}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {log.endpoint && (
                    <span className="text-[11px] text-white/25 font-mono">
                      {log.http_method} {log.endpoint}
                    </span>
                  )}
                </div>
              </div>

              {/* Time + IP */}
              <div className="flex flex-col items-end flex-shrink-0">
                <span className="text-xs text-white/40">{log.created_at ? timeAgo(log.created_at) : ''}</span>
                {log.ip_address && (
                  <span className="text-[10px] text-white/20 flex items-center gap-1 mt-0.5">
                    <Globe size={9} /> {log.ip_address}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-white/50 px-3">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
