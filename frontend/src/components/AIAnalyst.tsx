import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Loader2, Sparkles, X } from 'lucide-react'
import { api, ChatMessage } from '@/services/api'
import { renderAnalysisText } from '@/utils/renderAnalysisText'

// Friendly labels for tool names shown during thinking phase
const TOOL_LABELS: Record<string, string> = {
  get_match_events: 'match events',
  get_match_summary: 'match summary',
  search_players: 'players',
  get_player_season_stats: 'player stats',
  get_team_season_stats: 'team stats',
  get_scoring_patterns: 'scoring patterns',
  get_turnover_analysis: 'turnover data',
  get_player_gps_stats: 'GPS data',
  get_team_gps_summary: 'team GPS',
  get_attendance_data: 'attendance records',
}

function friendlyToolName(tool: string): string {
  return TOOL_LABELS[tool] || tool.replace(/_/g, ' ')
}

interface AIAnalystProps {
  isOpen: boolean
  onClose: () => void
  initialContext?: string
}

export default function AIAnalyst({ isOpen, onClose, initialContext }: AIAnalystProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [thinkingTool, setThinkingTool] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent, thinkingTool])

  useEffect(() => {
    if (isOpen && messages.length === 0 && initialContext) {
      setMessages([{
        role: 'assistant',
        content: `I'm your GAA analyst assistant. ${initialContext} What would you like to know?`
      }])
    }
  }, [isOpen, initialContext])

  const sendMessage = async () => {
    if (!input.trim() || loading || isStreaming) return

    const userMessage: ChatMessage = { role: 'user', content: input.trim() }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setIsStreaming(false)
    setStreamingContent('')
    setThinkingTool(null)
    setError(null)

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
        onDone: () => {
          setMessages(prev => [...prev, { role: 'assistant', content: accumulated }])
          setStreamingContent('')
          setIsStreaming(false)
          setLoading(false)
        },
        onError: (message) => {
          setError(message)
          setIsStreaming(false)
          setLoading(false)
        },
      })
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

  const suggestedQuestions = [
    "How is our scoring conversion rate this season?",
    "Which players have the best turnover stats?",
    "What does the GPS data tell us about training intensity?",
    "Who has the best attendance at training?"
  ]

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-card rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Bot size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">GAA Analyst</h2>
              <p className="text-xs text-white/60">Powered by Claude AI</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={20} className="text-white/60" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !loading && !isStreaming ? (
            <div className="text-center py-8">
              <Sparkles className="mx-auto mb-4 text-amber-400" size={48} />
              <h3 className="text-xl font-bold text-white mb-2">Ask me anything about our team</h3>
              <p className="text-white/60 mb-6">I can analyze matches, player performance, GPS data, attendance, and more.</p>

              <div className="grid gap-2">
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(q)}
                    className="text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm text-white/80"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                    <Bot size={16} className="text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] p-3 rounded-2xl ${
                    msg.role === 'user'
                      ? 'bg-indigo-600/80 backdrop-blur-sm border border-indigo-500/30 text-white rounded-br-sm'
                      : 'glass-card text-white rounded-bl-sm'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="text-sm">{renderAnalysisText(msg.content)}</div>
                  ) : (
                    <p className="text-sm">{msg.content}</p>
                  )}
                </div>
                {msg.role === 'user' && (
                  <img
                    src="/clg-logo.png"
                    className="w-8 h-8 rounded-full object-cover ring-1 ring-white/20 flex-shrink-0"
                    alt="AI Analyst"
                  />
                )}
              </div>
            ))
          )}

          {/* Loading: 3-dot bounce (waiting for first token) */}
          {loading && !thinkingTool && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <Bot size={16} className="text-white" />
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

          {/* Thinking indicator (tool calls in progress) */}
          {thinkingTool && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div className="glass-card p-3 rounded-2xl rounded-bl-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="animate-spin text-indigo-400" size={16} />
                  <span className="text-sm text-white/70">
                    Looking up {friendlyToolName(thinkingTool)}...
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Streaming text (progressive render) */}
          {isStreaming && streamingContent && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                <Bot size={16} className="text-white" />
              </div>
              <div className="max-w-[80%] p-3 rounded-2xl glass-card text-white rounded-bl-sm">
                <div className="text-sm">
                  {renderAnalysisText(streamingContent)}
                  <span className="inline-block w-0.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom" />
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
        <div className="p-4 border-t border-white/10">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Ask about matches, players, GPS data, attendance..."
              className="input-glass flex-1 rounded-xl p-3 resize-none"
              rows={1}
              disabled={loading || isStreaming}
            />
            <button
              onClick={sendMessage}
              disabled={loading || isStreaming || !input.trim()}
              className="btn-primary px-4 rounded-xl"
            >
              <Send size={20} className="text-white" />
            </button>
          </div>
          <p className="text-xs text-white/40 mt-2 text-center">
            AI may make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  )
}
