/**
 * Season KPI cards for one player, in the season dashboard's style, but measured against HIMSELF (Owen, 2026-11-16):
 * the big figure is his season average per full match, the colour and the trend line are his last 3 against that
 * (green = better, amber = about the same, red = worse; neither colour for figures that are not good or bad), the
 * small line is his best and the squad average for context. The (i) explains the figure.
 * Same data (and React Query cache) as SelfKpiPanel: /analytics/player/{id}/self-kpis (+ /gps).
 */
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Info, Minus, TrendingDown, TrendingUp, X } from 'lucide-react'
import { mergeSelfKpis, type SelfGpsKpis, type SelfKpiDef, type SelfKpis } from './SelfKpiPanel'

const WINDOW = 3

/** card label + what it measures (per full match unless it says otherwise) */
const CARD: Record<string, { label: string; what: string }> = {
  score_points: { label: 'Points per game', what: 'Points he scored per match: a goal is 3, a two-pointer 2, a point 1. Frees and 45s included.' },
  scores: { label: 'Scores per game', what: 'Goals, two-pointers and points he scored per match.' },
  shots: { label: 'Shots per game', what: 'Every shot he took per match, scored or not.' },
  conversion_pct: { label: 'Shot conversion', what: 'Of his shots, the share he scored (frees included).' },
  scores_from_play: { label: 'Scores from play', what: 'Scores per match not from a free or 45.' },
  assists: { label: 'Assists per game', what: 'The last pass before a score, per match.' },
  impact_rank: { label: 'Impact rank (our team)', what: "Where he ranks in our team each match on the reports' impact weighting (goals x10, two-pointers x5, points x3, assists x3, turnovers, kickouts and throw-ins won x2, minus turnovers lost). Lower is better." },
  carries: { label: 'Carries per game', what: 'Times he had the ball in hand (tagged carries) per match.' },
  passes: { label: 'Passes per game', what: 'Carries he ended with a pass, per match.' },
  metres_per_carry: { label: 'Metres gained per carry', what: 'How far up the pitch the ball moved on his carries, on average.' },
  turnovers_lost: { label: 'Turnovers lost', what: 'Times he lost the ball per match (including unforced errors). Lower is better.' },
  stray_passes: { label: 'Stray passes', what: 'Passes that went astray (part of turnovers lost), per match. Lower is better.' },
  frees_won: { label: 'Frees won', what: 'Frees he won per match.' },
  turnovers_won: { label: 'Turnovers won', what: 'Turnovers and tackles he won per match.' },
  blocks: { label: 'Blocks', what: 'Shots or passes he blocked per match.' },
  interceptions: { label: 'Interceptions', what: 'Passes he intercepted per match.' },
  kickouts_won: { label: 'Kickouts won', what: 'Kickouts he won per match, ours or theirs, clean or off the break.' },
  kickouts_won_clean: { label: 'Kickouts caught', what: 'Kickouts he won clean (caught) per match.' },
  kickouts_won_break: { label: 'Kickout breaks won', what: 'Kickouts he won off the break per match.' },
  frees_conceded: { label: 'Frees conceded', what: 'Frees given against him per match. Lower is better.' },
  cards: { label: 'Cards', what: 'Cards per match. Lower is better.' },
  distance_km: { label: 'Distance', what: 'Distance covered per match (GPS).' },
  m_per_min: { label: 'Metres per minute', what: 'Distance divided by minutes played: his work rate, fair across full games and cameos.' },
  hsr_m: { label: 'High-speed running', what: 'Metres run above high speed per match (GPS).' },
  sprints: { label: 'Sprints', what: 'Sprints per match (GPS).' },
  top_speed: { label: 'Top speed', what: 'His fastest speed in a match, averaged over his matches (GPS).' },
  accelerations: { label: 'Accelerations', what: 'Hard accelerations per match (GPS).' },
  avg_hr: { label: 'Average heart rate', what: 'Average heart rate in matches, where the unit records it.' },
  max_hr: { label: 'Max heart rate', what: 'Highest heart rate in matches, where the unit records it.' },
  red_zone_min: { label: 'Minutes in the red zone', what: 'Minutes above 90% of his max heart rate per match.' },
  back_10s_pct: { label: 'Goal-side after losing it', what: 'Of the times we lost the ball while he was on, the share where he was goal-side of the ball 10 s later (GPS). Forwards are rarely expected to be.' },
  sprint_after_loss_pct: { label: 'Sprinted after losing it', what: 'Of the times we lost the ball while he was on, the share where he sprinted (over 5.5 m/s) within 10 s (GPS).' },
  hsr_per_min: { label: 'High-speed running per min', what: 'High-speed metres per minute on the pitch (GPS tracking).' },
  avg_x_m: { label: 'Average position', what: 'His average spot, metres from our own goal line (higher = further up the pitch), from the GPS tracking. Neither good nor bad: it shows where he played.' },
  avg_x_without_m: { label: 'Position without the ball', what: 'His average spot when they had the ball, metres from our goal (GPS tracking). Neither good nor bad.' },
}

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

