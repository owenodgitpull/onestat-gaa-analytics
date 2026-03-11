import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload,
  Activity,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  ChevronDown,
  X,
  Calendar,
  Zap,
  Timer,
  Dumbbell,
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import { api, type SquadFitnessSummary, type PlayerFitnessCard, type FitnessTestCreate, type FitnessTest, type FitnessTestComparison } from '../services/api'

type MetricKey = 'weight_kg' | 'body_fat_percentage' | 'ktw_right_cm' | 'ktw_left_cm' | 'overhead_squat_score' | 'cmj_cm' | 'squat_jump_cm' | 'press_ups_60s' | 'pull_ups_60s' | 'sprint_0_10m_sec' | 'bronco_test_min' | 'eur_calculated' | 'mas_100_percent' | 'mas_120_percent'

const METRIC_LABELS: Record<string, { label: string; shortLabel: string; unit: string }> = {
  weight_kg: { label: 'Weight', shortLabel: 'Wt', unit: 'kg' },
  body_fat_percentage: { label: 'Body Fat', shortLabel: 'BF%', unit: '%' },
  ktw_right_cm: { label: 'KTW Right', shortLabel: 'KTW-R', unit: 'cm' },
  ktw_left_cm: { label: 'KTW Left', shortLabel: 'KTW-L', unit: 'cm' },
  overhead_squat_score: { label: 'OH Squat', shortLabel: 'OHS', unit: '/3' },
  cmj_cm: { label: 'CMJ', shortLabel: 'CMJ', unit: 'cm' },
  squat_jump_cm: { label: 'Squat Jump', shortLabel: 'SJ', unit: 'cm' },
  press_ups_60s: { label: 'Press-ups', shortLabel: 'PU', unit: '' },
  pull_ups_60s: { label: 'Pull-ups', shortLabel: 'Pull', unit: '' },
  sprint_0_10m_sec: { label: '0-10m Sprint', shortLabel: '10m', unit: 's' },
  bronco_test_min: { label: 'Bronco', shortLabel: 'Bronco', unit: 'min' },
  eur_calculated: { label: 'EUR', shortLabel: 'EUR', unit: '' },
  mas_100_percent: { label: 'MAS 100%', shortLabel: 'MAS', unit: 'm/s' },
  mas_120_percent: { label: 'MAS 120%', shortLabel: 'MAS120', unit: 'm/s' },
}

const METRIC_COLUMNS: { key: MetricKey; label: string; shortLabel: string; unit: string; lowerIsBetter?: boolean }[] = [
  { key: 'weight_kg', label: 'Weight', shortLabel: 'Wt', unit: 'kg' },
  { key: 'cmj_cm', label: 'CMJ', shortLabel: 'CMJ', unit: 'cm' },
  { key: 'squat_jump_cm', label: 'Squat Jump', shortLabel: 'SJ', unit: 'cm' },
  { key: 'sprint_0_10m_sec', label: '0-10m Sprint', shortLabel: '10m', unit: 's', lowerIsBetter: true },
  { key: 'bronco_test_min', label: 'Bronco', shortLabel: 'Bronco', unit: 'min', lowerIsBetter: true },
  { key: 'press_ups_60s', label: 'Press-ups (60s)', shortLabel: 'PU', unit: '' },
  { key: 'pull_ups_60s', label: 'Pull-ups (60s)', shortLabel: 'Pull', unit: '' },
  { key: 'ktw_right_cm', label: 'KTW Right', shortLabel: 'KTW-R', unit: 'cm' },
  { key: 'ktw_left_cm', label: 'KTW Left', shortLabel: 'KTW-L', unit: 'cm' },
  { key: 'overhead_squat_score', label: 'OH Squat', shortLabel: 'OHS', unit: '/3' },
  { key: 'body_fat_percentage', label: 'Body Fat', shortLabel: 'BF%', unit: '%', lowerIsBetter: true },
  { key: 'eur_calculated', label: 'EUR', shortLabel: 'EUR', unit: '' },
  { key: 'mas_100_percent', label: 'MAS 100%', shortLabel: 'MAS', unit: 'm/s' },
  { key: 'mas_120_percent', label: 'MAS 120%', shortLabel: 'MAS120', unit: 'm/s' },
]

