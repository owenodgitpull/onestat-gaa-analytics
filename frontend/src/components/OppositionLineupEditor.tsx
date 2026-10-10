/**
 * OppositionLineupEditor — the opposition's 15 + bench for a match (inter-county only).
 *
 * Same slots and default jersey numbers as our own lineup (StartingLineupModal), so their circles on the pitch lay out
 * exactly like ours. Pre-filled from the last lineup against this team; "paste a team sheet" fills it from
 * "1 Gallagher" style lines (deterministic parse, no AI).
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

/** "1 Gallagher", "12. McBrearty", "16 - Cox": starters by jersey 1-15, bench 16+ in order. */
function parseTeamSheet(text: string, base: Rows): Rows {
  const rows = { ...base }
  let bench = 0
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d{1,2})[\s.\-:)]+(.+?)\s*$/)
    if (!m) continue
    const jersey = Number(m[1])
    const surname = m[2].trim().split(/\s+/).pop() || ''
    if (!surname) continue
    const starter = STARTER_BY_JERSEY[jersey]
    if (starter) rows[starter] = { jersey: String(jersey), surname }
    else if (bench < SUBSTITUTE_POSITIONS.length) rows[SUBSTITUTE_POSITIONS[bench++].id] = { jersey: String(jersey), surname }
  }
  return rows
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
        placeholder="Surname"
        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
        aria-label={`${label} surname`}
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
        Starters sit in the same position slots as your own lineup, so their circles lay out the same way on the pitch. Surname only.
      </p>

      <button
        type="button"
        onClick={() => setShowPaste(v => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-orange-300 hover:text-orange-200"
      >
        <ClipboardPaste size={13} /> Paste a team sheet
      </button>
      {showPaste && (
        <div className="space-y-2">
          <textarea
            value={paste}
            onChange={e => setPaste(e.target.value)}
            rows={6}
            placeholder={'1 Gallagher\n2 McBrearty\n3 Boyle\n16 Cox'}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-none"
          />
          <button
            type="button"
            onClick={() => { setRows(prev => parseTeamSheet(paste, prev)); setPaste(''); setShowPaste(false); setDirty(true) }}
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
