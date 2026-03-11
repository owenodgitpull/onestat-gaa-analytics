import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Send, Bot, Loader2, BarChart3, MessageSquare, ArrowLeft, History } from 'lucide-react'
import { api, ChatMessage, AIChartSpec, DataTable, ChatSessionSummary } from '@/services/api'
import { renderAnalysisText } from '@/utils/renderAnalysisText'
import DynamicChart from '@/components/DynamicChart'
import DataTableCard from '@/components/DataTableCard'
import ChatSessionSidebar from '@/components/ChatSessionSidebar'

// Friendly labels for tool names shown during thinking phase
const TOOL_LABELS: Record<string, string> = {
  get_match_events: 'match events',
  get_match_summary: 'match summary',
  search_players: 'players',
  get_player_season_stats: 'player stats',
  get_team_season_stats: 'team stats',
  get_stats_by_half: 'per-half stats',
  get_scoring_patterns: 'scoring patterns',
  get_turnover_analysis: 'turnover data',
  get_player_gps_stats: 'GPS data',
  get_team_gps_summary: 'team GPS',
  get_attendance_data: 'attendance records',
  get_pitch_paths: 'pitch paths',
  generate_chart: 'chart',
  create_data_table: 'table',
}

function friendlyToolName(tool: string): string {
  return TOOL_LABELS[tool] || tool.replace(/_/g, ' ')
}

type VizItem =
  | { kind: 'chart'; chart: AIChartSpec; id: string }
  | { kind: 'table'; table: DataTable; id: string }

