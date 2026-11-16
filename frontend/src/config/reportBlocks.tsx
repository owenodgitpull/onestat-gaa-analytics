/**
 * Report blocks: every chart and table that can go into a PDF report, grouped into sections. A block renders the SAME
 * component the screens use (Match Result page charts, GPS tabs), so the report always matches what the coach sees.
 * A block returns null when its data is missing (e.g. GPS blocks on a match without a synced GPS file) and is then left
 * out of the report, title and all.
 */
import type { ReactNode } from 'react'
import type { MatchReportData } from '@/hooks/useMatchReportData'
import { renderAnalysisText } from '@/utils/renderAnalysisText'
import MatchStatsPanel from '@/components/MatchStatsPanel'
import ScoringTimeline from '@/components/charts/ScoringTimeline'
import ShotOutcomeChart from '@/components/charts/ShotOutcomeChart'
import KickoutSequence from '@/components/charts/KickoutSequence'
import MatchKickoutZones from '@/components/charts/MatchKickoutZones'
import MatchKickoutOutcomes from '@/components/charts/MatchKickoutOutcomes'
import ScoringZoneMap from '@/components/charts/ScoringZoneMap'
import TurnoverMap from '@/components/charts/TurnoverMap'
import ShootingEfficiencyHeatmap from '@/components/charts/ShootingEfficiencyHeatmap'
import ExpectedPointsCard from '@/components/charts/ExpectedPointsCard'
import ScoreOrigins from '@/components/charts/ScoreOrigins'
import ScoreableFreesAnalysis from '@/components/charts/ScoreableFreesAnalysis'
import AttackEfficiencyCard from '@/components/charts/AttackEfficiencyCard'
import SeasonBenchmarkCard from '@/components/charts/SeasonBenchmarkCard'
import PossessionTerritoryChart from '@/components/charts/PossessionTerritoryChart'
import AttackingThirdsChart from '@/components/charts/AttackingThirdsChart'
import PathsTakenChart from '@/components/charts/PathsTakenChart'
import {
  OverviewView, ShapeView, TransitionsView, KickoutsView, IntensityView, HeatmapView, SupportView, MarkingView, MomentsView,
} from '@/components/gps/GpsAnalysisViews'
import { TeamVolumeChart, TeamIntensityGauge, PlayerDistanceChart, PlayerWorkloadChart } from '@/pages/MatchResult'

export interface MatchBlockCtx { d: MatchReportData; team: string; opponent: string }

export interface ReportBlock {
  id: string
  section: string
  label: string
  /** full = the whole page width; half = two side by side */
  size: 'full' | 'half'
  needsGps?: boolean
  render: (c: MatchBlockCtx) => ReactNode | null
}

const noop = () => {}

export const MATCH_SECTIONS = ['Summary', 'Scoring', 'Possession & territory', 'Kickouts', 'Turnovers & transitions', 'Shape', 'Shots against', 'Running', 'Passing support', 'Key moments'] as const

