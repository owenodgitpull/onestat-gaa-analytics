import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload,
  Activity,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  X,
  Calendar,
  Zap,
  Timer,
  Dumbbell,
  Brain,
  TrendingUp,
  Minus,
} from 'lucide-react'
import { api, type SquadFitnessSummary, type PlayerFitnessCard, type FitnessTestCreate } from '../services/api'
import type { Player } from '../types'

type MetricKey = 'weight_kg' | 'body_fat_percentage' | 'ktw_right_cm' | 'ktw_left_cm' | 'overhead_squat_score' | 'cmj_cm' | 'squat_jump_cm' | 'press_ups_60s' | 'pull_ups_60s' | 'sprint_0_10m_sec' | 'bronco_test_min'

const METRIC_COLUMNS: { key: MetricKey; label: string; shortLabel: string; unit: string; type: 'number' | 'int'; step?: string }[] = [
  { key: 'weight_kg', label: 'Weight', shortLabel: 'Wt', unit: 'kg', type: 'number', step: '0.1' },
  { key: 'cmj_cm', label: 'CMJ', shortLabel: 'CMJ', unit: 'cm', type: 'number', step: '0.1' },
  { key: 'squat_jump_cm', label: 'Squat Jump', shortLabel: 'SJ', unit: 'cm', type: 'number', step: '0.1' },
  { key: 'sprint_0_10m_sec', label: '0-10m Sprint', shortLabel: '10m', unit: 's', type: 'number', step: '0.01' },
  { key: 'bronco_test_min', label: 'Bronco', shortLabel: 'Bronco', unit: 'min', type: 'number', step: '0.01' },
  { key: 'press_ups_60s', label: 'Press-ups (60s)', shortLabel: 'PU', unit: '', type: 'int' },
  { key: 'pull_ups_60s', label: 'Pull-ups (60s)', shortLabel: 'Pull', unit: '', type: 'int' },
  { key: 'ktw_right_cm', label: 'KTW Right', shortLabel: 'KTW-R', unit: 'cm', type: 'number', step: '0.1' },
  { key: 'ktw_left_cm', label: 'KTW Left', shortLabel: 'KTW-L', unit: 'cm', type: 'number', step: '0.1' },
  { key: 'overhead_squat_score', label: 'OH Squat', shortLabel: 'OHS', unit: '/3', type: 'int' },
  { key: 'body_fat_percentage', label: 'Body Fat', shortLabel: 'BF%', unit: '%', type: 'number', step: '0.1' },
]

