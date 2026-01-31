import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Loader2, Sparkles, X } from 'lucide-react'
import { api, ChatMessage } from '@/services/api'

interface AIAnalystProps {
  isOpen: boolean
  onClose: () => void
  initialContext?: string
}

export default function AIAnalyst({ isOpen, onClose, initialContext }: AIAnalystProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (isOpen && messages.length === 0 && initialContext) {
      setMessages([{
        role: 'assistant',
        content: `I'm your GAA analyst assistant. ${initialContext} What would you like to know?`
      }])
    }
  }, [isOpen, initialContext])

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage: ChatMessage = { role: 'user', content: input.trim() }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const response = await api.ai.chat(messages, userMessage.content)
      setMessages(prev => [...prev, { role: 'assistant', content: response.response }])
    } catch (err) {
      setError('Failed to get response. Please try again.')
      console.error(err)
    } finally {
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
    "What tactical patterns should we focus on in training?",
    "Compare our first half vs second half performance"
  ]

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col border border-white/10">
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
          {messages.length === 0 ? (
            <div className="text-center py-8">
              <Sparkles className="mx-auto mb-4 text-amber-400" size={48} />
              <h3 className="text-xl font-bold text-white mb-2">Ask me anything about Dungloe GAA</h3>
              <p className="text-white/60 mb-6">I can analyze matches, player performance, tactics, and more.</p>

              <div className="grid gap-2">
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(q)
                    }}
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
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-white/10 text-white rounded-bl-sm'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                    <User size={16} className="text-white" />
                  </div>
                )}
              </div>
            ))
          )}

          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div className="bg-white/10 p-3 rounded-2xl rounded-bl-sm">
                <Loader2 className="animate-spin text-white" size={20} />
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
              onKeyPress={handleKeyPress}
              placeholder="Ask about matches, players, tactics..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder-white/40 resize-none focus:outline-none focus:border-indigo-500"
              rows={1}
              disabled={loading}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
