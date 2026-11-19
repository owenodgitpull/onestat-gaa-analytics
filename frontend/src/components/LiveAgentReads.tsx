import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { api, LiveInsight } from '@/services/api'

/**
 * The live match agent's 5-minute reads, as the sideline would have seen them: each one written from only what had
 * happened up to that minute (no GPS). For video-tagged matches they are replayed from the tagged events through the
 * same live agent. Collapsed it shows the first reads' headlines; open, every read in full.
 */

const COLLAPSED = 2

function when(i: LiveInsight, halfMins: number): string {
  if (i.trigger === 'half_time') return i.half === 1 ? 'Half time' : i.half === 2 ? 'End of normal time' : 'End of extra time 1'
  const period = i.half === 1 ? '1st half' : i.half === 2 ? '2nd half' : 'Extra time'
  // added time reads as 35+2 rather than 37
  const end = i.half === 1 ? halfMins : i.half === 2 ? 2 * halfMins : null
  const m = end && i.minute > end ? `${end}+${i.minute - end}` : `${i.minute}`
  return `${m}' · ${period}`
}

function paragraphs(text: string): { headline: string; rest: string[] } {
  const parts = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const headline = (parts[0] || '').replace(/^\*\*|\*\*$/g, '').replace(/\*\*/g, '')
  return { headline, rest: parts.slice(1).map(p => p.replace(/\*\*/g, '')) }
}

export default function LiveAgentReads({ matchId, halfMins = 35 }: { matchId: string; halfMins?: number }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['live-insights-all', matchId],
    queryFn: () => api.liveInsights.getInsights(matchId, 80),
    staleTime: 5 * 60 * 1000,
  })
  if (isLoading) {
    return (
      <div className="glass-card p-6 mt-6 flex items-center gap-2 text-sm text-white/60">
        <Loader2 size={16} className="animate-spin" /> Loading the live agent's reads…
      </div>
    )
  }
  const all = (data?.insights || []).filter(i => i.insight && !i.insight.startsWith('[Analysis pending'))
  if (!all.length) return null
  const reads = [...all].sort((a, b) => a.half - b.half || a.minute - b.minute || (a.trigger === 'half_time' ? 1 : 0) - (b.trigger === 'half_time' ? 1 : 0))
  const replayed = reads.some(r => (r.trigger_context || '').startsWith('Replayed'))
  const shown = open ? reads : reads.slice(0, COLLAPSED)

  return (
    <div className="glass-card p-6 mt-6">
      <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
          <Bot size={20} className="text-white" />
        </div>
        <span>Live agent reads, as the game unfolded</span>
      </h2>
      <p className="text-xs text-white/55 mb-4 md:ml-[52px]">
        What the live match agent told the sideline every 5 minutes, written from only what had happened up to that minute (no GPS).
        {replayed ? ' Replayed from the tagged events through the same live agent.' : ''} {reads.length} reads.
      </p>
      <ol className="space-y-3">
        {shown.map(r => {
          const { headline, rest } = paragraphs(r.insight)
          return (
            <li key={r.id} className={`rounded-xl border px-4 py-3 ${r.trigger === 'half_time' ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
              <div className="text-[11px] uppercase tracking-wide text-white/50 font-semibold tabular-nums mb-1">{when(r, halfMins)}</div>
              <p className="text-sm text-white font-semibold leading-snug">{headline}</p>
              {open && rest.map((p, k) => <p key={k} className="text-sm text-white/80 leading-relaxed mt-2">{p}</p>)}
            </li>
          )
        })}
      </ol>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-xs font-medium border border-white/10 transition-colors">
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {open ? 'Show less' : `Show all ${reads.length} reads in full`}
      </button>
    </div>
  )
}