/** The same queries (and cache keys) as the player page's SelfKpiPanel. */
export function usePlayerSelfData(playerId: string) {
  const self = useQuery({
    queryKey: ['player-self-kpis', playerId],
    queryFn: async (): Promise<SelfKpis> => {
      const res = await fetch(`${API_BASE}/analytics/player/${playerId}/self-kpis`, { credentials: 'include' })
      if (!res.ok) throw new Error('Could not load his match figures')
      return res.json()
    },
  })
  const gps = useQuery({
    queryKey: ['player-self-gps-kpis', playerId],
    queryFn: async (): Promise<SelfGpsKpis> => {
      const res = await fetch(`${API_BASE}/analytics/player/${playerId}/self-kpis/gps`, { credentials: 'include' })
      if (!res.ok) throw new Error('Could not load his GPS tracking figures')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
  })
  const data = useMemo(() => (self.data ? mergeSelfKpis(self.data, gps.data) : undefined), [self.data, gps.data])
  return { data, loading: self.isLoading, error: self.isError, gpsLoading: gps.isLoading }
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th'}`
function fmt(v: number | null | undefined, unit: string, avg = true) {
  if (v == null) return '–'
  if (unit === 'rank') return avg ? v.toFixed(1) : ordinal(Math.round(v))
  if (unit === '%') return `${Math.round(v)}%`
  const n = Math.abs(v) >= 100 ? Math.round(v).toString() : unit === 'km' || unit === 'm/s' ? v.toFixed(2) : (unit === 'bpm' ? Math.round(v).toString() : (Number.isInteger(v) ? String(v) : v.toFixed(1)))
  return unit && unit !== 'pts' && unit !== '' ? `${n} ${unit}` : n
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

interface Card {
  def: SelfKpiDef; label: string; what: string
  season: number | null; recent: number | null; n: number; best: { v: number; opp: string } | null; squad: number | null
  trend: 'up' | 'down' | 'stable' | null; good: boolean | null
}

function build(data: SelfKpis, key: string): Card | null {
  const def = data.kpis.find(k => k.key === key)
  if (!def) return null
  const full = data.matches.filter(m => !m.short && m.values[key] != null)
  if (!full.length) return null
  const vals = full.map(m => m.values[key] as number)
  const season = mean(vals)
  const recent = full.length >= WINDOW + 1 ? mean(vals.slice(-WINDOW)) : null
  let trend: Card['trend'] = null, good: boolean | null = null
  if (season != null && recent != null) {
    const d = recent - season
    const small = def.unit === '%' ? Math.abs(d) < 5 : def.unit === '' || def.unit === 'pts' || def.unit === 'rank' ? Math.abs(d) < 0.4 : Math.abs(d) < Math.max(0.05 * Math.abs(season), 1e-9)
    trend = small ? 'stable' : d > 0 ? 'up' : 'down'
    good = trend === 'stable' || def.higher_is_better == null ? null : (trend === 'up') === def.higher_is_better
  }
  const lower = def.higher_is_better === false
  const b = def.higher_is_better == null ? null : full.reduce((x, m) => ((lower ? (m.values[key] as number) < (x.values[key] as number) : (m.values[key] as number) > (x.values[key] as number)) ? m : x))
  return {
    def, label: CARD[key]?.label || def.label, what: CARD[key]?.what || def.label,
    season, recent, n: full.length, best: b ? { v: b.values[key] as number, opp: b.opponent } : null,
    squad: def.unit === 'rank' ? null : data.squad?.season?.[key] ?? null, trend, good,
  }
}

function KpiTile({ c, who }: { c: Card; who: 'his' | 'your' }) {
  const [open, setOpen] = useState(false)
  const tone = c.trend === 'stable' ? 'text-amber-300' : c.good === true ? 'text-emerald-400' : c.good === false ? 'text-red-400' : 'text-white'
  const His = who === 'his' ? 'His' : 'Your'
  return (
    <div className="glass-card p-4 relative min-h-[124px] flex flex-col justify-center">
      <button aria-label={`About ${c.label}`} onClick={() => setOpen(true)}
        className="absolute top-1.5 right-1.5 w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors">
        <Info size={14} className="text-white/70" />
      </button>
      <div className="text-white/75 text-xs font-semibold uppercase tracking-wide mb-2 pr-8">{c.label}</div>
      <div className={`text-3xl md:text-4xl font-bold leading-none tabular-nums ${tone}`}>{fmt(c.season, c.def.unit)}</div>
      <div className="text-[11px] text-white/55 mt-1.5 leading-snug truncate">
        {c.best ? `Best ${fmt(c.best.v, c.def.unit, false)} v ${c.best.opp}` : `${c.n} match${c.n === 1 ? '' : 'es'}`}
        {c.squad != null ? <span className="text-sky-300/80"> · squad {fmt(c.squad, c.def.unit)}</span> : null}
      </div>
      {c.trend && c.trend !== 'stable' && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${c.good === false ? 'text-red-400' : c.good === true ? 'text-emerald-400' : 'text-white/65'}`}
          title={`Last ${WINDOW} matches ${fmt(c.recent, c.def.unit)} v season ${fmt(c.season, c.def.unit)}`}>
          {c.trend === 'up' ? <TrendingUp size={12} aria-hidden="true" /> : <TrendingDown size={12} aria-hidden="true" />}
          <span>Last {WINDOW}: {fmt(c.recent, c.def.unit)}</span>
        </div>
      )}
      {c.trend === 'stable' && <div className="flex items-center gap-1 mt-2 text-xs font-medium text-white/55"><Minus size={12} aria-hidden="true" /><span>Stable</span></div>}
      {!c.trend && <div className="mt-2 text-[11px] text-white/40">Trend after {WINDOW + 1} full matches</div>}
      {open && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={c.label}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-sm bg-slate-900/95 border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-gradient-to-r from-emerald-600/15 to-cyan-600/15">
              <h3 className="text-sm font-bold text-white">{c.label}</h3>
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-white/10" aria-label="Close"><X size={16} className="text-white/60" /></button>
            </div>
            <div className="p-5 space-y-4 text-sm">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5">What it measures</div>
                <div className="text-white/90 leading-relaxed">{c.what}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5">{His} figures</div>
                <div className="rounded-lg border border-white/10 divide-y divide-white/5">
                  {[[`Season (${c.n} full matches)`, fmt(c.season, c.def.unit)], [`Last ${WINDOW}`, fmt(c.recent, c.def.unit)],
                    ['Best', c.best ? `${fmt(c.best.v, c.def.unit, false)} v ${c.best.opp}` : '–'], ['Squad average', c.squad != null ? fmt(c.squad, c.def.unit) : '–']].map(([a, b]) => (
                    <div key={a} className="flex items-center justify-between px-3 py-1.5"><span className="text-white/70">{a}</span><span className="text-white font-semibold tabular-nums">{b}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5">The colour</div>
                <div className="text-white/60 leading-relaxed">
                  Compared only with {who === 'his' ? 'himself' : 'yourself'}: {who} last {WINDOW} full matches against {who} season so far.{' '}
                  <span className="text-emerald-300">Green</span> = better, <span className="text-amber-300">amber</span> = about the same, <span className="text-red-300">red</span> = worse.
                  {c.def.higher_is_better == null ? ' This one is neither good nor bad, so it stays white.' : ''} Games under 20 minutes are left out.
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** One row of cards. Keys without data for this player are skipped; nothing renders if none have data. */
export default function PlayerKpiCards({ playerId, title, note, keys, who = 'his' }: {
  playerId: string; title: string; note?: string; keys: string[]; who?: 'his' | 'your'
}) {
  const { data, loading, error, gpsLoading } = usePlayerSelfData(playerId)
  const cards = useMemo(() => (data ? keys.map(k => build(data, k)).filter((c): c is Card => !!c) : []), [data, keys])
  const waitingGps = gpsLoading && keys.some(k => k in GPS_KEYS)
  if (error) return null
  if (loading || (waitingGps && !cards.length)) {
    return (
      <div>
        <h3 className="text-lg font-bold text-white mb-3">{title}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{keys.slice(0, 4).map(k => <div key={k} className="glass-card h-[124px] animate-pulse" />)}</div>
      </div>
    )
  }
  if (!cards.length) return null
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <span className="text-xs text-white/50">{note || `Per full match this season. Colour = ${who} last ${WINDOW} v ${who} season.`}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(c => <KpiTile key={c.def.key} c={c} who={who} />)}
      </div>
    </div>
  )
}

const GPS_KEYS: Record<string, true> = { back_10s_pct: true, sprint_after_loss_pct: true, hsr_per_min: true, avg_x_m: true, avg_x_without_m: true }
