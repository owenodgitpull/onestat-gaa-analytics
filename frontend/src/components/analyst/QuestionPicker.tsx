import { useState } from 'react'
import { BarChart3, Users, Target, Compass, Activity, LineChart, Layers, ChevronRight } from 'lucide-react'

interface Category { id: string; title: string; blurb: string; icon: typeof BarChart3; prompts: string[] }

// What the analyst can be asked, grouped the way a coach thinks. Each question maps onto data the analyst has tools for.
export const QUESTION_CATEGORIES: Category[] = [
  { id: 'match', title: 'Match analysis', blurb: 'Reviews and comparisons', icon: BarChart3, prompts: [
    'Give me a full review of our last match',
    'What decided our last match?',
    'Which match was our best performance this season, and why?',
    'What did we do differently in our wins compared with our defeats?',
    'How did our first half compare with our second half this season?',
    'Compare our home and away results',
  ] },
  { id: 'players', title: 'Player performance', blurb: 'Form, scoring, ball winning', icon: Users, prompts: [
    'Who is in the best form right now?',
    'Show me our top scorers',
    'Who wins us the most turnovers?',
    'Who loses the ball most, and where on the pitch?',
    'Which players have improved over their last 3 matches?',
    'Who has the best shot conversion this season?',
  ] },
  { id: 'scoring', title: 'Scoring and shooting', blurb: 'Where and how we score', icon: Target, prompts: [
    'Analyse our scoring zones',
    'How are our two-pointers going?',
    'Where do our wides come from?',
    'What share of our scores come from play and what share from frees?',
    'Which players take our frees, and how accurate are they?',
  ] },
  { id: 'restarts', title: 'Kick-outs and turnovers', blurb: 'Restarts and the ball won or lost', icon: Compass, prompts: [
    'How are our kick-outs going this season?',
    'Where do we win our own kick-outs?',
    'How many of their kick-outs do we win, and what do we do with them?',
    'How quickly do we turn a turnover into a score?',
    'What happens after we win the ball in our own third?',
    'Where on the pitch do we lose the ball most?',
  ] },
  { id: 'tactics', title: 'Tactical insights', blurb: 'Patterns across the season', icon: Layers, prompts: [
    'What patterns do we see in different weather?',
    'How do we do in the 10 minutes after we concede a score?',
    'How well do we get back behind the ball after losing it?',
    'How do our kick-outs and turnovers turn into scores?',
    'What are the biggest differences between our best and worst games?',
  ] },
  { id: 'fitness', title: 'Fitness and GPS', blurb: 'Running, workload, risk', icon: Activity, prompts: [
    'Are any players at workload injury risk?',
    'Who covers the most ground, and who sprints the most?',
    'Does our running drop off in the second half?',
    'How do fitness levels link to match performance?',
    'How does our GPS output correlate with wins?',
  ] },
  { id: 'charts', title: 'Charts, tables and clips', blurb: 'Have it build something', icon: LineChart, prompts: [
    'Chart our points scored in every match this season',
    'Make a table of every player\'s scores and turnovers won',
    'Chart our possession against the result in each match',
    'Build a table of this season\'s results',
    'Make a video of our turnovers won in the last match',
  ] },
]

/** Pick a category, then a question: one panel at a time instead of every question listed at once. */
export default function QuestionPicker({ onPick }: { onPick: (q: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const cat = QUESTION_CATEGORIES.find(c => c.id === open)
  return (
    <div>
      <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">What can I ask?</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2" role="tablist" aria-label="Question categories">
        {QUESTION_CATEGORIES.map(c => {
          const Icon = c.icon
          const on = c.id === open
          return (
            <button key={c.id} type="button" role="tab" aria-selected={on} onClick={() => setOpen(on ? null : c.id)}
              className={`text-left p-3 rounded-xl border transition-colors min-h-[72px] ${on ? 'bg-emerald-500/15 border-emerald-400/50' : 'glass-card-hover border-white/10'}`}>
              <div className="flex items-center gap-2">
                <Icon size={16} className={on ? 'text-emerald-300' : 'text-white/60'} aria-hidden="true" />
                <span className={`text-sm font-semibold ${on ? 'text-emerald-100' : 'text-white'}`}>{c.title}</span>
              </div>
              <div className="text-xs text-white/50 mt-1">{c.blurb}</div>
            </button>
          )
        })}
      </div>
      {cat && (
        <div className="mt-3 glass-card p-2 rounded-xl" role="tabpanel">
          <ul className="divide-y divide-white/5">
            {cat.prompts.map(p => (
              <li key={p}>
                <button type="button" onClick={() => onPick(p)}
                  className="w-full flex items-center justify-between gap-3 text-left px-3 py-2.5 rounded-lg text-sm text-white/85 hover:text-white hover:bg-white/5">
                  <span>{p}</span><ChevronRight size={16} className="text-white/30 shrink-0" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
