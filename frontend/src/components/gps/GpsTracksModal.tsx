/**
 * GPS tracks (raw time series) for one match: upload the per-player STATSports CSVs, then sync them to the video.
 *
 * Flow: pick the files -> each is sniffed (detectGpsFile) -> "Upload" parses them one at a time in a Web Worker
 * and sends each compact track to POST .../gps/timeseries/tracks -> a device name the server cannot match gets a
 * player picker and is resent with player_id -> "Run sync" (POST .../sync, 10-60 s) -> per-period result and the
 * tracks that are not in the match window. Uses only api.matchGpsTimeseries and utils/gpsTimeseriesParser.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Upload, Loader2, CheckCircle, AlertCircle, FileText, RefreshCw, MinusCircle } from 'lucide-react'
import { api, type GpsSyncSummary, type GpsTimeseriesSummary } from '../../services/api'
import { detectGpsFile, fileDateFromName, type GpsFileDetection, type TrackUpload } from '../../utils/gpsTimeseriesParser'
import type { GpsParseResponse } from '../../workers/gpsParse.worker'
import { formatUtc, videoToGpsMs } from '../../utils/gpsClock'
import { usePlayers } from '../../hooks/usePlayers'

type RowStatus = 'checking' | 'ready' | 'skipped' | 'parsing' | 'uploading' | 'stored' | 'needs_player' | 'error'

interface FileRow {
  id: string
  file: File
  detection: GpsFileDetection | null
  status: RowStatus
  message: string
  track?: TrackUpload          // kept after parsing so an unmatched name can be resent without re-parsing
  playerName?: string
  pickedPlayerId?: string
}

export const PERIOD_LABEL: Record<number, string> = { 1: '1st half', 2: '2nd half', 3: 'Extra time 1', 4: 'Extra time 2' }

const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`

/** Round to what the server stores (degrees x 1e7, cm/s) so the request is about half the size. */
function compact(t: TrackUpload): TrackUpload {
  return {
    ...t,
    lat: t.lat.map(v => Math.round(v * 1e7) / 1e7),
    lon: t.lon.map(v => Math.round(v * 1e7) / 1e7),
    speed: t.speed.map(v => Math.round(v * 100) / 100),
  }
}

