import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Map as MapIcon } from 'lucide-react'
import PlayerChartNote from './PlayerChartNote'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface MapEvent {
  match_id: string; opponent: string; kind: 'turnover_won' | 'kickout_won' | 'score'; event_type: string
  points: number; pitch_x: number | null; pitch_y: number | null; minute: number | null; half: number
}

type Mode = 'turnover_won' | 'kickout_won' | 'score'
const MODES: { key: Mode; label: string }[] = [
  { key: 'turnover_won', label: 'Turnovers won' },
  { key: 'kickout_won', label: 'Kick-outs won' },
  { key: 'score', label: 'Scores' },
]

const TURNOVER_LABEL: Record<string, string> = { turnover_won: 'Turnover won', interception: 'Interception', tackle_won: 'Tackle won', block: 'Block' }
const SCORE_LABEL: Record<string, string> = {
  point: 'Point', point_free: 'Point (free)', forty_five: "45'", two_point: '2-pointer', two_point_free: '2-pointer (free)', goal: 'Goal', penalty_goal: 'Penalty goal',
}
const label = (e: MapEvent) => e.kind === 'score' ? SCORE_LABEL[e.event_type] ?? e.event_type : e.kind === 'turnover_won' ? TURNOVER_LABEL[e.event_type] ?? e.event_type : 'Kick-out won'

// Colour AND shape say what a mark is: 1-pointers are green circles, 2-pointers are violet diamonds, goals are amber squares.
function Mark({ e, x, y, selected }: { e: MapEvent; x: number; y: number; selected: boolean }) {
  const stroke = selected ? '#fff' : 'rgba(255,255,255,0.85)'
  const sw = selected ? 6 : 4
  if (e.kind === 'score' && e.points === 2) {
    const r = 40
    return <polygon points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`} fill="#a78bfa" stroke={stroke} strokeWidth={sw} />
  }
  if (e.kind === 'score' && e.points === 3) {
    return <rect x={x - 32} y={y - 32} width={64} height={64} rx={8} fill="#f59e0b" stroke={stroke} strokeWidth={sw} />
  }
  const fill = e.kind === 'score' ? '#10b981' : e.kind === 'kickout_won' ? '#f59e0b' : '#38bdf8'
  return <circle cx={x} cy={y} r={34} fill={fill} stroke={stroke} strokeWidth={sw} />
}

/** Where a player won turnovers and kick-outs, and where he scored, in every match that counts; toggle between them. */
export default function PlayerActionMap({ playerId }: { playerId: string }) {
  const [mode, setMode] = useState<Mode>('turnover_won')
  const [sel, setSel] = useState<{ e: MapEvent; x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['player-map-events', playerId],
    queryFn: async (): Promise<MapEvent[]> => {
      const res = await fetch(`${API_BASE}/analytics/player/${playerId}/map-events`, { credentials: 'include' })
      if (!res.ok) throw new Error('map events')
      return res.json()
    },
    enabled: !!playerId,
  })
  const all = data ?? []
  const counts = useMemo(() => ({
    turnover_won: all.filter(e => e.kind === 'turnover_won').length,
    kickout_won: all.filter(e => e.kind === 'kickout_won').length,
    score: all.filter(e => e.kind === 'score').length,
  }), [all])
  const shown = all.filter(e => e.kind === mode)
  const plotted = shown.filter(e => e.pitch_x !== null && e.pitch_y !== null)
  const unplaced = shown.length - plotted.length
  const scoreSplit = mode === 'score' ? {
    ones: shown.filter(e => e.points === 1).length, twos: shown.filter(e => e.points === 2).length, goals: shown.filter(e => e.points === 3).length,
  } : null

  const pick = (e: MapEvent, ev: React.MouseEvent) => {
    ev.stopPropagation()
    if (!box.current) return
    const r = box.current.getBoundingClientRect()
    setSel(sel?.e === e ? null : { e, x: ev.clientX - r.left, y: ev.clientY - r.top })
  }

  return (
    <div className="glass-card p-6">
      <h3 className="text-xl font-bold text-white mb-3 flex items-center gap-2"><MapIcon size={20} /> Action Map</h3>
      <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Action map">
        {MODES.map(m => (
          <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} onClick={() => { setMode(m.key); setSel(null) }}
            className={`px-3 min-h-[36px] rounded-lg text-sm border transition-colors ${mode === m.key ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 font-semibold' : 'bg-white/5 border-white/10 text-white/60 hover:text-white'}`}>
            {m.label} <span className="text-white/50 tabular-nums">{counts[m.key]}</span>
          </button>
        ))}
      </div>
      {isLoading ? <div className="text-center text-white/40 py-8">Loading…</div> : plotted.length === 0 ? (
        <div className="text-center text-white/40 py-8">{shown.length ? 'These were not placed on the pitch when tagged.' : mode === 'score' ? 'No scores tagged to him yet.' : mode === 'kickout_won' ? 'No kick-outs won tagged to him yet.' : 'No turnovers won tagged to him yet.'}</div>
      ) : (
        <div className="w-full max-w-3xl mx-auto">
          <div ref={box} className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '16/10' }} onClick={() => setSel(null)}>
            <svg viewBox="0 0 2332 1446" className="w-full h-full">
              <rect width="2332" height="1446" fill="#2d5016" />
              <image href="/pitch-svg.svg" width="2332" height="1446" preserveAspectRatio="xMidYMid meet" />
              {plotted.map((e, i) => {
                const x = (e.pitch_x! / 100) * 1960 + 183
                const y = (e.pitch_y! / 100) * 1167 + 123
                return <g key={i} className="cursor-pointer" onClick={ev => pick(e, ev)}><Mark e={e} x={x} y={y} selected={sel?.e === e} /></g>
              })}
            </svg>
            {sel && (
              <div className="absolute z-10 pointer-events-none bg-black/90 border border-white/20 rounded-lg px-3 py-2 text-xs text-white shadow-xl"
                style={{ left: sel.x + 10, top: sel.y - 48, transform: sel.x > (box.current?.clientWidth ?? 0) / 2 ? 'translateX(-110%)' : undefined }}>
                <div className="font-semibold">{label(sel.e)}</div>
                <div className="text-white/60">vs {sel.e.opponent}</div>
                {sel.e.minute != null && <div className="text-white/50">{sel.e.minute}'</div>}
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/60">
            <span>Attacking left to right.</span>
            {mode === 'turnover_won' && <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full bg-sky-400" /> Turnover, interception, tackle or block won</span>}
            {mode === 'kickout_won' && <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full bg-amber-400" /> Kick-out won (ours or theirs)</span>}
            {scoreSplit && <>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full bg-emerald-500" /> 1-pointers {scoreSplit.ones}</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rotate-45 bg-violet-400" /> 2-pointers {scoreSplit.twos}</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-amber-500" /> Goals {scoreSplit.goals}</span>
            </>}
            {unplaced > 0 && <span className="text-white/40">{unplaced} not placed on the pitch</span>}
          </div>
        </div>
      )}
      <PlayerChartNote what="Where he won the ball and where he scored, across every match, with his team always attacking left to right. Switch between turnovers won (including interceptions, tackles and blocks), kick-outs won, and scores split into 1-pointers, 2-pointers and goals." />
    </div>
  )
}
