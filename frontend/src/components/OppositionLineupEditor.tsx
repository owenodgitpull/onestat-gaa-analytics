/**
 * OppositionLineupEditor — the opposition's 15 + bench for a match (inter-county only).
 *
 * Same slots and default jersey numbers as our own lineup (StartingLineupModal), so their circles on the pitch lay out
 * exactly like ours. Pre-filled from the last lineup against this team; "paste a team sheet" fills it from
 * a pasted team sheet or list of full names (deterministic parse, no AI).
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardPaste, Save } from 'lucide-react'
import api from '@/services/api'
import { FORMATION_POSITIONS, POSITION_DEFAULT_JERSEY, SUBSTITUTE_POSITIONS } from '@/components/StartingLineupModal'

type Row = { jersey: string; surname: string }
type Rows = Record<string, Row>

const STARTER_BY_JERSEY = Object.fromEntries(Object.entries(POSITION_DEFAULT_JERSEY).map(([pos, j]) => [j, pos]))

const POS_NAME: Record<string, string> = {
  gk: 'Goalkeeper', 'fb-left': 'Left corner back', 'fb-center': 'Full back', 'fb-right': 'Right corner back',
  'hb-left': 'Left half back', 'hb-center': 'Centre half back', 'hb-right': 'Right half back',
  'mf-left': 'Midfield', 'mf-right': 'Midfield', 'hf-left': 'Left half forward', 'hf-center': 'Centre half forward',
  'hf-right': 'Right half forward', 'ff-left': 'Left corner forward', 'ff-center': 'Full forward', 'ff-right': 'Right corner forward',
}
const SLOT_ORDER = [...FORMATION_POSITIONS.map(p => p.id), ...SUBSTITUTE_POSITIONS.map(p => p.id)]

function emptyRows(): Rows {
  const rows: Rows = {}
  for (const p of FORMATION_POSITIONS) rows[p.id] = { jersey: String(POSITION_DEFAULT_JERSEY[p.id] ?? ''), surname: '' }
  SUBSTITUTE_POSITIONS.forEach((p, i) => { rows[p.id] = { jersey: String(16 + i), surname: '' } })
  return rows
}

/**
 * Turns whatever was pasted into the lineup. Full names are kept as written. Accepts:
 *   - numbered lines: "1 Conor Cox", "12. Ryan McHugh", "16 - Chris O'Donnell", "3) Name", tab-separated
 *   - plain names, one per line or comma / semicolon separated (a news article's team list): placed in order,
 *     1-15 in the starting slots then the bench
 *   - a number on its own line followed by the name on the next line
 *   - brackets and trailing notes are dropped: "Conor Cox (Kilcar)", "Cox - captain"
 * A number puts that player in that jersey's slot; names without a number take the next jersey in order.
 */
function parseTeamSheet(text: string, base: Rows): { rows: Rows; count: number } {
  const rows = { ...base }
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  // one long line (or two) with commas / semicolons / " | " is a list, not a single name
  let entries: string[] = lines
  if (lines.length <= 2 && lines.some(l => /[,;|]/.test(l))) {
    entries = lines.flatMap(l => l.split(/\s*[,;|]\s*/)).map(e => e.trim()).filter(Boolean)
  }
  const clean = (raw: string) =>
    raw
      .replace(/\([^)]*\)/g, ' ')            // (Kilcar), (c)
      .replace(/\s[-–—]\s.*$/, '')            // " - captain"
      .replace(/^[\s"'`•*]+|[\s"'`•*,.]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  let bench = 0
  let next = 1
  let pendingJersey: number | null = null
  let count = 0
  const place = (jersey: number, name: string) => {
    const starter = STARTER_BY_JERSEY[jersey]
    if (starter) rows[starter] = { jersey: String(jersey), surname: name }
    else if (bench < SUBSTITUTE_POSITIONS.length) rows[SUBSTITUTE_POSITIONS[bench++].id] = { jersey: String(jersey), surname: name }
    else return
    count++
    next = jersey + 1
  }

  for (const entry of entries) {
    const numOnly = entry.match(/^(\d{1,2})[.):]?$/)
    if (numOnly) { pendingJersey = Number(numOnly[1]); continue }
    const m = entry.match(/^(\d{1,2})[\s.\-–:)	]+(.+)$/)
    const jersey = pendingJersey ?? (m ? Number(m[1]) : null)
    const name = clean(pendingJersey != null ? entry : m ? m[2] : entry)
    pendingJersey = null
    if (!name || !/[A-Za-z]/.test(name)) continue
    place(jersey ?? next, name)
  }
  return { rows, count }
}

