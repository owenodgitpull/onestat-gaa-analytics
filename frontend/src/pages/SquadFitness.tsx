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
import type { Player } from '../types'

type MetricKey = 'weight_kg' | 'body_fat_percentage' | 'ktw_right_cm' | 'ktw_left_cm' | 'overhead_squat_score' | 'cmj_cm' | 'squat_jump_cm' | 'press_ups_60s' | 'pull_ups_60s' | 'sprint_0_10m_sec' | 'bronco_test_min'

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
]

// CSV column name aliases → our metric keys
const CSV_ALIASES: Record<string, MetricKey> = {
  'weight': 'weight_kg', 'weight_kg': 'weight_kg', 'weight (kg)': 'weight_kg', 'wt': 'weight_kg',
  'cmj': 'cmj_cm', 'cmj_cm': 'cmj_cm', 'cmj (cm)': 'cmj_cm', 'counter movement jump': 'cmj_cm',
  'squat jump': 'squat_jump_cm', 'squat_jump_cm': 'squat_jump_cm', 'sj': 'squat_jump_cm', 'squat jump (cm)': 'squat_jump_cm',
  'sprint': 'sprint_0_10m_sec', 'sprint_0_10m_sec': 'sprint_0_10m_sec', '10m': 'sprint_0_10m_sec', '0-10m': 'sprint_0_10m_sec', '10m sprint': 'sprint_0_10m_sec', 'sprint (s)': 'sprint_0_10m_sec', '0-10m sprint': 'sprint_0_10m_sec',
  'bronco': 'bronco_test_min', 'bronco_test_min': 'bronco_test_min', 'bronco test': 'bronco_test_min', 'bronco (min)': 'bronco_test_min',
  'press ups': 'press_ups_60s', 'press_ups_60s': 'press_ups_60s', 'press-ups': 'press_ups_60s', 'pressups': 'press_ups_60s', 'push ups': 'press_ups_60s', 'press ups (60s)': 'press_ups_60s',
  'pull ups': 'pull_ups_60s', 'pull_ups_60s': 'pull_ups_60s', 'pull-ups': 'pull_ups_60s', 'pullups': 'pull_ups_60s', 'pull ups (60s)': 'pull_ups_60s',
  'ktw right': 'ktw_right_cm', 'ktw_right_cm': 'ktw_right_cm', 'ktw r': 'ktw_right_cm', 'ktw right (cm)': 'ktw_right_cm',
  'ktw left': 'ktw_left_cm', 'ktw_left_cm': 'ktw_left_cm', 'ktw l': 'ktw_left_cm', 'ktw left (cm)': 'ktw_left_cm',
  'overhead squat': 'overhead_squat_score', 'overhead_squat_score': 'overhead_squat_score', 'oh squat': 'overhead_squat_score', 'ohs': 'overhead_squat_score',
  'body fat': 'body_fat_percentage', 'body_fat_percentage': 'body_fat_percentage', 'bf%': 'body_fat_percentage', 'body fat %': 'body_fat_percentage', 'body fat (%)': 'body_fat_percentage',
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue }
    current += ch
  }
  result.push(current.trim())
  return result
}

