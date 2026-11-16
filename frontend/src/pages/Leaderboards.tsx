/**
 * Squad leaderboards for the coach: /leaderboards?category=kickout_king&player=<id>
 * Opened from a player's page (his rank chips): that board is shown with him highlighted, and every other board is
 * one chip away. The same podium + ranking as the player portal (LeaderboardCategoryView), but the coach sees every
 * player (no opt-outs hidden) and a row opens that player's page.
 * Data: GET /analytics/leaderboards/{category} and /analytics/player/{id}/leaderboard-positions (his place on each).
 */
import { useMemo, useRef } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ChevronLeft, X } from 'lucide-react'
import { fetchAPI } from '../services/api'
import type { LeaderboardContext, LeaderboardEntry } from '../services/playerPortalApi'
import LeaderboardCategoryView from '../components/player/LeaderboardCategoryView'
import { CATEGORIES, emptyMessageFor } from '../components/player/leaderboardCategories'

interface CoachBoard { category: string; display_name: string; unit: string | null; rankings: LeaderboardEntry[] }
interface Position { category: string; display_name: string; rank: number; total: number; value: number | string | null; unit?: string | null }

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th'}`

export default function Leaderboards() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const category = CATEGORIES.some(c => c.key === params.get('category')) ? params.get('category')! : CATEGORIES[0].key
  const playerId = params.get('player')
  const competition = params.get('competition')
  const lastN = params.get('last') ? Number(params.get('last')) : null
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v == null || v === '' ? next.delete(k) : next.set(k, v)))
    setParams(next, { replace: true })
  }
  const qs = new URLSearchParams()
  if (competition) qs.set('competition', competition)
  if (lastN) qs.set('last_n', String(lastN))
  const q = qs.toString() ? `?${qs.toString()}` : ''

  const comps = useQuery({ queryKey: ['match-competitions'], queryFn: () => fetchAPI<string[]>('/matches/competitions'), staleTime: 30 * 60 * 1000 })
  const board = useQuery({
    queryKey: ['coach-leaderboard', category, competition, lastN],
    queryFn: () => fetchAPI<CoachBoard>(`/analytics/leaderboards/${category}${q}`),
    staleTime: 5 * 60 * 1000,
  })
  const positions = useQuery({
    queryKey: ['player-leaderboard-positions', playerId, competition, lastN],
    queryFn: () => fetchAPI<{ positions: Position[] }>(`/analytics/player/${playerId}/leaderboard-positions${q}`),
    enabled: !!playerId, staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,      // keep his places on the chips while a new filter computes
  })
  const posBy = useMemo(() => Object.fromEntries((positions.data?.positions || []).map(p => [p.category, p])), [positions.data])

  const meta = CATEGORIES.find(c => c.key === category)!
  const rows = board.data?.rankings || []
  const me = playerId ? rows.find(r => r.player_id === playerId) : undefined
  // his name survives a board he is not on, or one still loading
  const nameRef = useRef<string | null>(null)
  if (me?.player_name) nameRef.current = me.player_name
  const playerName = me?.player_name || nameRef.current
  const ctx: LeaderboardContext | undefined = board.data ? {
    category, display_name: board.data.display_name, unit: board.data.unit || '',
    my_rank: me?.rank ?? null, my_value: me?.value ?? null, total_players: rows.length,
    top_3: rows.slice(0, 3), context_window: [],
  } : undefined

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {playerId && <Link to={`/players/${playerId}`} className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"><ChevronLeft size={16} aria-hidden="true" /> Back to {playerName || 'the player'}</Link>}
          <h1 className="text-2xl font-bold text-white mt-1">Squad leaderboards</h1>
          <p className="text-sm text-white/55">Every player, the same boards the players see in their portal. Tap a player to open him.</p>
        </div>
        {playerId && (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-3 py-1.5 text-sm text-emerald-200">
            Highlighting {playerName || 'player'}
            <button onClick={() => set({ player: null })} className="text-emerald-200/70 hover:text-white" aria-label="Stop highlighting"><X size={14} /></button>
          </span>
        )}
      </div>

      {/* scope: competition + recent matches, applies to every board */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={competition ?? ''} onChange={e => set({ competition: e.target.value || null })} aria-label="Competition"
          className="bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/85 min-w-[12rem]">
          <option value="" className="bg-slate-900">All competitions</option>
          {(comps.data || []).map(c => <option key={c} value={c} className="bg-slate-900">{c}</option>)}
        </select>
        <div className="flex gap-1.5" role="group" aria-label="Matches">
          {([['All matches', null], ['Last 5', 5], ['Last 3', 3]] as const).map(([lab, v]) => (
            <button key={lab} onClick={() => set({ last: v ? String(v) : null })} aria-pressed={lastN === v}
              className={`rounded-lg px-3 py-2 text-xs font-medium ${lastN === v ? 'bg-white/15 text-white border border-white/20' : 'bg-white/[0.04] text-white/55 border border-transparent hover:bg-white/[0.08]'}`}>{lab}</button>
          ))}
        </div>
      </div>

      {/* boards as chips (wrapping, nothing hidden); with a player picked, his place on each */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Leaderboards">
        {CATEGORIES.map(c => {
          const active = c.key === category
          const p = posBy[c.key]
          return (
            <button key={c.key} role="tab" aria-selected={active} onClick={() => set({ category: c.key })}
              className={`rounded-xl px-3 py-2 flex items-center gap-2 transition-colors ${active ? 'bg-white/10 border border-white/25' : 'bg-white/[0.04] border border-transparent hover:bg-white/[0.08]'}`}>
              <c.icon size={16} style={{ color: active ? c.color : 'rgba(255,255,255,0.45)' }} aria-hidden="true" />
              <span className={`text-sm font-medium whitespace-nowrap ${active ? 'text-white' : 'text-white/60'}`}>{c.label}</span>
              {p && <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${p.rank <= 3 ? 'bg-amber-400/20 text-amber-200' : 'bg-white/10 text-white/55'}`}>{ordinal(p.rank)}</span>}
            </button>
          )
        })}
      </div>

      <div className="glass-card p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><meta.icon size={20} style={{ color: meta.color }} aria-hidden="true" />{board.data?.display_name || meta.label}</h2>
          <span className="text-xs text-white/45">{rows.length ? `${rows.length} players ranked` : ''}{board.data?.unit ? ` · by ${board.data.unit}` : ''}</span>
        </div>
        <p className="text-sm text-white/60 max-w-prose">{meta.description}</p>
        {me && <p className="text-sm text-emerald-200">{me.player_name}: {ordinal(me.rank)} of {rows.length}{me.detail ? ` (${me.detail})` : ''}</p>}
        {playerId && board.data && !board.isFetching && !me && <p className="text-sm text-white/55">{playerName || 'He'} is not on this board{competition || lastN ? ' for this selection' : ''}.</p>}
        {category === 'the_wall' && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/45">
            <span><b className="text-white/70">B</b> = Blocks</span><span><b className="text-white/70">I</b> = Interceptions</span><span><b className="text-white/70">TO</b> = Turnovers Won</span>
          </div>
        )}
        {board.isError ? <p className="text-sm text-amber-300">Could not load this leaderboard.</p> : (
          <LeaderboardCategoryView board={ctx} ranking={rows} isLoading={board.isLoading} myPlayerId={playerId} categoryKey={category}
            icon={meta.icon} color={meta.color} emptyMessage={emptyMessageFor(category, 'coach')} meLabel="this player"
            qualificationNote={category === 'clinical_rating' ? 'Minimum 10 shots required to qualify' : undefined}
            onSelect={id => navigate(`/players/${id}`)} split />
        )}
      </div>
    </div>
  )
}
