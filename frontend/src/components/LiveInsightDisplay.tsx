import { useState, useEffect } from 'react'
import { Bot, Sparkles, ChevronDown, ChevronUp, Clock } from 'lucide-react'
import { api, LiveInsight } from '@/services/api'

interface LiveInsightDisplayProps {
  matchId: string | null
  minute: number
  half: number
  isMatchActive: boolean
  onNewInsight?: (insight: LiveInsight) => void
  /** Increment to force re-fetch of latest insight (e.g. after half-time trigger) */
  refreshTrigger?: number
}

export default function LiveInsightDisplay({
  matchId,
  minute,
  half,
  isMatchActive,
  onNewInsight,
  refreshTrigger = 0,
}: LiveInsightDisplayProps) {
  const [latestInsight, setLatestInsight] = useState<LiveInsight | null>(null)
  const [allInsights, setAllInsights] = useState<LiveInsight[]>([])
  const [expanded, setExpanded] = useState(false)
  const [insightExpanded, setInsightExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastCheckMinute, setLastCheckMinute] = useState(0)

  // Fetch latest insight on mount and when match changes
  useEffect(() => {
    if (matchId) {
      fetchLatestInsight()
    }
  }, [matchId])

  // Re-fetch latest insight when externally triggered (e.g. half-time analysis)
  useEffect(() => {
    if (matchId && refreshTrigger > 0) {
      fetchLatestInsight()
    }
  }, [refreshTrigger])

  // Check for new insights every 5 minutes during active match
  useEffect(() => {
    if (!matchId || !isMatchActive) return

    // Trigger at every 5-minute mark that we haven't checked yet
    const fiveMinBlock = Math.floor(minute / 5)
    if (fiveMinBlock > 0 && fiveMinBlock !== lastCheckMinute) {
      setLastCheckMinute(fiveMinBlock)
      triggerInsightCheck()
    }
  }, [matchId, minute, isMatchActive, lastCheckMinute])

  const fetchLatestInsight = async () => {
    if (!matchId) return

    try {
      const insight = await api.liveInsights.getLatest(matchId)
      if (insight) {
        setLatestInsight(insight)
      }
    } catch (err) {
      console.error('Failed to fetch latest insight:', err)
    }
  }

  const fetchAllInsights = async () => {
    if (!matchId) return

    try {
      const response = await api.liveInsights.getInsights(matchId, 10)
      setAllInsights(response.insights)
    } catch (err) {
      console.error('Failed to fetch insights:', err)
    }
  }

  const triggerInsightCheck = async () => {
    if (!matchId || loading) return

    setLoading(true)
    try {
      console.log(`[LiveInsight] Triggering check at ${minute}' (half ${half})`)
      const response = await api.liveInsights.triggerCheck(matchId, minute, half)
      console.log(`[LiveInsight] Response:`, response)
      if (response.generated && response.insight) {
        setLatestInsight(response.insight)
        setInsightExpanded(false)
        onNewInsight?.(response.insight)
        // Refresh all insights if expanded
        if (expanded) {
          fetchAllInsights()
        }
      }
    } catch (err) {
      console.error('[LiveInsight] Failed to trigger insight check:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleExpand = () => {
    if (!expanded) {
      fetchAllInsights()
    }
    setExpanded(!expanded)
  }

  const getTriggerLabel = (trigger: string): string => {
    const labels: Record<string, string> = {
      interval: '5-min Analysis',
      goal_scored: 'Goal Impact',
      scoring_run: 'Momentum Shift',
      scoring_drought: 'Scoring Alert',
      card_issued: 'Card Impact',
      substitution: 'Sub Analysis',
      half_time: 'Half-Time',
      turnover_crisis: 'Turnover Alert',
      momentum_shift: 'Momentum'
    }
    return labels[trigger] || trigger
  }

  const formatInsightText = (text: string) => {
    // Split on double newlines into paragraphs, filter empties
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim())

    return paragraphs.map((para, i) => {
      // Convert **bold** to <strong>
      const html = para.trim()
        .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
        // Convert single newlines to <br>
        .replace(/\n/g, '<br />')
        // Convert bullet points
        .replace(/^[-•]\s*/gm, '<span class="text-indigo-400 mr-1">•</span>')

      return (
        <p
          key={i}
          className="text-white/85 leading-relaxed mb-2 last:mb-0"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )
    })
  }

  const getTriggerColor = (trigger: string): string => {
    const colors: Record<string, string> = {
      goal_scored: 'from-indigo-600/30 to-violet-600/30 border-indigo-500/50',
      scoring_run: 'from-blue-600/30 to-indigo-600/30 border-blue-500/50',
      scoring_drought: 'from-amber-600/30 to-orange-600/30 border-amber-500/50',
      card_issued: 'from-red-600/30 to-rose-600/30 border-red-500/50',
      turnover_crisis: 'from-orange-600/30 to-red-600/30 border-orange-500/50',
      half_time: 'from-purple-600/30 to-indigo-600/30 border-purple-500/50',
      interval: 'from-slate-600/30 to-gray-600/30 border-slate-500/50',
      momentum_shift: 'from-cyan-600/30 to-blue-600/30 border-cyan-500/50',
      substitution: 'from-violet-600/30 to-purple-600/30 border-violet-500/50'
    }
    return colors[trigger] || 'from-slate-600/30 to-gray-600/30 border-slate-500/50'
  }

  if (!latestInsight && !loading) {
    return (
      <div className="glass-card p-4 bg-gradient-to-r from-indigo-600/10 to-purple-600/10 border border-indigo-500/20">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Bot size={20} className="text-white" />
          </div>
          <div>
            <h4 className="font-semibold text-white text-sm">AI Analyst</h4>
            <p className="text-white/60 text-xs">
              {isMatchActive
                ? 'Analyzing match patterns...'
                : 'Start the match to receive live insights'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Latest Insight Card */}
      {latestInsight && (
        <div
          className={`glass-card p-4 bg-gradient-to-r ${getTriggerColor(latestInsight.trigger)} border-2 transition-all ${
            loading ? 'animate-pulse' : ''
          }`}
        >
          <div className="flex items-start space-x-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <Sparkles size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-semibold text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded">
                    {getTriggerLabel(latestInsight.trigger)}
                  </span>
                  <span className="text-xs text-white/60 flex items-center">
                    <Clock size={12} className="mr-1" />
                    {latestInsight.minute}'
                  </span>
                </div>
              </div>
              <div className={`text-sm ${!insightExpanded ? 'max-h-[4.5rem] overflow-hidden' : ''}`}>
                {formatInsightText(latestInsight.insight)}
              </div>
              {latestInsight.insight.length > 120 && (
                <button
                  onClick={() => setInsightExpanded(!insightExpanded)}
                  className="text-xs text-indigo-300 hover:text-indigo-200 mt-1 transition-colors"
                >
                  {insightExpanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>
          </div>

          {/* Expand button */}
          <button
            onClick={handleExpand}
            className="w-full mt-3 pt-2 border-t border-white/10 flex items-center justify-center text-xs text-white/60 hover:text-white transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp size={14} className="mr-1" /> Hide history
              </>
            ) : (
              <>
                <ChevronDown size={14} className="mr-1" /> Show all insights ({allInsights.length || '...'})
              </>
            )}
          </button>
        </div>
      )}

      {/* Expanded Insights List */}
      {expanded && allInsights.length > 0 && (
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
          {allInsights.slice(1).map((insight) => (
            <div
              key={insight.id}
              className={`glass-card p-3 bg-gradient-to-r ${getTriggerColor(insight.trigger)} border opacity-80`}
            >
              <div className="flex items-start space-x-2">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Bot size={14} className="text-white/80" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/20 px-1.5 py-0.5 rounded">
                      {getTriggerLabel(insight.trigger)}
                    </span>
                    <span className="text-[10px] text-white/50">{insight.minute}'</span>
                  </div>
                  <div className="text-xs">
                    {formatInsightText(insight.insight)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="text-center text-xs text-white/60 py-2">
          <Sparkles className="inline-block animate-spin mr-1" size={12} />
          Generating insight...
        </div>
      )}
    </div>
  )
}
