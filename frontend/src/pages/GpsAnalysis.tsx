/**
 * GPS analysis for one match: /results/:matchId/gps?tab=replay&t=<video ms>
 * Replay + sync check + every metric view. Reads only; the sync nudge (admins) changes the GPS sync, never tagged data.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Loader2, AlertCircle, LineChart } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useClubName } from '../contexts/ClubContext'
import { gpsAnalysisApi } from '../services/gpsAnalysisApi'
import GpsReplay from '../components/gps/GpsReplay'
import GpsSyncCheck from '../components/gps/GpsSyncCheck'
import { SyncBadge } from '../components/gps/GpsTracksModal'
import {
  OverviewView, ShapeView, TransitionsView, KickoutsView, IntensityView, HeatmapView, TagHealthView, SupportView, MarkingView, MomentsView, Loading, Failed,
} from '../components/gps/GpsAnalysisViews'

const TABS = [
  { key: 'replay', label: 'Replay' },
  { key: 'overview', label: 'Overview' },
  { key: 'shape', label: 'Shape' },
  { key: 'transitions', label: 'Transitions' },
  { key: 'kickouts', label: 'Kickouts' },
  { key: 'running', label: 'Running' },
  { key: 'heat', label: 'Heat maps' },
  { key: 'support', label: 'Passing support' },
  { key: 'marking', label: 'Shots against' },
  { key: 'moments', label: 'Key moments' },
  { key: 'tags', label: 'Tag check' },
  { key: 'sync', label: 'Sync check' },
] as const
type TabKey = typeof TABS[number]['key']

export default function GpsAnalysis() {
  const { matchId = '' } = useParams<{ matchId: string }>()
  const [params, setParams] = useSearchParams()
  const { canEdit } = useAuth()
  const team = useClubName() || 'We'
  const tab = (TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'replay') as TabKey
  const [initialT] = useState(() => (params.get('t') ? Number(params.get('t')) : null))
  const [seekRequest, setSeekRequest] = useState<{ ms: number; n: number } | null>(null)

  const ctxQ = useQuery({ queryKey: ['gps-context', matchId], queryFn: () => gpsAnalysisApi.context(matchId), enabled: !!matchId, retry: false })
  const needsAnalysis = tab !== 'replay' && tab !== 'sync'
  const aQ = useQuery({ queryKey: ['gps-analysis', matchId], queryFn: () => gpsAnalysisApi.analysis(matchId), enabled: !!matchId && !!ctxQ.data && needsAnalysis, retry: false, staleTime: 5 * 60 * 1000 })

  const setTab = (k: TabKey) => { const p = new URLSearchParams(window.location.search); p.set('tab', k); setParams(p, { replace: true }) }
  const openReplay = useCallback((ms: number) => {
    setSeekRequest(r => ({ ms, n: (r?.n ?? 0) + 1 }))
    const p = new URLSearchParams(window.location.search); p.set('tab', 'replay'); p.set('t', String(Math.round(ms))); setParams(p, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [setParams])

  // keep ?t= roughly in step with the replay so a refresh or a shared link lands in the same place
  const [lastT, setLastT] = useState(0)
  const onTime = useCallback((ms: number) => setLastT(ms), [])
  useEffect(() => {
    if (tab !== 'replay' || !lastT) return
    const id = setTimeout(() => {
      const p = new URLSearchParams(window.location.search); p.set('t', String(Math.round(lastT)))
      window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p.toString()}`)
    }, 1500)
    return () => clearTimeout(id)
  }, [lastT, tab])

  const ctx = ctxQ.data
  const opponent = ctx?.opponent || 'Opposition'
  const periods = useMemo(() => ctx?.periods || [], [ctx])

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/results/${matchId}`} className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"><ChevronLeft size={16} /> Back to the match</Link>
          <h1 className="text-xl md:text-2xl font-bold text-white mt-1">GPS · {team} v {opponent}</h1>
          {ctx && <div className="flex flex-wrap items-center gap-2 text-xs text-white/55 mt-1">Sync <SyncBadge status={ctx.sync.status} /> <span>{ctx.tracked.filter(pid => ctx.on_pitch[pid]).length} players with a unit played · no goalkeeper or opposition units</span></div>}
        </div>
        <Link to="/gps-season" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-sm text-white"><LineChart size={15} /> All GPS matches</Link>
      </div>

      <div className="-mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto">
        <div className="flex gap-1 min-w-max border-b border-white/10" role="tablist" aria-label="GPS views">
          {TABS.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-emerald-400 text-white' : 'border-transparent text-white/60 hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {ctxQ.isLoading ? <Loading text="Loading the match…" /> : ctxQ.isError ? (
        <div className="glass-card p-5 flex items-start gap-2 text-sm text-white/80">
          <AlertCircle size={16} className="text-amber-300 mt-0.5 shrink-0" />
          <div>
            <div>{(ctxQ.error as Error)?.message || 'GPS is not available for this match.'}</div>
            <div className="text-white/55 mt-1">On the match page, press Upload GPS, add the raw player files and run the sync. (A summary file alone fills the figures but has no positions to replay.)</div>
          </div>
        </div>
      ) : ctx && (
        <>
          <div className={tab === 'replay' ? '' : 'hidden'}>
            <GpsReplay matchId={matchId} ctx={ctx} initialMs={initialT} seekRequest={seekRequest} team={team} onTimeChange={onTime} active={tab === 'replay'} />
          </div>
          {tab === 'sync' && <GpsSyncCheck matchId={matchId} ctx={ctx} canEdit={canEdit} onOpenReplay={openReplay} />}
          {needsAnalysis && (aQ.isLoading ? <Loading text="Working out the GPS numbers for this match (a few seconds the first time)…" /> : aQ.isError ? <Failed e={aQ.error} /> : aQ.data && (
            <>
              {tab === 'overview' && <OverviewView a={aQ.data} periods={periods} onOpen={openReplay} />}
              {tab === 'shape' && <ShapeView matchId={matchId} a={aQ.data} periods={periods} onOpen={openReplay} />}
              {tab === 'transitions' && <TransitionsView a={aQ.data} periods={periods} onOpen={openReplay} team={team} />}
              {tab === 'kickouts' && <KickoutsView a={aQ.data} periods={periods} onOpen={openReplay} team={team} />}
              {tab === 'running' && <IntensityView a={aQ.data} />}
              {tab === 'heat' && <HeatmapView matchId={matchId} ctx={ctx} team={team} />}
              {tab === 'support' && <SupportView a={aQ.data} periods={periods} onOpen={openReplay} />}
              {tab === 'marking' && <MarkingView a={aQ.data} periods={periods} onOpen={openReplay} opponent={opponent} />}
              {tab === 'moments' && <MomentsView a={aQ.data} periods={periods} onOpen={openReplay} />}
              {tab === 'tags' && <TagHealthView a={aQ.data} periods={periods} onOpen={openReplay} sessionId={ctx.session.id} />}
            </>
          ))}
          {needsAnalysis && aQ.isFetching && !aQ.isLoading && <p className="flex items-center gap-2 text-xs text-white/50"><Loader2 size={12} className="animate-spin" /> Updating…</p>}
        </>
      )}
    </div>
  )
}