export default function SquadFitness() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<SquadFitnessSummary | null>(null)
  const [cards, setCards] = useState<PlayerFitnessCard[]>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [players, setPlayers] = useState<Player[]>([])
  const [testDate, setTestDate] = useState(() => new Date().toISOString().split('T')[0])
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [summaryData, cardsData] = await Promise.all([
        api.fitnessTests.getSquadSummary(),
        api.fitnessTests.getSquadCards(),
      ])
      setSummary(summaryData)
      setCards(cardsData)
    } catch (err) {
      console.error('Failed to load fitness data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const openUploadForm = async () => {
    try {
      const allPlayers = await api.players.getAll()
      const activePlayers = allPlayers.filter((p: Player) => p.active).sort((a: Player, b: Player) => a.name.localeCompare(b.name))
      setPlayers(activePlayers)
      setFormData({})
      setSaveError(null)
      setSaveSuccess(false)
      setShowUpload(true)
    } catch (err) {
      console.error('Failed to load players:', err)
    }
  }

  const updateMetric = (playerId: string, metric: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [playerId]: {
        ...prev[playerId],
        [metric]: value,
      },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    // Build tests array from form data — only include players with at least one metric
    const tests: FitnessTestCreate[] = []
    for (const player of players) {
      const playerData = formData[player.id]
      if (!playerData) continue

      const hasAnyValue = Object.values(playerData).some(v => v.trim() !== '')
      if (!hasAnyValue) continue

      const test: FitnessTestCreate = {
        player_id: player.id,
        test_date: testDate,
      }

      for (const col of METRIC_COLUMNS) {
        const val = playerData[col.key]
        if (val && val.trim() !== '') {
          const num = col.type === 'int' ? parseInt(val) : parseFloat(val)
          if (!isNaN(num)) {
            ;(test as unknown as Record<string, unknown>)[col.key] = num
          }
        }
      }

      tests.push(test)
    }

    if (tests.length === 0) {
      setSaveError('No data entered. Fill in at least one metric for one player.')
      setSaving(false)
      return
    }

    try {
      await api.fitnessTests.bulkCreate(testDate, tests)
      setSaveSuccess(true)
      // Refresh the main data
      await fetchData()
      // Close form after a moment
      setTimeout(() => {
        setShowUpload(false)
        setSaveSuccess(false)
      }, 1500)
    } catch (err) {
      console.error('Failed to save fitness tests:', err)
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleAnalyzeAll = async () => {
    // Get latest tests that don't have AI analysis
    try {
      const latestTests = await api.fitnessTests.getSquadLatest()
      const unanalyzed = latestTests.filter(t => !t.ai_analysis)
      for (const test of unanalyzed) {
        setAnalyzingId(test.id)
        try {
          await api.fitnessTests.analyze(test.id)
        } catch (err) {
          console.error(`Failed to analyze test ${test.id}:`, err)
        }
      }
      setAnalyzingId(null)
      await fetchData()
    } catch (err) {
      console.error('Failed to analyze tests:', err)
      setAnalyzingId(null)
    }
  }

  const filteredCards = cards.filter(c => {
    if (filterStatus === 'all') return true
    return c.status === filterStatus
  })

  const statusCounts = {
    all: cards.length,
    optimal: cards.filter(c => c.status === 'optimal').length,
    needs_attention: cards.filter(c => c.status === 'needs_attention').length,
    at_risk: cards.filter(c => c.status === 'at_risk').length,
    no_data: cards.filter(c => c.status === 'no_data').length,
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-10 bg-white/5 rounded-xl animate-pulse w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-white/5 rounded-xl animate-pulse" />)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-36 bg-white/5 rounded-xl animate-pulse" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity size={28} className="text-emerald-400" />
            Squad Fitness
          </h1>
          {summary?.last_test_date && (
            <p className="text-sm text-white/50 mt-1">
              Last tested: {new Date(summary.last_test_date).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {cards.some(c => c.status !== 'no_data') && (
            <button
              onClick={handleAnalyzeAll}
              disabled={!!analyzingId}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-sm font-semibold transition-all disabled:opacity-50"
            >
              <Brain size={16} className={analyzingId ? 'animate-spin' : ''} />
              {analyzingId ? 'Analyzing...' : 'AI Analyze All'}
            </button>
          )}
          <button
            onClick={openUploadForm}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'var(--gradient-primary)', color: '#0a1a10', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3)' }}
          >
            <Upload size={16} />
            Upload Fitness Tests
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && summary.players_tested > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="glass-card p-5">
            <div className="text-white/60 text-xs font-semibold uppercase tracking-wide mb-1.5">Players Tested</div>
            <div className="text-3xl font-bold text-white">{summary.players_tested}<span className="text-lg text-white/40">/{summary.total_players}</span></div>
            <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(summary.players_tested / summary.total_players) * 100}%` }} />
            </div>
          </div>
          <div className="glass-card p-5">
            <div className="text-white/60 text-xs font-semibold uppercase tracking-wide mb-1.5">Squad Score</div>
            <div className={`text-3xl font-bold ${summary.squad_fitness_score >= 70 ? 'text-emerald-400' : summary.squad_fitness_score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
              {summary.squad_fitness_score.toFixed(0)}
            </div>
            <div className="text-xs text-white/40 mt-1">out of 100</div>
          </div>
          <div className="glass-card p-5">
            <div className="text-white/60 text-xs font-semibold uppercase tracking-wide mb-1.5">Avg CMJ</div>
            <div className="text-3xl font-bold text-white">{summary.averages.cmj_cm?.toFixed(1) || '-'}<span className="text-sm text-white/40 ml-1">cm</span></div>
            {summary.top_performers.cmj_cm && (
              <div className="text-xs text-emerald-400 mt-1 truncate">Best: {summary.top_performers.cmj_cm.player}</div>
            )}
          </div>
          <div className="glass-card p-5">
            <div className="text-white/60 text-xs font-semibold uppercase tracking-wide mb-1.5">Avg Bronco</div>
            <div className="text-3xl font-bold text-white">{summary.averages.bronco_test_min?.toFixed(2) || '-'}<span className="text-sm text-white/40 ml-1">min</span></div>
            {summary.top_performers.bronco_test_min && (
              <div className="text-xs text-emerald-400 mt-1 truncate">Best: {summary.top_performers.bronco_test_min.player}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="glass-card p-8 text-center">
          <Activity size={48} className="mx-auto text-white/15 mb-4" />
          <h3 className="text-lg font-bold text-white mb-2">No Fitness Tests Yet</h3>
          <p className="text-white/50 text-sm mb-6 max-w-md mx-auto">
            Upload your first squad fitness test to see player scores, squad averages, AI analysis, and injury risk assessments.
          </p>
          <button
            onClick={openUploadForm}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'var(--gradient-primary)', color: '#0a1a10', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3)' }}
          >
            <Upload size={16} />
            Upload First Fitness Test
          </button>
        </div>
      )}

      {/* Concerns */}
      {summary && summary.concerns.length > 0 && (
        <div className="glass-card p-4 border-l-4 border-amber-500/60">
          <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2 mb-2">
            <AlertTriangle size={16} />
            Concerns ({summary.concerns.length})
          </h3>
          <div className="space-y-1.5">
            {summary.concerns.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-white font-medium">{c.player}:</span>
                <span className="text-white/60">{c.issues.join('; ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs + Player Cards */}
      {cards.length > 0 && (
        <>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {[
              { key: 'all', label: 'All', count: statusCounts.all },
              { key: 'optimal', label: 'Optimal', count: statusCounts.optimal, color: 'text-emerald-400' },
              { key: 'needs_attention', label: 'Needs Attention', count: statusCounts.needs_attention, color: 'text-amber-400' },
              { key: 'at_risk', label: 'At Risk', count: statusCounts.at_risk, color: 'text-red-400' },
              { key: 'no_data', label: 'No Data', count: statusCounts.no_data, color: 'text-white/40' },
            ].filter(f => f.count > 0).map(f => (
              <button
                key={f.key}
                onClick={() => setFilterStatus(f.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                  filterStatus === f.key
                    ? 'bg-white/15 text-white'
                    : 'bg-white/5 text-white/50 hover:text-white/80'
                }`}
              >
                {f.label}
                <span className={`${f.color || 'text-white/60'}`}>({f.count})</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredCards.map(card => (
              <div
                key={card.player_id}
                onClick={() => navigate(`/players/${card.player_id}`)}
                className="glass-card p-4 cursor-pointer hover:bg-white/[0.08] transition-all group"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {card.jersey_number && (
                      <span className="text-xs font-bold text-white/40 bg-white/10 rounded-md w-6 h-6 flex items-center justify-center flex-shrink-0">
                        {card.jersey_number}
                      </span>
                    )}
                    <span className="text-sm font-bold text-white truncate">{card.player_name}</span>
                  </div>
                  <ChevronRight size={14} className="text-white/20 group-hover:text-white/50 transition-colors flex-shrink-0" />
                </div>

                {card.status === 'no_data' ? (
                  <div className="text-center py-2">
                    <Minus size={20} className="mx-auto text-white/15 mb-1" />
                    <p className="text-xs text-white/30">No test data</p>
                  </div>
                ) : (
                  <>
                    {/* Status indicator */}
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold mb-2 ${
                      card.status === 'optimal' ? 'bg-emerald-500/20 text-emerald-400' :
                      card.status === 'needs_attention' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {card.status === 'optimal' ? <CheckCircle size={10} /> :
                       card.status === 'needs_attention' ? <AlertTriangle size={10} /> :
                       <AlertTriangle size={10} />}
                      {card.status === 'optimal' ? 'Optimal' : card.status === 'needs_attention' ? 'Attention' : 'At Risk'}
                    </div>

                    {/* Key Metrics */}
                    <div className="space-y-1">
                      {card.key_metrics.cmj_cm && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/50 flex items-center gap-1"><Zap size={10} /> CMJ</span>
                          <span className="text-white font-medium">{card.key_metrics.cmj_cm.toFixed(1)}cm</span>
                        </div>
                      )}
                      {card.key_metrics.bronco_test_min && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/50 flex items-center gap-1"><Timer size={10} /> Bronco</span>
                          <span className="text-white font-medium">{card.key_metrics.bronco_test_min.toFixed(2)}min</span>
                        </div>
                      )}
                      {card.key_metrics.sprint_0_10m_sec && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/50 flex items-center gap-1"><TrendingUp size={10} /> 10m</span>
                          <span className="text-white font-medium">{card.key_metrics.sprint_0_10m_sec.toFixed(2)}s</span>
                        </div>
                      )}
                    </div>

                    {/* Injury risk bar */}
                    {card.injury_risk != null && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[10px] mb-0.5">
                          <span className="text-white/30">Injury Risk</span>
                          <span className={
                            card.injury_risk <= 3 ? 'text-emerald-400' :
                            card.injury_risk <= 6 ? 'text-amber-400' : 'text-red-400'
                          }>{card.injury_risk}/10</span>
                        </div>
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${
                            card.injury_risk <= 3 ? 'bg-emerald-500' :
                            card.injury_risk <= 6 ? 'bg-amber-500' : 'bg-red-500'
                          }`} style={{ width: `${card.injury_risk * 10}%` }} />
                        </div>
                      </div>
                    )}

                    {/* Test date */}
                    {card.latest_test_date && (
                      <div className="text-[10px] text-white/25 mt-2">
                        Tested: {new Date(card.latest_test_date).toLocaleDateString()}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !saving && setShowUpload(false)} />
          <div className="relative w-full max-w-6xl max-h-[90vh] bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Dumbbell size={20} className="text-emerald-400" />
                  Upload Fitness Tests
                </h2>
                <p className="text-xs text-white/50 mt-0.5">Enter test results for your squad. Leave blank for untested players.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-white/50" />
                  <input
                    type="date"
                    value={testDate}
                    onChange={e => setTestDate(e.target.value)}
                    className="bg-white/10 border border-white/15 rounded-lg px-3 py-1.5 text-sm text-white"
                  />
                </div>
                <button onClick={() => setShowUpload(false)} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Spreadsheet */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-800/95 backdrop-blur-sm">
                    <th className="text-left text-white/60 text-xs font-semibold uppercase tracking-wide px-4 py-3 sticky left-0 bg-slate-800/95 min-w-[180px]">
                      Player
                    </th>
                    {METRIC_COLUMNS.map(col => (
                      <th key={col.key} className="text-center text-white/60 text-[10px] font-semibold uppercase tracking-wide px-2 py-3 min-w-[80px]">
                        <div>{col.shortLabel}</div>
                        <div className="text-white/30 font-normal">{col.unit}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {players.map((player, idx) => (
                    <tr key={player.id} className={`border-t border-white/5 ${idx % 2 === 0 ? 'bg-white/[0.02]' : ''} hover:bg-white/[0.05]`}>
                      <td className="px-4 py-2 sticky left-0 bg-slate-900/95 backdrop-blur-sm">
                        <div className="flex items-center gap-2">
                          {player.jersey_number && (
                            <span className="text-xs font-bold text-white/40 bg-white/10 rounded w-6 h-6 flex items-center justify-center flex-shrink-0">
                              {player.jersey_number}
                            </span>
                          )}
                          <span className="text-white font-medium truncate">{player.name}</span>
                        </div>
                      </td>
                      {METRIC_COLUMNS.map(col => (
                        <td key={col.key} className="px-1 py-1.5">
                          <input
                            type="number"
                            step={col.step || '1'}
                            min="0"
                            max={col.key === 'overhead_squat_score' ? '3' : undefined}
                            value={formData[player.id]?.[col.key] || ''}
                            onChange={e => updateMetric(player.id, col.key, e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-emerald-500/50 focus:bg-white/10 transition-all outline-none placeholder-white/15"
                            placeholder="-"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 flex-shrink-0">
              <div>
                {saveError && <p className="text-sm text-red-400">{saveError}</p>}
                {saveSuccess && <p className="text-sm text-emerald-400 flex items-center gap-1"><CheckCircle size={14} /> Saved successfully!</p>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-white/40">
                  {Object.keys(formData).filter(id => {
                    const d = formData[id]
                    return d && Object.values(d).some(v => v.trim() !== '')
                  }).length} players with data
                </span>
                <button
                  onClick={() => setShowUpload(false)}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-white/5 text-white/60 text-sm hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold disabled:opacity-50 transition-all"
                  style={{ background: 'var(--gradient-primary)', color: '#0a1a10' }}
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      Save Tests
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