export default function SquadFitness() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<SquadFitnessSummary | null>(null)
  const [cards, setCards] = useState<PlayerFitnessCard[]>([])
  const [sessions, setSessions] = useState<Array<{ test_date: string; player_count: number }>>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [players, setPlayers] = useState<Player[]>([])
  const [testDate, setTestDate] = useState(() => new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [csvPreview, setCsvPreview] = useState<{ headers: string[]; mappedHeaders: (MetricKey | 'name' | null)[]; rows: string[][]; playerMatches: (Player | null)[] } | null>(null)
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [sessionTests, setSessionTests] = useState<FitnessTest[]>([])
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

  const openUploadForm = async () => {
    try {
      const allPlayers = await api.players.getAll()
      setPlayers(allPlayers.filter((p: Player) => p.active).sort((a: Player, b: Player) => a.name.localeCompare(b.name)))
      setCsvPreview(null)
      setSaveError(null)
      setSaveSuccess(false)
      setShowUpload(true)
    } catch (err) {
      console.error('Failed to load players:', err)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (!text) return

      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) { setSaveError('CSV file must have a header row and at least one data row.'); return }

      const headers = parseCsvLine(lines[0])
      const rows = lines.slice(1).map(parseCsvLine)

      // Map headers to our metric keys
      const mappedHeaders = headers.map(h => {
        const lower = h.toLowerCase().trim()
        if (lower === 'name' || lower === 'player' || lower === 'player name') return 'name' as const
        return CSV_ALIASES[lower] || null
      })

      const nameIdx = mappedHeaders.indexOf('name')
      if (nameIdx === -1) {
        setSaveError('CSV must have a "Name" or "Player" column.')
        return
      }

      // Try to match each row's name to a player
      const playerMatches = rows.map(row => {
        const csvName = (row[nameIdx] || '').toLowerCase().trim()
        if (!csvName) return null
        // Exact match first, then partial
        return players.find(p => p.name.toLowerCase() === csvName) ||
          players.find(p => csvName.includes(p.name.toLowerCase().split(' ').pop()!) && csvName.includes(p.name.toLowerCase().split(' ')[0])) ||
          null
      })

      setCsvPreview({ headers, mappedHeaders, rows, playerMatches })
      setSaveError(null)
    }
    reader.readAsText(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  const handleSaveCsv = async () => {
    if (!csvPreview) return
    setSaving(true)
    setSaveError(null)

    const tests: FitnessTestCreate[] = []
    for (let i = 0; i < csvPreview.rows.length; i++) {
      const player = csvPreview.playerMatches[i]
      if (!player) continue

      const row = csvPreview.rows[i]
      const test: FitnessTestCreate = { player_id: player.id, test_date: testDate }
      let hasValue = false

      csvPreview.mappedHeaders.forEach((key, colIdx) => {
        if (!key || key === 'name') return
        const val = row[colIdx]
        if (val && val.trim()) {
          const num = parseFloat(val)
          if (!isNaN(num)) {
            ;(test as unknown as Record<string, unknown>)[key] = num
            hasValue = true
          }
        }
      })

      if (hasValue) tests.push(test)
    }

    if (tests.length === 0) { setSaveError('No valid data found. Check player name matching.'); setSaving(false); return }

    try {
      await api.fitnessTests.bulkCreate(testDate, tests)
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
      const tests = await api.fitnessTests.list(undefined, dateStr)
      // Filter to just this date
      setSessionTests(tests.filter(t => t.test_date === dateStr))
    } catch { setSessionTests([]) }
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
            Upload CSV
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
            Upload a CSV with your squad fitness test results to see scores, trends, and AI analysis.
          </p>
          <button onClick={openUploadForm}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'var(--gradient-primary)', color: '#0a1a10', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3)' }}>
            <Upload size={16} />
            Upload First Fitness Test
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
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left">
                              <th className="text-white/50 text-xs font-semibold uppercase py-1.5 pr-4 sticky left-0 bg-transparent">Player</th>
                              {METRIC_COLUMNS.filter(c => sessionTests.some(t => (t as any)[c.key] != null)).map(col => (
                                <th key={col.key} className="text-white/50 text-xs font-semibold uppercase py-1.5 px-2 text-center whitespace-nowrap">
                                  {col.shortLabel}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sessionTests.sort((a, b) => (a.player_name || '').localeCompare(b.player_name || '')).map(test => (
                              <tr key={test.id} className="border-t border-white/5 hover:bg-white/5">
                                <td className="py-1.5 pr-4 text-white font-medium whitespace-nowrap">{test.player_name}</td>
                                {METRIC_COLUMNS.filter(c => sessionTests.some(t => (t as any)[c.key] != null)).map(col => (
                                  <td key={col.key} className="py-1.5 px-2 text-center text-white/70">
                                    {(test as any)[col.key] != null ? (test as any)[col.key] : '-'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
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

      {/* Upload Modal — CSV file upload */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !saving && setShowUpload(false)} />
          <div className="relative w-full max-w-3xl max-h-[90vh] bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Dumbbell size={20} className="text-emerald-400" />
                  Upload Fitness Tests
                </h2>
                <p className="text-xs text-white/50 mt-0.5">Upload a CSV file with player names and test metrics.</p>
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
              {!csvPreview ? (
                /* Drop zone / file picker */
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/20 rounded-xl p-12 text-center cursor-pointer hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all"
                >
                  <Upload size={48} className="mx-auto text-white/20 mb-4" />
                  <h3 className="text-lg font-bold text-white mb-2">Drop CSV file here or click to browse</h3>
                  <p className="text-sm text-white/50 mb-4">
                    CSV should have a <span className="text-white/80 font-medium">Name</span> column and metric columns like CMJ, Bronco, Sprint, etc.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {['Name', 'CMJ', 'Bronco', 'Sprint', 'Press Ups', 'Pull Ups', 'Weight', 'Body Fat'].map(h => (
                      <span key={h} className="px-2 py-1 bg-white/5 rounded text-[10px] text-white/40 font-mono">{h}</span>
                    ))}
                  </div>
                  <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
                </div>
              ) : (
                /* CSV Preview + player matching */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Preview — {csvPreview.rows.length} rows</h3>
                    <button onClick={() => { setCsvPreview(null); setSaveError(null) }}
                      className="text-xs text-white/50 hover:text-white px-3 py-1 rounded bg-white/10 hover:bg-white/15 transition-all">
                      Choose different file
                    </button>
                  </div>

                  {/* Mapped columns summary */}
                  <div className="flex flex-wrap gap-1.5">
                    {csvPreview.mappedHeaders.map((key, i) => (
                      <span key={i} className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        key ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-white/30 line-through'
                      }`}>
                        {csvPreview.headers[i]} {key ? `→ ${key}` : '(skipped)'}
                      </span>
                    ))}
                  </div>

                  {/* Preview table */}
                  <div className="overflow-x-auto border border-white/10 rounded-xl">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-white/5">
                          <th className="text-left text-white/50 text-xs font-semibold px-3 py-2">Match</th>
                          <th className="text-left text-white/50 text-xs font-semibold px-3 py-2">CSV Name</th>
                          {csvPreview.mappedHeaders.filter(h => h && h !== 'name').map((key, i) => (
                            <th key={i} className="text-center text-white/50 text-xs font-semibold px-2 py-2">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.rows.slice(0, 30).map((row, i) => {
                          const nameIdx = csvPreview.mappedHeaders.indexOf('name')
                          const matched = csvPreview.playerMatches[i]
                          return (
                            <tr key={i} className="border-t border-white/5">
                              <td className="px-3 py-1.5">
                                {matched ? (
                                  <span className="text-emerald-400 text-xs flex items-center gap-1"><CheckCircle size={10} />{matched.name}</span>
                                ) : (
                                  <span className="text-red-400 text-xs flex items-center gap-1"><X size={10} />No match</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-white/70">{row[nameIdx] || '-'}</td>
                              {csvPreview.mappedHeaders.filter(h => h && h !== 'name').map((_, colDisplayIdx) => {
                                // Find the actual column index
                                let actualColIdx = -1
                                let skipCount = 0
                                for (let ci = 0; ci < csvPreview.mappedHeaders.length; ci++) {
                                  const h = csvPreview.mappedHeaders[ci]
                                  if (h && h !== 'name') {
                                    if (skipCount === colDisplayIdx) { actualColIdx = ci; break }
                                    skipCount++
                                  }
                                }
                                return <td key={colDisplayIdx} className="px-2 py-1.5 text-center text-white/60">{row[actualColIdx] || '-'}</td>
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-xs text-white/40">
                    {csvPreview.playerMatches.filter(Boolean).length} of {csvPreview.rows.length} players matched.
                    {csvPreview.playerMatches.filter(p => !p).length > 0 && ' Unmatched rows will be skipped.'}
                  </div>
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
                <button onClick={() => setShowUpload(false)} disabled={saving}
                  className="px-4 py-2 rounded-lg bg-white/5 text-white/60 text-sm hover:bg-white/10 transition-colors">Cancel</button>
                {csvPreview && (
                  <button onClick={handleSaveCsv} disabled={saving || !csvPreview.playerMatches.some(Boolean)}
                    className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold disabled:opacity-50 transition-all"
                    style={{ background: 'var(--gradient-primary)', color: '#0a1a10' }}>
                    {saving ? (
                      <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Saving...</>
                    ) : (
                      <><CheckCircle size={16} /> Save {csvPreview.playerMatches.filter(Boolean).length} Tests</>
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