const QUICK_PROMPTS = [
  { category: 'Match Analysis', prompts: ['How are our kickouts performing?', 'Compare home vs away results'] },
  { category: 'Player Performance', prompts: ['Who are our most accurate scorers?', 'Show me our top scorers'] },
  { category: 'Tactical Insights', prompts: ['Where do we lose the most turnovers?', 'Analyze our scoring zones'] },
  { category: 'Fitness & GPS', prompts: ['How does our sprint data compare?', 'Who has the highest attendance?'] },
]

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function AIAnalystPage() {
  const { sessionId: urlSessionId } = useParams<{ sessionId?: string }>()
  const navigate = useNavigate()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [thinkingTool, setThinkingTool] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [visualizations, setVisualizations] = useState<VizItem[]>([])
  const [isActive, setIsActive] = useState(false)
  const [mobileView, setMobileView] = useState<'chat' | 'viz'>('chat')

  // Session state
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(urlSessionId)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const vizEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const scrollVizToBottom = useCallback(() => {
    vizEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, streamingContent, thinkingTool, scrollToBottom])
  useEffect(() => { scrollVizToBottom() }, [visualizations, scrollVizToBottom])

  // Fetch sessions on mount
  useEffect(() => {
    api.ai.listSessions().then(setSessions).catch(console.error)
  }, [])

  // Listen for sidebar toggle from Navigation
  useEffect(() => {
    const handler = () => setSidebarOpen(prev => !prev)
    window.addEventListener('toggle-chat-sidebar', handler)
    return () => window.removeEventListener('toggle-chat-sidebar', handler)
  }, [])

  // Load session when URL param changes
  useEffect(() => {
    if (urlSessionId && urlSessionId !== currentSessionId) {
      setCurrentSessionId(urlSessionId)
      loadSession(urlSessionId)
    } else if (!urlSessionId && currentSessionId) {
      // navigated to /analyst — reset
      handleNewChat()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSessionId])

  const loadSession = async (id: string) => {
    setSessionLoading(true)
    try {
      const detail = await api.ai.getSession(id)
      const loadedMessages: ChatMessage[] = []
      const loadedVizs: VizItem[] = []

      for (const msg of detail.messages) {
        loadedMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content })
        if (msg.visualizations) {
          for (const viz of msg.visualizations) {
            if (viz.kind === 'chart') {
              loadedVizs.push({ kind: 'chart', chart: viz.data, id: viz.data.id || `chart-${Date.now()}-${Math.random()}` })
            } else if (viz.kind === 'table') {
              loadedVizs.push({ kind: 'table', table: viz.data, id: `table-${Date.now()}-${Math.random()}` })
            }
          }
        }
      }

      setMessages(loadedMessages)
      setVisualizations(loadedVizs)
      setIsActive(loadedMessages.length > 0)
      setError(null)
      setStreamingContent('')
      setThinkingTool(null)
    } catch (err) {
      console.error('Failed to load session:', err)
      setError('Failed to load conversation')
    } finally {
      setSessionLoading(false)
    }
  }

  const handleNewChat = () => {
    setMessages([])
    setVisualizations([])
    setIsActive(false)
    setCurrentSessionId(undefined)
    setError(null)
    setStreamingContent('')
    setThinkingTool(null)
    setMobileView('chat')
    if (urlSessionId) {
      navigate('/analyst')
    }
  }

  const handleSelectSession = (id: string) => {
    navigate(`/analyst/${id}`)
  }

  const handleDeleteSession = async (id: string) => {
    try {
      await api.ai.deleteSession(id)
      setSessions(prev => prev.filter(s => s.id !== id))
      if (id === currentSessionId) {
        handleNewChat()
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  const refreshSessions = async () => {
    try {
      const updated = await api.ai.listSessions()
      setSessions(updated)
    } catch (e) {
      console.error('Failed to refresh sessions:', e)
    }
  }

  const sendMessage = async (text?: string) => {
    const msgText = text || input.trim()
    if (!msgText || loading || isStreaming) return

    const userMessage: ChatMessage = { role: 'user', content: msgText }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setIsStreaming(false)
    setStreamingContent('')
    setThinkingTool(null)
    setError(null)

    if (!isActive) setIsActive(true)

    try {
      let accumulated = ''

      await api.ai.streamChat(messages, userMessage.content, {
        onThinking: (tool) => {
          setLoading(false)
          setIsStreaming(true)
          setThinkingTool(tool)
        },
        onText: (chunk) => {
          setLoading(false)
          setIsStreaming(true)
          setThinkingTool(null)
          accumulated += chunk
          setStreamingContent(accumulated)
        },
        onChart: (chart) => {
          const vizItem: VizItem = { kind: 'chart', chart, id: chart.id || `chart-${Date.now()}` }
          setVisualizations(prev => [...prev, vizItem])
          // On mobile, auto-switch to viz view on first viz
          setMobileView(prev => prev === 'chat' ? 'viz' : prev)
        },
        onTable: (table) => {
          const vizItem: VizItem = { kind: 'table', table, id: `table-${Date.now()}` }
          setVisualizations(prev => [...prev, vizItem])
          setMobileView(prev => prev === 'chat' ? 'viz' : prev)
        },
        onSessionCreated: (newSessionId) => {
          setCurrentSessionId(newSessionId)
          navigate(`/analyst/${newSessionId}`, { replace: true })
        },
        onSessionTitle: (title) => {
          // Update session title in the sidebar list
          setSessions(prev => {
            const exists = prev.find(s => s.id === currentSessionId)
            if (exists) {
              return prev.map(s => s.id === currentSessionId ? { ...s, title } : s)
            }
            return prev
          })
        },
        onDone: () => {
          setMessages(prev => [...prev, { role: 'assistant', content: accumulated }])
          setStreamingContent('')
          setIsStreaming(false)
          setLoading(false)
          refreshSessions()
        },
        onError: (message) => {
          setError(message)
          setIsStreaming(false)
          setLoading(false)
        },
      }, currentSessionId)
    } catch (err) {
      setError('Failed to get response. Please try again.')
      console.error(err)
      setIsStreaming(false)
      setLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // --- Session loading state ---
  if (sessionLoading) {
    return (
      <div className="-mx-4 -mt-6 px-4 pt-2 min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin text-emerald-400 mx-auto mb-3" size={32} />
          <p className="text-white/50 text-sm">Loading conversation...</p>
        </div>
      </div>
    )
  }

  // --- Welcome State ---
  if (!isActive) {
    return (
      <>
        <ChatSessionSidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onNewChat={handleNewChat}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="-mx-4 -mt-6 px-4 pt-2 min-h-[calc(100vh-3.5rem)]  flex items-center justify-center relative">
          {/* Mobile history button */}
          {sessions.length > 0 && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden absolute top-4 right-4 z-10 p-2.5 rounded-xl bg-white/10 border border-white/10 text-white/60 hover:text-white hover:bg-white/15 transition-all"
            >
              <History size={18} />
            </button>
          )}
          <div className="max-w-3xl w-full mx-auto">
            {/* Greeting */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center mx-auto mb-4">
                <Bot size={32} className="text-white" />
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">{getGreeting()}, Owen</h1>
              <p className="text-white/60">Your AI-powered GAA analyst</p>
            </div>

            {/* Input */}
            <div className="glass-card p-4 mb-8">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Ask about matches, players, GPS data, tactics..."
                className="input-glass w-full rounded-xl p-3 resize-none"
                rows={3}
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim()}
                  className="btn-primary px-5 py-2 rounded-xl flex items-center gap-2"
                >
                  <Send size={16} />
                  <span>Send</span>
                </button>
              </div>
            </div>

            {/* Quick prompts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {QUICK_PROMPTS.map((cat) => (
                <div key={cat.category}>
                  <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">{cat.category}</p>
                  <div className="space-y-2">
                    {cat.prompts.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => sendMessage(prompt)}
                        className="glass-card-hover w-full text-left p-3 rounded-xl text-sm text-white/80 hover:text-white transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    )
  }

  // --- Active State ---
  const chatPanel = (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
                <Bot size={14} className="text-white" />
              </div>
            )}
            <div
              className={`max-w-[85%] p-3 rounded-2xl ${
                msg.role === 'user'
                  ? 'backdrop-blur-xl border border-emerald-400/20 text-white rounded-br-sm'
                  : 'glass-card text-white rounded-bl-sm'
              }`}
              style={msg.role === 'user' ? {
                background: 'linear-gradient(135deg, rgba(0,230,118,0.15), rgba(0,176,255,0.10))',
                boxShadow: '0 4px 16px rgba(0,230,118,0.15), inset 0 1px 0 rgba(255,255,255,0.08)',
              } : undefined}
            >
              {msg.role === 'assistant' ? (
                <div className="text-sm">{renderAnalysisText(msg.content)}</div>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {/* Loading: 3-dot bounce */}
        {loading && !thinkingTool && (
          <div className="flex gap-3 justify-start">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <Bot size={14} className="text-white" />
            </div>
            <div className="glass-card p-3 rounded-2xl rounded-bl-sm">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Thinking indicator */}
        {thinkingTool && (
          <div className="flex gap-3 justify-start">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <Bot size={14} className="text-white" />
            </div>
            <div className="glass-card p-3 rounded-2xl rounded-bl-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="animate-spin text-emerald-400" size={14} />
                <span className="text-sm text-white/70">
                  Looking up {friendlyToolName(thinkingTool)}...
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Streaming text */}
        {isStreaming && streamingContent && (
          <div className="flex gap-3 justify-start">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
              <Bot size={14} className="text-white" />
            </div>
            <div className="max-w-[85%] p-3 rounded-2xl glass-card text-white rounded-bl-sm">
              <div className="text-sm">
                {renderAnalysisText(streamingContent)}
                <span className="inline-block w-0.5 h-4 bg-emerald-400 animate-pulse ml-0.5 align-text-bottom" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/10">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask a follow-up..."
            className="input-glass flex-1 rounded-xl p-3 resize-none text-sm"
            rows={1}
            disabled={loading || isStreaming}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || isStreaming || !input.trim()}
            className="btn-primary px-4 rounded-xl"
          >
            <Send size={18} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  )

  const vizPanel = (
    <div className="flex flex-col h-full">
      {visualizations.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <BarChart3 size={48} className="text-white/20 mx-auto mb-3" />
            <p className="text-white/40 text-sm">Charts and tables will appear here</p>
            <p className="text-white/30 text-xs mt-1">Ask me to visualize something</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {visualizations.map((viz) =>
            viz.kind === 'chart' ? (
              <DynamicChart key={viz.id} chart={viz.chart} />
            ) : (
              <DataTableCard key={viz.id} table={viz.table} />
            )
          )}
          <div ref={vizEndRef} />
        </div>
      )}
    </div>
  )

  return (
    <>
      <ChatSessionSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="-mx-4 -mt-6 px-4 pt-2 h-[calc(100vh-3.5rem)] flex flex-col">
        {/* Mobile history + new chat buttons */}
        <div className="md:hidden flex items-center justify-between py-2 px-1">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl bg-white/10 border border-white/10 text-white/60 hover:text-white hover:bg-white/15 transition-all"
          >
            <History size={18} />
          </button>
          <button
            onClick={handleNewChat}
            className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-white/60 hover:text-white hover:bg-white/15 transition-all text-xs font-medium"
          >
            + New Chat
          </button>
        </div>

        {/* Desktop/Tablet: side-by-side */}
        <div className="hidden md:flex flex-1 gap-4 min-h-0">
          {/* Chat panel */}
          <div
            className="glass-card rounded-2xl overflow-hidden flex flex-col transition-all duration-700 ease-in-out"
            style={{ width: visualizations.length > 0 ? '40%' : '100%', minWidth: '320px' }}
          >
            {chatPanel}
          </div>

          {/* Viz panel */}
          <div
            className={`glass-card rounded-2xl overflow-hidden flex flex-col transition-all duration-700 ease-in-out ${
              visualizations.length > 0 ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ width: visualizations.length > 0 ? '60%' : '0%' }}
          >
            {vizPanel}
          </div>
        </div>

        {/* Mobile: toggle view */}
        <div className="md:hidden flex flex-col flex-1 min-h-0">
          {/* Toggle pill */}
          {visualizations.length > 0 && (
            <div className="flex items-center justify-center gap-2 py-2">
              <button
                onClick={() => setMobileView('chat')}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                  mobileView === 'chat'
                    ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                    : 'bg-white/5 text-white/50 border border-white/10'
                }`}
              >
                <MessageSquare size={12} className="inline mr-1" />
                Chat
              </button>
              <button
                onClick={() => setMobileView('viz')}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                  mobileView === 'viz'
                    ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                    : 'bg-white/5 text-white/50 border border-white/10'
                }`}
              >
                <BarChart3 size={12} className="inline mr-1" />
                Visuals
                {visualizations.length > 0 && (
                  <span className="ml-1 bg-emerald-500/40 text-emerald-200 px-1.5 rounded-full text-[10px]">
                    {visualizations.length}
                  </span>
                )}
              </button>
            </div>
          )}

          <div className="glass-card rounded-2xl overflow-hidden flex-1 min-h-0">
            {mobileView === 'chat' ? chatPanel : (
              <div className="flex flex-col h-full">
                {vizPanel}
                <div className="p-3 border-t border-white/10">
                  <button
                    onClick={() => {
                      setMobileView('chat')
                      setTimeout(() => inputRef.current?.focus(), 100)
                    }}
                    className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <ArrowLeft size={14} />
                    Ask something else
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
