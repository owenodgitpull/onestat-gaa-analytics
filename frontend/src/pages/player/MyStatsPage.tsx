import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { playerPortalAPI } from '../../services/playerPortalApi';
import type {
  GPSEntry, AttendanceSummary, PlayerMatchStatRow, ShotEvent,
} from '../../services/playerPortalApi';
import { useClub } from '../../contexts/ClubContext';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ComposedChart, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ReferenceArea, ReferenceLine,
} from 'recharts';
import {
  Crosshair, Activity, Shield, CalendarCheck, Sparkles, Flame,
  Trophy, X, Search, ArrowLeftRight, Target, BookOpen, Check, ChevronDown, Moon,
} from 'lucide-react';
import ChartZoomModal from '../../components/ChartZoomModal';
import SleepTracker from '../../components/player/SleepTracker';

const TABS = [
  { key: 'scoring', label: 'Scoring', icon: Crosshair },
  { key: 'gps', label: 'GPS', icon: Activity },
  { key: 'fitness', label: 'Fitness', icon: Activity },
  { key: 'defence', label: 'Defence', icon: Shield },
  { key: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { key: 'sleep', label: 'Sleep', icon: Moon },
];

const TOOLTIP_STYLE = {
  contentStyle: { background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' },
  labelStyle: { color: 'rgba(255,255,255,0.7)' },
};

export default function MyStatsPage() {
  const [activeTab, setActiveTab] = useState('scoring');
  const [showH2H, setShowH2H] = useState(false);
  const { club, logoUrl } = useClub();

  return (
    <div className="space-y-5 pb-4">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-40 -mx-4 px-4 pt-3 pb-3 mb-1"
        style={{
          background: 'linear-gradient(180deg, rgba(10,10,25,0.98) 0%, rgba(10,10,25,0.92) 80%, rgba(10,10,25,0) 100%)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {logoUrl && (
              <img
                src={logoUrl}
                alt=""
                className="h-9 w-9 rounded-lg object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">My Stats</h1>
              {club?.name && (
                <p className="text-[11px] text-white/35 font-medium leading-tight">{club.name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowH2H(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/5 border border-white/10 transition-all"
            >
              <ArrowLeftRight size={12} />
              Compare
            </button>
            <img
              src="/oneStatLogoTransparent.png"
              alt="OneStat"
              className="h-7 object-contain opacity-90"
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                active
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'text-white/50 hover:text-white/70 hover:bg-white/5 border border-transparent'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'scoring' && <ScoringTab />}
      {activeTab === 'gps' && <GPSTab />}
      {activeTab === 'fitness' && <FitnessTab />}
      {activeTab === 'defence' && <DefenceTab />}
      {activeTab === 'attendance' && <AttendanceTab />}
      {activeTab === 'sleep' && <SleepTracker />}

      {showH2H && <HeadToHeadOverlay onClose={() => setShowH2H(false)} />}
    </div>
  );
}

// ---- Scoring Tab ----
function ScoringTab() {
  const [expandedMatchIdx, setExpandedMatchIdx] = useState<number | null>(null);

  const { data: matchData, isLoading: matchLoading } = useQuery({
    queryKey: ['player-match-stats'],
    queryFn: playerPortalAPI.getMyMatchStats,
  });
  const { data: shotData, isLoading: shotLoading } = useQuery({
    queryKey: ['player-shots'],
    queryFn: playerPortalAPI.getMyShots,
  });
  const { data: gpsData } = useQuery({
    queryKey: ['player-gps'],
    queryFn: playerPortalAPI.getMyGPS,
  });
  const { data: attData } = useQuery<AttendanceSummary>({
    queryKey: ['player-attendance'],
    queryFn: playerPortalAPI.getMyAttendance,
  });

  if (matchLoading || shotLoading) return <LoadingState />;

  const matches = matchData?.matches || [];
  const shots = shotData?.shots || [];
  const gpsEntries = gpsData?.gps_entries || [];

  // Scoring trend data (reverse so oldest first)
  const trendData = [...matches].reverse().map((m) => ({
    opponent: m.opponent.slice(0, 8),
    score: m.total_score_value,
    goals: m.goals * 3,
    points: m.points,
    twoPointers: m.two_pointers * 2,
  }));

  // Shot outcomes
  const scoreShots = shots.filter((s) => ['goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five', 'penalty_goal'].includes(s.event_type));
  const missShots = shots.filter((s) => ['wide', 'short', 'saved', 'wide_free', 'forty_five_missed', 'penalty_miss'].includes(s.event_type));

  // Scoring streak
  const scoringStreak = computeScoringStreak(matches);

  // Personal best match score
  const bestMatch = matches.reduce<{ score: number; opponent: string } | null>((best, m) => {
    if (!best || m.total_score_value > best.score) return { score: m.total_score_value, opponent: m.opponent };
    return best;
  }, null);

  // Radar data
  const radarData = computeRadarData(matches, gpsEntries, attData);

  // Match drill-down: trendData[i] maps to matches[matches.length - 1 - i]
  const expandedMatch = expandedMatchIdx != null
    ? matches[matches.length - 1 - expandedMatchIdx]
    : null;

  return (
    <div className="space-y-5">
      {/* AI Insights */}
      <AIInsightsCard />

      {/* Season Story */}
      <SeasonStoryCard />

      {/* Challenges */}
      <ChallengesCard />

      {/* Streak + PB row */}
      <div className="grid grid-cols-2 gap-3">
        {scoringStreak > 0 && (
          <div className="rounded-xl px-3 py-3 text-center" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(239,68,68,0.08))', border: '1px solid rgba(245,158,11,0.2)' }}>
            <Flame size={16} className="text-amber-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-amber-400">{scoringStreak}</div>
            <div className="text-[10px] text-white/40 uppercase">Scoring Streak</div>
          </div>
        )}
        {bestMatch && (
          <div className="rounded-xl px-3 py-3 text-center" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(6,182,212,0.08))', border: '1px solid rgba(16,185,129,0.2)' }}>
            <Trophy size={16} className="text-emerald-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-emerald-400">{bestMatch.score}pts</div>
            <div className="text-[10px] text-white/40 uppercase">PB vs {bestMatch.opponent.slice(0, 10)}</div>
          </div>
        )}
      </div>

      {/* Player DNA Radar */}
      {radarData.length > 0 && (
        <ChartCard title="Player DNA" subtitle="Normalized 0-100 across 6 dimensions">
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.12)" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="value" stroke="#10b981" fill="#10b981" fillOpacity={0.35} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Shot Map with tooltips */}
      <ShotMapCard shots={shots} scoreShots={scoreShots} missShots={missShots} />

      {/* Scoring Trend — tap a bar for match breakdown */}
      {trendData.length > 1 && (
        <ChartCard title="Scoring Trend" subtitle="Tap a bar for match breakdown">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart
              data={trendData}
              onClick={(state: any) => {
                if (state?.activeTooltipIndex != null) {
                  setExpandedMatchIdx((prev) =>
                    prev === state.activeTooltipIndex ? null : state.activeTooltipIndex
                  );
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="opponent" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              {expandedMatchIdx != null && (
                <ReferenceArea
                  x1={trendData[expandedMatchIdx]?.opponent}
                  x2={trendData[expandedMatchIdx]?.opponent}
                  fill="#10b981"
                  fillOpacity={0.1}
                  stroke="#10b981"
                  strokeOpacity={0.3}
                />
              )}
              <Bar dataKey="goals" stackId="a" fill="#f59e0b" name="Goals" radius={[0, 0, 0, 0]} />
              <Bar dataKey="points" stackId="a" fill="#10b981" name="Points" radius={[0, 0, 0, 0]} />
              <Bar dataKey="twoPointers" stackId="a" fill="#06b6d4" name="2-Pointers" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="score" stroke="#10b981" strokeWidth={2} dot={false} name="Total" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Match Detail Card — expanded from chart tap */}
      {expandedMatch && <MatchDetailCard match={expandedMatch} />}

      {/* Match Log */}
      <ChartCard title="Match Log">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/40 border-b border-white/10">
                <th className="text-left py-2 pr-2">Opponent</th>
                <th className="text-center px-1">G</th>
                <th className="text-center px-1">P</th>
                <th className="text-center px-1">2pt</th>
                <th className="text-center px-1">W</th>
                <th className="text-center px-1">Total</th>
              </tr>
            </thead>
            <tbody>
              {matches.slice(0, 10).map((m) => (
                <tr key={m.match_id} className="border-b border-white/5">
                  <td className="py-2 pr-2 text-white/70">{m.opponent}</td>
                  <td className="text-center text-amber-400 font-medium">{m.goals || '-'}</td>
                  <td className="text-center text-emerald-400">{m.points || '-'}</td>
                  <td className="text-center text-cyan-400">{m.two_pointers || '-'}</td>
                  <td className="text-center text-red-400/60">{m.wides || '-'}</td>
                  <td className="text-center text-white font-bold">{m.total_score_value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

// ---- Season Story Card (collapsible) ----
function SeasonStoryCard() {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['player-season-story'],
    queryFn: playerPortalAPI.getSeasonStory,
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl p-4 animate-pulse" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(16,185,129,0.04))', border: '1px solid rgba(6,182,212,0.15)' }}>
        <div className="flex items-center gap-2 mb-2">
          <BookOpen size={14} className="text-cyan-400" />
          <span className="text-xs font-semibold text-cyan-300">Season Story</span>
        </div>
        <div className="space-y-2">
          <div className="h-3 rounded bg-white/5 w-5/6" />
          <div className="h-3 rounded bg-white/5 w-4/5" />
        </div>
      </div>
    );
  }

  if (!data?.story) return null;

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(16,185,129,0.04))',
        border: '1px solid rgba(6,182,212,0.15)',
      }}
    >
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-cyan-400" />
          <span className="text-xs font-semibold text-cyan-300">Season Story</span>
        </div>
        <ChevronDown
          size={14}
          className={`text-cyan-400/50 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <p className="text-xs text-white/70 leading-relaxed italic mt-2.5">
          &ldquo;{data.story}&rdquo;
        </p>
      )}
    </div>
  );
}

// ---- Challenges Card ----
function ChallengesCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['player-challenges'],
    queryFn: playerPortalAPI.getMyChallenges,
    staleTime: 5 * 60 * 1000, // 5 min
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl p-4 animate-pulse" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(239,68,68,0.04))', border: '1px solid rgba(245,158,11,0.15)' }}>
        <div className="flex items-center gap-2 mb-2">
          <Target size={14} className="text-amber-400" />
          <span className="text-xs font-semibold text-amber-300">Weekly Challenges</span>
        </div>
        <div className="space-y-3">
          <div className="h-12 rounded bg-white/5" />
          <div className="h-12 rounded bg-white/5" />
        </div>
      </div>
    );
  }

  const challenges = data?.challenges || [];
  if (challenges.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(239,68,68,0.04))',
        border: '1px solid rgba(245,158,11,0.15)',
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Target size={14} className="text-amber-400" />
        <span className="text-xs font-semibold text-amber-300">Weekly Challenges</span>
      </div>
      <div className="space-y-3">
        {challenges.map((c) => {
          const isComplete = c.status === 'completed';
          const pct = c.progress_pct;
          const daysLeft = c.expires_at
            ? Math.max(0, Math.ceil((new Date(c.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
            : null;

          return (
            <div key={c.id} className="flex items-center gap-3">
              {/* Progress Ring */}
              <div className="shrink-0 relative w-10 h-10">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                  <circle
                    cx="18" cy="18" r="15" fill="none"
                    stroke={isComplete ? '#10b981' : '#f59e0b'}
                    strokeWidth="3"
                    strokeDasharray={`${(pct / 100) * 94.25} 94.25`}
                    strokeLinecap="round"
                  />
                </svg>
                {isComplete && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Check size={14} className="text-emerald-400" />
                  </div>
                )}
                {!isComplete && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-white/60">{Math.round(pct)}%</span>
                  </div>
                )}
              </div>
              {/* Text */}
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium leading-tight ${isComplete ? 'text-emerald-400 line-through' : 'text-white/80'}`}>
                  {c.title}
                </div>
                <div className="text-[10px] text-white/40 mt-0.5">
                  {isComplete ? 'Completed!' : (
                    <>
                      {Math.round(pct)}%{daysLeft != null && ` — expires in ${daysLeft}d`}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Match Detail Card (from chart tap) ----
function MatchDetailCard({ match }: { match: PlayerMatchStatRow }) {
  const resultColor = match.result === 'W' ? 'text-emerald-400' : match.result === 'L' ? 'text-red-400' : 'text-amber-400';
  const total = match.goals * 3 + match.points + match.two_pointers * 2;

  return (
    <div
      className="rounded-xl p-4 animate-in slide-in-from-top-2 duration-200"
      style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(6,182,212,0.04))',
        border: '1px solid rgba(16,185,129,0.2)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-white">{match.opponent}</div>
          <div className="text-[10px] text-white/40">{match.match_date}</div>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${resultColor} bg-white/5`}>
          {match.result || '—'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <MatchDetailStat label="Goals" value={match.goals} color="text-amber-400" />
        <MatchDetailStat label="Points" value={match.points} color="text-emerald-400" />
        <MatchDetailStat label="2pts" value={match.two_pointers} color="text-cyan-400" />
        <MatchDetailStat label="Frees" value={match.frees} color="text-purple-400" />
        <MatchDetailStat label="Wides" value={match.wides} color="text-red-400" />
        <MatchDetailStat label="TO Won" value={match.turnovers_won} color="text-emerald-400" />
        <MatchDetailStat label="TO Lost" value={match.turnovers_lost} color="text-red-400" />
        <MatchDetailStat label="Total" value={total} color="text-white" bold />
      </div>
    </div>
  );
}

function MatchDetailStat({ label, value, color, bold }: {
  label: string; value: number; color: string; bold?: boolean;
}) {
  return (
    <div className="text-center py-1">
      <div className="text-[9px] text-white/40 uppercase">{label}</div>
      <div className={`text-sm ${bold ? 'font-bold' : 'font-medium'} ${color}`}>{value}</div>
    </div>
  );
}

// ---- Shot Type Labels ----
const SHOT_TYPE_LABELS: Record<string, string> = {
  goal: 'Goal',
  point: 'Point',
  two_point: '2-Pointer',
  point_free: 'Free',
  two_point_free: '2pt Free',
  forty_five: '45',
  penalty_goal: 'Penalty',
  wide: 'Wide',
  short: 'Short',
  saved: 'Saved',
  wide_free: 'Wide Free',
  forty_five_missed: '45 Missed',
  penalty_miss: 'Pen Miss',
};

const SHOT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'goals', label: 'Goals', types: ['goal', 'penalty_goal'] },
  { key: 'points', label: 'Points', types: ['point', 'point_free', 'forty_five'] },
  { key: '2pts', label: '2-Ptrs', types: ['two_point', 'two_point_free'] },
  { key: 'wides', label: 'Wides', types: ['wide', 'wide_free', 'forty_five_missed'] },
  { key: 'scored', label: 'Scored', types: ['goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five', 'penalty_goal'] },
  { key: 'missed', label: 'Missed', types: ['wide', 'short', 'saved', 'wide_free', 'forty_five_missed', 'penalty_miss'] },
];

// ---- Shot Map with Tooltips + Filters ----
function ShotMapCard({ shots, scoreShots, missShots }: {
  shots: ShotEvent[];
  scoreShots: ShotEvent[];
  missShots: ShotEvent[];
}) {
  const [selectedShot, setSelectedShot] = useState<ShotEvent | null>(null);
  const [activeFilter, setActiveFilter] = useState('all');

  const toSvgX = (pct: number) => (pct / 100) * 1960 + 183;
  const toSvgY = (pct: number) => (pct / 100) * 1167 + 123;

  // Apply filter
  const filterDef = SHOT_FILTERS.find(f => f.key === activeFilter);
  const filteredShots = activeFilter === 'all'
    ? shots
    : shots.filter(s => filterDef?.types?.includes(s.event_type));
  const filteredScore = filteredShots.filter(s => scoreShots.includes(s));
  const filteredMiss = filteredShots.filter(s => missShots.includes(s));

  const shotColor = (s: ShotEvent) => {
    if (['goal', 'penalty_goal'].includes(s.event_type)) return '#fbbf24'; // gold for goals
    if (scoreShots.includes(s)) return '#10b981'; // green for scores
    return '#ef4444'; // red for misses
  };

  return (
    <ChartCard title="Shot Map" subtitle={`${filteredShots.length} shot${filteredShots.length !== 1 ? 's' : ''} shown`}>
      {/* Filter pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
        {SHOT_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => { setActiveFilter(f.key); setSelectedShot(null); }}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors ${
              activeFilter === f.key
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-white/5 text-white/40 border border-white/10 hover:text-white/60'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div
        className="relative bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-xl overflow-hidden"
        style={{ aspectRatio: '16/10' }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).tagName !== 'circle') setSelectedShot(null);
        }}
      >
        <svg viewBox="0 0 2332 1446" className="w-full h-full">
          <rect width="2332" height="1446" fill="#2d5016" />
          <image href="/pitch-svg.svg" width="2332" height="1446" preserveAspectRatio="xMidYMid meet" />
          {[...filteredMiss, ...filteredScore].map((s, i) => s.pitch_x != null && s.pitch_y != null && (
            <circle
              key={`shot-${i}`}
              cx={toSvgX(s.pitch_x)}
              cy={toSvgY(s.pitch_y)}
              r="20"
              fill={shotColor(s)}
              stroke={selectedShot === s ? '#fff' : 'rgba(255,255,255,0.6)'}
              strokeWidth={selectedShot === s ? 5 : 2}
              opacity={selectedShot && selectedShot !== s ? 0.3 : 0.85}
              style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
              onPointerDown={(e) => { e.stopPropagation(); setSelectedShot(s); }}
            />
          ))}
        </svg>
        {/* Tooltip overlay */}
        {selectedShot && selectedShot.pitch_x != null && selectedShot.pitch_y != null && (() => {
          // Position tooltip below the shot if near top edge, above otherwise
          const shotY = selectedShot.pitch_y;
          const showBelow = shotY < 20;
          return (
            <div
              className="absolute pointer-events-none px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white whitespace-nowrap z-10"
              style={{
                background: 'rgba(0,0,0,0.92)',
                border: '1px solid rgba(255,255,255,0.2)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                left: `${Math.min(82, Math.max(18, selectedShot.pitch_x))}%`,
                top: showBelow
                  ? `${Math.min(90, shotY + 8)}%`
                  : `${Math.max(2, shotY - 10)}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <span className="font-semibold">{SHOT_TYPE_LABELS[selectedShot.event_type] || selectedShot.event_type}</span>
              {' · '}vs {selectedShot.opponent}
              {selectedShot.minute != null && <span className="text-white/60"> · {selectedShot.minute}&apos;</span>}
            </div>
          );
        })()}
        {/* Tap hint */}
        {!selectedShot && filteredShots.length > 0 && (
          <div className="absolute bottom-2 left-0 right-0 text-center">
            <span className="text-[10px] text-white/30 bg-black/40 px-2 py-0.5 rounded">Tap a shot to see details</span>
          </div>
        )}
      </div>
      <div className="flex gap-4 mt-2 justify-center text-xs text-white/50">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Goal</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Score ({filteredScore.length})</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-400" /> Miss ({filteredMiss.length})</span>
      </div>
    </ChartCard>
  );
}

// ---- AI Insights Card (collapsible) ----
function AIInsightsCard() {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['player-ai-insights'],
    queryFn: playerPortalAPI.getMyAIInsights,
    staleTime: 60 * 60 * 1000, // 1 hour
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl p-4 animate-pulse" style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(139,92,246,0.04))', border: '1px solid rgba(168,85,247,0.15)' }}>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-purple-400" />
          <span className="text-xs font-semibold text-purple-300">AI Insights</span>
        </div>
        <div className="space-y-2">
          <div className="h-3 rounded bg-white/5 w-3/4" />
          <div className="h-3 rounded bg-white/5 w-5/6" />
        </div>
      </div>
    );
  }

  const insights = data?.insights || [];
  if (insights.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(139,92,246,0.04))',
        border: '1px solid rgba(168,85,247,0.15)',
      }}
    >
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-purple-400" />
          <span className="text-xs font-semibold text-purple-300">AI Insights</span>
          <span className="text-[10px] text-purple-400/50">{insights.length} tips</span>
        </div>
        <ChevronDown
          size={14}
          className={`text-purple-400/50 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <ul className="space-y-1.5 mt-2.5">
          {insights.map((ins, i) => (
            <li key={i} className="text-xs text-white/70 leading-relaxed flex gap-2">
              <span className="text-purple-400 mt-0.5 shrink-0">&#8226;</span>
              <span>{ins}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- GPS Tab ----
function GPSTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['player-gps'],
    queryFn: playerPortalAPI.getMyGPS,
  });
  const { data: workloadData } = useQuery({
    queryKey: ['player-workload'],
    queryFn: playerPortalAPI.getMyWorkload,
    retry: 1,
  });

  if (isLoading) return <LoadingState />;

  const entries = data?.gps_entries || [];
  const matchEntries = entries.filter((e) => e.session_type === 'match');
  const workload = workloadData?.workload_entries || [];

  if (entries.length === 0) {
    return <EmptyState message="No GPS data available yet." />;
  }

  // Combined sprint + speed data
  const sprintSpeedData = matchEntries.map((e) => ({
    label: e.opponent_or_label.slice(0, 8),
    sprints: e.sprint_count || 0,
    speed: e.max_speed_ms ? +(e.max_speed_ms * 3.6).toFixed(1) : 0,
  }));

  // Distance & HSR
  const distData = matchEntries.map((e) => ({
    label: e.opponent_or_label.slice(0, 8),
    distance: e.total_distance_m ? +(e.total_distance_m / 1000).toFixed(1) : 0,
    hsr: e.high_speed_running_m ? +e.high_speed_running_m.toFixed(0) : 0,
  }));

  // Distance zones (stacked bar)
  const zoneData = matchEntries
    .filter(e => e.total_distance_m)
    .map((e) => {
      const total = e.total_distance_m || 0;
      const sprint = e.sprint_distance_m || 0;
      const hsr = e.high_speed_running_m || 0;
      const hml = e.hml_distance_m || 0;
      const low = Math.max(0, total - sprint - hsr - hml);
      return {
        label: e.opponent_or_label.slice(0, 8),
        low: +(low / 1000).toFixed(2),
        hml: +(hml / 1000).toFixed(2),
        hsr: +(hsr / 1000).toFixed(2),
        sprint: +(sprint / 1000).toFixed(2),
      };
    });

  // GPS Personal Bests
  const gpsPBs = computeGPSPBs(matchEntries);

  // Season averages for progress bars
  const seasonAvg = computeSeasonAverages(matchEntries);
  const latest = matchEntries.length > 0 ? matchEntries[matchEntries.length - 1] : null;

  // ACWR data
  const acwrData = workload
    .filter(w => w.acwr != null)
    .map(w => ({
      date: w.date.slice(5, 10),
      acwr: w.acwr!,
      acute: w.acute_load_7d,
      chronic: w.chronic_load_28d,
    }));

  return (
    <div className="space-y-5">
      {/* GPS Personal Bests */}
      {gpsPBs.length > 0 && (
        <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {gpsPBs.map((pb) => (
            <div
              key={pb.label}
              className="shrink-0 rounded-xl px-3 py-2.5 min-w-[110px] text-center"
              style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(6,182,212,0.06))', border: '1px solid rgba(16,185,129,0.15)' }}
            >
              <Trophy size={12} className="text-emerald-400 mx-auto mb-1" />
              <div className="text-sm font-bold text-white">{pb.value}</div>
              <div className="text-[9px] text-white/40 uppercase">{pb.label}</div>
              {pb.opponent && <div className="text-[9px] text-emerald-400/60 mt-0.5">vs {pb.opponent.slice(0, 10)}</div>}
            </div>
          ))}
        </div>
      )}

      {/* vs Season Average */}
      {latest && seasonAvg && (
        <ChartCard title="vs Season Average" subtitle={`Latest: ${latest.opponent_or_label}`}>
          <div className="space-y-2.5">
            <ProgressMetric label="Distance" current={latest.total_distance_m} avg={seasonAvg.distance} format="km" divisor={1000} />
            <ProgressMetric label="HSR" current={latest.high_speed_running_m} avg={seasonAvg.hsr} format="m" />
            <ProgressMetric label="Sprints" current={latest.sprint_count} avg={seasonAvg.sprints} format="" />
            <ProgressMetric label="Max Speed" current={latest.max_speed_ms ? latest.max_speed_ms * 3.6 : null} avg={seasonAvg.speed} format="km/h" />
          </div>
        </ChartCard>
      )}

      {/* Combined Sprint + Speed */}
      {sprintSpeedData.length > 1 && (
        <ChartCard title="Sprints & Top Speed" subtitle="Sprint count + max speed per match">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={sprintSpeedData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar yAxisId="left" dataKey="sprints" fill="#06b6d4" name="Sprints" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="speed" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Max Speed (km/h)" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Distance & HSR */}
      {distData.length > 1 && (
        <ChartCard title="Distance & HSR" subtitle="Per match (km)">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={distData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="distance" fill="#3b82f6" name="Distance (km)" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="hsr" stroke="#f59e0b" strokeWidth={2} dot={false} name="HSR (m)" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Distance Zones */}
      {zoneData.length > 1 && zoneData.some(z => z.sprint > 0 || z.hml > 0) && (
        <ChartCard title="Distance Zones" subtitle="Stacked by speed zone (km)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={zoneData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="low" stackId="z" fill="#6b7280" name="Low Speed" />
              <Bar dataKey="hml" stackId="z" fill="#f59e0b" name="HML" />
              <Bar dataKey="hsr" stackId="z" fill="#3b82f6" name="HSR" />
              <Bar dataKey="sprint" stackId="z" fill="#ef4444" name="Sprint" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ACWR Chart */}
      {acwrData.length > 3 && (
        <ChartCard title="Acute:Chronic Workload Ratio" subtitle="Training load balance">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={acwrData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis domain={[0, 2.2]} tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <ReferenceArea y1={0.8} y2={1.3} fill="#10b981" fillOpacity={0.08} />
              <ReferenceLine y={1.5} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Danger', fill: '#ef4444', fontSize: 9, position: 'right' }} />
              <ReferenceLine y={0.8} stroke="#10b981" strokeDasharray="4 4" />
              <ReferenceLine y={1.3} stroke="#10b981" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="acwr" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 2 }} name="ACWR" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Latest GPS Stats */}
      {latest && (
        <ChartCard title="Latest Match GPS">
          <LatestGPSCard entry={latest} />
        </ChartCard>
      )}
    </div>
  );
}

function ProgressMetric({ label, current, avg, format, divisor = 1 }: {
  label: string; current: number | null | undefined; avg: number;
  format: string; divisor?: number;
}) {
  if (current == null || avg === 0) return null;
  const val = current / divisor;
  const pct = Math.min((val / avg) * 100, 150);
  const above = val >= avg;
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-white/50">{label}</span>
        <span className={above ? 'text-emerald-400' : 'text-amber-400'}>
          {val.toFixed(1)}{format} / {avg.toFixed(1)}{format} avg
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${above ? 'bg-emerald-500' : 'bg-amber-500'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function LatestGPSCard({ entry }: { entry: GPSEntry }) {
  const stats = [
    { label: 'Distance', value: entry.total_distance_m ? `${(entry.total_distance_m / 1000).toFixed(1)} km` : '—' },
    { label: 'HSR', value: entry.high_speed_running_m ? `${entry.high_speed_running_m.toFixed(0)} m` : '—' },
    { label: 'Sprints', value: entry.sprint_count?.toString() || '—' },
    { label: 'Max Speed', value: entry.max_speed_ms ? `${(entry.max_speed_ms * 3.6).toFixed(1)} km/h` : '—' },
    { label: 'DSL', value: entry.dynamic_stress_load?.toFixed(1) || '—' },
    { label: 'Minutes', value: entry.playing_minutes?.toString() || '—' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="text-center py-2">
          <div className="text-[10px] text-white/40 uppercase">{s.label}</div>
          <div className="text-sm font-bold text-white mt-0.5">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---- Fitness Tab ----
function FitnessTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['player-fitness'],
    queryFn: playerPortalAPI.getMyFitness,
  });

  if (isLoading) return <LoadingState />;

  const tests = data?.fitness_tests || [];
  if (tests.length === 0) return <EmptyState message="No fitness test results yet." />;

  const chronological = [...tests].reverse();

  const cmjData = chronological.filter(t => t.cmj_cm).map(t => ({
    date: t.test_date.slice(5),
    cmj: t.cmj_cm,
    squat: t.squat_jump_cm,
  }));

  const broncoData = chronological.filter(t => t.bronco_test_min).map(t => ({
    date: t.test_date.slice(5),
    bronco: t.bronco_test_min,
  }));

  const latest = tests[0];
  const previous = tests.length > 1 ? tests[1] : null;

  return (
    <div className="space-y-5">
      <ChartCard title="Latest Test" subtitle={latest.test_date}>
        <div className="grid grid-cols-2 gap-3">
          <FitnessMetric label="CMJ" value={latest.cmj_cm} unit="cm" prev={previous?.cmj_cm} higher />
          <FitnessMetric label="Bronco" value={latest.bronco_test_min} unit="min" prev={previous?.bronco_test_min} higher={false} />
          <FitnessMetric label="10m Sprint" value={latest.sprint_0_10m_sec} unit="s" prev={previous?.sprint_0_10m_sec} higher={false} />
          <FitnessMetric label="Press-ups" value={latest.press_ups_60s} unit="/60s" prev={previous?.press_ups_60s} higher />
          <FitnessMetric label="Weight" value={latest.weight_kg} unit="kg" prev={previous?.weight_kg} />
          <FitnessMetric label="Body Fat" value={latest.body_fat_percentage} unit="%" prev={previous?.body_fat_percentage} higher={false} />
        </div>
      </ChartCard>

      {cmjData.length > 1 && (
        <ChartCard title="Jump Performance" subtitle="CMJ & Squat Jump over time">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={cmjData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="cmj" stroke="#10b981" strokeWidth={2} name="CMJ (cm)" />
              <Line type="monotone" dataKey="squat" stroke="#06b6d4" strokeWidth={2} strokeDasharray="5 5" name="Squat Jump (cm)" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {broncoData.length > 1 && (
        <ChartCard title="Bronco Test" subtitle="Time over testing sessions">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={broncoData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} reversed />
              <Tooltip {...TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="bronco" stroke="#10b981" strokeWidth={2} name="Bronco (min)" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}

function FitnessMetric({ label, value, unit, prev, higher }: {
  label: string; value: number | null | undefined; unit: string;
  prev?: number | null; higher?: boolean;
}) {
  const diff = value != null && prev != null ? value - prev : null;
  const improved = diff != null && higher != null
    ? (higher ? diff > 0 : diff < 0)
    : null;

  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <div className="text-[10px] text-white/40 uppercase">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-base font-bold text-white">{value != null ? value : '—'}</span>
        <span className="text-[10px] text-white/30">{unit}</span>
      </div>
      {diff != null && (
        <span className={`text-[10px] font-medium ${improved ? 'text-emerald-400' : improved === false ? 'text-red-400' : 'text-white/30'}`}>
          {diff > 0 ? '+' : ''}{higher === false ? diff.toFixed(2) : diff.toFixed(1)}
        </span>
      )}
    </div>
  );
}

// ---- Defence Tab ----
function DefenceTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['player-match-stats'],
    queryFn: playerPortalAPI.getMyMatchStats,
  });

  if (isLoading) return <LoadingState />;

  const matches = data?.matches || [];
  if (matches.length === 0) return <EmptyState message="No match data available." />;

  const defData = [...matches].reverse().map((m) => ({
    opponent: m.opponent.slice(0, 8),
    blocks: m.blocks,
    interceptions: m.interceptions,
    turnovers_won: m.turnovers_won,
  }));

  const totalDef = matches.reduce((sum, m) => sum + m.blocks + m.interceptions + m.turnovers_won, 0);
  const totalTO = matches.reduce((sum, m) => sum + m.turnovers_lost, 0);
  const cleanPlayPct = totalDef + totalTO > 0
    ? ((totalDef / (totalDef + totalTO)) * 100).toFixed(1)
    : '—';

  // Defence streak: consecutive matches without a turnover lost
  const defStreak = computeDefenceStreak(matches);

  return (
    <div className="space-y-5">
      {/* Summary + Streak */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 grid grid-cols-3 gap-3">
          <MiniStatCard label="Blocks" value={matches.reduce((s, m) => s + m.blocks, 0)} />
          <MiniStatCard label="Intercepts" value={matches.reduce((s, m) => s + m.interceptions, 0)} />
          <MiniStatCard label="TO Won" value={matches.reduce((s, m) => s + m.turnovers_won, 0)} />
        </div>
        {defStreak > 0 && (
          <div className="col-span-2 rounded-xl px-3 py-3 flex items-center justify-center gap-2" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(6,182,212,0.06))', border: '1px solid rgba(16,185,129,0.15)' }}>
            <Shield size={14} className="text-emerald-400" />
            <span className="text-sm font-bold text-emerald-400">{defStreak} match{defStreak > 1 ? 'es' : ''}</span>
            <span className="text-[10px] text-white/40">without turnover</span>
          </div>
        )}
      </div>

      <ChartCard title="Clean Play %" subtitle={`${cleanPlayPct}% (defensive actions vs turnovers lost)`}>
        <div className="h-3 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
            style={{ width: `${cleanPlayPct}%` }}
          />
        </div>
      </ChartCard>

      {defData.length > 1 && (
        <ChartCard title="Defensive Actions" subtitle="Per match (stacked)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={defData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="opponent" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="blocks" stackId="a" fill="#ef4444" name="Blocks" />
              <Bar dataKey="interceptions" stackId="a" fill="#f59e0b" name="Interceptions" />
              <Bar dataKey="turnovers_won" stackId="a" fill="#10b981" name="TO Won" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}

// ---- Attendance Tab ----
function AttendanceTab() {
  const { data, isLoading } = useQuery<AttendanceSummary>({
    queryKey: ['player-attendance'],
    queryFn: playerPortalAPI.getMyAttendance,
  });
  const { data: matchData } = useQuery({
    queryKey: ['player-match-stats'],
    queryFn: playerPortalAPI.getMyMatchStats,
  });

  if (isLoading) return <LoadingState />;
  if (!data) return <EmptyState message="No attendance data available." />;

  const sessions = data.sessions || [];
  const byType = data.by_type || {};
  const matchDates = new Set((matchData?.matches || []).map(m => m.match_date.slice(0, 10)));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <MiniStatCard label="Rate" value={`${data.rate_pct}%`} />
        <MiniStatCard label="Attended" value={`${data.attended}/${data.total_sessions}`} />
        <MiniStatCard label="Current Streak" value={data.current_streak} />
        <MiniStatCard label="Best Streak" value={data.longest_streak} />
      </div>

      {Object.keys(byType).length > 0 && (
        <ChartCard title="By Type">
          <div className="space-y-2">
            {Object.entries(byType).map(([type, { total, attended }]) => {
              const pct = total > 0 ? (attended / total * 100) : 0;
              return (
                <div key={type}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white/60 capitalize">{type}</span>
                    <span className="text-white/40">{attended}/{total} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </ChartCard>
      )}

      {/* Enhanced Calendar with match appearance dots */}
      <ChartCard title="Attendance Calendar">
        <div className="flex flex-wrap gap-1">
          {sessions.slice(0, 60).map((s) => {
            const isPresent = s.status === 'present' || s.status === 'late';
            const isMatchDay = matchDates.has(s.date.slice(0, 10));
            return (
              <div key={s.session_id} className="relative">
                <div
                  className={`w-4 h-4 rounded-sm ${
                    isPresent
                      ? 'bg-emerald-500/70'
                      : s.status === 'excused' || s.status === 'injured'
                      ? 'bg-amber-500/50'
                      : 'bg-red-500/40'
                  }`}
                  title={`${s.date} — ${s.type}: ${s.status}`}
                />
                {isMatchDay && (
                  <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex gap-3 mt-2 text-[10px] text-white/40">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70" /> Present</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/50" /> Excused</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/40" /> Absent</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Match</span>
        </div>
      </ChartCard>
    </div>
  );
}

// ---- Head-to-Head Overlay ----
function HeadToHeadOverlay({ onClose }: { onClose: () => void }) {
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const { data: rosterData } = useQuery({
    queryKey: ['player-roster'],
    queryFn: playerPortalAPI.getRoster,
  });

  const { data: h2hData, isLoading: h2hLoading } = useQuery({
    queryKey: ['player-h2h', selectedPlayer],
    queryFn: () => playerPortalAPI.getHeadToHead(selectedPlayer!),
    enabled: !!selectedPlayer,
  });

  const roster = rosterData?.players || [];
  const filtered = roster.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h2 className="text-sm font-bold text-white">Head-to-Head</h2>
        <button onClick={onClose} className="p-1 text-white/50 hover:text-white">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Player Picker */}
        {!selectedPlayer && (
          <>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                type="text"
                placeholder="Search players..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/30"
              />
            </div>
            <div className="space-y-1">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlayer(p.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-all text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60">
                    {p.jersey_number || '#'}
                  </div>
                  <div>
                    <div className="text-sm text-white">{p.name}</div>
                    {p.position && <div className="text-[10px] text-white/40">{p.position}</div>}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Loading */}
        {selectedPlayer && h2hLoading && <LoadingState />}

        {/* Comparison */}
        {selectedPlayer && h2hData && (
          <>
            <button
              onClick={() => setSelectedPlayer(null)}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              &larr; Pick different player
            </button>

            <div className="flex justify-between items-center mb-2">
              <div className="text-center flex-1">
                <div className="text-xs font-bold text-emerald-400">You</div>
                <div className="text-[10px] text-white/40">{h2hData.me.player_name}</div>
              </div>
              <div className="text-white/20 text-xs px-2">vs</div>
              <div className="text-center flex-1">
                <div className="text-xs font-bold text-amber-400">Them</div>
                <div className="text-[10px] text-white/40">{h2hData.them.player_name}</div>
              </div>
            </div>

            <div className="space-y-2.5">
              <H2HBar label="Total Score" myVal={h2hData.me.total_score_value} theirVal={h2hData.them.total_score_value} unit="pts" />
              <H2HBar label="Accuracy" myVal={h2hData.me.accuracy_pct} theirVal={h2hData.them.accuracy_pct} unit="%" />
              <H2HBar label="Matches" myVal={h2hData.me.matches_played} theirVal={h2hData.them.matches_played} unit="" />
              <H2HBar label="Blocks" myVal={h2hData.me.blocks} theirVal={h2hData.them.blocks} unit="" />
              <H2HBar label="TO Won" myVal={h2hData.me.turnovers_won} theirVal={h2hData.them.turnovers_won} unit="" />
              <H2HBar label="Avg Distance" myVal={h2hData.me.avg_distance_km} theirVal={h2hData.them.avg_distance_km} unit="km" />
              <H2HBar label="Avg Sprints" myVal={h2hData.me.avg_sprints} theirVal={h2hData.them.avg_sprints} unit="" />
              <H2HBar label="Top Speed" myVal={h2hData.me.avg_max_speed_kmh} theirVal={h2hData.them.avg_max_speed_kmh} unit="km/h" />
              <H2HBar label="Attendance" myVal={h2hData.me.attendance_rate} theirVal={h2hData.them.attendance_rate} unit="%" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function H2HBar({ label, myVal, theirVal, unit }: {
  label: string; myVal: number | null; theirVal: number | null; unit: string;
}) {
  const mv = myVal ?? 0;
  const tv = theirVal ?? 0;
  const total = mv + tv || 1;
  const myPct = (mv / total) * 100;
  const iLead = mv > tv;
  const tied = mv === tv;

  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className={iLead ? 'text-emerald-400 font-medium' : 'text-white/50'}>{mv != null ? `${mv}${unit}` : '—'}</span>
        <span className="text-white/40">{label}</span>
        <span className={!iLead && !tied ? 'text-amber-400 font-medium' : 'text-white/50'}>{tv != null ? `${tv}${unit}` : '—'}</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-white/5">
        <div
          className={`h-full transition-all ${iLead ? 'bg-emerald-500' : tied ? 'bg-white/20' : 'bg-emerald-500/30'}`}
          style={{ width: `${myPct}%` }}
        />
        <div
          className={`h-full transition-all ${!iLead && !tied ? 'bg-amber-500' : tied ? 'bg-white/20' : 'bg-amber-500/30'}`}
          style={{ width: `${100 - myPct}%` }}
        />
      </div>
    </div>
  );
}

// ---- Shared Components ----

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <ChartZoomModal title={title}>
      <div
        className="rounded-xl p-4"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-[11px] text-white/40 mt-0.5">{subtitle}</p>}
        </div>
        {children}
      </div>
    </ChartZoomModal>
  );
}

function MiniStatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="rounded-xl px-3 py-3 text-center"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="text-[10px] text-white/40 uppercase">{label}</div>
      <div className="text-lg font-bold text-white mt-0.5">{value}</div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3].map((i) => <div key={i} className="h-40 rounded-xl bg-white/5" />)}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-white/50 text-sm">{message}</p>
    </div>
  );
}

// ---- Data helpers ----

function computeScoringStreak(matches: PlayerMatchStatRow[]): number {
  // Matches are newest-first; count from most recent
  let streak = 0;
  for (const m of matches) {
    if (m.total_score_value > 0) streak++;
    else break;
  }
  return streak;
}

function computeDefenceStreak(matches: PlayerMatchStatRow[]): number {
  let streak = 0;
  for (const m of matches) {
    if (m.turnovers_lost === 0) streak++;
    else break;
  }
  return streak;
}

function computeRadarData(
  matches: PlayerMatchStatRow[],
  gpsEntries: GPSEntry[],
  attendance: AttendanceSummary | undefined,
) {
  if (matches.length === 0) return [];

  const matchCount = matches.length;
  const totalScore = matches.reduce((s, m) => s + m.total_score_value, 0);
  const totalShots = matches.reduce((s, m) => s + m.goals + m.points + m.two_pointers + m.wides, 0);
  const totalScores = matches.reduce((s, m) => s + m.goals + m.points + m.two_pointers, 0);
  const accuracy = totalShots > 0 ? (totalScores / totalShots) * 100 : 0;
  const defActions = matches.reduce((s, m) => s + m.blocks + m.interceptions + m.turnovers_won, 0);

  const matchGPS = gpsEntries.filter(e => e.session_type === 'match');
  const avgDist = matchGPS.length > 0
    ? matchGPS.reduce((s, e) => s + (e.total_distance_m || 0), 0) / matchGPS.length
    : 0;

  const attRate = attendance?.rate_pct ?? 0;
  const discipline = matches.reduce((s, m) => s + m.turnovers_lost, 0);
  // If no turnovers_lost recorded at all, treat as no data (neutral 50) not perfect (100)
  const disciplineScore = matchCount > 0 && discipline > 0
    ? Math.max(0, 100 - (discipline / matchCount) * 20)
    : matchCount > 0 ? 50 : 50;

  // Normalize each to 0-100 scale
  const scoreNorm = Math.min(100, (totalScore / matchCount / 5) * 100); // 5pts/match = 100
  const accNorm = Math.min(100, accuracy);
  const defNorm = Math.min(100, (defActions / matchCount / 3) * 100); // 3 def actions/match = 100
  const workNorm = Math.min(100, (avgDist / 9000) * 100); // 9km = 100
  const attNorm = Math.min(100, attRate);
  const discNorm = Math.min(100, disciplineScore);

  return [
    { axis: 'Scoring', value: Math.round(scoreNorm) },
    { axis: 'Accuracy', value: Math.round(accNorm) },
    { axis: 'Defence', value: Math.round(defNorm) },
    { axis: 'Workload', value: Math.round(workNorm) },
    { axis: 'Availability', value: Math.round(attNorm) },
    { axis: 'Discipline', value: Math.round(discNorm) },
  ];
}

function computeGPSPBs(matchEntries: GPSEntry[]) {
  const pbs: { label: string; value: string; opponent: string }[] = [];

  if (matchEntries.length === 0) return pbs;

  // Max distance
  const maxDist = matchEntries.reduce((best, e) =>
    (e.total_distance_m || 0) > (best.total_distance_m || 0) ? e : best
  , matchEntries[0]);
  if (maxDist.total_distance_m) {
    pbs.push({ label: 'Max Distance', value: `${(maxDist.total_distance_m / 1000).toFixed(1)}km`, opponent: maxDist.opponent_or_label });
  }

  // Most sprints
  const maxSprints = matchEntries.reduce((best, e) =>
    (e.sprint_count || 0) > (best.sprint_count || 0) ? e : best
  , matchEntries[0]);
  if (maxSprints.sprint_count) {
    pbs.push({ label: 'Most Sprints', value: `${maxSprints.sprint_count}`, opponent: maxSprints.opponent_or_label });
  }

  // Top speed
  const maxSpeed = matchEntries.reduce((best, e) =>
    (e.max_speed_ms || 0) > (best.max_speed_ms || 0) ? e : best
  , matchEntries[0]);
  if (maxSpeed.max_speed_ms) {
    pbs.push({ label: 'Top Speed', value: `${(maxSpeed.max_speed_ms * 3.6).toFixed(1)}km/h`, opponent: maxSpeed.opponent_or_label });
  }

  return pbs;
}

function computeSeasonAverages(matchEntries: GPSEntry[]) {
  if (matchEntries.length === 0) return null;

  const dists = matchEntries.map(e => e.total_distance_m || 0);
  const hsrs = matchEntries.map(e => e.high_speed_running_m || 0);
  const sprints = matchEntries.map(e => e.sprint_count || 0);
  const speeds = matchEntries.filter(e => e.max_speed_ms).map(e => e.max_speed_ms! * 3.6);

  return {
    distance: dists.reduce((a, b) => a + b, 0) / dists.length / 1000,
    hsr: hsrs.reduce((a, b) => a + b, 0) / hsrs.length,
    sprints: sprints.reduce((a, b) => a + b, 0) / sprints.length,
    speed: speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0,
  };
}
