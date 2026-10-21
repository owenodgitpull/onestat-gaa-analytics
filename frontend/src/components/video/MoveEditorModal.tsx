/**
 * "Edit this move" - the chain of carries and passes behind a score, a kickout won or a turnover, as a list a coach
 * can fix: change who carried, remove a step that should not be there, add a missing one. Every change is saved at once
 * (the carry, the pass that came out of it, and the match record all move together on the server).
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { X, Trash2, Plus, Loader2 } from 'lucide-react'
import { videoMovesAPI, type MoveResponse, type MoveStep } from '../../services/videoMovesApi'

export interface PickablePlayer {
  id: string
  name: string
  jerseyNumber: number | null
  /** on the field now - listed first; the rest (bench / subbed off) sit in their own group */
  onField?: boolean
}

/** The options of a player <select>: on the field first, then the rest, each with their match number */
export function PlayerOptions({ players }: { players: PickablePlayer[] }) {
  const label = (p: PickablePlayer) => `${p.jerseyNumber != null ? `#${p.jerseyNumber} ` : ''}${p.name}`
  const on = players.filter(p => p.onField !== false)
  const off = players.filter(p => p.onField === false)
  return (
    <>
      {on.map(p => <option key={p.id} value={p.id}>{label(p)}</option>)}
      {off.length > 0 && (
        <optgroup label="Bench / subbed off">
          {off.map(p => <option key={p.id} value={p.id}>{label(p)}</option>)}
        </optgroup>
      )}
    </>
  )
}

interface Props {
  isOpen: boolean
  onClose: () => void
  sessionId: string
  eventId: string | null
  /** our players (any of them) and the opposition's lineup, to pick from */
  ownPlayers: PickablePlayer[]
  oppPlayers: PickablePlayer[]
  /** called after any change so the page can refresh its events / charts */
  onChanged: () => void
}

const ENDED_LABEL: Record<string, string> = {
  pass: 'passes', score: 'scores', wide: 'shoots wide', turnover: 'loses it', manual: 'ends the carry',
  free: 'wins a free', kickout: 'kickout', short: 'shot dropped short', saved: 'shot saved', hit_post: 'hits the post',
}

