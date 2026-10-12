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

  const cell = (pos: string, label: string) => (
    <div key={pos} className="flex items-center gap-2">
      <span className="w-9 text-[10px] font-semibold text-white/40 text-right">{label}</span>
      <input
        value={rows[pos]?.jersey ?? ''}
        onChange={e => setField(pos, 'jersey', e.target.value.replace(/\D/g, '').slice(0, 2))}
        inputMode="numeric"
        className="w-11 px-1.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-center text-sm text-orange-300 font-bold focus:outline-none focus:ring-2 focus:ring-orange-500/40"
        aria-label={`${label} jersey number`}
      />
      <input
        value={rows[pos]?.surname ?? ''}
        onChange={e => setField(pos, 'surname', e.target.value)}
        placeholder="Full name"
        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
        aria-label={`${label} full name`}
      />
    </div>
  )

  return (
    <div className="space-y-3">
      {data?.prefill && (
        <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-400/20 rounded-lg px-3 py-2">
          Loaded from your last match against {data.team_name || opponent}. Check the changes, then save.
        </p>
      )}
      <p className="text-xs text-white/40">
        Starters sit in the same position slots as your own lineup, so their circles lay out the same way on the pitch. Enter full names (first name and surname) so players who share a surname are told apart.
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Starting 15</div>
            {FORMATION_POSITIONS.map(p => cell(p.id, p.label))}
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Bench</div>
            {SUBSTITUTE_POSITIONS.map((p, i) => cell(p.id, `S${i + 1}`))}
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
