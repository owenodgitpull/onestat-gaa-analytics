// A macro-level GAA turnover splits into three distinct reasons, each with a
// different real-world meaning (and a different event_type/consequence):
//  - Active Dispossession: the opposition actively won it (tackle/strip/
//    forced interception) — a genuine forced turnover, TURNOVER_LOST, no
//    free conceded.
//  - Unforced Error: our own mistake with no defensive pressure (stray
//    pass, dropped ball, miscue) — OUR_UNFORCED_ERROR, no free conceded.
//  - Offensive Foul: a technical infringement by the carrier (overcarrying,
//    picking the ball off the ground) — this concedes a free, same as any
//    other foul, so it's recorded as FOUL_COMMITTED, not a turnover type.
// Before this, "T/O Lost" recorded a bare TURNOVER_LOST with no way to
// capture which of these actually happened, and overcarrying/picked-off-
// ground were miscategorised as "unforced error" subtypes even though
// they're fouls that concede a free, not a general-play turnover.
//
// Shared between live match recording (MatchRecording.tsx) and video
// tagging (VideoTagging.tsx) so the two pickers can never drift apart.

export interface SubtypeOption {
  value: string
  label: string
}

export const UNFORCED_ERROR_SUBTYPES: SubtypeOption[] = [
  { value: 'stray_pass', label: 'Stray Pass' },
  { value: 'dropped_ball', label: 'Dropped Ball' },
  { value: 'miscue', label: 'Miscue' },
  { value: 'kick_over_sideline', label: 'Kicked Over Sideline' },
  { value: 'square_ball', label: 'Square Ball' },
  { value: 'three_v_three', label: '3v3 Violation' },
  { value: 'time_wasting', label: 'Time Wasting' },
]

export const DISPOSSESSION_SUBTYPES: SubtypeOption[] = [
  { value: 'strip', label: 'Strip' },
  { value: 'tackle', label: 'Tackle' },
  { value: 'forced_interception', label: 'Forced Interception' },
]

export const OFFENSIVE_FOUL_SUBTYPES: SubtypeOption[] = [
  { value: 'overcarrying', label: 'Overcarrying' },
  { value: 'picked_off_ground', label: 'Picked Off Ground' },
]

export const FOUL_SUBTYPES: SubtypeOption[] = [
  { value: 'pushing', label: 'Pushing' },
  { value: 'pulling', label: 'Pulling' },
  { value: 'charging', label: 'Charging' },
  { value: 'late_tackle', label: 'Late Tackle' },
  { value: 'jersey_pull', label: 'Jersey Pull' },
  { value: 'obstruction', label: 'Obstruction' },
  { value: 'dissent', label: 'Dissent' },
]

/** The three turnover-reason choices shown by the reason picker before a
 * subtype is chosen — mirrors handleTurnoverReasonSelected's mapping in
 * MatchRecording.tsx. */
export type TurnoverReason = 'dispossession' | 'unforced' | 'offensive_foul'

export const TURNOVER_REASON_CONFIG: Record<
  TurnoverReason,
  { eventType: string; foulMode: boolean; subtypeOptions: SubtypeOption[]; label: string }
> = {
  dispossession: { eventType: 'turnover_lost', foulMode: false, subtypeOptions: DISPOSSESSION_SUBTYPES, label: 'Active Dispossession' },
  unforced: { eventType: 'unforced_error', foulMode: false, subtypeOptions: UNFORCED_ERROR_SUBTYPES, label: 'Unforced Error' },
  offensive_foul: { eventType: 'foul_committed', foulMode: true, subtypeOptions: OFFENSIVE_FOUL_SUBTYPES, label: 'Offensive Foul' },
}
