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
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:bg-black/20"
          onClick={onClose}
          style={{ top: '56px' }}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-14 bottom-0 z-50 w-[260px] flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          left: '56px',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.04))',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRight: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm font-semibold text-white/80">Chat History</span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* New Chat button */}
        <div className="px-3 py-3">
          <button
            onClick={() => {
              onNewChat()
              onClose()
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-white transition-all"
            style={{
              background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.18))',
              border: '1px solid rgba(99,102,241,0.3)',
            }}
          >
            <Plus size={16} />
            New Chat
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {sessions.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare size={24} className="text-white/15 mx-auto mb-2" />
              <p className="text-xs text-white/30">No conversations yet</p>
            </div>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === currentSessionId
              return (
                <button
                  key={session.id}
                  onClick={() => {
                    onSelectSession(session.id)
                    onClose()
                  }}
                  className={`group w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all ${
                    isActive
                      ? 'bg-indigo-500/10 border-l-2 border-indigo-500 text-white'
                      : 'text-white/70 hover:bg-white/5 hover:text-white border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{session.title}</p>
                    <p className="text-[11px] text-white/30 mt-0.5">
                      {relativeTime(session.updated_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteSession(session.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </button>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
