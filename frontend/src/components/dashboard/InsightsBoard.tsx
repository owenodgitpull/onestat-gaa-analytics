import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Lightbulb, TrendingDown, TrendingUp, Minus, Loader2 } from 'lucide-react'
import type { AIChartSpec, KPICardItem } from '@/services/api'
import { gpsAnalysisApi, type KoPattern } from '@/services/gpsAnalysisApi'

/**
 * Every insight the season dashboard already holds, on one board (Jim: "an insights tab would be good"): the AI line
 * on each KPI card (until now only in its info pop-up), the possession funnel read, each AI chart's finding and the
 * kickout setups. Sorted by what a coach does with them - needs attention (last 3 worse than our season), going well
 * (better), worth knowing (steady, charts, setups). Nothing new is generated, so it costs nothing to show.
 */

type Group = 'attention' | 'well' | 'know'
interface Item { id: string; group: Group; source: string; figure?: string; sub?: string; text: string; weight: number }

const COLLAPSED = 3

function fmt(c: KPICardItem, v: number): string {
  if (c.format === 'percent') return `${v}%`
  if (c.format === 'seconds') return `${v} s`
  if (c.format === 'signed_int' || c.format === 'signed_decimal') return v > 0 ? `+${v}` : `${v}`
  return `${v}`
}

function fromCards(cards: KPICardItem[]): Item[] {
  return cards.filter(c => c.insight).map(c => {
    const t = c.trend
    const moved = t && t.direction !== 'stable' && t.good != null
    const group: Group = moved ? (t!.good ? 'well' : 'attention') : 'know'
    const change = t && t.season ? Math.abs((t.recent - t.season) / t.season) : 0
    return {
      id: `kpi:${c.key}`, group, source: c.label, figure: fmt(c, c.value),
      sub: t ? `last ${t.window}: ${fmt(c, t.recent)} · season ${fmt(c, t.season)}` : undefined,
      text: c.insight!, weight: change,
    }
  })
}

function fromCharts(charts: AIChartSpec[]): Item[] {
  return charts.filter(c => c.insight).map(c => ({
    id: `chart:${c.id}`, group: c.trend === 'declining' ? 'attention' : c.trend === 'improving' ? 'well' : 'know',
    source: `Chart · ${c.title}`, text: c.insight, weight: 0.05,
  }))
}

function fromSetups(sides: Partial<Record<'own' | 'opp', { patterns: { win: KoPattern[]; lose: KoPattern[] } }>>): Item[] {
  const out: Item[] = []
  for (const [k, side] of Object.entries(sides)) {
    if (!side) continue
    const whose = k === 'own' ? 'Our kickouts' : 'Their kickouts'
    for (const p of [...side.patterns.win.slice(0, 2), ...side.patterns.lose.slice(0, 1)]) {
      out.push({
        id: `ko:${k}:${p.id}`, group: 'know', source: `${whose} · ${p.direction === 'win' ? 'Setup' : 'Losing setup'}`,
        figure: `${p.won}/${p.n}`, sub: `rest ${p.rest_won}/${p.rest_n}${p.last3 && p.last3.n ? ` · last 3: ${p.last3.won}/${p.last3.n}` : ''} · ${p.strength}`,
        text: p.setup || `When ${p.label}`, weight: 0.01,
      })
    }
  }
  return out
}

const GROUPS: { id: Group; title: string; hint: string; icon: typeof TrendingUp; tone: string }[] = [
  { id: 'attention', title: 'Needs attention', hint: 'Last 3 matches worse than our season', icon: TrendingDown, tone: 'text-red-300' },
  { id: 'well', title: 'Going well', hint: 'Last 3 matches better than our season', icon: TrendingUp, tone: 'text-emerald-300' },
  { id: 'know', title: 'Worth knowing', hint: 'Steady KPIs, chart findings, kickout setups', icon: Minus, tone: 'text-white/70' },
]

function Tile({ it }: { it: Item }) {
  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 flex gap-3">
      {it.figure && (
        <div className="shrink-0 w-[4.5rem]">
          <div className="text-xl font-bold text-white tabular-nums leading-none">{it.figure}</div>
          {it.sub && <div className="text-[10px] text-white/50 leading-snug mt-1">{it.sub}</div>}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-0.5 truncate">{it.source}</div>
        <p className="text-sm text-white/90 leading-snug">{it.text}</p>
        {!it.figure && it.sub && <div className="text-[11px] text-white/50 mt-1">{it.sub}</div>}
      </div>
    </li>
  )
}

export default function InsightsBoard({ cards, funnelInsight, aiCharts, hasGps }: {
  cards: KPICardItem[]; funnelInsight?: string | null; aiCharts: AIChartSpec[]; hasGps: boolean
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('insights-board-open') !== '0' } catch { return true }
  })
  const [all, setAll] = useState(false)
  const ko = useQuery({ queryKey: ['gps-ko-patterns'], queryFn: () => gpsAnalysisApi.kickoutPatterns(), staleTime: 10 * 60 * 1000, retry: false, enabled: hasGps && open })

  const items: Item[] = [
    ...fromCards(cards),
    ...(funnelInsight ? [{ id: 'funnel', group: 'know' as Group, source: 'Possession funnel', text: funnelInsight, weight: 0.02 }] : []),
    ...fromCharts(aiCharts),
    ...(ko.data ? fromSetups(ko.data.sides) : []),
  ]
  const toggle = () => setOpen(o => {
    try { localStorage.setItem('insights-board-open', o ? '0' : '1') } catch { /* private mode */ }
    return !o
  })

  return (
    <div className="glass-card p-5 mb-6">
      <button onClick={toggle} aria-expanded={open} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center"><Lightbulb size={18} className="text-white" /></span>
          <span>
            <span className="block text-lg font-bold text-white">Insights</span>
            <span className="block text-xs text-white/55">{items.length} from across the season dashboard · last 3 matches compared with our own season</span>
          </span>
        </span>
        {open ? <ChevronUp size={18} className="text-white/60" /> : <ChevronDown size={18} className="text-white/60" />}
      </button>
      {open && (
        <>
          {items.length === 0 ? (
            <p className="mt-4 text-sm text-white/60">No insights yet: they appear once the season's KPI reads have been written (after match data is recorded).</p>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              {GROUPS.map(g => {
                const list = items.filter(i => i.group === g.id).sort((a, b) => b.weight - a.weight)
                const shown = all ? list : list.slice(0, COLLAPSED)
                const Icon = g.icon
                return (
                  <section key={g.id} className="min-w-0">
                    <h3 className={`text-sm font-semibold flex items-center gap-1.5 ${g.tone}`}><Icon size={14} aria-hidden="true" />{g.title} <span className="text-white/40 font-normal">({list.length})</span></h3>
                    <p className="text-[11px] text-white/45 mb-2">{g.hint}</p>
                    {list.length === 0 ? <p className="text-xs text-white/40">Nothing here right now.</p> : (
                      <ul className="space-y-2">{shown.map(it => <Tile key={it.id} it={it} />)}</ul>
                    )}
                    {g.id === 'know' && hasGps && ko.isLoading && (
                      <p className="mt-2 text-xs text-white/50 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Finding kickout setups across the GPS matches…</p>
                    )}
                  </section>
                )
              })}
            </div>
          )}
          {items.length > 0 && GROUPS.some(g => items.filter(i => i.group === g.id).length > COLLAPSED) && (
            <button onClick={() => setAll(a => !a)} className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-xs font-medium border border-white/10 transition-colors">
              {all ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{all ? 'Show the top 3 in each' : `Show all ${items.length} insights`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
