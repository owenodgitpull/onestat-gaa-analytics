/**
 * Phase analysis: one dot per possession, Jim's phase names as headings, sub-rows indented under them.
 * Numbers are plain counts from the backend (possessions, finished, had a shot, scored, points; per half [shot, finished, scored]).
 * No rankings, no good/bad colouring, no comparison with an average: one match is too small a sample for that.
 * Wide screens get the table; below 900px of card width each row becomes a stacked card (container query, so it follows the
 * card, not the window).
 */
type Half = [number, number, number] | null
export type PhaseRow = { id: string; label: string | null; detail: string | null; poss: number; fin: number; shot: number; scored: number; pts: number; h1: Half; h2: Half; h3?: Half }
export type PhaseGroup = {
  id: string; title: string; detail?: string | null; exclusive?: boolean; note?: string
  rows?: PhaseRow[]
  counts?: { label: string; ours: number | null; theirs: number | null; unclear?: number }[]
}

const LOW_N = 5            // fewer finished possessions than this = small sample
const DOT = 16
const GAP = 5
const HALF_UNIT = 7        // px per finished possession in a half bar (capped to the cell)
const PPP_SCALE = 1.0      // fixed 0 to 1.0 scale so bars compare across rows

const LABELS = { scored: 'Scored', missed: "Shot, didn't score", noshot: 'Finished, no shot', open: "Didn't finish" } as const
type Kind = keyof typeof LABELS

const outcomes = (p: PhaseRow): [Kind, number][] => [
  ['scored', p.scored], ['missed', p.shot - p.scored], ['noshot', p.fin - p.shot], ['open', p.poss - p.fin],
]

function Dots({ p }: { p: PhaseRow }) {
  const o = outcomes(p)
  const title = o.filter(([, n]) => n > 0).map(([k, n]) => `${n} ${LABELS[k].toLowerCase()}`).join(' · ')
  return (
    <div className="pa-dots" title={title} role="img" aria-label={title}>
      {o.flatMap(([k, n]) => Array.from({ length: Math.max(0, n) }, (_, i) => <span key={`${k}${i}`} className={`pa-dot pa-dot--${k}`} />))}
    </div>
  )
}

function HalfBar({ h, name }: { h: Half | undefined; name: string }) {
  if (!h) return <span className="pa-muted" data-half={name}>–</span>
  const [shots, fin, scored] = h
  const pc = (n: number) => `${fin ? (100 * n) / fin : 0}%`
  return (
    <div className="pa-half" data-half={name} title={`${fin} possessions finished in this half · ${shots} had a shot · ${scored} scored`}>
      <div className="pa-half__track" style={{ width: Math.max(fin, 1) * HALF_UNIT }}>
        <div className="pa-half__shots" style={{ width: pc(shots) }} />
        <div className="pa-half__scored" style={{ width: pc(scored) }} />
      </div>
      <div className="pa-half__text"><b>{scored}</b> scored</div>
      <div className="pa-half__sub">{shots} of {fin} had a shot</div>
    </div>
  )
}

function Row({ p, title, detail, variant, et }: { p: PhaseRow; title: string; detail?: string | null; variant: 'phase' | 'sub'; et: boolean }) {
  const low = p.fin < LOW_N
  const ppp = p.fin ? p.pts / p.fin : 0
  return (
    <div className={`pa-row pa-row--${variant}${low ? ' pa-row--low' : ''}`}>
      <div className="pa-cell pa-label">
        <div className="pa-label__title">
          {title}
          {low && <span className="pa-chip" title="Too few possessions to read a rate from">n={p.fin}</span>}
        </div>
        {detail && <div className="pa-label__detail">{detail}</div>}
      </div>
      <div className="pa-cell pa-num"><span className="pa-num__lab">Possessions </span>{p.poss}</div>
      <div className="pa-cell pa-main">
        <Dots p={p} />
        <div className="pa-stat">
          <b>{p.shot}</b> of {p.fin} {p.fin === 1 ? 'possession' : 'possessions'} had a shot · <b>{p.scored}</b> scored · <b>{p.pts}</b> {p.pts === 1 ? 'point' : 'points'}
        </div>
      </div>
      <div className="pa-cell pa-pppcell" title="Points divided by possessions that finished">
        <div className="pa-ppp__row">
          <div className={`pa-ppp${low ? ' pa-muted' : ''}`}>{low ? '–' : ppp.toFixed(2)}</div>
          <span className="pa-ppp__lab">Pts / poss</span>
        </div>
        {!low && <div className="pa-ppp__bar"><div style={{ width: `${Math.min(100, (ppp / PPP_SCALE) * 100)}%` }} /></div>}
      </div>
      <div className="pa-halves">
        <div className="pa-cell pa-halfcell"><HalfBar h={p.h1} name="1st half" /></div>
        <div className="pa-cell pa-halfcell"><HalfBar h={p.h2} name="2nd half" /></div>
        {et && <div className="pa-cell pa-halfcell"><HalfBar h={p.h3} name="Extra time" /></div>}
      </div>
    </div>
  )
}

