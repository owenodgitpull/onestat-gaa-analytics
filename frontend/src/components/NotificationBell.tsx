/**
 * Notification bell for coaches in the top bar: the in-app notifications (reel ready, report ready, GPS uploaded, weekly
 * brief...) that were saved all along but only the player portal showed. Unread count badge, a dropdown list, tap to
 * open what it is about, mark all read. Checks every minute and when the tab comes back into focus.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Loader2, Film, FileText, Activity, Sparkles, MonitorPlay, CheckCheck, AlertCircle } from 'lucide-react'
import { fetchAPI } from '@/services/api'

interface AppNotification {
  id: string; type: string | null; title: string; body: string | null; data: Record<string, any> | null; is_read: boolean; sent_at: string | null
}

const ICON: Record<string, typeof Bell> = {
  video_compilation_ready: Film, match_report: FileText, gps_uploaded: Activity, weekly_brief: Sparkles, presentation_shared: MonitorPlay,
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString()
}

/** where a notification takes you */
function target(n: AppNotification): string | null {
  const d = n.data || {}
  switch (n.type) {
    case 'video_compilation_ready': return '/video-compilations'
    case 'match_report': case 'gps_uploaded': return d.match_id ? `/results/${d.match_id}` : '/results'
    case 'presentation_shared': return '/presentations'
    case 'weekly_brief': return '/'
    default: return null
  }
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchAPI<{ notifications: AppNotification[] }>('/notifications/?limit=30'),
    refetchInterval: 60000, refetchOnWindowFocus: true, retry: false,
  })
  const list = q.data?.notifications ?? []
  const unread = list.filter(n => !n.is_read).length

  const markRead = useMutation({
    mutationFn: (id: string) => fetchAPI(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const markAll = useMutation({
    mutationFn: () => fetchAPI('/notifications/mark-all-read', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const openOne = (n: AppNotification) => {
    if (!n.is_read) markRead.mutate(n.id)
    const t = target(n)
    setOpen(false)
    if (t) navigate(t)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-white/10 transition-colors"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell size={19} className="text-white/80" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums ring-2 ring-slate-900">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="fixed left-2 right-2 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 max-h-[70vh] flex flex-col bg-slate-800 border border-white/10 rounded-xl shadow-xl z-20 overflow-hidden" role="dialog" aria-label="Notifications">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="text-sm font-semibold text-white">Notifications</div>
              <button
                onClick={() => markAll.mutate()}
                disabled={unread === 0 || markAll.isPending}
                className="flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-40 disabled:hover:text-emerald-300"
              >
                {markAll.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />} Mark all read
              </button>
            </div>
            <div className="overflow-y-auto">
              {q.isLoading ? (
                <div role="status" className="flex items-center gap-2 px-4 py-6 text-sm text-white/60"><Loader2 size={14} className="animate-spin" /> Loading notifications…</div>
              ) : q.isError ? (
                <div role="status" className="flex items-center gap-2 px-4 py-6 text-sm text-red-300"><AlertCircle size={14} /> Could not load notifications.</div>
              ) : list.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-white/50">Nothing yet. Reels, reports and GPS uploads will show up here.</div>
              ) : list.map(n => {
                const Icon = ICON[n.type || ''] || Bell
                const failed = n.data?.failed
                return (
                  <button key={n.id} onClick={() => openOne(n)}
                    className={`w-full text-left px-4 py-3 flex gap-3 border-b border-white/5 hover:bg-white/5 ${n.is_read ? '' : 'bg-emerald-500/[0.06]'}`}>
                    <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${failed ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                      {failed ? <AlertCircle size={15} /> : <Icon size={15} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm truncate ${n.is_read ? 'text-white/75' : 'text-white font-semibold'}`}>{n.title}</span>
                        {!n.is_read && <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" aria-label="unread" />}
                      </div>
                      {n.body && <div className="text-xs text-white/55 mt-0.5 line-clamp-2">{n.body}</div>}
                      <div className="text-[11px] text-white/35 mt-1">{ago(n.sent_at)}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
