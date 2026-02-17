import { useState } from 'react'
import { Sparkles, RefreshCw, TrendingUp, Eye, X } from 'lucide-react'
import DynamicChart from '@/components/DynamicChart'
import type { AIChartSpec, OutlierSuggestion } from '@/services/api'

interface AiInsightsSectionProps {
  aiCharts: AIChartSpec[]
  pinnedChartIds: string[]
  loadingAICharts: boolean
  replacingChartId: string | null
  canPin: boolean
  onDismissChart: (chartId: string) => void
  onPinChart: (chart: AIChartSpec) => void
  onRegenerateAll: () => void
  isPinned: (chartId: string) => boolean
  aiChartsSummary?: string
  suggestions?: OutlierSuggestion[]
  loadingSuggestions?: boolean
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  scoring: { bg: 'bg-amber-500/20', text: 'text-amber-300', label: 'Scoring' },
  turnovers: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', label: 'Defence' },
  kickouts: { bg: 'bg-cyan-500/20', text: 'text-cyan-300', label: 'Kickouts' },
  workload: { bg: 'bg-rose-500/20', text: 'text-rose-300', label: 'Workload' },
}

export default function AiInsightsSection({
  aiCharts,
  pinnedChartIds,
  loadingAICharts,
  replacingChartId,
  canPin,
  onDismissChart,
  onPinChart,
  onRegenerateAll,
  isPinned,
  aiChartsSummary,
  suggestions = [],
  loadingSuggestions = false,
}: AiInsightsSectionProps) {
  // Filter out charts that have been pinned (they now live in My Charts)
  const dynamicCharts = aiCharts.filter(c => !pinnedChartIds.includes(c.id))
  const [expandedSuggestion, setExpandedSuggestion] = useState<string | null>(null)

  // Convert a suggestion to an AIChartSpec so it can be rendered & pinned
  const suggestionToChartSpec = (s: OutlierSuggestion): AIChartSpec => ({
    id: s.id,
    type: s.type,
    title: s.title,
    insight: s.insight,
    data: s.data,
    config: s.config,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <span className="text-white">AI Insights</span>
          <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">Dynamic</span>
        </h2>
        <button
          onClick={onRegenerateAll}
          disabled={loadingAICharts}
          className="btn-glass flex items-center gap-2 text-sm"
        >
          <RefreshCw size={14} className={loadingAICharts ? 'animate-spin' : ''} />
          Regenerate All
        </button>
      </div>

      {/* AI Suggested Charts (Seasonal Outliers) */}
      {(suggestions.length > 0 || loadingSuggestions) && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-white/60 mb-3 uppercase tracking-wider flex items-center gap-2">
            <TrendingUp size={14} />
            AI Spotted Trends
          </h3>

          {loadingSuggestions ? (
            <div className="glass-card p-6 flex items-center justify-center gap-3">
              <RefreshCw size={18} className="animate-spin text-purple-400" />
              <span className="text-white/50 text-sm">Scanning for seasonal patterns and outliers...</span>
            </div>
          ) : (
            <div className="space-y-3">
              {suggestions.map(suggestion => {
                const isExpanded = expandedSuggestion === suggestion.id
                const style = CATEGORY_STYLES[suggestion.outlier_category] || CATEGORY_STYLES.scoring
                const chartSpec = suggestionToChartSpec(suggestion)

                return (
                  <div key={suggestion.id} className="glass-card overflow-hidden">
                    {/* Suggestion Card */}
                    <div className="p-4 flex items-center gap-3">
                      <div className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
                        {style.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{suggestion.title}</p>
                        <p className="text-xs text-white/50 truncate">{suggestion.teaser}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => setExpandedSuggestion(isExpanded ? null : suggestion.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors"
                        >
                          {isExpanded ? <X size={12} /> : <Eye size={12} />}
                          {isExpanded ? 'Close' : 'View'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded Chart View */}
                    {isExpanded && (
                      <div className="border-t border-white/10 p-4">
                        <DynamicChart
                          chart={chartSpec}
                          onPin={onPinChart}
                          isPinned={isPinned(suggestion.id)}
                          canPin={canPin}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* AI Summary */}
      {aiChartsSummary && (
        <p className="text-white/60 text-sm mb-4">{aiChartsSummary}</p>
      )}

      {/* Dynamic Charts */}
      {loadingAICharts && dynamicCharts.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="glass-card p-6 h-[300px] flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <RefreshCw size={24} className="animate-spin text-purple-400" />
                <span className="text-white/50 text-sm">AI generating chart {i}...</span>
              </div>
            </div>
          ))}
        </div>
      ) : dynamicCharts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dynamicCharts.map(chart => (
            <DynamicChart
              key={chart.id}
              chart={chart}
              onDismiss={onDismissChart}
              onPin={onPinChart}
              isPinned={isPinned(chart.id)}
              canPin={canPin}
              isLoading={replacingChartId === chart.id}
            />
          ))}
        </div>
      ) : (
        <div className="glass-card p-8 text-center">
          <Sparkles size={32} className="text-purple-400 mx-auto mb-3" />
          <p className="text-white/60 mb-4">No AI charts available. Click "Regenerate All" to generate insights.</p>
          <button onClick={onRegenerateAll} className="btn-primary">
            Generate Charts
          </button>
        </div>
      )}

      <p className="text-white/40 text-xs mt-3 text-center">
        Hover over any chart to pin it or dismiss and generate a new insight
      </p>
    </div>
  )
}
