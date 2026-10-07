import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, AlertCircle, Download } from 'lucide-react'
import { API_BASE } from '@/services/api'
import type { Match } from '@/types'
import { alertDialog } from '../../utils/dialog'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ManMarkingAssignment {
  id: string
  player_name: string
  opponent_player_name: string
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  matches: Match[]
}

export default function OppositionScoutReport({ matches }: Props) {
  const reportRef = useRef<HTMLDivElement>(null)
  const upcomingMatches = matches.filter(
    (m) => m.status === 'scheduled' || m.status === 'in_progress'
  )
  const [selectedId, setSelectedId] = useState(upcomingMatches[0]?.id ?? '')
  const selectedMatch = matches.find((m) => m.id === selectedId)
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!reportRef.current) return
    setIsExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: '#0f172a',
        scale: 2,
        useCORS: true,
      })
      const imgData = canvas.toDataURL('image/png')
      const imgWidth = canvas.width
      const imgHeight = canvas.height
      const pdfWidth = 210
      const pdfHeight = (imgHeight * pdfWidth) / imgWidth
      const pdf = new jsPDF('p', 'mm', [pdfWidth, pdfHeight])
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
      const opponent = selectedMatch?.opponent?.toLowerCase().replace(/\s+/g, '-') ?? 'opposition'
      pdf.save(`opposition-scout-report-${opponent}.pdf`)
    } catch {
      void alertDialog({ title: 'Export failed', message: 'Please try again.', variant: 'danger' })
    } finally {
      setIsExporting(false)
    }
  }

  const [briefing, setBriefing] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [markings, setMarkings] = useState<ManMarkingAssignment[]>([])
  const [headToHead, setHeadToHead] = useState<Match[]>([])

  // Load existing briefing + markings when match changes
  useEffect(() => {
    if (!selectedId) return
    setBriefing(null)
    setMarkings([])
    setStreamText('')
    setError(null)

    // Fetch match details (includes opposition_briefing if saved)
    fetch(`${API_BASE}/matches/${selectedId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((match: Match & { opposition_briefing?: string }) => {
        if (match.opposition_briefing) setBriefing(match.opposition_briefing)
      })
      .catch(() => {})

    // Fetch man markings
    fetch(`${API_BASE}/match-prep/${selectedId}/markings`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ManMarkingAssignment[]) => setMarkings(data))
      .catch(() => setMarkings([]))
  }, [selectedId])

  // Compute head-to-head from all matches
  useEffect(() => {
    if (!selectedMatch) return
    const prev = matches.filter(
      (m) => m.status === 'completed' && m.opponent.toLowerCase() === selectedMatch.opponent.toLowerCase()
    )
    setHeadToHead(prev.slice(0, 5))
  }, [selectedMatch, matches])

  const generateBriefing = () => {
    if (!selectedId) return
    setGenerating(true)
    setStreamText('')
    setError(null)
    setBriefing(null)

    const url = `${API_BASE}/match-prep/${selectedId}/opposition-briefing`
    const evtSource = new EventSource(url, { withCredentials: true })
    let accumulated = ''

    evtSource.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data)
        if (payload.type === 'text') {
          accumulated += payload.content
          setStreamText(accumulated)
        } else if (payload.type === 'done') {
          evtSource.close()
          setBriefing(accumulated)
          setGenerating(false)
        } else if (payload.type === 'error') {
          setError(payload.message)
          evtSource.close()
          setGenerating(false)
        }
      } catch { /* ignore */ }
    }

    evtSource.onerror = () => {
      if (accumulated) {
        setBriefing(accumulated)
      } else {
        setError('Failed to generate briefing. Please try again.')
      }
      evtSource.close()
      setGenerating(false)
    }
  }

  if (upcomingMatches.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-white/50">
        No upcoming matches scheduled. Add fixtures to use this report.
      </div>
    )
  }

  return (
    <div ref={reportRef} className="space-y-4">
      {/* Fixture selector */}
      <div className="glass-card p-4 flex items-center gap-4 flex-wrap">
        <label className="text-white/60 text-sm font-medium whitespace-nowrap">Select Fixture:</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 min-w-48 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
        >
          {upcomingMatches.map((m) => (
            <option key={m.id} value={m.id} className="bg-slate-800">
              {new Date(m.match_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })} — vs {m.opponent}
            </option>
          ))}
        </select>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {isExporting ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>

      {selectedMatch && (
        <div className="space-y-4">
          {/* Match info */}
          <div className="glass-card p-5">
            <h2 className="text-lg font-bold text-white mb-1">vs {selectedMatch.opponent}</h2>
            <p className="text-white/50 text-sm">
              {new Date(selectedMatch.match_date).toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long' })}
              {selectedMatch.competition && ` · ${selectedMatch.competition}`}
              {' · '}{selectedMatch.is_home ? 'Home' : 'Away'}
            </p>
          </div>

          {/* Opposition briefing */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest flex items-center gap-2">
                <Search size={14} /> Opposition Briefing
              </h3>
              {!briefing && !generating && (
                <button
                  onClick={generateBriefing}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-colors"
                >
                  Generate Briefing
                </button>
              )}
              {briefing && (
                <button
                  onClick={generateBriefing}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/60 text-xs font-medium transition-colors"
                >
                  Regenerate
                </button>
              )}
            </div>

            {generating && (
              <div>
                <div className="flex items-center gap-2 text-emerald-400 text-sm mb-3">
                  <Loader2 size={14} className="animate-spin" />
                  Generating opposition briefing…
                </div>
                {streamText && (
                  <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">{streamText}</p>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            {briefing && !generating && (
              <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">{briefing}</p>
            )}

            {!briefing && !generating && !error && (
              <p className="text-white/40 text-sm">
                No briefing generated yet. Click "Generate Briefing" to use AI web search to scout {selectedMatch.opponent}.
              </p>
            )}
          </div>

          {/* Head to head */}
          {headToHead.length > 0 && (
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
                Head-to-Head History vs {selectedMatch.opponent}
              </h3>
              <div className="space-y-2">
                {headToHead.map((m) => {
                  const teamTotal = m.team_goals * 3 + m.team_points
                  const oppTotal = m.opponent_goals * 3 + m.opponent_points
                  const result = teamTotal > oppTotal ? 'W' : teamTotal < oppTotal ? 'L' : 'D'
                  const resultColors: Record<string, string> = { W: 'text-emerald-400', L: 'text-red-400', D: 'text-white/60' }
                  return (
                    <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5 text-sm">
                      <span className="text-white/40 text-xs w-20">
                        {new Date(m.match_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </span>
                      <span className={`font-bold w-6 ${resultColors[result]}`}>{result}</span>
                      <span className="text-white flex-1">
                        {m.team_goals}-{String(m.team_points).padStart(2, '0')} v {m.opponent_goals}-{String(m.opponent_points).padStart(2, '0')}
                      </span>
                      {m.competition && (
                        <span className="text-white/30 text-xs">{m.competition}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Man markings */}
          {markings.length > 0 && (
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Man Marking Assignments</h3>
              <div className="space-y-2">
                {markings.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5 text-sm">
                    <span className="text-white font-medium flex-1">{m.player_name}</span>
                    <span className="text-white/40">marks</span>
                    <span className="text-amber-400 font-medium flex-1 text-right">{m.opponent_player_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