/** One plain line under a heading, where the name alone does not say what is counted. */
const EXPLAIN: Record<string, string> = {
  tracked: 'Every possession we followed through the tagged events, ours and theirs: from the moment a team got the ball until it scored, missed, lost it, gave away a foul or the half ended.',
}

const n = (v: number | null) => (v == null ? '–' : v)

function Phase({ phase, et }: { phase: PhaseGroup; et: boolean }) {
  if (phase.counts) {
    return (
      <div className="pa-phase">
        <div className="pa-phase__head">{phase.title}{phase.note && <span className="pa-muted"> · {phase.note}</span>}</div>
        {phase.counts.map(c => (
          <div key={c.label} className="pa-row pa-row--sub pa-row--counts">
            <div className="pa-cell pa-label"><div className="pa-label__title">{c.label}</div></div>
            <div className="pa-cell pa-counts">We won <b>{n(c.ours)}</b> <span className="pa-muted">·</span> They won <b>{n(c.theirs)}</b>
              {!!c.unclear && <span className="pa-muted"> · {c.unclear} unclear (nothing tagged straight after)</span>}</div>
          </div>
        ))}
      </div>
    )
  }
  const rows = phase.rows ?? []
  if (!rows.length) return null
  if (rows.length === 1 && !rows[0].label) {
    return <div className="pa-phase"><Row p={rows[0]} title={phase.title} detail={phase.detail} variant="phase" et={et} /></div>
  }
  // A possession total in the heading is only shown where the rows cannot overlap (the backend says which).
  const total = phase.exclusive ? rows.reduce((s, x) => s + x.poss, 0) : null
  return (
    <div className="pa-phase">
      <div className="pa-phase__head">{phase.title}{total != null && <span className="pa-muted"> · {total} possessions</span>}
        {EXPLAIN[phase.id] && <div className="pa-phase__explain">{EXPLAIN[phase.id]}</div>}
      </div>
      {rows.map(x => <Row key={x.id} p={x} title={x.label ?? ''} detail={x.detail} variant="sub" et={et} />)}
    </div>
  )
}

export default function PhaseAnalysis({ phases }: { phases: PhaseGroup[] }) {
  const et = phases.some(ph => ph.rows?.some(r => r.h3))
  const cols = `minmax(230px,1fr) 112px minmax(380px,1.5fr) 130px 170px 170px${et ? ' 170px' : ''}`
  return (
    <section className="pa" style={{ ['--pa-cols' as string]: cols, ['--pa-halves' as string]: et ? 3 : 2 }}>
      <style>{css}</style>
      <header className="pa-head">
        <div>
          <div className="pa-eyebrow">Phase analysis</div>
          <div className="pa-sub">One dot per possession. Phases overlap, so don't add across them. A possession total in a heading means its rows don't overlap.</div>
        </div>
        <div className="pa-legend">
          {(Object.keys(LABELS) as Kind[]).map(k => <span key={k}><i className={`pa-dot pa-dot--${k}`} /> {LABELS[k]}</span>)}
        </div>
      </header>

      <div className="pa-table">
        <div className="pa-row pa-row--head" aria-hidden="true">
          <div className="pa-cell">Phase</div>
          <div className="pa-cell pa-num">Possessions</div>
          <div className="pa-cell">How each possession ended</div>
          <div className="pa-cell">Pts / poss</div>
          <div className="pa-cell">1st half</div>
          <div className="pa-cell">2nd half</div>
          {et && <div className="pa-cell">Extra time</div>}
        </div>
        {phases.map(ph => <Phase key={ph.id} phase={ph} et={et} />)}
      </div>

      <footer className="pa-foot">
        Pts / poss = points scored ÷ possessions that finished (0.50 means a point every two possessions).
        Greyed rows have fewer than {LOW_N} finished possessions, so read the dots, not the Pts / poss.
        Half bars: grey = finished possessions, blue = had a shot, green = scored.
      </footer>
    </section>
  )
}

