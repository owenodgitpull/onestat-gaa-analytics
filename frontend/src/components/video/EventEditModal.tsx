/**
 * "Fix this event" - one form for anything on the log: who it was (ours or the opposition's), the assist, the
 * outcome / type, under pressure, from play / from a free, the time and a note. Saves only what was changed.
 */
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { VideoEvent, VideoEventUpdateData } from '../../services/videoApi'
import type { PickablePlayer } from './MoveEditorModal'

interface Props {
  event: VideoEvent | null
  ownPlayers: PickablePlayer[]
  oppPlayers: PickablePlayer[]
  onClose: () => void
  onSave: (eventId: string, data: VideoEventUpdateData) => void
}

const SCORING = ['POINT_SCORED', 'GOAL_SCORED', 'FREE_KICK', 'FORTY_FIVE', 'PENALTY']

const label = (p: PickablePlayer) => `${p.jerseyNumber != null ? `#${p.jerseyNumber} ` : ''}${p.name}`

export default function EventEditModal({ event, ownPlayers, oppPlayers, onClose, onSave }: Props) {
  const [ownId, setOwnId] = useState('')
  const [oppId, setOppId] = useState('')
  const [assistId, setAssistId] = useState('')
  const [subType, setSubType] = useState('')
  const [desc, setDesc] = useState('')
  const [minute, setMinute] = useState('')
  const [second, setSecond] = useState('')
  const [pressure, setPressure] = useState(false)
  const [fromFree, setFromFree] = useState(false)

  useEffect(() => {
    if (!event) return
    setOwnId(event.player_id || '')
    const opp = oppPlayers.find(o => o.name === event.opponent_player_name)
    setOppId(opp?.id || '')
    setAssistId(event.assist_player_id || '')
    setSubType(event.sub_type || '')
    setDesc(event.description || '')
    setMinute(String(event.match_minute ?? ''))
    setSecond(String(event.match_second ?? 0))
    setPressure(!!event.scoring_context?.under_pressure)
    setFromFree(event.scoring_context?.source === 'free')
  }, [event, oppPlayers])

  if (!event) return null
  const isScore = SCORING.includes(event.event_type)
  const ours = event.team === 'team_a'

  const save = () => {
    const d: VideoEventUpdateData = {}
    if (ownId !== (event.player_id || '')) d.player_id = ownId || null
    const prevOpp = oppPlayers.find(o => o.name === event.opponent_player_name)?.id || ''
    if (oppId !== prevOpp) {
      d.opposition_player_id = oppId || null
      const o = oppPlayers.find(x => x.id === oppId)
      if (o) d.opponent_player_name = o.name
    }
    if (assistId !== (event.assist_player_id || '')) d.assist_player_id = assistId || null
    if (subType !== (event.sub_type || '')) d.sub_type = subType
    if (desc !== (event.description || '')) d.description = desc
    const mi = parseInt(minute, 10), se = parseInt(second, 10)
    if (!isNaN(mi) && (mi !== event.match_minute || (!isNaN(se) && se !== event.match_second))) {
      d.match_minute = mi
      d.match_second = isNaN(se) ? 0 : se
    }
    const ctx = event.scoring_context || {}
    if (isScore && (pressure !== !!ctx.under_pressure || fromFree !== (ctx.source === 'free'))) {
      d.scoring_context = { ...ctx, under_pressure: pressure, source: fromFree ? 'free' : 'play' }
    }
    if (Object.keys(d).length) onSave(event.id, d)
    onClose()
  }

  const sel = 'w-full bg-slate-800 text-white text-sm rounded-lg border border-white/15 px-2 py-1.5'
  const lab = 'block text-[11px] font-semibold text-white/50 mb-1 mt-3'

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div className="relative w-full max-w-md my-8 glass-card p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Fix this event</h2>
            <p className="text-xs text-white/50">{event.event_type.replace(/_/g, ' ').toLowerCase()} · {ours ? 'ours' : 'opposition'}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1" aria-label="Close"><X size={18} /></button>
        </div>

        {ours ? (
          <>
            <label className={lab}>Our player</label>
            <select className={sel} value={ownId} onChange={e => setOwnId(e.target.value)}>
              <option value="">— none —</option>
              {ownPlayers.map(p => <option key={p.id} value={p.id}>{label(p)}</option>)}
            </select>
          </>
        ) : (
          <>
            <label className={lab}>Opposition player</label>
            <select className={sel} value={oppId} onChange={e => setOppId(e.target.value)}>
              <option value="">— none —</option>
              {oppPlayers.map(p => <option key={p.id} value={p.id}>{label(p)}</option>)}
            </select>
          </>
        )}

        {isScore && (
          <>
            <label className={lab}>Assist (our player)</label>
            <select className={sel} value={assistId} onChange={e => setAssistId(e.target.value)}>
              <option value="">— none —</option>
              {ownPlayers.map(p => <option key={p.id} value={p.id}>{label(p)}</option>)}
            </select>
            <div className="flex gap-4 mt-3 text-sm text-white/80">
              <label className="flex items-center gap-2"><input type="checkbox" checked={pressure} onChange={e => setPressure(e.target.checked)} /> Under pressure</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={fromFree} onChange={e => setFromFree(e.target.checked)} /> From a free</label>
            </div>
          </>
        )}

        <label className={lab}>Type / outcome (sub type)</label>
        <input className={sel} value={subType} onChange={e => setSubType(e.target.value)} placeholder="e.g. clean_catch, handpass_error" />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lab}>Minute</label>
            <input className={sel} inputMode="numeric" value={minute} onChange={e => setMinute(e.target.value)} />
          </div>
          <div>
            <label className={lab}>Second</label>
            <input className={sel} inputMode="numeric" value={second} onChange={e => setSecond(e.target.value)} />
          </div>
        </div>

        <label className={lab}>Note</label>
        <textarea className={sel} rows={2} value={desc} onChange={e => setDesc(e.target.value)} />

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/10 text-white/80 text-sm font-semibold">Cancel</button>
          <button onClick={save} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold">Save</button>
        </div>
      </div>
    </div>
  )
}
