/**
 * Plain-English read of an attacking move (the Paths Taken chart), built from its tagged steps.
 *
 * A step is one saved event: how the move started, each pass or kick, and how it finished. Hand passes are saved as a
 * generic "other" event, so the old wording read "then other (Murphy), then other (Mogan)". This turns the steps into
 * a sentence a coach would say, and names the kind of mistake on a lost ball ("a stray pass to the opposition").
 */

export interface PathStep {
  type: string
  player: string | null
  sub_type?: string | null
}

export interface DescribeOptions {
  /** Surname for a step's player, '' when unknown. */
  name: (step: PathStep) => string
  /** Zone phrase for a step's position, e.g. "midfield on the right", "our 13". */
  where: (step: PathStep) => string
  outcome: string
}

const KICKS = new Set(['long_kick_pass', 'high_ball', 'free_high_ball'])
const PASSES = new Set(['other', 'long_kick_pass', 'high_ball', 'free_short_pass', 'free_high_ball'])

const SCORED: Record<string, string> = {
  goal: 'a goal', penalty_goal: 'a penalty goal', point: 'a point', two_point: 'a two-pointer',
  point_free: 'a pointed free', two_point_free: 'a two-pointed free', forty_five: 'a 45',
}

/** What a lost ball was, in the words a coach uses (subject is added by the caller). */
const LOSS_PHRASE: Record<string, string> = {
  stray_pass: 'played a stray pass to the opposition',
  dropped_ball: 'dropped the ball',
  miscue: 'miscued it',
  kick_over_sideline: 'kicked it over the sideline',
  square_ball: 'was penalised for a square ball',
  three_v_three: 'was penalised for a 3v3 breach',
  time_wasting: 'was penalised for time wasting',
  overcarrying: 'overcarried it',
  picked_off_ground: 'picked it off the ground',
  strip: 'was stripped of the ball',
  tackle: 'was tackled and lost it',
  forced_interception: 'had the pass intercepted under pressure',
}

const joinNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** How a move started: who got the ball and how. */
function opening(first: PathStep, name: string, zone: string): string {
  const who = name || ''
  const at = zone ? ` in ${zone}` : ''
  switch (first.type) {
    case 'own_kickout_won':
    case 'own_kickout_won_break':
    case 'kickout_won':
      return who ? `${who} won the kickout${at}` : `The kickout was won${at}`
    case 'opp_kickout_won':
    case 'opp_kickout_won_break':
      return who ? `${who} won their kickout${at}` : `Their kickout was won${at}`
    case 'turnover_won':
      return who ? `${who} won a turnover${at}` : `A turnover was won${at}`
    case 'interception':
      return who ? `${who} intercepted the ball${at}` : `The ball was intercepted${at}`
    case 'tackle_won':
      return who ? `${who} won it with a tackle${at}` : `It was won with a tackle${at}`
    case 'block':
      return who ? `${who} blocked it${at}` : `It was blocked${at}`
    case 'breaking_ball_won':
      return who ? `${who} won the breaking ball${at}` : `The breaking ball was won${at}`
    case 'free_won':
    case 'foul_won':
      return who ? `${who} won a free${at}` : `A free was won${at}`
    default:
      return who ? `${who} started the move${at}` : `The move started${at}`
  }
}

/** One pass or kick, narrated. */
function narrate(step: PathStep, name: string): string {
  const who = name || 'It'
  switch (step.type) {
    case 'long_kick_pass': return name ? `${name} kicked it long` : 'It was kicked long'
    case 'high_ball': return name ? `${name} played a high ball` : 'A high ball was played'
    case 'free_short_pass': return name ? `${name} took the free short` : 'The free was taken short'
    case 'free_high_ball': return name ? `${name} took the free high into the box` : 'The free was played high'
    default: return name ? `${name} passed it` : who === 'It' ? 'It was passed' : `${who} passed it`
  }
}

function finish(steps: PathStep[], opts: DescribeOptions): string {
  const last = steps[steps.length - 1]
  const who = opts.name(last)
  const zone = opts.where(last)
  const outcome = opts.outcome
  if (SCORED[outcome]) return `${who ? `${who} finished` : 'It finished'} with ${SCORED[outcome]} from ${zone}`
  if (outcome === 'wide' || outcome === 'wide_free') return `${who ? `${who} put it wide` : 'It went wide'} from ${zone}`
  if (outcome === 'short') return `${who ? `${who}'s shot` : 'The shot'} dropped short from ${zone}`
  if (outcome === 'saved') return `${who ? `${who}'s shot` : 'The shot'} was saved from ${zone}`
  if (outcome === 'turnover_lost' || outcome === 'unforced_error') {
    const phrase = (last.sub_type && LOSS_PHRASE[last.sub_type])
      || (outcome === 'unforced_error' ? 'gave it away with an unforced error' : 'lost the ball')
    return who ? `${who} ${phrase} in ${zone}` : `The ball was lost in ${zone}`
  }
  return `${outcome.replace(/_/g, ' ')}${who ? ` (${who})` : ''} at ${zone}`
}

/** The whole sentence for a move. Returns null for a move with no steps. */
export function describeMove(steps: PathStep[], opts: DescribeOptions): string | null {
  if (!steps.length) return null
  if (steps.length === 1) {
    const only = finish(steps, opts)
    return `${only.charAt(0).toUpperCase()}${only.slice(1)}.`
  }

  const first = steps[0]
  const last = steps[steps.length - 1]
  const firstName = opts.name(first)
  const lastName = opts.name(last)

  const parts: string[] = [opening(first, firstName, opts.where(first))]

  // Every step before the finish that is a pass or a kick (the starting event itself is not one)
  const moves = steps.slice(first.type === 'other' || PASSES.has(first.type) ? 0 : 1, -1).filter(s => PASSES.has(s.type))

  if (moves.length > 0 && moves.length <= 2) {
    // the player who won it and then passed it: "Campbell won a turnover in midfield and passed it"
    let rest = moves
    if (firstName && moves[0].type === 'other' && opts.name(moves[0]) === firstName && first.type !== 'other') {
      parts[0] = `${parts[0]} and passed it`
      rest = moves.slice(1)
    }
    if (rest.length) parts.push(rest.map(m => narrate(m, opts.name(m))).join(', then '))
  } else if (moves.length > 2) {
    const kicks = moves.filter(m => KICKS.has(m.type)).length
    const seen = new Set<string>()
    const through: string[] = []
    for (const m of moves) {
      const n = opts.name(m)
      if (n && n !== firstName && n !== lastName && !seen.has(n)) { seen.add(n); through.push(n) }
    }
    const finalPasser = opts.name(moves[moves.length - 1])
    let line = `${moves.length} passes`
    if (kicks > 0) line += ` (${kicks} kicked)`
    if (through.length > 0) line += ` through ${joinNames(through)}`
    if (finalPasser && finalPasser !== lastName) line += `, with ${finalPasser} making the final pass`
    parts.push(line)
  }

  parts.push(finish(steps, opts))
  return parts.map(p => (p.endsWith('.') ? p : `${p}.`)).join(' ')
}

/** Label for one step in the numbered chain: "Pass (Murphy)", "Stray pass (Mulreany)"; null = use the normal label. */
export function stepLabel(step: PathStep, name: string): string | null {
  let label: string | null = null
  if (step.type === 'other') label = 'Pass'
  else if ((step.type === 'unforced_error' || step.type === 'turnover_lost') && step.sub_type && LOSS_PHRASE[step.sub_type]) {
    label = step.sub_type.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
  }
  if (!label) return null
  return name ? `${label} (${name})` : label
}
