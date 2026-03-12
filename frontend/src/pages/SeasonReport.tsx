import { lazy, Suspense, useEffect, useState } from 'react'
import {
  FileText, Calendar, User, Shield, Activity, BarChart3,
  Footprints, Target, AlertTriangle, ArrowLeft,
} from 'lucide-react'
import { useClubName } from '@/contexts/ClubContext'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import { api } from '@/services/api'
import type { Match, Player } from '@/types'
import type { DashboardData } from '@/services/api'

// Lazy-load each report component to keep initial bundle small
const MatchDayReport = lazy(() => import('@/components/reports/MatchDayReport'))
const PlayerFormReport = lazy(() => import('@/components/reports/PlayerFormReport'))
const OppositionScoutReport = lazy(() => import('@/components/reports/OppositionScoutReport'))
const SquadFitnessReport = lazy(() => import('@/components/reports/SquadFitnessReport'))
const SeasonProgressReport = lazy(() => import('@/components/reports/SeasonProgressReport'))
const KickoutAnalysisReport = lazy(() => import('@/components/reports/KickoutAnalysisReport'))
const TrainingLoadReport = lazy(() => import('@/components/reports/TrainingLoadReport'))
const DisciplineReport = lazy(() => import('@/components/reports/DisciplineReport'))

// ─── Report definitions ───────────────────────────────────────────────────────

type ReportId =
  | 'match-day'
  | 'player-form'
  | 'opposition-scout'
  | 'squad-fitness'
  | 'season-progress'
  | 'kickout-analysis'
  | 'training-load'
  | 'discipline'

interface ReportDef {
  id: ReportId
  title: string
  description: string
  icon: React.ReactNode
  color: string
}

const REPORTS: ReportDef[] = [
  {
    id: 'match-day',
    title: 'Match Day Report',
    description: 'Full breakdown of any completed match — scorers, stats, GPS, AI summary.',
    icon: <Calendar size={22} />,
    color: 'from-emerald-500/30 to-teal-500/30',
  },
  {
    id: 'player-form',
    title: 'Player Form',
    description: 'Last 5 matches, form trend, radar chart vs squad average.',
    icon: <User size={22} />,
    color: 'from-blue-500/30 to-indigo-500/30',
  },
  {
    id: 'opposition-scout',
    title: 'Opposition Scout',
    description: 'AI-generated briefing for upcoming fixtures. Head-to-head history.',
    icon: <Shield size={22} />,
    color: 'from-purple-500/30 to-violet-500/30',
  },
  {
    id: 'squad-fitness',
    title: 'Squad Fitness',
    description: 'Availability, workload flags, latest fitness test scores.',
    icon: <Activity size={22} />,
    color: 'from-rose-500/30 to-pink-500/30',
  },
  {
    id: 'season-progress',
    title: 'Season Progress',
    description: 'Win/loss record, scoring trend, home/away split, competition breakdown.',
    icon: <BarChart3 size={22} />,
    color: 'from-amber-500/30 to-orange-500/30',
  },
  {
    id: 'kickout-analysis',
    title: 'Kickout Analysis',
    description: 'Own and opposition kickout retention per match, with result correlation.',
    icon: <Footprints size={22} />,
    color: 'from-cyan-500/30 to-sky-500/30',
  },
  {
    id: 'training-load',
    title: 'Training Load',
    description: 'Session attendance, GPS load per player for any date range.',
    icon: <Target size={22} />,
    color: 'from-lime-500/30 to-green-500/30',
  },
  {
    id: 'discipline',
    title: 'Discipline',
    description: 'Cards and fouls by player and match, suspension risk tracker.',
    icon: <AlertTriangle size={22} />,
    color: 'from-red-500/30 to-orange-500/30',
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function SeasonReport() {
  const clubName = useClubName()
  const [activeReport, setActiveReport] = useState<ReportId | null>(null)

  // Shared data loaded once for the reports that need it
  const [matches, setMatches] = useState<Match[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [dataLoading, setDataLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.matches.getAll().catch(() => []),
      api.players.getAll().catch(() => []),
      api.analytics.getDashboard().catch(() => null),
    ]).then(([m, p, d]) => {
      setMatches(m)
      setPlayers(p)
      setDashboardData(d)
    }).finally(() => setDataLoading(false))
  }, [])

  const activeReportDef = REPORTS.find((r) => r.id === activeReport)

  if (dataLoading) return <LoadingSkeleton variant="generic" />

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      {/* Header */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/30 to-blue-500/30 flex items-center justify-center">
            <FileText size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Reports</h1>
            <p className="text-sm text-white/50">{clubName}</p>
          </div>
        </div>
      </div>

      {/* Report grid OR active report */}
      {!activeReport ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {REPORTS.map((report) => (
            <button
              key={report.id}
              onClick={() => setActiveReport(report.id)}
              className="glass-card p-5 text-left group hover:bg-white/10 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${report.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                <span className="text-white">{report.icon}</span>
              </div>
              <h3 className="text-white font-semibold text-sm mb-1">{report.title}</h3>
              <p className="text-white/50 text-xs leading-relaxed">{report.description}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Back + title bar */}
          <div className="glass-card p-4 flex items-center gap-3">
            <button
              onClick={() => setActiveReport(null)}
              className="flex items-center gap-2 text-white/60 hover:text-white text-sm font-medium transition-colors"
            >
              <ArrowLeft size={16} />
              All Reports
            </button>
            <span className="text-white/20">/</span>
            {activeReportDef && (
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${activeReportDef.color} flex items-center justify-center`}>
                  <span className="text-white scale-75">{activeReportDef.icon}</span>
                </div>
                <h2 className="text-white font-semibold text-sm">{activeReportDef.title}</h2>
              </div>
            )}
          </div>

          {/* Report content */}
          <Suspense fallback={<LoadingSkeleton variant="generic" />}>
            {activeReport === 'match-day' && <MatchDayReport matches={matches} />}
            {activeReport === 'player-form' && <PlayerFormReport players={players} />}
            {activeReport === 'opposition-scout' && <OppositionScoutReport matches={matches} />}
            {activeReport === 'squad-fitness' && <SquadFitnessReport players={players} />}
            {activeReport === 'season-progress' && (
              <SeasonProgressReport matches={matches} dashboardData={dashboardData} />
            )}
            {activeReport === 'kickout-analysis' && <KickoutAnalysisReport />}
            {activeReport === 'training-load' && <TrainingLoadReport />}
            {activeReport === 'discipline' && <DisciplineReport />}
          </Suspense>
        </div>
      )}
    </div>
  )
}