export default function OppositionLineupEditor({ matchId, opponent }: { matchId: string; opponent: string }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['oppositionLineup', matchId],
    queryFn: () => api.matchPrep.getOppositionLineup(matchId),
    staleTime: 60_000,
  })
  const [rows, setRows] = useState<Rows>(emptyRows)
  const [paste, setPaste] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [pasteMsg, setPasteMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    const next = emptyRows()
    for (const r of data.lineup) next[r.position_id] = { jersey: r.jersey_number != null ? String(r.jersey_number) : '', surname: r.surname }
    setRows(next)
    setDirty(data.prefill) // a prefill is not saved yet
  }, [data])

  const filled = useMemo(() => Object.values(rows).filter(r => r.surname.trim()).length, [rows])

  const setField = (pos: string, field: keyof Row, value: string) => {
    setRows(prev => ({ ...prev, [pos]: { ...prev[pos], [field]: value } }))
    setDirty(true)
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    try {
      const lineup = Object.entries(rows)
        .filter(([, r]) => r.surname.trim())
        .map(([position_id, r]) => ({ position_id, jersey_number: r.jersey ? Number(r.jersey) : null, surname: r.surname.trim() }))
      const result = await api.matchPrep.saveOppositionLineup(matchId, lineup)
      queryClient.setQueryData(['oppositionLineup', matchId], result)
      queryClient.invalidateQueries({ queryKey: ['match', matchId] })
      setSaved(true)
      setDirty(false)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Failed to save opposition lineup:', err)
    } finally {
      setSaving(false)
    }
  }

  const slotName = (id: string) => {
    if (POS_NAME[id]) return POS_NAME[id]
    const i = SUBSTITUTE_POSITIONS.findIndex(p => p.id === id)
    return i >= 0 ? `Substitute ${i + 1}` : id
  }
  const goNext = (id: string) => {
    const i = SLOT_ORDER.indexOf(id)
    setSelected(i >= 0 && i < SLOT_ORDER.length - 1 ? SLOT_ORDER[i + 1] : null)
  }
  const clearSlot = (id: string) => {
    setRows(prev => ({ ...prev, [id]: { ...prev[id], surname: '' } }))
    setDirty(true)
    setSaved(false)
  }

  const circle = (id: string, label: string, small: boolean) => {
    const r = rows[id]
    const has = !!r?.surname.trim()
    const isSel = selected === id
    return (
      <>
        {isSel && <span className="absolute inset-0 rounded-full ring-4 ring-amber-400 animate-ping" />}
        <div
          className={`${small ? 'w-7 h-7 sm:w-9 sm:h-9 text-[9px] sm:text-xs' : 'w-8 h-8 sm:w-10 sm:h-10 text-[10px] sm:text-xs'} rounded-full flex items-center justify-center font-bold transition-all ${
            has ? `ring-2 shadow-lg ${isSel ? 'scale-125 ring-4' : 'hover:scale-105'}` : 'bg-slate-600/80 text-white/90 hover:bg-slate-500 hover:scale-110'
          }`}
          style={has ? ({
            backgroundColor: '#F97316', color: '#FFFFFF',
            '--tw-ring-color': isSel ? '#fbbf24' : '#FFFFFF',
            boxShadow: isSel ? '0 0 16px rgba(251,191,36,0.5)' : undefined,
          } as React.CSSProperties) : undefined}
        >
          {has ? (r.jersey || label) : label}
        </div>
      </>
    )
  }

  return (
    <div className="space-y-3">
      {data?.prefill && (
        <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-400/20 rounded-lg px-3 py-2">
          Loaded from your last match against {data.team_name || opponent}. Check the changes, then save.
        </p>
      )}
      <p className="text-xs text-white/40">
        Same pitch and slots as your own lineup. Tap a position, type the player's number and full name (first name and surname),
        press Enter to move to the next position.
      </p>

      <button
        type="button"
        onClick={() => setShowPaste(v => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-orange-300 hover:text-orange-200"
      >
        <ClipboardPaste size={13} /> Paste a team sheet
      </button>
      {pasteMsg && !showPaste && <p className="text-xs text-emerald-300/90">{pasteMsg}</p>}
      {showPaste && (
        <div className="space-y-2">
          {pasteMsg && <p className="text-xs text-amber-300/90">{pasteMsg}</p>}
          <textarea
            value={paste}
            onChange={e => setPaste(e.target.value)}
            rows={6}
            placeholder={"1 Conor Cox\n2 Ryan McHugh\n3 Chris O'Donnell\n\nor just names, one per line or separated by commas"}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-none"
          />
          <button
            type="button"
            onClick={() => {
              const { rows: next, count } = parseTeamSheet(paste, rows)
              if (!count) { setPasteMsg('No names found - paste one name per line, or names separated by commas.'); return }
              setRows(next); setPaste(''); setShowPaste(false); setPasteMsg(`${count} names filled in - check the order, then save.`); setDirty(true); setSaved(false)
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500/15 border border-orange-400/30 text-orange-300"
          >
            Fill from sheet
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-xs text-white/40">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Pitch + bench: the same layout as the starting lineup picker */}
          <div className="md:col-span-2 flex flex-col gap-2">
            <div className="relative bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-2xl overflow-hidden aspect-[16/10]">
              <svg viewBox="0 0 2332 1446" className="absolute inset-0 w-full h-full opacity-40">
                <rect width="2332" height="1446" fill="#2d5016" />
                <image href="/pitch-svg.svg" width="2332" height="1446" preserveAspectRatio="xMidYMid meet" />
              </svg>
              {FORMATION_POSITIONS.map(pos => (
                <div
                  key={pos.id}
                  className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  onClick={() => setSelected(pos.id)}
                >
                  {circle(pos.id, String(POSITION_DEFAULT_JERSEY[pos.id] ?? pos.label), false)}
                  {rows[pos.id]?.surname.trim() && (
                    <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                      <span className={`text-[9px] sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 sm:py-1 rounded ${selected === pos.id ? 'bg-amber-500/30 text-amber-200' : 'bg-black/50 text-white'}`}>
                        {rows[pos.id].surname}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-center flex-wrap gap-x-3 gap-y-2 px-2">
              {SUBSTITUTE_POSITIONS.map((pos, i) => (
                <div key={pos.id} className="cursor-pointer flex flex-col items-center" onClick={() => setSelected(pos.id)}>
                  <div className="relative">{circle(pos.id, rows[pos.id]?.jersey || String(16 + i), true)}</div>
                  {rows[pos.id]?.surname.trim() && (
                    <div className="mt-2">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${selected === pos.id ? 'bg-amber-500/30 text-amber-200' : 'bg-black/50 text-white'}`}>
                        {rows[pos.id].surname}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Side panel: edit the tapped position, or list everyone */}
          <div>
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">{slotName(selected)}</h3>
                  <button onClick={() => setSelected(null)} className="text-xs text-white/50 hover:text-white">Done</button>
                </div>
                <label className="block text-[11px] text-white/50">
                  Number
                  <input
                    value={rows[selected]?.jersey ?? ''}
                    onChange={e => setField(selected, 'jersey', e.target.value.replace(/\D/g, '').slice(0, 2))}
                    inputMode="numeric"
                    className="mt-1 w-20 px-2 py-2 rounded-lg bg-white/5 border border-white/10 text-center text-base text-orange-300 font-bold focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                  />
                </label>
                <label className="block text-[11px] text-white/50">
                  Full name
                  <input
                    key={selected}
                    autoFocus
                    value={rows[selected]?.surname ?? ''}
                    onChange={e => setField(selected, 'surname', e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goNext(selected) } }}
                    placeholder="e.g. Conor Cox"
                    className="mt-1 w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                  />
                </label>
                <div className="flex gap-2">
                  <button onClick={() => goNext(selected)} className="flex-1 text-xs font-semibold px-2 py-2 rounded-lg bg-orange-500/15 border border-orange-400/30 text-orange-300">Next position →</button>
                  <button onClick={() => clearSlot(selected)} className="flex-1 text-xs font-semibold px-2 py-2 rounded-lg bg-red-500/15 border border-red-400/30 text-red-300">Clear</button>
                </div>
              </div>
            ) : (
              <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                <p className="text-white/50 text-xs font-semibold mb-1">Players ({filled})</p>
                {SLOT_ORDER.map(id => {
                  const r = rows[id]
                  return (
                    <button
                      key={id}
                      onClick={() => setSelected(id)}
                      className="w-full glass-card px-2 py-1 flex items-center gap-2 text-left"
                    >
                      <span className="text-white/50 text-[10px] font-semibold w-24 flex-shrink-0 truncate">{slotName(id)}</span>
                      <span className="w-6 text-center text-xs font-bold text-orange-300">{r?.jersey}</span>
                      <span className={`text-xs truncate flex-1 ${r?.surname.trim() ? 'text-white font-medium' : 'text-white/30 italic'}`}>{r?.surname.trim() || '—'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-white/30">{filled} players entered</span>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
          style={{
            background: saved ? 'rgba(16,185,129,0.2)' : 'rgba(251,146,60,0.15)',
            border: saved ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(251,146,60,0.3)',
            color: saved ? '#34d399' : '#fb923c',
          }}
        >
          <Save size={12} />
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save lineup'}
        </button>
      </div>
    </div>
  )
}