const css = `
.pa{--pa-text:#e6edf6;--pa-muted:#8b9ab0;--pa-line:rgba(255,255,255,.07);--pa-scored:#3ddc97;--pa-missed:#4aa3df;--pa-noshot:#56657c;
  color:var(--pa-text);container-type:inline-size;container-name:pa;font-size:16px;line-height:1.4}
.pa *{box-sizing:border-box}
.pa b{font-weight:600}
.pa-muted{color:var(--pa-muted)}
.pa-head{display:flex;justify-content:space-between;gap:16px 24px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px}
.pa-eyebrow{font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:var(--pa-muted);font-weight:600}
.pa-sub{color:var(--pa-muted);font-size:15px;margin-top:6px;max-width:560px}
.pa-legend{display:flex;gap:8px 14px;flex-wrap:wrap;font-size:14px;color:var(--pa-muted)}
.pa-legend span{display:inline-flex;align-items:center;gap:6px}
.pa-row{display:grid;grid-template-columns:var(--pa-cols);column-gap:16px;align-items:center;padding:14px 16px;border-top:1px solid var(--pa-line)}
.pa-row--head{border-top:0;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--pa-muted);font-weight:600;padding-top:4px;padding-bottom:6px}
.pa-row--low .pa-dots,.pa-row--low .pa-half{opacity:.6}
.pa-num{padding:0 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--pa-muted)}
.pa-num__lab,.pa-ppp__lab{display:none}
.pa-halves{display:contents}
.pa-halfcell>[data-half]::before{content:none}
.pa-phase{margin-top:14px;border-radius:12px;overflow:hidden;border:1px solid var(--pa-line);background:rgba(255,255,255,.02)}
.pa-phase .pa-row:first-child{border-top:0}
.pa-phase__head{font-size:19px;font-weight:700;padding:14px 16px;background:rgba(74,163,223,.12);border-left:3px solid var(--pa-missed)}
.pa-phase__head .pa-muted{font-size:14px;font-weight:500}
.pa-phase__explain{font-size:14px;font-weight:400;color:var(--pa-muted);margin-top:4px;max-width:760px}
.pa-row--phase{border-left:3px solid var(--pa-missed);background:rgba(74,163,223,.06);padding-top:16px;padding-bottom:16px}
.pa-row--phase .pa-label__title{font-size:19px;font-weight:700}
.pa-row--sub{border-left:3px solid transparent}
.pa-row--sub .pa-label{padding-left:16px}
.pa-row--sub .pa-label__title{font-weight:500}
.pa-row--counts{grid-template-columns:minmax(210px,1.1fr) 1fr}
.pa-counts{font-size:16px}
.pa-label__title{font-weight:600;display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.pa-label__detail{color:var(--pa-muted);font-size:14px;margin-top:1px}
.pa-chip{font-size:12px;font-weight:600;padding:1px 6px;border-radius:999px;border:1px solid var(--pa-line);color:var(--pa-muted);background:rgba(255,255,255,.04)}
.pa-dots{display:flex;flex-wrap:wrap;gap:${GAP}px;max-width:${18 * (DOT + GAP)}px}
.pa-dot{display:inline-block;flex:none;width:${DOT}px;height:${DOT}px;border-radius:50%}
.pa-dot--scored{background:var(--pa-scored)}
.pa-dot--missed{background:var(--pa-missed)}
.pa-dot--noshot{background:var(--pa-noshot)}
.pa-dot--open{background:transparent;border:1.5px solid var(--pa-noshot)}
.pa-stat{font-size:14px;color:var(--pa-muted);margin-top:9px;font-variant-numeric:tabular-nums}
.pa-stat b{color:var(--pa-text)}
.pa-ppp{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
.pa-ppp__bar{height:7px;border-radius:4px;background:rgba(255,255,255,.08);margin-top:7px;width:100px;max-width:100%;overflow:hidden}
.pa-ppp__bar>div{height:100%;background:var(--pa-scored);border-radius:3px}
.pa-half__track{position:relative;height:12px;max-width:100%;border-radius:2px;background:var(--pa-noshot);overflow:hidden}
.pa-half__shots,.pa-half__scored{position:absolute;left:0;top:0;bottom:0}
.pa-half__shots{background:var(--pa-missed)}
.pa-half__scored{background:var(--pa-scored)}
.pa-half__text{font-size:15px;margin-top:7px;font-variant-numeric:tabular-nums}
.pa-half__sub{font-size:13px;color:var(--pa-muted);margin-top:1px;font-variant-numeric:tabular-nums}
.pa-foot{margin-top:14px;font-size:14px;color:var(--pa-muted)}

/* Below ~900px of card width: each row is a stacked card, no sideways scroll */
@container pa (max-width: 900px){
  .pa-row--head{display:none}
  .pa-row{grid-template-columns:1fr auto;grid-template-areas:"label num" "main main" "ppp ppp" "halves halves";row-gap:12px;padding:14px}
  .pa-row--counts{grid-template-columns:1fr;grid-template-areas:"label" "counts";row-gap:4px}
  .pa-row--counts .pa-label{grid-area:label}.pa-row--counts .pa-counts{grid-area:counts;padding-left:16px}
  .pa-row--sub .pa-label{padding-left:0}
  .pa-label{grid-area:label}
  .pa-num{grid-area:num;padding-right:0;text-align:right;align-self:start}
  .pa-num__lab{display:inline;font-size:13px}
  .pa-main{grid-area:main}
  .pa-dots{max-width:none}
  .pa-pppcell{grid-area:ppp}
  .pa-ppp__row{display:flex;align-items:baseline;gap:10px}
  .pa-ppp__lab{display:inline;font-size:13px;color:var(--pa-muted);text-transform:uppercase;letter-spacing:.06em}
  .pa-ppp__bar{width:100%;max-width:240px}
  .pa-halves{grid-area:halves;display:grid;grid-template-columns:repeat(var(--pa-halves),minmax(0,1fr));gap:16px}
  .pa-halfcell{min-width:0}
  .pa-halfcell>[data-half]::before{content:attr(data-half);display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--pa-muted);margin-bottom:6px}
}
`
