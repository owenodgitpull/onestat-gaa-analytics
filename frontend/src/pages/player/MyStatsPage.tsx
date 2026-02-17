import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { playerPortalAPI } from '../../services/playerPortalApi';
import type { GPSEntry, AttendanceSummary } from '../../services/playerPortalApi';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ComposedChart,
} from 'recharts';
import { Crosshair, Activity, Shield, CalendarCheck } from 'lucide-react';

const TABS = [
  { key: 'scoring', label: 'Scoring', icon: Crosshair },
  { key: 'gps', label: 'GPS', icon: Activity },
  { key: 'fitness', label: 'Fitness', icon: Activity },
  { key: 'defence', label: 'Defence', icon: Shield },
  { key: 'attendance', label: 'Attendance', icon: CalendarCheck },
];

export default function MyStatsPage() {
  const [activeTab, setActiveTab] = useState('scoring');

  return (
    <div className="space-y-5 pb-4">
      <h1 className="text-lg font-bold text-white">My Stats</h1>

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
                  ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
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
    </div>
  );
}

// ---- Scoring Tab ----
function ScoringTab() {
  const { data: matchData, isLoading: matchLoading } = useQuery({
    queryKey: ['player-match-stats'],
    queryFn: playerPortalAPI.getMyMatchStats,
  });
  const { data: shotData, isLoading: shotLoading } = useQuery({
    queryKey: ['player-shots'],
    queryFn: playerPortalAPI.getMyShots,
  });

  if (matchLoading || shotLoading) return <LoadingState />;

  const matches = matchData?.matches || [];
  const shots = shotData?.shots || [];

  // Scoring trend data (reverse so oldest first)
  const trendData = [...matches].reverse().map((m) => ({
    opponent: m.opponent.slice(0, 8),
    score: m.total_score_value,
    goals: m.goals * 3,
    points: m.points,
    twoPointers: m.two_pointers * 2,
  }));

  // Shot outcomes for mini heatmap
  const scoreShots = shots.filter((s) => ['goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five', 'penalty_goal'].includes(s.event_type));
  const missShots = shots.filter((s) => ['wide', 'short', 'saved', 'wide_free', 'forty_five_missed', 'penalty_miss'].includes(s.event_type));

  return (
    <div className="space-y-5">
      {/* Shot Map */}
      <ChartCard title="Shot Map" subtitle={`${shots.length} shots total`}>
        <div className="relative w-full" style={{ paddingBottom: '66%' }}>
          <div className="absolute inset-0 rounded-lg overflow-hidden" style={{ background: 'linear-gradient(180deg, #1a3a1a, #0f2810)' }}>
            {/* Pitch lines */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 66" preserveAspectRatio="none">
              <rect x="0" y="0" width="100" height="66" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.3" />
              <line x1="50" y1="0" x2="50" y2="66" stroke="rgba(255,255,255,0.1)" strokeWidth="0.2" />
              {/* Goal areas */}
              <rect x="85" y="18" width="15" height="30" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.2" />
              <rect x="0" y="18" width="15" height="30" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.2" />
            </svg>
            {/* Score shots (green) */}
            {scoreShots.map((s, i) => s.pitch_x != null && s.pitch_y != null && (
              <div
                key={`s-${i}`}
                className="absolute w-2 h-2 rounded-full bg-emerald-400/80"
                style={{
                  left: `${s.pitch_x}%`,
                  top: `${s.pitch_y * 0.66}%`,
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 6px rgba(16,185,129,0.5)',
                }}
              />
            ))}
            {/* Miss shots (red) */}
            {missShots.map((s, i) => s.pitch_x != null && s.pitch_y != null && (
              <div
                key={`m-${i}`}
                className="absolute w-2 h-2 rounded-full bg-red-400/60"
                style={{
                  left: `${s.pitch_x}%`,
                  top: `${s.pitch_y * 0.66}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-4 mt-2 justify-center text-xs text-white/50">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Score ({scoreShots.length})</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Miss ({missShots.length})</span>
        </div>
      </ChartCard>

      {/* Scoring Trend */}
      {trendData.length > 1 && (
        <ChartCard title="Scoring Trend" subtitle="Points value per match">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="opponent" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip
                contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
              />
              <Bar dataKey="goals" stackId="a" fill="#f59e0b" name="Goals" radius={[0, 0, 0, 0]} />
              <Bar dataKey="points" stackId="a" fill="#6366f1" name="Points" radius={[0, 0, 0, 0]} />
              <Bar dataKey="twoPointers" stackId="a" fill="#a855f7" name="2-Pointers" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="score" stroke="#10b981" strokeWidth={2} dot={false} name="Total" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Match-by-Match Table */}
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
                  <td className="text-center text-indigo-400">{m.points || '-'}</td>
                  <td className="text-center text-purple-400">{m.two_pointers || '-'}</td>
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

// ---- GPS Tab ----
function GPSTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['player-gps'],
    queryFn: playerPortalAPI.getMyGPS,
  });

  if (isLoading) return <LoadingState />;

  const entries = data?.gps_entries || [];
  const matchEntries = entries.filter((e) => e.session_type === 'match');

  if (entries.length === 0) {
    return <EmptyState message="No GPS data available yet." />;
  }

  const distData = matchEntries.map((e) => ({
    label: e.opponent_or_label.slice(0, 8),
    distance: e.total_distance_m ? +(e.total_distance_m / 1000).toFixed(1) : 0,
    hsr: e.high_speed_running_m ? +e.high_speed_running_m.toFixed(0) : 0,
    sprints: e.sprint_count || 0,
  }));

  const speedData = matchEntries.filter(e => e.max_speed_ms).map((e) => ({
    label: e.opponent_or_label.slice(0, 8),
    speed: e.max_speed_ms ? +(e.max_speed_ms * 3.6).toFixed(1) : 0,
  }));

  return (
    <div className="space-y-5">
      {distData.length > 1 && (
        <ChartCard title="Distance & HSR" subtitle="Per match (km)">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={distData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
              <Bar dataKey="distance" fill="#3b82f6" name="Distance (km)" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="hsr" stroke="#f59e0b" strokeWidth={2} dot={false} name="HSR (m)" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {distData.length > 1 && (
        <ChartCard title="Sprint Count" subtitle="Per match">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={distData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
              <Bar dataKey="sprints" fill="#a855f7" name="Sprints" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {speedData.length > 1 && (
        <ChartCard title="Max Speed Trend" subtitle="km/h per match">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={speedData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
              <Tooltip contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
              <Line type="monotone" dataKey="speed" stroke="#10b981" strokeWidth={2} name="Max Speed (km/h)" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Latest GPS Stats */}
      {matchEntries.length > 0 && (
        <ChartCard title="Latest Match GPS">
          <LatestGPSCard entry={matchEntries[matchEntries.length - 1]} />
        </ChartCard>
      )}
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

  // Reverse for chronological order
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
      {/* Latest vs Previous */}
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
              <Tooltip contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
              <Line type="monotone" dataKey="cmj" stroke="#6366f1" strokeWidth={2} name="CMJ (cm)" />
              <Line type="monotone" dataKey="squat" stroke="#a855f7" strokeWidth={2} strokeDasharray="5 5" name="Squat Jump (cm)" />
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
              <Tooltip contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
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

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <MiniStatCard label="Blocks" value={matches.reduce((s, m) => s + m.blocks, 0)} />
        <MiniStatCard label="Intercepts" value={matches.reduce((s, m) => s + m.interceptions, 0)} />
        <MiniStatCard label="TO Won" value={matches.reduce((s, m) => s + m.turnovers_won, 0)} />
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
              <Tooltip contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
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

  if (isLoading) return <LoadingState />;
  if (!data) return <EmptyState message="No attendance data available." />;

  const sessions = data.sessions || [];
  const byType = data.by_type || {};

  // Calendar heatmap — group by week
  const weeks: Record<string, { date: string; status: string }[]> = {};
  sessions.forEach((s) => {
    const d = new Date(s.date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = [];
    weeks[key].push({ date: s.date, status: s.status });
  });

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <MiniStatCard label="Rate" value={`${data.rate_pct}%`} />
        <MiniStatCard label="Attended" value={`${data.attended}/${data.total_sessions}`} />
        <MiniStatCard label="Current Streak" value={data.current_streak} />
        <MiniStatCard label="Best Streak" value={data.longest_streak} />
      </div>

      {/* By Type Breakdown */}
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
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </ChartCard>
      )}

      {/* Calendar Heatmap */}
      <ChartCard title="Attendance Calendar">
        <div className="flex flex-wrap gap-1">
          {sessions.slice(0, 60).map((s) => {
            const isPresent = s.status === 'present' || s.status === 'late';
            return (
              <div
                key={s.session_id}
                className={`w-4 h-4 rounded-sm ${
                  isPresent
                    ? 'bg-emerald-500/70'
                    : s.status === 'excused' || s.status === 'injured'
                    ? 'bg-amber-500/50'
                    : 'bg-red-500/40'
                }`}
                title={`${s.date} — ${s.type}: ${s.status}`}
              />
            );
          })}
        </div>
        <div className="flex gap-3 mt-2 text-[10px] text-white/40">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70" /> Present</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/50" /> Excused</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/40" /> Absent</span>
        </div>
      </ChartCard>
    </div>
  );
}

// ---- Shared Components ----

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
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
