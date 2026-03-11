import { X, Plus, Trash2, MessageSquare } from 'lucide-react'
import type { ChatSessionSummary } from '@/services/api'

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

interface ChatSessionSidebarProps {
  sessions: ChatSessionSummary[]
  currentSessionId?: string
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  isOpen: boolean
  onClose: () => void
}

export default function ChatSessionSidebar({
  sessions,
  currentSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  isOpen,
  onClose,
}: ChatSessionSidebarProps) {
  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        style={{ top: 56 }}
      />

      {/* Panel — full-width on mobile, offset on desktop */}
      <div
        className="fixed z-50 flex flex-col w-[280px] max-w-[85vw] md:w-[260px]"
        style={{
          top: 56,
          left: 0,
          bottom: 0,
          background: '#0d0d1f',
          borderRight: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}
        >
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>Chat History</span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ color: '#999' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* New Chat button */}
        <div style={{ padding: '12px 12px' }}>
          <button
            onClick={() => { onNewChat(); onClose() }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
            style={{
              color: '#fff',
              background: 'rgba(0,230,118,0.2)',
              border: '1px solid rgba(0,230,118,0.35)',
            }}
          >
            <Plus size={16} />
            <span>New Chat</span>
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '0 8px 12px' }}>
          {sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <MessageSquare size={24} style={{ color: '#333', margin: '0 auto 8px' }} />
              <p style={{ color: '#555', fontSize: 12 }}>No conversations yet</p>
            </div>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === currentSessionId
              return (
                <div
                  key={session.id}
                  onClick={() => { onSelectSession(session.id); onClose() }}
                  className="group flex items-center gap-2.5 rounded-lg cursor-pointer"
                  style={{
                    padding: '10px 12px',
                    marginBottom: 2,
                    color: isActive ? '#fff' : '#ccc',
                    background: isActive ? 'rgba(0,230,118,0.15)' : 'transparent',
                    borderLeft: isActive ? '2px solid #34d399' : '2px solid transparent',
                  }}
                >
                  <MessageSquare size={15} style={{ color: '#666', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.title}
                    </p>
                    <p style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {relativeTime(session.updated_at)} · {session.message_count} msg{session.message_count !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id) }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center transition-all flex-shrink-0"
                    style={{ color: '#888' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
