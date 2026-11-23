/**
 * Ground picker for match setup (Owen 2026-11-23): a ground's pitch is measured once, saved, and picked from then on.
 * The match takes the saved pitch size, so the GPS dots, distances and the pitch drawn in the replay are to scale.
 * "Add a ground" / "Edit" open a small inline form; saving shows a spinner and a status line.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, MapPin, Plus, Pencil, Check, AlertCircle } from 'lucide-react'
import { stadiumsApi, stadiumKeys, parseCorners, type Stadium } from '@/services/stadiumsApi'

const input = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent disabled:opacity-50'

export default function StadiumPicker({ value, onChange, disabled = false, fallbackSize, idPrefix = 'stadium' }: {
  value: string | null
  onChange: (id: string | null, stadium: Stadium | null) => void
  disabled?: boolean
  /** the match's own size when no ground is picked (older matches typed in by hand) */
  fallbackSize?: { length: number | null | undefined; width: number | null | undefined }
  idPrefix?: string
}) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: stadiumKeys.all, queryFn: stadiumsApi.list, staleTime: 60000 })
  const list = q.data ?? []
  const picked = list.find(s => s.id === value) ?? null

  const [form, setForm] = useState<null | { id: string | null; name: string; length: string; width: string; corners: string; showCorners: boolean }>(null)
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text: string }>({ kind: 'idle', text: '' })

  const openNew = () => { setState({ kind: 'idle', text: '' }); setForm({ id: null, name: '', length: '', width: '', corners: '', showCorners: false }) }
  const openEdit = (s: Stadium) => {
    setState({ kind: 'idle', text: '' })
    setForm({ id: s.id, name: s.name, length: String(s.pitch_length_m), width: String(s.pitch_width_m),
      corners: (s.corners ?? []).map(c => `${c[0]}, ${c[1]}`).join('\n'), showCorners: !!s.corners?.length })
  }

  const save = async () => {
    if (!form) return
    const name = form.name.trim(), L = parseFloat(form.length), W = parseFloat(form.width)
    if (!name) return setState({ kind: 'error', text: 'Give the ground a name.' })
    if (!(L >= 100 && L <= 160)) return setState({ kind: 'error', text: 'Length is goal line to goal line, in metres (100 to 160).' })
    if (!(W >= 60 && W <= 100)) return setState({ kind: 'error', text: 'Width is sideline to sideline, in metres (60 to 100).' })
    let corners: [number, number][] | null
    try { corners = parseCorners(form.corners) } catch (e) { return setState({ kind: 'error', text: e instanceof Error ? e.message : String(e) }) }
    setState({ kind: 'saving', text: form.id ? `Saving ${name}…` : `Adding ${name}…` })
    try {
      const body = { name, pitch_length_m: L, pitch_width_m: W, corners }
      const st = form.id ? await stadiumsApi.update(form.id, body) : await stadiumsApi.create(body)
      await qc.invalidateQueries({ queryKey: stadiumKeys.all })
      onChange(st.id, st)
      setForm(null)
      setState({ kind: 'saved', text: form.id
        ? `${st.name} saved${st.matches ? `. Its ${st.matches} match${st.matches === 1 ? '' : 'es'} now use this size; GPS positions are being redone (about a minute).` : '.'}`
        : `${st.name} added. You can pick it for every match played there.` })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setState({ kind: 'error', text: /403|forbidden|permission/i.test(msg) ? 'Only a club admin can add or change a ground.' : `Could not save: ${msg}` })
    }
  }

  return (
    <div>
      <label htmlFor={`${idPrefix}-select`} className="block text-sm font-medium text-white mb-2">
        Ground <span className="text-white/40 text-xs font-normal">(sets the real pitch size for GPS and distances)</span>
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" />
          <select id={`${idPrefix}-select`} value={value ?? ''} disabled={disabled || q.isLoading}
            onChange={e => { const s = list.find(x => x.id === e.target.value) ?? null; onChange(s ? s.id : null, s) }}
            className={`${input} pl-9 appearance-none`}>
            <option value="">{q.isLoading ? 'Loading your grounds…' : fallbackSize?.length && fallbackSize?.width
              ? `No saved ground (this match: ${fallbackSize.length} × ${fallbackSize.width} m)` : 'No saved ground (standard 145 × 90 m)'}</option>
            {list.map(s => <option key={s.id} value={s.id}>{s.name} · {s.pitch_length_m} × {s.pitch_width_m} m</option>)}
          </select>
        </div>
        {!disabled && picked && !form && (
          <button type="button" onClick={() => openEdit(picked)} className="flex items-center gap-1 px-3 rounded-lg text-xs border border-white/10 bg-white/5 text-white/70 hover:text-white shrink-0" title={`Change ${picked.name}'s pitch size`}>
            <Pencil size={13} /> Edit
          </button>
        )}
        {!disabled && !form && (
          <button type="button" onClick={openNew} className="flex items-center gap-1 px-3 rounded-lg text-xs border border-white/10 bg-white/5 text-white/70 hover:text-white shrink-0">
            <Plus size={13} /> Add a ground
          </button>
        )}
      </div>
      {q.isError && <p className="mt-1.5 text-xs text-red-300">Could not load your saved grounds. Close this and try again.</p>}

      {form && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
          <p className="text-xs text-white/60">{form.id ? 'Change this ground. Every match played there follows.' : 'Add a ground once. After that, just pick it.'}</p>
          <div>
            <label htmlFor={`${idPrefix}-name`} className="block text-xs text-white/50 mb-1">Name</label>
            <input id={`${idPrefix}-name`} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. MacCumhaill Park" className={input} maxLength={120} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${idPrefix}-len`} className="block text-xs text-white/50 mb-1">Length, goal line to goal line (m)</label>
              <input id={`${idPrefix}-len`} type="number" inputMode="decimal" min={100} max={160} step={0.01} value={form.length} onChange={e => setForm({ ...form, length: e.target.value })} placeholder="137.82" className={input} />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-wid`} className="block text-xs text-white/50 mb-1">Width, sideline to sideline (m)</label>
              <input id={`${idPrefix}-wid`} type="number" inputMode="decimal" min={60} max={100} step={0.01} value={form.width} onChange={e => setForm({ ...form, width: e.target.value })} placeholder="86.75" className={input} />
            </div>
          </div>
          <div>
            <button type="button" onClick={() => setForm({ ...form, showCorners: !form.showCorners })} className="text-xs text-white/45 hover:text-white/70 underline decoration-dotted underline-offset-2" aria-expanded={form.showCorners}>
              {form.showCorners ? 'Hide corner flags' : 'Have the corner flags from a map? (optional, sharpens GPS)'}
            </button>
            {form.showCorners && (
              <div className="mt-2">
                <label htmlFor={`${idPrefix}-corners`} className="block text-xs text-white/50 mb-1">Corner flags, one per line as latitude, longitude</label>
                <textarea id={`${idPrefix}-corners`} rows={4} value={form.corners} onChange={e => setForm({ ...form, corners: e.target.value })}
                  placeholder={'53.3602706, -6.2520854\n53.3614850, -6.2513769'} className={`${input} font-mono text-xs`} />
                <p className="mt-1 text-[11px] text-white/40">In Google Maps or Google Earth, right-click a corner flag and copy its coordinates. Two flags on the same sideline are enough; they fix the pitch's angle. Without them the angle is read from where the players ran.</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={state.kind === 'saving'} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-cyan-500/20 border border-cyan-400/30 text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-60">
              {state.kind === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {form.id ? 'Save ground' : 'Add ground'}
            </button>
            <button type="button" onClick={() => { setForm(null); setState({ kind: 'idle', text: '' }) }} disabled={state.kind === 'saving'} className="px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white">Cancel</button>
          </div>
        </div>
      )}
      {state.kind !== 'idle' && (
        <p role="status" className={`mt-2 flex items-start gap-1.5 text-xs ${state.kind === 'error' ? 'text-red-300' : state.kind === 'saved' ? 'text-emerald-300' : 'text-white/60'}`}>
          {state.kind === 'saving' ? <Loader2 size={13} className="animate-spin mt-0.5 shrink-0" /> : state.kind === 'error' ? <AlertCircle size={13} className="mt-0.5 shrink-0" /> : <Check size={13} className="mt-0.5 shrink-0" />}
          <span>{state.text}</span>
        </p>
      )}
    </div>
  )
}