export default function GpsTracksModal({ matchId, matchDate, onClose }: { matchId: string; matchDate: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: players } = usePlayers()
  const [rows, setRows] = useState<FileRow[]>([])
  const [busy, setBusy] = useState<null | 'upload' | 'sync'>(null)
  const [status, setStatus] = useState<{ tone: 'info' | 'ok' | 'error'; text: string } | null>(null)
  const [syncResult, setSyncResult] = useState<GpsSyncSummary | null>(null)
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null)
  const [, tick] = useState(0)
  const workerRef = useRef<Worker | null>(null)

  const summaryQ = useQuery<GpsTimeseriesSummary>({
    queryKey: ['gps-timeseries', matchId],
    queryFn: () => api.matchGpsTimeseries.getSummary(matchId),
  })
  const summary = summaryQ.data
  const matchDay = (matchDate || '').slice(0, 10)

  useEffect(() => () => { workerRef.current?.terminate() }, [])
  // a running clock on the sync status line, so a 30 s wait never looks frozen
  useEffect(() => {
    if (syncStartedAt == null) return
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [syncStartedAt])

  const patch = (id: string, p: Partial<FileRow>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...p } : r)))

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const added: FileRow[] = [...files].map((f, i) => ({ id: `${Date.now()}-${i}-${f.name}`, file: f, detection: null, status: 'checking', message: 'Checking the file…' }))
    setRows(rs => [...rs, ...added])
    setStatus({ tone: 'info', text: `Checking ${added.length} file${added.length === 1 ? '' : 's'}…` })
    for (const r of added) {
      try {
        const d = await detectGpsFile(r.file)
        const fileDay = fileDateFromName(r.file.name)
        if (d.kind !== 'timeseries') {
          const why = d.kind === 'summary' ? 'Per-player summary: use the Upload GPS button for this one'
            : d.kind === 'timeseries_sparse' ? d.message : 'Not a GPS time series (needs Time, Lat and Lon columns)'
          patch(r.id, { detection: d, status: 'skipped', message: why })
        } else if (fileDay && matchDay && fileDay !== matchDay) {
          patch(r.id, { detection: d, status: 'ready', message: `File is dated ${fileDay}, the match is ${matchDay}: it will be read as the match date` })
        } else {
          patch(r.id, { detection: d, status: 'ready', message: `${mb(r.file.size)} · ready` })
        }
      } catch (e) {
        patch(r.id, { status: 'error', message: e instanceof Error ? e.message : 'Could not read the file' })
      }
    }
    setStatus({ tone: 'info', text: 'Files checked. Press Upload to read and store them.' })
  }

  const parseInWorker = (row: FileRow): Promise<TrackUpload> => {
    if (!workerRef.current) workerRef.current = new Worker(new URL('../../workers/gpsParse.worker.ts', import.meta.url), { type: 'module' })
    const w = workerRef.current
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent<GpsParseResponse>) => {
        if (e.data.id !== row.id) return
        w.removeEventListener('message', onMsg)
        if (e.data.ok) resolve(e.data.track)
        else reject(new Error(e.data.error))
      }
      w.addEventListener('message', onMsg)
      w.postMessage({ id: row.id, file: row.file, matchDate: matchDay })
    })
  }

  const send = async (row: FileRow, track: TrackUpload, playerId?: string): Promise<'stored' | 'needs_player' | 'error'> => {
    patch(row.id, { status: 'uploading', message: 'Storing…', track })
    try {
      const res = await api.matchGpsTimeseries.uploadTrack(matchId, playerId ? { ...track, player_id: playerId } : track)
      patch(row.id, { status: 'stored', track: undefined, playerName: res.player_name ?? undefined,
        message: `${res.player_name} · ${res.start_utc}-${res.end_utc} UTC · ${res.duration_min} min${res.match_type === 'fuzzy_surname' ? ' · matched on surname only: check it is the right man' : ''}` })
      return 'stored'
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e)
      if (e?.status === 422 && /Could not match/i.test(msg)) {
        patch(row.id, { status: 'needs_player', track, message: `No player found for "${track.device_name}". Pick who wore this unit.` })
        return 'needs_player'
      }
      patch(row.id, { status: 'error', track, message: msg })
      return 'error'
    }
  }

  const uploadAll = async () => {
    const todo = rows.filter(r => r.status === 'ready' || (r.status === 'error' && r.detection?.kind === 'timeseries'))
    if (!todo.length) return
    setBusy('upload')
    let stored = 0, needPick = 0, failed = 0
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i]
      const who = r.detection?.deviceName || r.file.name
      setStatus({ tone: 'info', text: `Reading file ${i + 1} of ${todo.length}: ${who} (${mb(r.file.size)})…` })
      patch(r.id, { status: 'parsing', message: 'Reading positions…' })
      let track: TrackUpload
      try {
        track = r.track ?? compact(await parseInWorker(r))
      } catch (e) {
        failed++
        patch(r.id, { status: 'error', message: e instanceof Error ? e.message : 'Could not read the file' })
        continue
      }
      setStatus({ tone: 'info', text: `Storing file ${i + 1} of ${todo.length}: ${who}…` })
      const outcome = await send(r, track)
      if (outcome === 'stored') stored++
      else if (outcome === 'needs_player') needPick++
      else failed++
    }
    setStatus({
      tone: failed ? 'error' : needPick ? 'info' : 'ok',
      text: `${stored} track${stored === 1 ? '' : 's'} stored${needPick ? `, ${needPick} need a player picked` : ''}${failed ? `, ${failed} failed` : ''}. ${needPick || failed ? 'Sort those out, then run the sync.' : 'Now run the sync.'}`,
    })
    setBusy(null)
    queryClient.invalidateQueries({ queryKey: ['gps-timeseries', matchId] })
  }

  const resendWithPlayer = async (row: FileRow) => {
    if (!row.track || !row.pickedPlayerId) return
    setBusy('upload')
    setStatus({ tone: 'info', text: `Storing ${row.track.device_name}…` })
    const ok = (await send(row, row.track, row.pickedPlayerId)) === 'stored'
    setBusy(null)
    setStatus(ok ? { tone: 'ok', text: `${row.track.device_name} stored.` } : { tone: 'error', text: `${row.track.device_name} was not stored: see the row.` })
    queryClient.invalidateQueries({ queryKey: ['gps-timeseries', matchId] })
  }

  const runSync = async () => {
    setBusy('sync')
    setSyncResult(null)
    setSyncStartedAt(Date.now())
    setStatus({ tone: 'info', text: 'Syncing the GPS to the video from the tagged carries…' })
    try {
      const res = await api.matchGpsTimeseries.runSync(matchId)
      setSyncResult(res)
      setStatus({ tone: 'ok', text: `Synced: ${res.periods?.length ?? 0} period${res.periods?.length === 1 ? '' : 's'} matched to the video.` })
    } catch (e) {
      setStatus({ tone: 'error', text: `Sync failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setSyncStartedAt(null)
      setBusy(null)
      queryClient.invalidateQueries({ queryKey: ['gps-timeseries', matchId] })
      queryClient.invalidateQueries({ queryKey: ['gps-timeseries-anchors', matchId] })
    }
  }

  const sortedPlayers = useMemo(() => [...(players || [])].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')), [players])
  const storedTracks = summary?.tracks ?? []
  const sync = syncResult ?? summary?.sync ?? null
  const outOfWindow = storedTracks.filter(t => t.quality && !t.quality.in_match)
  const notChecked = storedTracks.filter(t => !t.quality)
  const readyCount = rows.filter(r => r.status === 'ready').length
  const elapsed = syncStartedAt ? Math.round((Date.now() - syncStartedAt) / 1000) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="GPS tracks">
      <div className="glass-card w-full md:max-w-3xl md:mx-4 max-h-[92vh] flex flex-col rounded-b-none md:rounded-2xl">
        <div className="flex items-center justify-between px-4 md:px-6 pt-4 md:pt-5 pb-3 border-b border-white/10">
          <div>
            <h3 className="text-lg font-bold text-white">GPS tracks</h3>
            <p className="text-xs text-white/50">Raw STATSports positions (one CSV per player), synced to the match video</p>
          </div>
          <button onClick={onClose} disabled={busy !== null} className="p-2 -mr-2 text-white/60 hover:text-white disabled:opacity-30" aria-label="Close" title={busy ? 'Wait for the current step to finish' : 'Close'}>
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
          {(
            <>
              {/* What is stored already */}
              <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm">
                {summaryQ.isLoading ? (
                  <span className="flex items-center gap-2 text-white/60"><Loader2 size={14} className="animate-spin" /> Loading what is stored for this match…</span>
                ) : summaryQ.isError ? (
                  <span className="flex items-center gap-2 text-red-300"><AlertCircle size={14} /> Could not load the stored tracks: {(summaryQ.error as Error)?.message}</span>
                ) : storedTracks.length === 0 ? (
                  <span className="text-white/60">No GPS tracks stored for this match yet.</span>
                ) : (
                  <span className="text-white/80">
                    <b className="text-white">{storedTracks.length}</b> tracks stored
                    {storedTracks.length - outOfWindow.length - notChecked.length > 0 && sync && sync.status !== 'pending' && <> · <b className="text-white">{storedTracks.length - outOfWindow.length - notChecked.length}</b> in the match</>}
                    {' · '}sync <SyncBadge status={sync?.status ?? 'pending'} />
                  </span>
                )}
              </div>

              {storedTracks.length > 0 && (
                <details className="rounded-xl border border-white/10 bg-white/[0.02]">
                  <summary className="cursor-pointer px-3 py-2 text-sm text-white/75">Stored tracks ({storedTracks.length}): one per player, a new file for the same player replaces it</summary>
                  <ul className="px-3 pb-2 text-sm divide-y divide-white/5">
                    {storedTracks.map(t => (
                      <li key={t.id} className="py-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="text-white">{t.player_name} <span className="text-white/40 text-xs">{t.device_name}</span></span>
                        <span className={`text-xs ${t.quality && !t.quality.in_match ? 'text-amber-300' : 'text-white/50'}`}>
                          {t.quality ? (t.quality.in_match ? `${Math.round(t.quality.coverage * 100)}% of the match` : 'not in the match window') : 'not synced yet'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* File picker */}
              <label className={`flex flex-col items-center justify-center w-full py-6 border-2 border-dashed border-white/20 rounded-xl transition-colors ${busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-emerald-500/50'}`}>
                <Upload size={28} className="text-white/40 mb-2" />
                <span className="text-sm text-white/80">Choose the player CSVs</span>
                <span className="text-xs text-white/40 mt-1 text-center px-4">Select all of them at once (one file per player, 100-170 MB each). They are read on this device; only the positions are sent.</span>
                <input type="file" multiple accept=".csv,text/csv" className="hidden" disabled={busy !== null}
                  onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
              </label>

              {rows.length > 0 && (
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">Files in this upload</h4>
                  {!busy && <button onClick={() => setRows([])} className="text-xs text-white/50 hover:text-white">Clear list</button>}
                </div>
              )}
              {rows.length > 0 && (
                <ul className="divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
                  {rows.map(r => (
                    <li key={r.id} className="px-3 py-2.5 bg-white/[0.02]">
                      <div className="flex items-start gap-2.5">
                        <RowIcon status={r.status} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-sm font-medium text-white truncate">{r.playerName || r.detection?.deviceName || r.file.name}</span>
                            {r.detection?.deviceName && <span className="text-xs text-white/40 truncate">{r.file.name}</span>}
                          </div>
                          <div className={`text-xs mt-0.5 ${r.status === 'error' ? 'text-red-300' : r.status === 'needs_player' ? 'text-amber-300' : 'text-white/55'}`}>{r.message}</div>
                          {r.status === 'needs_player' && (
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <select value={r.pickedPlayerId || ''} onChange={e => patch(r.id, { pickedPlayerId: e.target.value || undefined })}
                                className="min-w-0 flex-1 md:flex-none md:w-64 bg-white/10 border border-white/15 rounded-lg px-2 py-2 text-sm text-white">
                                <option value="">Pick the player…</option>
                                {sortedPlayers.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.jersey_number ? ` (${p.jersey_number})` : ''}</option>)}
                              </select>
                              <button onClick={() => resendWithPlayer(r)} disabled={!r.pickedPlayerId || busy !== null}
                                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-40">Store</button>
                              <button onClick={() => patch(r.id, { status: 'skipped', track: undefined, message: 'Skipped' })}
                                className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-sm">Skip</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                {rows.length > 0 && (
                  <button onClick={uploadAll} disabled={busy !== null || readyCount === 0}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-40">
                    {busy === 'upload' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                    {busy === 'upload' ? 'Uploading…' : `Upload ${readyCount} track${readyCount === 1 ? '' : 's'}`}
                  </button>
                )}
                {storedTracks.length > 0 && (
                  <button onClick={runSync} disabled={busy !== null}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-sm font-semibold disabled:opacity-40">
                    {busy === 'sync' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    {busy === 'sync' ? `Syncing… ${elapsed}s` : sync && sync.status !== 'pending' ? 'Run the sync again' : 'Run sync'}
                  </button>
                )}
              </div>

              {status && (
                <div role="status" className={`flex items-start gap-2 text-sm ${status.tone === 'error' ? 'text-red-300' : status.tone === 'ok' ? 'text-emerald-300' : 'text-white/70'}`}>
                  {busy ? <Loader2 size={15} className="animate-spin mt-0.5 shrink-0" /> : status.tone === 'error' ? <AlertCircle size={15} className="mt-0.5 shrink-0" /> : status.tone === 'ok' ? <CheckCircle size={15} className="mt-0.5 shrink-0" /> : null}
                  <span>{status.text}{busy === 'sync' && ' This takes 10 to 60 seconds.'}</span>
                </div>
              )}

              {/* Sync result */}
              {sync && sync.status !== 'pending' && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">Sync result</h4>
                  {sync.status === 'failed' ? (
                    <p className="text-sm text-red-300">{sync.error || 'The sync failed.'}</p>
                  ) : (
                    <SyncPeriodsTable periods={sync.periods || []} />
                  )}
                  {outOfWindow.length > 0 && (
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2.5">
                      <div className="text-sm font-medium text-amber-200">Not in the match window ({outOfWindow.length})</div>
                      <p className="text-xs text-amber-100/70 mt-0.5">These tracks were recorded at another time (e.g. a morning session). They stay stored but every GPS view leaves them out.</p>
                      <ul className="mt-1.5 text-sm text-white/80 space-y-0.5">
                        {outOfWindow.map(t => <li key={t.id}>{t.player_name} <span className="text-white/40 text-xs">({t.device_name} · {Math.round((t.quality?.coverage ?? 0) * 100)}% of the match covered)</span></li>)}
                      </ul>
                    </div>
                  )}
                  {sync.status !== 'failed' && (
                    <p className="text-xs text-white/45">A typical gap of 6 to 12 m in every period means the sync worked. <a className="underline text-white/70 hover:text-white" href={`/results/${matchId}/gps?tab=sync`}>Check it by eye and open the replay</a>.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function SyncBadge({ status }: { status: string }) {
  const s: Record<string, string> = {
    confirmed: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30',
    auto: 'bg-blue-500/20 text-blue-200 border-blue-500/30',
    pending: 'bg-white/10 text-white/60 border-white/15',
    failed: 'bg-red-500/20 text-red-200 border-red-500/30',
  }
  const label: Record<string, string> = { confirmed: 'confirmed', auto: 'automatic', pending: 'not run', failed: 'failed' }
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${s[status] || s.pending}`}>{label[status] || status}</span>
}

export function SyncPeriodsTable({ periods }: { periods: NonNullable<GpsSyncSummary['periods']> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-white/5 text-white/50 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-semibold px-3 py-2">Period</th>
            <th className="text-right font-semibold px-3 py-2" title="Median distance between a tagged carry start and where the carrier's unit says he was">Typical gap</th>
            <th className="text-right font-semibold px-3 py-2">Carries</th>
            <th className="text-right font-semibold px-3 py-2 hidden md:table-cell">Throw-in (UTC)</th>
            <th className="text-right font-semibold px-3 py-2 hidden md:table-cell">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {[...periods].sort((a, b) => a.half - b.half).map(p => (
            <tr key={p.half}>
              <td className="px-3 py-2 text-white">{PERIOD_LABEL[p.half] || `Period ${p.half}`}</td>
              <td className={`px-3 py-2 text-right font-semibold tabular-nums ${residualTone(p.median_residual_m)}`}>{p.median_residual_m != null ? `${p.median_residual_m.toFixed(1)} m` : '–'}</td>
              <td className="px-3 py-2 text-right text-white/80 tabular-nums">{p.n_carries ?? '–'}</td>
              <td className="px-3 py-2 text-right text-white/60 tabular-nums hidden md:table-cell">{formatUtc(videoToGpsMs([p], p.video_start_ms) ?? 0)}</td>
              <td className="px-3 py-2 text-right text-white/60 hidden md:table-cell">{p.source === 'manual' ? 'nudged' : 'automatic'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-white/45 border-t border-white/5">Typical gap: tagged carry start vs the carrier's GPS position. 6 to 12 m is normal (it is mostly tagging error); over 20 m means the sync is probably wrong.</p>
    </div>
  )
}

function residualTone(m?: number) {
  if (m == null) return 'text-white/60'
  return m <= 13 ? 'text-emerald-300' : m <= 20 ? 'text-amber-300' : 'text-red-300'
}

function RowIcon({ status }: { status: RowStatus }) {
  const cls = 'mt-0.5 shrink-0'
  if (status === 'checking' || status === 'parsing' || status === 'uploading') return <Loader2 size={16} className={`${cls} animate-spin text-emerald-300`} />
  if (status === 'stored') return <CheckCircle size={16} className={`${cls} text-emerald-400`} />
  if (status === 'error') return <AlertCircle size={16} className={`${cls} text-red-400`} />
  if (status === 'needs_player') return <AlertCircle size={16} className={`${cls} text-amber-400`} />
  if (status === 'skipped') return <MinusCircle size={16} className={`${cls} text-white/30`} />
  return <FileText size={16} className={`${cls} text-white/50`} />
}
