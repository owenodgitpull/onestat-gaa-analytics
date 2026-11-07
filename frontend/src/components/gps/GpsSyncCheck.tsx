/**
 * Sync check: is the GPS lined up with the video? Per period: offset, typical gap, carries used; the anchors chart
 * (each tagged carry's implied offset against video time: a flat cloud is good, a step means a cut in the video);
 * a nudge (+-0.5 s / +-2 s, PATCH .../gps/timeseries/sync, marks the sync confirmed); and kickout jump buttons that
 * open the replay so a person can confirm by eye. Changes the GPS sync only, never the tagged data.
 */
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, AlertCircle, CheckCircle, Play } from 'lucide-react'
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts'
import { api, type GpsTimeseriesSummary, type GpsAnchors } from '../../services/api'
import { formatUtc, videoToGpsMs } from '../../utils/gpsClock'
import { type GpsReplayContext, periodClock, COLOR_OURS } from '../../services/gpsAnalysisApi'
import { SyncBadge, SyncPeriodsTable, PERIOD_LABEL } from './GpsTracksModal'

export default function GpsSyncCheck({ matchId, ctx, canEdit, onOpenReplay }: {
  matchId: string; ctx: GpsReplayContext | undefined; canEdit: boolean; onOpenReplay: (ms: number) => void
}) {
  const qc = useQueryClient()
  const summaryQ = useQuery<GpsTimeseriesSummary>({ queryKey: ['gps-timeseries', matchId], queryFn: () => api.matchGpsTimeseries.getSummary(matchId) })
  const anchorsQ = useQuery<GpsAnchors>({ queryKey: ['gps-timeseries-anchors', matchId], queryFn: () => api.matchGpsTimeseries.getAnchors(matchId) })
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<{ tone: 'info' | 'ok' | 'error'; text: string } | null>(null)
  const sync = summaryQ.data?.sync

  const save = async (half: number, offsetMs: number, label: string) => {
    setBusy(label)
    setStatus({ tone: 'info', text: `Saving: ${label}…` })
    try {
      const periods = (sync?.periods || []).map(p => ({ half: p.half, offset_ms: p.half === half ? offsetMs : p.offset_ms }))
      await api.matchGpsTimeseries.overrideSync(matchId, periods, true)
      setStatus({ tone: 'ok', text: `${label}. The sync is now marked confirmed; every GPS view uses the new offset.` })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['gps-timeseries', matchId] }),
        qc.invalidateQueries({ queryKey: ['gps-timeseries-anchors', matchId] }),
        qc.invalidateQueries({ queryKey: ['gps-analysis', matchId] }),
        qc.invalidateQueries({ queryKey: ['gps-context', matchId] }),
      ])
    } catch (e) {
      setStatus({ tone: 'error', text: `Not saved: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const kickoutsByHalf = useMemo(() => {
    const out: Record<number, { video_ms: number; event_type: string }[]> = {}
    for (const e of ctx?.events || []) {
      if (!/KICKOUT/.test(e.event_type)) continue
      const h = e.half ?? 1
      ;(out[h] ||= []).push(e)
    }
    return out
  }, [ctx])

  if (summaryQ.isLoading) return <p className="flex items-center gap-2 text-sm text-white/60"><Loader2 size={14} className="animate-spin" /> Loading the sync…</p>
  if (summaryQ.isError) return <p className="flex items-center gap-2 text-sm text-red-300"><AlertCircle size={14} /> Could not load the sync: {(summaryQ.error as Error)?.message}</p>
  if (!sync || sync.status === 'pending') return <p className="text-sm text-white/60">The GPS has not been synced to the video yet. Open Upload GPS on the match page and run the sync there.</p>
  if (sync.status === 'failed') return <p className="text-sm text-red-300">The last sync failed: {sync.error}</p>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
        Sync <SyncBadge status={sync.status} />
        {sync.confirmed_at && <span className="text-white/45 text-xs">confirmed {new Date(sync.confirmed_at).toLocaleString()}</span>}
      </div>
      <SyncPeriodsTable periods={sync.periods || []} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...(sync.periods || [])].sort((a, b) => a.half - b.half).map(p => {
          const ap = anchorsQ.data?.periods.find(x => x.half === p.half)
          const pts = (ap?.anchors || []).map(a => ({ x: a.video_ms / 60000, y: (a.implied_offset_ms - p.offset_ms) / 1000, d: a.dist_m }))
          const kos = (kickoutsByHalf[p.half] || [])
          const picks = kos.length ? [kos[0], kos[Math.floor(kos.length / 2)], kos[kos.length - 1]].filter((v, i, a) => a.indexOf(v) === i) : []
          return (
            <div key={p.half} className="glass-card p-4 space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-sm font-semibold text-white">{PERIOD_LABEL[p.half] || `Period ${p.half}`}</h4>
                <span className="text-xs text-white/50 tabular-nums">throw-in at {formatUtc(videoToGpsMs([p], p.video_start_ms) ?? 0)} UTC</span>
              </div>
              <div>
                <div className="text-xs text-white/55 mb-1">Each dot is one tagged carry: how far (seconds) it would move the sync on its own. A flat band around 0 is good; a jump means a cut in the video.</div>
                {anchorsQ.isLoading ? <div className="h-40 flex items-center justify-center text-xs text-white/50 gap-2"><Loader2 size={13} className="animate-spin" /> Loading carries…</div> : (
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 6, right: 8, bottom: 4, left: -18 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                        <XAxis type="number" dataKey="x" name="Video minute" domain={['dataMin', 'dataMax']} tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} tickFormatter={v => `${Math.round(v)}'`} stroke="rgba(255,255,255,0.15)" />
                        <YAxis type="number" dataKey="y" name="Seconds" domain={[-8, 8]} allowDataOverflow ticks={[-8, -4, 0, 4, 8]} tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} stroke="rgba(255,255,255,0.15)" />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.35)" />
                        <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.2)' }} contentStyle={{ background: '#0b1226', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number, n: string) => [n === 'Seconds' ? `${v.toFixed(1)} s` : `${v.toFixed(1)}'`, n === 'Seconds' ? 'Implied shift' : 'Video minute']} />
                        <Scatter data={pts} fill={COLOR_OURS} fillOpacity={0.7} shape={(props: any) => <circle cx={props.cx} cy={props.cy} r={4} fill={COLOR_OURS} fillOpacity={0.7} stroke="#0b1226" strokeWidth={1} />} />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-white/55 mr-1">Nudge GPS:</span>
                  {[-2000, -500, 500, 2000].map(d => {
                    const label = `${PERIOD_LABEL[p.half]} ${d > 0 ? '+' : '−'}${Math.abs(d) / 1000} s`
                    return (
                      <button key={d} disabled={busy !== null} onClick={() => save(p.half, p.offset_ms + d, label)}
                        className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-xs text-white tabular-nums disabled:opacity-40">
                        {busy === label ? <Loader2 size={12} className="animate-spin inline" /> : `${d > 0 ? '+' : '−'}${Math.abs(d) / 1000} s`}
                      </button>
                    )
                  })}
                  {sync.status !== 'confirmed' && (
                    <button disabled={busy !== null} onClick={() => save(p.half, p.offset_ms, `${PERIOD_LABEL[p.half]} confirmed as it is`)}
                      className="ml-auto px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-semibold disabled:opacity-40">Looks right</button>
                  )}
                </div>
              )}
              {picks.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {picks.map(k => (
                    <button key={k.video_ms} onClick={() => onOpenReplay(Math.max(0, k.video_ms - 3000))}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/80">
                      <Play size={11} /> Kickout {periodClock(k.video_ms, ctx?.periods || [])}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-white/45">To check by eye: open a kickout, pause on the kick, and see whether the dots stand where the players are on the video. If the dots move before the players on the video, press −; if they move after the players, press +.</p>
      {status && (
        <div role="status" className={`flex items-start gap-2 text-sm ${status.tone === 'error' ? 'text-red-300' : status.tone === 'ok' ? 'text-emerald-300' : 'text-white/70'}`}>
          {busy ? <Loader2 size={15} className="animate-spin mt-0.5 shrink-0" /> : status.tone === 'error' ? <AlertCircle size={15} className="mt-0.5 shrink-0" /> : status.tone === 'ok' ? <CheckCircle size={15} className="mt-0.5 shrink-0" /> : null}
          <span>{status.text}</span>
        </div>
      )}
    </div>
  )
}
