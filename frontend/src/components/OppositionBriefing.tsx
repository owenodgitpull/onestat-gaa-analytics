/**
 * OppositionBriefing — AI-generated opposition summary for match prep.
 *
 * Streams an opposition briefing from the Chat Agent with web search access.
 */

import { useState, useRef } from 'react'
import { Bot, Loader2, X, Copy, Check } from 'lucide-react'
import { renderAnalysisText } from '../utils/renderAnalysisText'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface OppositionBriefingProps {
  matchId: string
  opponent: string
}

export default function OppositionBriefing({ matchId, opponent }: OppositionBriefingProps) {
  const [briefing, setBriefing] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const generateBriefing = async () => {
    setLoading(true)
    setError(null)
    setBriefing('')

    abortRef.current = new AbortController()

    try {
      const response = await fetch(
        `${API_BASE}/match-prep/matches/${matchId}/opposition-briefing`,
        {
          credentials: 'include',
          signal: abortRef.current.signal,
        }
      )

      if (!response.ok) {
        throw new Error('Failed to generate briefing')
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') continue

          try {
            const parsed = JSON.parse(payload)
            if (parsed.type === 'text' && parsed.content) {
              fullText += parsed.content
              setBriefing(fullText)
            } else if (parsed.text) {
              fullText += parsed.text
              setBriefing(fullText)
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (briefing) {
      navigator.clipboard.writeText(briefing)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleClose = () => {
    if (abortRef.current) abortRef.current.abort()
    setBriefing(null)
    setLoading(false)
    setError(null)
  }

  if (!briefing && !loading) {
    return (
      <button
        onClick={generateBriefing}
        className="glass-card p-4 flex items-center gap-3 hover:bg-white/10 transition-all w-full text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
          <Bot size={20} className="text-purple-400" />
        </div>
        <div>
          <span className="text-white font-semibold text-sm">AI Opposition Briefing</span>
          <p className="text-white/40 text-xs mt-0.5">
            Generate a one-page scouting report on {opponent} using web search & match history
          </p>
        </div>
      </button>
    )
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-purple-400" />
          <span className="text-sm font-bold text-white">Opposition Briefing: {opponent}</span>
          {loading && <Loader2 size={14} className="text-purple-400 animate-spin" />}
        </div>
        <div className="flex items-center gap-1">
          {briefing && (
            <button onClick={handleCopy} className="p-1.5 rounded-lg text-white/40 hover:text-white" title="Copy briefing">
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          )}
          <button onClick={handleClose} className="p-1.5 rounded-lg text-white/40 hover:text-white">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="p-4 max-h-[60vh] overflow-y-auto">
        {error && (
          <div className="text-red-400 text-sm mb-3">{error}</div>
        )}
        {briefing && (
          <div className="prose prose-invert prose-sm max-w-none text-white/80 leading-relaxed">
            {renderAnalysisText(briefing)}
          </div>
        )}
        {loading && !briefing && (
          <div className="flex items-center gap-3 text-white/50 text-sm py-4">
            <Loader2 size={18} className="animate-spin" />
            Researching {opponent}...
          </div>
        )}
      </div>
    </div>
  )
}