export const MATCH_BLOCKS: ReportBlock[] = [
  // Summary
  { id: 'ai-summary', section: 'Summary', label: 'Match analysis', size: 'full',
    render: ({ d }) => (d.report?.analysis ? <div className="glass-card p-6 text-[15px] leading-relaxed">{renderAnalysisText(d.report.analysis)}</div> : null) },
  { id: 'match-stats', section: 'Summary', label: 'Match statistics', size: 'half',
    render: ({ d, team, opponent }) => (d.stats ? <MatchStatsPanel matchStats={d.stats} clubName={team} opponentName={opponent} hasEvents={d.events.length > 0} onOpenExtraStats={noop} /> : null) },
  { id: 'season-benchmark', section: 'Summary', label: 'Against our season average', size: 'half',
    render: ({ d, team }) => (d.seasonBenchmark ? <SeasonBenchmarkCard data={d.seasonBenchmark} teamName={team} /> : null) },
  // Scoring
  { id: 'scoring-timeline', section: 'Scoring', label: 'Scoring timeline', size: 'half',
    render: ({ d, team, opponent }) => (d.events.length ? <ScoringTimeline events={d.events} opponent={opponent} teamName={team} insight={d.report?.insights?.scoring} /> : null) },
  { id: 'shot-outcomes', section: 'Scoring', label: 'Shot outcomes', size: 'half',
    render: ({ d, opponent }) => (d.events.length ? <ShotOutcomeChart events={d.events} opponent={opponent} insight={d.report?.insights?.shooting} /> : null) },
  { id: 'scoring-zone-map', section: 'Scoring', label: 'Scoring zone map', size: 'half',
    render: ({ d, team, opponent }) => (d.events.length ? <ScoringZoneMap events={d.events} teamName={team || 'Us'} opponent={opponent} /> : null) },
  { id: 'shooting-efficiency', section: 'Scoring', label: 'Shooting efficiency', size: 'half',
    render: ({ d }) => (d.shotLocations.length ? <ShootingEfficiencyHeatmap shots={d.shotLocations} /> : null) },
  { id: 'expected-points', section: 'Scoring', label: 'Expected points', size: 'full',
    render: ({ d, team, opponent }) => (d.match ? <ExpectedPointsCard matchId={d.match.id} teamName={team} opponentName={opponent} /> : null) },
  { id: 'score-origins', section: 'Scoring', label: 'Score origins', size: 'half',
    render: ({ d, team, opponent }) => (d.scoreOrigins ? <div className="h-[380px] [&_.glass-card]:h-full"><ScoreOrigins data={d.scoreOrigins} teamName={team} opponentName={opponent} /></div> : null) },
  { id: 'attack-efficiency', section: 'Scoring', label: 'Attack efficiency', size: 'half',
    render: ({ d, team, opponent }) => (d.attackEfficiency ? <AttackEfficiencyCard data={d.attackEfficiency} teamName={team} opponentName={opponent} /> : null) },
  { id: 'scoreable-frees', section: 'Scoring', label: 'Scoreable frees', size: 'half',
    render: ({ d, team }) => (d.scoreableFrees ? <ScoreableFreesAnalysis data={d.scoreableFrees} teamName={team} /> : null) },
  // Possession & territory
  { id: 'possession-territory', section: 'Possession & territory', label: 'Possession & territory', size: 'half',
    render: ({ d, opponent }) => (d.match && d.events.length ? <PossessionTerritoryChart stats={d.stats} events={d.events} matchId={d.match.id} opponent={opponent} insight={d.report?.insights?.possession} attackingRightFirstHalf={d.match.attacking_right_first_half} halfDurationMins={d.match.half_duration_mins || 30} /> : null) },
  { id: 'paths-taken', section: 'Possession & territory', label: 'Paths taken', size: 'half',
    render: ({ d }) => (d.match && d.events.length ? <PathsTakenChart matchId={d.match.id} /> : null) },
  { id: 'attacking-thirds', section: 'Possession & territory', label: 'Attacking thirds', size: 'full',
    render: ({ d, opponent }) => (d.match && d.events.length ? <AttackingThirdsChart matchId={d.match.id} opponent={opponent} events={d.events} attackingRightFirstHalf={d.match.attacking_right_first_half} halfDurationMins={d.match.half_duration_mins || 30} /> : null) },
  { id: 'turnover-map', section: 'Possession & territory', label: 'Possession battle map', size: 'half',
    render: ({ d, team }) => (d.match && d.events.length ? <TurnoverMap events={d.events} teamName={team || 'Us'} attackingRightFirstHalf={d.match.attacking_right_first_half} halfDurationMins={d.match.half_duration_mins} /> : null) },
  // Kickouts
  { id: 'kickout-sequence', section: 'Kickouts', label: 'Kickout sequence', size: 'full',
    render: ({ d, team, opponent }) => (d.events.length ? <KickoutSequence events={d.events} teamName={team} opponentName={opponent} halfDurationMins={d.match?.half_duration_mins} /> : null) },
  { id: 'kickout-zones', section: 'Kickouts', label: 'Kickout zones', size: 'half',
    render: ({ d, team, opponent }) => (d.events.length ? <MatchKickoutZones events={d.events} attackingRightFirstHalf={d.match?.attacking_right_first_half} halfDurationMins={d.match?.half_duration_mins} teamName={team} opponentName={opponent} /> : null) },
  { id: 'kickout-outcomes', section: 'Kickouts', label: 'Kickout outcomes', size: 'half',
    render: ({ d, team, opponent }) => (d.events.length ? <MatchKickoutOutcomes events={d.events} teamName={team} opponentName={opponent} /> : null) },
  { id: 'gps-kickouts-own', section: 'Kickouts', label: 'Our kickouts: who stood where (GPS)', size: 'full', needsGps: true,
    render: ({ d, team }) => (d.gpsAnalysis && d.gpsCtx ? <KickoutsView a={d.gpsAnalysis} periods={d.gpsCtx.periods} onOpen={noop} team={team} matchId={d.gpsCtx.match_id} initialKind="own" /> : null) },
  { id: 'gps-kickouts-opp', section: 'Kickouts', label: 'Their kickouts: who stood where (GPS)', size: 'full', needsGps: true,
    render: ({ d, team }) => (d.gpsAnalysis && d.gpsCtx ? <KickoutsView a={d.gpsAnalysis} periods={d.gpsCtx.periods} onOpen={noop} team={team} matchId={d.gpsCtx.match_id} initialKind="opp" /> : null) },
  // Turnovers & transitions
  { id: 'gps-overview', section: 'Turnovers & transitions', label: 'GPS overview', size: 'full', needsGps: true,
    render: ({ d }) => (d.gpsAnalysis && d.gpsCtx ? <OverviewView a={d.gpsAnalysis} periods={d.gpsCtx.periods} onOpen={noop} /> : null) },
  { id: 'gps-transitions', section: 'Turnovers & transitions', label: 'Transitions: getting back and breaking forward', size: 'full', needsGps: true,
    render: ({ d, team }) => (d.gpsAnalysis && d.gpsCtx ? <TransitionsView a={d.gpsAnalysis} periods={d.gpsCtx.periods} onOpen={noop} team={team} /> : null) },
  // Shape
  { id: 'gps-shape', section: 'Shape', label: 'Team shape', size: 'full', needsGps: true,
    render: ({ d }) => (d.gpsAnalysis && d.gpsCtx ? <ShapeView matchId={d.gpsCtx.match_id} a={d.gpsAnalysis} periods={d.gpsCtx.periods} onOpen={noop} /> : null) },
  { id: 'gps-heatmap', section: 'Shape', label: 'Where we played (heat map)', size: 'full', needsGps: true,
    render: ({ d, team }) => (d.gpsCtx ? <HeatmapView matchId={d.gpsCtx.match_id} ctx={d.gpsCtx} team={team} /> : null) },
  // Shots against
  { id: 'gps-shots-against', section: 'Shots against', label: 'Pressure on their shots', size: 'full', needsGps: true,
    render: ({ d, opponent }) => (d.gpsAnalysis && d.gpsCtx ? <MarkingView a={d.gpsAnalysis} periods={d.gpsCtx.periods} onOpen={noop} opponent={opponent} /> : null) },
  // Running
  { id: 'gps-running', section: 'Running', label: 'Running by player', size: 'full', needsGps: true,
    render: ({ d }) => (d.gpsAnalysis ? <IntensityView a={d.gpsAnalysis} /> : null) },
  { id: 'team-volume', section: 'Running', label: 'Team volume (5-min)', size: 'half',
    render: ({ d }) => (d.gps.length ? <TeamVolumeChart gpsData={d.gps as any} events={d.events} volumeData={d.teamVolume} /> : null) },
  { id: 'team-intensity', section: 'Running', label: 'Team intensity', size: 'half',
    render: ({ d }) => (d.gps.length ? <TeamIntensityGauge gpsData={d.gps as any} /> : null) },
  { id: 'player-distance', section: 'Running', label: 'Player distance', size: 'half',
    render: ({ d }) => (d.gps.length ? <PlayerDistanceChart gpsData={d.gps as any} lineupData={d.lineup as any} /> : null) },
  { id: 'player-workload', section: 'Running', label: 'Player workload', size: 'half',
    render: ({ d }) => (d.gps.length ? <PlayerWorkloadChart gpsData={d.gps as any} lineupData={d.lineup as any} /> : null) },
  // Passing support
  { id: 'gps-support', section: 'Passing support', label: 'Help for the man on the ball', size: 'full', needsGps: true,
    render: ({ d }) => (d.gpsAnalysis && d.gpsCtx ? <SupportView a={d.gpsAnalysis} periods={d.gpsCtx.periods} onOpen={noop} /> : null) },
  // Key moments
  { id: 'gps-moments', section: 'Key moments', label: 'Key moments', size: 'full', needsGps: true,
    render: ({ d }) => (d.gpsAnalysis && d.gpsCtx ? <MomentsView a={d.gpsAnalysis} periods={d.gpsCtx.periods} onOpen={noop} /> : null) },
]

/** Built-in templates: an ordered list of block ids. */
export const MATCH_TEMPLATES: Record<string, { label: string; description: string; blocks: string[] }> = {
  'post-match': {
    label: 'Post-match report',
    description: 'Everything on the Match Result page and every GPS tab, with a short read under each section.',
    blocks: MATCH_BLOCKS.map(b => b.id),
  },
}
