/**
 * Squad Health View Component
 * Displays player workload data, health alerts, and injury risk indicators
 */
import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Activity,
  TrendingUp,
  Heart,
  RefreshCw,
  CheckCircle,
  X,
  Zap,
  User,
  Bot
} from 'lucide-react'
import { api, SquadHealthSummary, PlayerWorkload } from '@/services/api'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import { renderAnalysisText } from '@/utils/renderAnalysisText'
import { Link } from 'react-router-dom'

interface Props {
  onRefresh?: () => void
}

export default function SquadHealthView({ onRefresh: _onRefresh }: Props) {
  const [healthData, setHealthData] = useState<SquadHealthSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [showAllAlerts, setShowAllAlerts] = useState(false)

  const fetchHealthData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [data, aiResult] = await Promise.all([
        api.squadHealth.getSummary(),
        api.squadHealth.getAISummary().catch(() => ({ summary: null })),
      ])
      setHealthData(data)
      setAiSummary(aiResult.summary)
    } catch (err) {
      setError('Failed to load squad health data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const triggerAnalysis = async () => {
    setAnalyzing(true)
    try {
      await api.squadHealth.analyzeSquad()
      await fetchHealthData()
    } catch (err) {
      console.error('Analysis failed:', err)
    } finally {
      setAnalyzing(false)
    }
  }

  const dismissAlert = async (alertId: string) => {
    try {
      await api.squadHealth.dismissAlert(alertId)
      await fetchHealthData()
    } catch (err) {
      console.error('Failed to dismiss alert:', err)
    }
  }

  useEffect(() => {
    fetchHealthData()
  }, [])

  if (loading) {
    return <LoadingSkeleton />
  }

  if (error || !healthData) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-red-400 mb-4">{error || 'No health data available'}</p>
        <button onClick={fetchHealthData} className="btn-glass">
          Retry
        </button>
      </div>
    )
  }

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'optimal': return 'text-emerald-400'
      case 'undertrained': return 'text-amber-400'
      case 'elevated': return 'text-orange-400'
      case 'high_risk': return 'text-red-400'
      default: return 'text-slate-400'
    }
  }

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'optimal': return 'bg-emerald-500/20 border-emerald-500/30'
      case 'undertrained': return 'bg-amber-500/20 border-amber-500/30'
      case 'elevated': return 'bg-orange-500/20 border-orange-500/30'
      case 'high_risk': return 'bg-red-500/20 border-red-500/30'
      default: return 'bg-slate-500/20 border-slate-500/30'
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500 text-white'
      case 'high': return 'bg-orange-500 text-white'
      case 'medium': return 'bg-amber-500 text-white'
      case 'low': return 'bg-blue-500 text-white'
      default: return 'bg-slate-500 text-white'
    }
  }

  // Combine all alerts for display
  const allAlerts = [
    ...healthData.alerts.critical,
    ...healthData.alerts.high,
    ...healthData.alerts.medium,
    ...healthData.alerts.low
  ]

  // Categorize players by status
  const playersByStatus = healthData.player_workloads.reduce((acc, player) => {
    const status = player.status || 'unknown'
    if (!acc[status]) acc[status] = []
    acc[status].push(player)
    return acc
  }, {} as Record<string, PlayerWorkload[]>)

  return (
    <div className="space-y-6">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rose-500/20 flex items-center justify-center">
            <Heart size={24} className="text-rose-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Squad Health Monitor</h2>
            <p className="text-white/60 text-sm">
              Event-driven workload analysis powered by AI
            </p>
          </div>
        </div>
        <button
          onClick={triggerAnalysis}
          disabled={analyzing}
          className="btn-glass flex items-center gap-2"
        >
          {analyzing ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : (
            <Zap size={16} />
          )}
          {analyzing ? 'Analyzing...' : 'Run Analysis'}
        </button>
      </div>

      {/* AI Summary */}
      {aiSummary && (
        <div className="glass-card p-4 border border-emerald-500/20">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Bot size={16} className="text-emerald-400" />
            </div>
            <div className="text-sm leading-relaxed">{renderAnalysisText(aiSummary)}</div>
          </div>
        </div>
      )}

      {/* Status Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="stat-card">
          <div className="text-white text-sm font-semibold mb-2">Total Alerts</div>
          <div className="stat-value">{healthData.total_alerts}</div>
        </div>
        <div className="stat-card border-l-4 border-red-500">
          <div className="text-white text-sm font-semibold mb-2">Critical</div>
          <div className="stat-value text-red-500">{healthData.critical_count}</div>
        </div>
        <div className="stat-card border-l-4 border-orange-500">
          <div className="text-white text-sm font-semibold mb-2">High Risk</div>
          <div className="stat-value text-orange-500">{healthData.high_count}</div>
        </div>
        <div className="stat-card border-l-4 border-emerald-500">
          <div className="text-white text-sm font-semibold mb-2">Optimal</div>
          <div className="stat-value text-emerald-500">
            {playersByStatus['optimal']?.length || 0}
          </div>
        </div>
        <div className="stat-card border-l-4 border-amber-500">
          <div className="text-white text-sm font-semibold mb-2">Monitoring</div>
          <div className="stat-value text-amber-500">
            {(playersByStatus['undertrained']?.length || 0) + (playersByStatus['elevated']?.length || 0)}
          </div>
        </div>
      </div>

      {/* Active Alerts */}
      {allAlerts.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-white">
            <AlertTriangle size={20} className="text-amber-400" />
            Active Alerts
          </h3>
          <div className="space-y-3">
            {(showAllAlerts ? allAlerts : allAlerts.slice(0, 1)).map((alert) => (
              <div
                key={alert.id}
                className="p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${getSeverityColor(alert.severity)}`}>
                      {alert.severity}
                    </span>
                    <div>
                      <div className="font-semibold text-white">{alert.title}</div>
                      <div className="text-sm text-white/60">{alert.player_name}</div>
                      <div className="text-sm text-white/40 mt-1">{alert.message}</div>
                      {alert.recommendation && (
                        <div className="text-sm text-emerald-300 mt-2 flex items-start gap-1">
                          <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
                          <span>{alert.recommendation}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => dismissAlert(alert.id)}
                    className="p-1 rounded hover:bg-white/10"
                  >
                    <X size={16} className="text-white/40" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {allAlerts.length > 1 && (
            <button
              onClick={() => setShowAllAlerts(!showAllAlerts)}
              className="mt-3 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              {showAllAlerts ? 'Show less' : `View ${allAlerts.length - 1} more alert${allAlerts.length - 1 > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}

      {/* Player Workload Grid */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-white">
          <Activity size={20} className="text-emerald-400" />
          Player Workload Status
        </h3>

        {healthData.player_workloads.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {healthData.player_workloads.map((player) => (
              <Link
                key={player.player_id}
                to={`/players/${player.player_id}`}
                className={`p-4 rounded-xl border hover:border-emerald-500/30 transition-colors cursor-pointer block ${getStatusBg(player.status)}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                      <User size={16} className="text-white" />
                    </div>
                    <span className="font-semibold text-white">{player.player_name}</span>
                  </div>
                  <span className={`text-xs font-bold uppercase ${getStatusColor(player.status)}`}>
                    {player.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-white/40 text-xs">ACWR</div>
                    <div className={`font-bold ${
                      player.acwr === null ? 'text-slate-400' :
                      player.acwr < 0.8 ? 'text-amber-400' :
                      player.acwr <= 1.3 ? 'text-emerald-400' :
                      player.acwr <= 1.5 ? 'text-orange-400' :
                      'text-red-400'
                    }`}>
                      {player.acwr !== null ? player.acwr.toFixed(2) : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-white/40 text-xs">Today Load</div>
                    <div className="font-bold text-white">
                      {player.today_load}
                    </div>
                  </div>
                  <div>
                    <div className="text-white/40 text-xs">Acute (7d)</div>
                    <div className="flex items-center gap-1 text-white">
                      {player.acute_load !== null ? Math.round(player.acute_load) : '-'}
                      {player.acute_load !== null && player.chronic_load !== null &&
                        player.acute_load > player.chronic_load && (
                          <TrendingUp size={12} className="text-orange-400" />
                        )
                      }
                    </div>
                  </div>
                  <div>
                    <div className="text-white/40 text-xs">Chronic (28d)</div>
                    <div className="text-white">
                      {player.chronic_load !== null ? Math.round(player.chronic_load) : '-'}
                    </div>
                  </div>
                </div>

                {/* ACWR Visual Bar */}
                {player.acwr !== null && (
                  <div className="mt-3">
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          player.acwr < 0.8 ? 'bg-amber-400' :
                          player.acwr <= 1.3 ? 'bg-emerald-400' :
                          player.acwr <= 1.5 ? 'bg-orange-400' :
                          'bg-red-400'
                        }`}
                        style={{ width: `${Math.min(player.acwr / 2 * 100, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-white/30 mt-1">
                      <span>0.8</span>
                      <span>1.0</span>
                      <span>1.3</span>
                      <span>1.5+</span>
                    </div>
                  </div>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-white/40">
            <Activity size={48} className="mx-auto mb-4 opacity-50" />
            <p>No workload data available yet.</p>
            <p className="text-sm mt-2">
              Data will appear after training sessions and matches are logged.
            </p>
          </div>
        )}
      </div>

      {/* ACWR Legend */}
      <div className="glass-card p-4">
        <h4 className="text-sm font-semibold text-white/60 mb-3">ACWR (Acute:Chronic Workload Ratio) Guide</h4>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-400"></span>
            <span className="text-white/60">&lt;0.8 Undertrained</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-400"></span>
            <span className="text-white/60">0.8-1.3 Optimal</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-orange-400"></span>
            <span className="text-white/60">1.3-1.5 Elevated Risk</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-400"></span>
            <span className="text-white/60">&gt;1.5 High Risk</span>
          </div>
        </div>
      </div>
    </div>
  )
}