function clock(s: number | null | undefined) {
  if (s == null) return ''
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function MoveEditorModal({ isOpen, onClose, sessionId, eventId, ownPlayers, oppPlayers, onChanged }: Props) {
  const [move, setMove] = useState<MoveResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)   // segment id we are adding a step after

  const load = useCallback(async () => {
    if (!eventId) return
    setLoading(true)
    setError(null)
    try {
      setMove(await videoMovesAPI.getMove(sessionId, eventId))
    } catch (e: any) {
      setError(e?.message || 'Could not load this move')
    } finally {
      setLoading(false)
    }
  }, [sessionId, eventId])

  useEffect(() => { if (isOpen) { setMove(null); setAdding(null); load() } }, [isOpen, load])
  if (!isOpen) return null

  const optionsFor = (step: Pick<MoveStep, 'team'>) => (step.team === 'team_a' ? ownPlayers : oppPlayers)

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (e: any) {
      setError(e?.message || 'That change did not save')
    } finally {
      setBusy(null)
    }
  }

  const playerBody = (team: 'team_a' | 'team_b', p: PickablePlayer) =>
    team === 'team_a'
      ? { player_id: p.id, opposition_player_id: null, jersey_number: p.jerseyNumber }
      : { player_id: null, opposition_player_id: p.id, jersey_number: p.jerseyNumber }

  const steps = move?.steps ?? []
  const teamLabel = move?.team === 'team_a' ? 'our' : 'their'
  // Every change takes a couple of seconds on the server: always say what is happening, never leave the list looking idle
  const busyLabel = busy === null ? null
    : busy.startsWith('add-') ? 'Adding the step…'
    : busy.startsWith('del-') ? 'Removing the step…'
    : 'Saving the change…'

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div className="relative w-full max-w-xl my-8 glass-card p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-lg font-bold text-white">Edit this move</h2>
            {move && (
              <p className="text-xs text-white/50 mt-0.5">
                {move.event_type.replace(/_/g, ' ').toLowerCase()} at {move.match_minute}:{String(move.match_second ?? 0).padStart(2, '0')} — {teamLabel} move, in order
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1" aria-label="Close"><X size={18} /></button>
        </div>

        {busyLabel && (
          <div className="flex items-center gap-2 text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-2.5 py-1.5 mt-2" role="status" aria-live="polite">
            <Loader2 size={14} className="animate-spin" /> {busyLabel}
          </div>
        )}
        {loading && !move && (
          <div className="flex items-center gap-2 text-sm text-white/60 py-6"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        )}
        {error && <p className="text-xs text-red-300 my-2">{error}</p>}
        {move && steps.length === 0 && (
          <p className="text-sm text-white/60 py-4">
            No carries were tagged for this one, so there is no move to edit. Tag the carriers on the pitch next time,
            or add the missing step by editing a neighbouring move.
          </p>
        )}

        <ol className="space-y-2 mt-3">
          {steps.map((s, i) => {
            const opts = optionsFor(s)
            const current = s.team === 'team_a' ? s.player_id : s.opposition_player_id
            const isLast = i === steps.length - 1
            return (
              <Fragment key={s.segment_id}>
              <li className={`rounded-xl border border-white/10 bg-white/[0.04] p-2.5 transition-opacity ${busy === `set-${s.segment_id}` || busy === `del-${s.segment_id}` ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="w-6 text-center text-[11px] font-bold text-white/40">{i + 1}</span>
                  <select
                    value={current ?? ''}
                    disabled={busy !== null}
                    onChange={e => {
                      const p = opts.find(o => o.id === e.target.value)
                      if (p) run(`set-${s.segment_id}`, () => videoMovesAPI.setStepPlayer(sessionId, s.segment_id, playerBody(s.team, p)))
                    }}
                    className="flex-1 min-w-0 bg-slate-800 text-white text-sm rounded-lg border border-white/15 px-2 py-1.5"
                  >
                    {!current && <option value="">Choose a player…</option>}
                    {current && !opts.some(o => o.id === current) && <option value={current}>{s.name ?? 'Unknown'}</option>}
                    <PlayerOptions players={opts} />
                  </select>
                  {busy === `set-${s.segment_id}` && <Loader2 size={14} className="animate-spin text-emerald-300 flex-shrink-0" aria-label="Saving" />}
                  <span className="text-[11px] text-white/40 whitespace-nowrap">{clock(s.match_clock_s)}</span>
                  <button
                    onClick={() => run(`del-${s.segment_id}`, () => videoMovesAPI.deleteStep(sessionId, s.segment_id))}
                    disabled={busy !== null}
                    className="p-1.5 rounded-lg text-white/40 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    title="Remove this step"
                  >
                    {busy === `del-${s.segment_id}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1.5 pl-8">
                  <span className="text-[11px] text-white/45">
                    {isLast ? (ENDED_LABEL[s.ended_by || ''] || s.ended_by || 'ends the move') : 'carries, then passes'}
                  </span>
                  {adding === s.segment_id ? (
                    <select
                      autoFocus
                      defaultValue=""
                      onBlur={() => setAdding(null)}
                      onChange={e => {
                        const p = opts.find(o => o.id === e.target.value)
                        setAdding(null)
                        if (p) run(`add-${s.segment_id}`, () => videoMovesAPI.insertStep(sessionId, { after_segment_id: s.segment_id, ...playerBody(s.team, p) }))
                      }}
                      className="bg-slate-800 text-white text-xs rounded-lg border border-white/15 px-2 py-1"
                    >
                      <option value="" disabled>Who took it next?</option>
                      <PlayerOptions players={opts} />
                    </select>
                  ) : busy === `add-${s.segment_id}` ? (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-200"><Loader2 size={12} className="animate-spin" /> Adding step…</span>
                  ) : (
                    <button
                      onClick={() => setAdding(s.segment_id)}
                      disabled={busy !== null || isLast}
                      className="flex items-center gap-1 text-[11px] text-emerald-300/80 hover:text-emerald-200 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={isLast ? 'The last step ends the move' : 'Add a missing step after this one'}
                    >
                      <Plus size={12} /> Add a step after
                    </button>
                  )}
                </div>
              </li>
              {busy === `add-${s.segment_id}` && (
                <li className="rounded-xl border border-dashed border-emerald-400/40 bg-emerald-500/5 p-3 flex items-center gap-2 text-xs text-emerald-200 animate-pulse">
                  <Loader2 size={14} className="animate-spin" /> Adding the new step here…
                </li>
              )}
              </Fragment>
            )
          })}
        </ol>

        <p className="text-[11px] text-white/35 mt-4">
          Changes save as you make them. The scorer, the assist and the other details of the event itself are edited from
          that event's own Edit button.
        </p>
        <div className="flex justify-end mt-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/10 text-white/80 hover:text-white text-sm font-semibold">Done</button>
        </div>
      </div>
    </div>
  )
}
