import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Info, X } from 'lucide-react'

export interface KpiExplanation {
  what: string
  how: string
  accuracy?: string
}

/** What each GPS number means, how it is worked out, and what limits it. Keyed by the tile label. */
export const GPS_KPI_INFO: Record<string, KpiExplanation> = {
  'Team distance': {
    what: 'Total ground covered by all our tracked outfielders while they were on the pitch.',
    how: 'Each player\'s GPS distance, counted only between the moments he came on and went off (substitutions, black cards and red cards from the tagged events), added up for the team.',
    accuracy: 'Goalkeepers and players without a unit are not included.',
  },
  'High-speed running': {
    what: 'Ground covered at high speed by the team.',
    how: 'Distance covered above 5.5 m/s (about 20 km/h), added up across our tracked outfielders while on the pitch.',
  },
  'High-speed': {
    what: 'Ground covered at high speed by the team.',
    how: 'Distance covered above 5.5 m/s (about 20 km/h), added up across our tracked outfielders while on the pitch.',
  },
  'Compact without ball': {
    what: 'How tightly packed our team is when they have the ball. Smaller = a tighter unit, harder to play through.',
    how: 'Every second, the average distance of each of our outfielders from the team\'s centre point. Averaged over the seconds the opposition had the ball. The smaller figure underneath is the same thing when we had the ball.',
    accuracy: 'Who has the ball comes from the tagged carries: a team "has the ball" from its carry until the other team\'s next carry. Stoppages (setting up for a free or a sideline) are still counted as play for now.',
  },
  'Compactness': {
    what: 'How tightly packed our team is. Smaller = a tighter unit.',
    how: 'Every second, the average distance of each of our outfielders from the team\'s centre point, averaged over the seconds without (and with) the ball.',
    accuracy: 'Possession comes from the tagged carries; stoppages are still counted as play for now.',
  },
  'Length': {
    what: 'How long our team is from back to front, along the pitch.',
    how: 'Every second, the distance between our deepest outfielder and our most advanced outfielder, along the length of the pitch. Averaged over the seconds without (and with) the ball.',
    accuracy: 'One player well ahead of or behind the rest stretches it. No goalkeeper.',
  },
  'Width': {
    what: 'How wide our team is spread across the pitch.',
    how: 'Every second, the distance between our left-most and right-most outfielder. Averaged over the seconds without (and with) the ball.',
    accuracy: 'Players who are off the field (bench, sin bin) are left out.',
  },
  'Deepest 6': {
    what: 'How high our defensive block sits.',
    how: 'Every second, the average distance from our own goal line of our six deepest outfielders, averaged over the seconds the opposition had the ball. Higher = a higher line.',
  },
  'Back behind ball': {
    what: 'How quickly we get bodies between the ball and our goal after losing it.',
    how: 'After each turnover we lose in open play: the seconds until enough of our players are nearer our goal than the ball. "Enough" = players on the pitch minus 3, at most 11 (so 9 of 12, 10 of 13). "Already back" = enough were behind the ball the moment we lost it; the figure is the median for the rest (caught short). Restarts (fouls, sidelines, 45s, kickouts) are not counted.',
    accuracy: 'Timed from the tagged moment of the loss, less the measured tagging delay. The ball\'s position is estimated from the tags (we have no ball or opposition GPS), so read a single turnover with care; the median over many is more reliable.',
  },
  'Back behind the ball': {
    what: 'How quickly we get bodies between the ball and our goal after losing it.',
    how: 'After each turnover we lose in open play: the seconds until enough of our players (on the pitch minus 3, at most 11) are nearer our goal than the ball. Median over the turnovers where we were caught short. Restarts (fouls, sidelines, 45s, kickouts) are not counted.',
    accuracy: 'Timed from the tagged moment of the loss, less the measured tagging delay; the ball position is estimated from the tags.',
  },
  'Turnovers lost': {
    what: 'Open-play turnovers we lost that the GPS could measure.',
    how: 'A carry of ours followed by a carry of theirs, with a tagged turnover (or a change of carrier within 25 s), and no stoppage in between. "Led to a score" = they scored before we got the ball back.',
  },
  'Retreat in 10 s': {
    what: 'How far the team as a whole drops back towards our goal in the 10 seconds after losing the ball.',
    how: 'The movement of the team\'s centre point towards our goal line between the moment of the loss and 10 seconds later. Median across turnovers.',
  },
  'Turnovers won': {
    what: 'Open-play turnovers we won that the GPS could measure, and how many broke forward.',
    how: 'A carry of theirs followed by one of ours with no stoppage in between. "Broke forward" = players who ran at high speed towards their goal in the next 10 seconds.',
  },
  'Support within 15 m': {
    what: 'How many team-mates were close enough to help when we passed.',
    how: 'At each tagged pass, the number of our outfielders within 15 m of the passer. Average over all passes.',
  },
  'No one within 15 m': {
    what: 'How often the passer was isolated.',
    how: 'Share of passes where none of our outfielders was within 15 m of the passer.',
  },
  'Further option': {
    what: 'How often there was a forward option for the passer.',
    how: 'Share of passes with a team-mate 15 m or more further forward and within 25 m of the passer.',
  },
  'Nearest defender': {
    what: 'How close our nearest player was when they shot.',
    how: 'At each opposition shot, the distance from the tagged shot spot to our nearest outfielder. Median across shots.',
    accuracy: 'The shot spot is a tag (good to about 5-7 m), so read it as a band, not an exact metre.',
  },
  'On their scores': {
    what: 'How close our nearest player was when they scored.',
    how: 'Same as Nearest defender, only for their scores. Median.',
    accuracy: 'Tagged spot, good to about 5-7 m.',
  },
  'Nobody within 5 m': {
    what: 'How often they shot without one of ours close.',
    how: 'Share of opposition shots where none of our outfielders was within 5 m of the tagged shot spot.',
    accuracy: 'Tagged spot, good to about 5-7 m.',
  },
  'Probable mis-tags': {
    what: 'Tags whose spot disagrees with where our player really was.',
    how: 'For each tag with one of our players, the distance between the tagged spot and his GPS position at that moment; a large gap is flagged as a probable mis-tag.',
  },
}

/** The round info button for a KPI tile; opens a small explainer. */
export function KpiInfoButton({ label, info }: { label: string; info?: KpiExplanation }) {
  const [open, setOpen] = useState(false)
  const e = info ?? GPS_KPI_INFO[label]
  if (!e) return null
  return (
    <>
      <button
        type="button"
        aria-label={`About ${label}`}
        onClick={(ev) => { ev.stopPropagation(); setOpen(true) }}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors"
      >
        <Info size={12} className="text-white/70" />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={label}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-sm bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-gradient-to-r from-emerald-600/15 to-teal-600/15">
              <h3 className="text-sm font-bold text-white">{label}</h3>
              <button onClick={() => setOpen(false)} aria-label="Close" className="p-1 rounded-lg hover:bg-white/10 transition-colors">
                <X size={16} className="text-white/60" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5">What it measures</div>
                <div className="text-sm text-white/90 leading-relaxed">{e.what}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5">How it's measured</div>
                <div className="text-sm text-white/70 leading-relaxed">{e.how}</div>
              </div>
              {e.accuracy && (
                <div className="pt-3 border-t border-white/10">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5">Accuracy</div>
                  <div className="text-sm text-white/60 leading-relaxed">{e.accuracy}</div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