type ImportSession = {
  test_date: string
  players: Array<{
    name: string
    matched_player: { id: string; name: string } | null
    metrics: Record<string, number>
  }>
}

export default function SquadFitness() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<SquadFitnessSummary | null>(null)
  const [cards, setCards] = useState<PlayerFitnessCard[]>([])
  const [sessions, setSessions] = useState<Array<{ test_date: string; player_count: number }>>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [testDate, setTestDate] = useState(() => new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<ImportSession[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [sessionTests, setSessionTests] = useState<FitnessTest[]>([])
  const [previousSessionTests, setPreviousSessionTests] = useState<FitnessTest[]>([])
  const [sessionLoading, setSessionLoading] = useState(false)
  // Comparison state
  const [comparisons, setComparisons] = useState<Record<string, FitnessTestComparison>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [summaryData, cardsData, sessionsData] = await Promise.all([
        api.fitnessTests.getSquadSummary().catch(() => null),
        api.fitnessTests.getSquadCards().catch(() => []),
        api.fitnessTests.getTestSessions().catch(() => []),
      ])
      if (summaryData) setSummary(summaryData)
      setCards(cardsData as PlayerFitnessCard[])
      setSessions(sessionsData)
    } catch (err) {
      console.error('Failed to load fitness data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Load comparisons for all tested players
  useEffect(() => {
    if (cards.length === 0) return
    const testedPlayers = cards.filter(c => c.status !== 'no_data')
    // Only load if we have more than 1 session (comparison needs 2 tests)
    if (sessions.length < 2) return

    const loadComparisons = async () => {
      const results: Record<string, FitnessTestComparison> = {}
      await Promise.all(
        testedPlayers.map(async (card) => {
          try {
            const comp = await api.fitnessTests.getPlayerComparison(card.player_id)
            if (comp && comp.previous_test) results[card.player_id] = comp
          } catch { /* skip */ }
        })
      )
      setComparisons(results)
    }
    loadComparisons()
  }, [cards, sessions.length])

  const openUploadForm = () => {
    setImportPreview(null)
    setImporting(false)
    setSaveError(null)
    setSaveSuccess(false)
    setShowUpload(true)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // Reset so same file can be re-selected
    await processFile(file)
  }

  const processFile = async (file: File) => {
    setImporting(true)
    setSaveError(null)
    setImportPreview(null)

    try {
      const result = await api.fitnessTests.importFile(file, testDate)
      if (!result.test_sessions || result.test_sessions.length === 0) {
        setSaveError('No fitness data found in this file.')
        return
      }
      setImportPreview(result.test_sessions)
    } catch (err: any) {
      setSaveError(err.message || 'Failed to process file. Please try a different format.')
    } finally {
      setImporting(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleSaveImport = async () => {
    if (!importPreview) return
    setSaving(true)
    setSaveError(null)

    let totalSaved = 0

    try {
      for (const session of importPreview) {
        const tests: FitnessTestCreate[] = []

        for (const player of session.players) {
          if (!player.matched_player) continue
          if (!player.metrics || Object.keys(player.metrics).length === 0) continue

          const test: FitnessTestCreate = {
            player_id: player.matched_player.id,
            test_date: session.test_date,
          }

          for (const [key, val] of Object.entries(player.metrics)) {
            if (typeof val === 'number') {
              ;(test as unknown as Record<string, unknown>)[key] = val
            }
          }

          tests.push(test)
        }

        if (tests.length > 0) {
          await api.fitnessTests.bulkCreate(session.test_date, tests)
          totalSaved += tests.length
        }
      }

      if (totalSaved === 0) {
        setSaveError('No matched players with data to save.')
        setSaving(false)
        return
      }

      setSaveSuccess(true)
      await fetchData()
      setTimeout(() => { setShowUpload(false); setSaveSuccess(false) }, 1500)
    } catch (err) {
      console.error('Failed to save:', err)
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleExpandSession = async (dateStr: string) => {
    if (expandedSession === dateStr) { setExpandedSession(null); return }
    setExpandedSession(dateStr)
    setSessionLoading(true)
    try {
      const tests = await api.fitnessTests.list(undefined, dateStr, dateStr)
      setSessionTests(tests)

      // Find previous session for comparison
      const sessionIdx = sessions.findIndex(s => s.test_date === dateStr)
      if (sessionIdx >= 0 && sessionIdx < sessions.length - 1) {
        const prevDate = sessions[sessionIdx + 1].test_date
        const prevTests = await api.fitnessTests.list(undefined, prevDate, prevDate)
        setPreviousSessionTests(prevTests)
      } else {
        setPreviousSessionTests([])
      }
    } catch { setSessionTests([]); setPreviousSessionTests([]) }
    finally { setSessionLoading(false) }
  }

  const handleAnalyzeAll = async () => {
    try {
      const latestTests = await api.fitnessTests.getSquadLatest()
      const unanalyzed = latestTests.filter(t => !t.ai_analysis)
      for (const test of unanalyzed) {
        setAnalyzingId(test.id)
        try { await api.fitnessTests.analyze(test.id) } catch {}
      }
      setAnalyzingId(null)
      await fetchData()
    } catch { setAnalyzingId(null) }
  }

  const filteredCards = cards.filter(c => filterStatus === 'all' || c.status === filterStatus)

  const statusCounts = {
    all: cards.length,
    optimal: cards.filter(c => c.status === 'optimal').length,
    needs_attention: cards.filter(c => c.status === 'needs_attention').length,
    at_risk: cards.filter(c => c.status === 'at_risk').length,
    no_data: cards.filter(c => c.status === 'no_data').length,
  }

  // Count trend arrows for a player card
  const getTrend = (playerId: string) => {
    const comp = comparisons[playerId]
    if (!comp || !comp.changes) return null
    let up = 0, down = 0
    for (const [, val] of Object.entries(comp.changes)) {
      if (val.change_pct != null) {
        if ((val as any).improved === true) up++
        else if ((val as any).improved === false) down++
      }
    }
    return { up, down }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-10 bg-white/5 rounded-xl animate-pulse w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-white/5 rounded-xl animate-pulse" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity size={28} className="text-emerald-400" />
            Squad Fitness
          </h1>
          {summary?.last_test_date && (
            <p className="text-sm text-white/50 mt-1">
              Last tested: {new Date(summary.last_test_date).toLocaleDateString()} &middot; {sessions.length} test session{sessions.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {cards.some(c => c.status !== 'no_data') && (
            <button onClick={handleAnalyzeAll} disabled={!!analyzingId}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-sm font-semibold transition-all disabled:opacity-50">
              <Brain size={16} className={analyzingId ? 'animate-spin' : ''} />
              {analyzingId ? 'Analyzing...' : 'AI Analyze All'}
            </button>
          )}
          <button onClick={openUploadForm}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'var(--gradient-primary)', color: '#0a1a10', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3)' }}>
            <Upload size={16} />
            Import Tests
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
            Import your squad fitness test results from any file to see scores, trends, and AI analysis.
          </p>
          <button onClick={openUploadForm}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'var(--gradient-primary)', color: '#0a1a10', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3)' }}>
            <Upload size={16} />
            Import First Fitness Test
          </button>
        </div>
      )}

      {/* Concerns */}
      {summary && summary.concerns.length > 0 && (
        <div className="glass-card p-4 border-l-4 border-amber-500/60">
          <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2 mb-2">
            <AlertTriangle size={16} /> Concerns ({summary.concerns.length})
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

      {/* Test Sessions History */}
      {sessions.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-white/80 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Calendar size={16} className="text-white/40" />
            Test Sessions
          </h2>
          <div className="space-y-2">
            {sessions.map(session => (
              <div key={session.test_date} className="glass-card overflow-hidden">
                <button
                  onClick={() => handleExpandSession(session.test_date)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <FileText size={16} className="text-emerald-400" />
                    <span className="text-white font-medium">
                      {new Date(session.test_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    <span className="text-white/40 text-sm">{session.player_count} player{session.player_count !== 1 ? 's' : ''}</span>
                  </div>
                  <ChevronDown size={16} className={`text-white/40 transition-transform ${expandedSession === session.test_date ? 'rotate-180' : ''}`} />
                </button>

                {expandedSession === session.test_date && (
                  <div className="border-t border-white/10 px-4 py-3">
                    {sessionLoading ? (
                      <div className="text-center py-4 text-white/40 text-sm">Loading...</div>
                    ) : (() => {
                      // Build lookup from player_id → previous session test
                      const prevLookup: Record<string, FitnessTest> = {}
                      for (const pt of previousSessionTests) {
                        if (pt.player_id) prevLookup[pt.player_id] = pt
                      }
                      const hasPrev = previousSessionTests.length > 0
                      const visibleCols = METRIC_COLUMNS.filter(c => sessionTests.some(t => (t as any)[c.key] != null))

                      return (
                        <>
                          {hasPrev && (
                            <div className="flex items-center gap-2 mb-2 text-xs text-white/40">
                              <TrendingUp size={12} className="text-emerald-400" />
                              Showing changes vs previous session
                            </div>
                          )}
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left">
                                  <th className="text-white/50 text-xs font-semibold uppercase py-1.5 pr-4 sticky left-0 bg-transparent">Player</th>
                                  {visibleCols.map(col => (
                                    <th key={col.key} className="text-white/50 text-xs font-semibold uppercase py-1.5 px-2 text-center whitespace-nowrap">
                                      {col.shortLabel}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {sessionTests.sort((a, b) => (a.player_name || '').localeCompare(b.player_name || '')).map(test => {
                                  const prev = test.player_id ? prevLookup[test.player_id] : null
                                  return (
                                    <tr key={test.id} className="border-t border-white/5 hover:bg-white/5">
                                      <td className="py-1.5 pr-4 text-white font-medium whitespace-nowrap">{test.player_name}</td>
                                      {visibleCols.map(col => {
                                        const val = (test as any)[col.key]
                                        const prevVal = prev ? (prev as any)[col.key] : null
                                        let delta: number | null = null
                                        let improved: boolean | null = null
                                        if (val != null && prevVal != null && prevVal !== 0) {
                                          delta = ((val - prevVal) / Math.abs(prevVal)) * 100
                                          improved = col.lowerIsBetter ? val < prevVal : val > prevVal
                                        }
                                        return (
                                          <td key={col.key} className="py-1.5 px-2 text-center whitespace-nowrap">
                                            <span className="text-white/70">{val != null ? val : '-'}</span>
                                            {delta != null && (
                                              <span className={`ml-1 inline-flex items-center text-[10px] font-medium ${improved ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {improved ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                                                {Math.abs(delta).toFixed(1)}%
                                              </span>
                                            )}
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                )}
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
              { key: 'needs_attention', label: 'Attention', count: statusCounts.needs_attention, color: 'text-amber-400' },
              { key: 'at_risk', label: 'At Risk', count: statusCounts.at_risk, color: 'text-red-400' },
              { key: 'no_data', label: 'No Data', count: statusCounts.no_data, color: 'text-white/40' },
            ].filter(f => f.count > 0).map(f => (
              <button key={f.key} onClick={() => setFilterStatus(f.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                  filterStatus === f.key ? 'bg-white/15 text-white' : 'bg-white/5 text-white/50 hover:text-white/80'
                }`}>
                {f.label} <span className={f.color || 'text-white/60'}>({f.count})</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredCards.map(card => {
              const trend = getTrend(card.player_id)
              return (
                <div key={card.player_id} onClick={() => navigate(`/players/${card.player_id}`)}
                  className="glass-card p-4 cursor-pointer hover:bg-white/[0.08] transition-all group">
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
                      {/* Status + Trend */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          card.status === 'optimal' ? 'bg-emerald-500/20 text-emerald-400' :
                          card.status === 'needs_attention' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {card.status === 'optimal' ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                          {card.status === 'optimal' ? 'Optimal' : card.status === 'needs_attention' ? 'Attention' : 'At Risk'}
                        </div>
                        {trend && (
                          <div className="flex items-center gap-1 text-[10px]">
                            {trend.up > 0 && (
                              <span className="flex items-center gap-0.5 text-emerald-400">
                                <ArrowUpRight size={10} />{trend.up}
                              </span>
                            )}
                            {trend.down > 0 && (
                              <span className="flex items-center gap-0.5 text-red-400">
                                <ArrowDownRight size={10} />{trend.down}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Key Metrics with trend */}
                      <div className="space-y-1">
                        {card.key_metrics.cmj_cm != null && (
                          <MetricRow label="CMJ" value={card.key_metrics.cmj_cm.toFixed(1)} unit="cm" icon={<Zap size={10} />}
                            change={comparisons[card.player_id]?.changes?.cmj_cm} />
                        )}
                        {card.key_metrics.bronco_test_min != null && (
                          <MetricRow label="Bronco" value={card.key_metrics.bronco_test_min.toFixed(2)} unit="min" icon={<Timer size={10} />}
                            change={comparisons[card.player_id]?.changes?.bronco_test_min} />
                        )}
                        {card.key_metrics.sprint_0_10m_sec != null && (
                          <MetricRow label="10m" value={card.key_metrics.sprint_0_10m_sec.toFixed(2)} unit="s" icon={<TrendingUp size={10} />}
                            change={comparisons[card.player_id]?.changes?.sprint_0_10m_sec} />
                        )}
                      </div>

                      {/* Test date */}
                      {card.latest_test_date && (
                        <div className="text-[10px] text-white/25 mt-2">
                          Tested: {new Date(card.latest_test_date).toLocaleDateString()}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Upload Modal — Any file import */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !saving && !importing && setShowUpload(false)} />
          <div className="relative w-full max-w-3xl max-h-[90vh] bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Dumbbell size={20} className="text-emerald-400" />
                  Import Fitness Tests
                </h2>
                <p className="text-xs text-white/50 mt-0.5">Upload any file — AI will extract the fitness data.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-white/50" />
                  <input type="date" value={testDate} onChange={e => setTestDate(e.target.value)}
                    className="bg-white/10 border border-white/15 rounded-lg px-3 py-1.5 text-sm text-white" />
                </div>
                <button onClick={() => setShowUpload(false)} className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
              {importing ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-12 h-12 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin mb-4" />
                  <h3 className="text-lg font-bold text-white mb-2">Extracting fitness data...</h3>
                  <p className="text-sm text-white/50">AI is reading your file and identifying player metrics</p>
                </div>
              ) : !importPreview ? (
                /* Drop zone / file picker */
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  className="border-2 border-dashed border-white/20 rounded-xl p-12 text-center cursor-pointer hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all"
                >
                  <Upload size={48} className="mx-auto text-white/20 mb-4" />
                  <h3 className="text-lg font-bold text-white mb-2">Drop any file here or click to browse</h3>
                  <p className="text-sm text-white/50 mb-4">
                    Supports <span className="text-white/80 font-medium">Excel, Word, CSV, PDF</span> — any format with player fitness data
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {['.xlsx', '.docx', '.csv', '.pdf'].map(ext => (
                      <span key={ext} className="px-2.5 py-1 bg-white/5 rounded-lg text-xs text-white/40 font-mono">{ext}</span>
                    ))}
                  </div>
                  <input ref={fileInputRef} type="file" accept=".csv,.txt,.xlsx,.xls,.docx,.pdf" className="hidden" onChange={handleFileUpload} />
                </div>
              ) : (
                /* AI-extracted preview */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">
                      Extracted {importPreview.reduce((a, s) => a + s.players.length, 0)} players
                      {importPreview.length > 1 && ` across ${importPreview.length} test sessions`}
                    </h3>
                    <button onClick={() => { setImportPreview(null); setSaveError(null) }}
                      className="text-xs text-white/50 hover:text-white px-3 py-1 rounded bg-white/10 hover:bg-white/15 transition-all">
                      Choose different file
                    </button>
                  </div>

                  {importPreview.map((session, si) => {
                    // Collect all metric keys used in this session
                    const metricKeys = Array.from(new Set(
                      session.players.flatMap(p => Object.keys(p.metrics))
                    ))
                    const matchedCount = session.players.filter(p => p.matched_player).length

                    return (
                      <div key={si} className="space-y-2">
                        {importPreview.length > 1 && (
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar size={14} className="text-emerald-400" />
                            <span className="text-white font-medium">
                              {new Date(session.test_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                            <span className="text-white/40">({session.players.length} players)</span>
                          </div>
                        )}

                        <div className="overflow-x-auto border border-white/10 rounded-xl">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-white/5">
                                <th className="text-left text-white/50 text-xs font-semibold px-3 py-2">Match</th>
                                <th className="text-left text-white/50 text-xs font-semibold px-3 py-2">File Name</th>
                                {metricKeys.map(key => (
                                  <th key={key} className="text-center text-white/50 text-xs font-semibold px-2 py-2 whitespace-nowrap">
                                    {METRIC_LABELS[key]?.shortLabel || key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {session.players.map((player, pi) => (
                                <tr key={pi} className="border-t border-white/5">
                                  <td className="px-3 py-1.5">
                                    {player.matched_player ? (
                                      <span className="text-emerald-400 text-xs flex items-center gap-1"><CheckCircle size={10} />{player.matched_player.name}</span>
                                    ) : (
                                      <span className="text-red-400 text-xs flex items-center gap-1"><X size={10} />No match</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-white/70">{player.name}</td>
                                  {metricKeys.map(key => (
                                    <td key={key} className="px-2 py-1.5 text-center text-white/60">
                                      {player.metrics[key] != null ? player.metrics[key] : '-'}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="text-xs text-white/40">
                          {matchedCount} of {session.players.length} players matched to squad.
                          {session.players.length - matchedCount > 0 && ' Unmatched rows will be skipped.'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 flex-shrink-0">
              <div>
                {saveError && <p className="text-sm text-red-400">{saveError}</p>}
                {saveSuccess && <p className="text-sm text-emerald-400 flex items-center gap-1"><CheckCircle size={14} /> Saved successfully!</p>}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowUpload(false)} disabled={saving || importing}
                  className="px-4 py-2 rounded-lg bg-white/5 text-white/60 text-sm hover:bg-white/10 transition-colors">Cancel</button>
                {importPreview && (
                  <button onClick={handleSaveImport}
                    disabled={saving || !importPreview.some(s => s.players.some(p => p.matched_player))}
                    className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold disabled:opacity-50 transition-all"
                    style={{ background: 'var(--gradient-primary)', color: '#0a1a10' }}>
                    {saving ? (
                      <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Saving...</>
                    ) : (
                      <><CheckCircle size={16} /> Save {importPreview.reduce((a, s) => a + s.players.filter(p => p.matched_player).length, 0)} Tests</>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Small metric row with optional trend indicator */
function MetricRow({ label, value, unit, icon, change }: {
  label: string; value: string; unit: string; icon: React.ReactNode
  change?: { previous: number | null; current: number | null; change_pct: number | null; improved?: boolean }
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-white/50 flex items-center gap-1">{icon} {label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-white font-medium">{value}{unit}</span>
        {change && change.change_pct != null && (
          <span className={`flex items-center text-[10px] font-medium ${
            (change as any).improved ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {(change as any).improved ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {Math.abs(change.change_pct).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}
