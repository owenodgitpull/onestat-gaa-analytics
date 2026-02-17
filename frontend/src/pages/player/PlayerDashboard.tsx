import { useQuery } from '@tanstack/react-query';
import { playerPortalAPI, type PlayerDashboard as DashboardData } from '../../services/playerPortalApi';
import { Link } from 'react-router-dom';
import { Trophy, Target, Crosshair, Zap, TrendingUp, ChevronRight } from 'lucide-react';

const CATEGORY_ICONS: Record<string, typeof Trophy> = {
  top_scorer: Trophy,
  clinical_rating: Target,
  the_wall: Crosshair,
  workhorse: TrendingUp,
  speed_demon: Zap,
  sprint_king: Zap,
  iron_man: TrendingUp,
  motm_points: Trophy,
};

const CATEGORY_COLORS: Record<string, string> = {
  top_scorer: 'from-amber-500/20 to-orange-500/15 border-amber-500/30',
  clinical_rating: 'from-emerald-500/20 to-green-500/15 border-emerald-500/30',
  the_wall: 'from-red-500/20 to-rose-500/15 border-red-500/30',
  workhorse: 'from-blue-500/20 to-cyan-500/15 border-blue-500/30',
  speed_demon: 'from-purple-500/20 to-violet-500/15 border-purple-500/30',
  sprint_king: 'from-indigo-500/20 to-blue-500/15 border-indigo-500/30',
  iron_man: 'from-teal-500/20 to-emerald-500/15 border-teal-500/30',
  motm_points: 'from-yellow-500/20 to-amber-500/15 border-yellow-500/30',
};

export default function PlayerDashboard() {

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['player-dashboard'],
    queryFn: playerPortalAPI.getMyDashboard,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-40 rounded-2xl bg-white/5" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 rounded-xl bg-white/5" />)}
        </div>
        <div className="h-32 rounded-2xl bg-white/5" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-white/60">Unable to load dashboard. Please try again.</p>
      </div>
    );
  }

  const { season_stats: stats, recent_form, leaderboard_positions, highlights } = data;

  // Find best leaderboard position
  const bestRank = leaderboard_positions.length > 0
    ? leaderboard_positions.reduce((best, pos) =>
        (pos.rank < best.rank ? pos : best), leaderboard_positions[0])
    : null;

  return (
    <div className="space-y-5 pb-4">
      {/* Hero Card */}
      <div
        className="rounded-2xl p-5 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.20), rgba(139,92,246,0.12), rgba(59,130,246,0.08))',
          border: '1px solid rgba(99,102,241,0.25)',
          boxShadow: '0 8px 32px rgba(99,102,241,0.15)',
        }}
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full -translate-y-8 translate-x-8 blur-2xl" />
        <div className="relative">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg shadow-indigo-500/30">
              {data.jersey_number || '#'}
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{data.player_name}</h1>
              <p className="text-sm text-white/50 capitalize">{data.position || 'Player'}</p>
              {bestRank && (
                <p className="text-sm text-indigo-400 font-medium mt-0.5">
                  #{bestRank.rank} {bestRank.display_name}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Score" value={stats.total_score} sub={`${stats.total_points_value} pts`} />
        <StatCard label="Accuracy" value={stats.accuracy_pct != null ? `${stats.accuracy_pct}%` : '—'} sub="shooting %" />
        <StatCard label="Matches" value={String(stats.matches_played)} sub="this season" />
        <StatCard
          label="MOTM Pts"
          value={
            leaderboard_positions.find((p) => p.category === 'motm_points')?.value?.toString() || '—'
          }
          sub={`rank #${leaderboard_positions.find((p) => p.category === 'motm_points')?.rank || '—'}`}
        />
      </div>

      {/* Recent Form */}
      {recent_form.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Recent Form</h2>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
            {recent_form.map((m) => (
              <div
                key={m.match_id}
                className="min-w-[160px] rounded-xl p-3.5 snap-start flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))',
                  border: '1px solid rgba(255,255,255,0.10)',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-white/50">{m.opponent}</span>
                  <span
                    className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      m.result === 'win'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : m.result === 'loss'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-white/10 text-white/60'
                    }`}
                  >
                    {m.result === 'win' ? 'W' : m.result === 'loss' ? 'L' : 'D'}
                  </span>
                </div>
                <div className="text-lg font-bold text-white">{m.personal_score}</div>
                <div className="text-[11px] text-white/40 mt-1">
                  {m.team_score} v {m.opponent_score}
                </div>
                {m.key_stat && (
                  <div className="text-[11px] text-indigo-400 mt-1">{m.key_stat}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Leaderboard Snapshot */}
      {leaderboard_positions.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Leaderboards</h2>
            <Link to="/player/leaderboards" className="text-xs text-indigo-400 flex items-center gap-0.5">
              View all <ChevronRight size={14} />
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
            {leaderboard_positions.map((pos) => {
              const Icon = CATEGORY_ICONS[pos.category] || Trophy;
              const colorClass = CATEGORY_COLORS[pos.category] || 'from-white/10 to-white/5 border-white/10';
              return (
                <Link
                  key={pos.category}
                  to="/player/leaderboards"
                  className={`min-w-[130px] rounded-xl p-3.5 snap-start flex-shrink-0 bg-gradient-to-br border transition-transform active:scale-95 ${colorClass}`}
                >
                  <Icon size={18} className="text-white/60 mb-2" />
                  <div className="text-2xl font-bold text-white">#{pos.rank}</div>
                  <div className="text-[11px] text-white/50 mt-0.5">{pos.display_name}</div>
                  <div className="text-xs text-white/40">of {pos.total}</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Highlights */}
      {highlights.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Highlights</h2>
          <div className="space-y-2">
            {highlights.map((h, i) => (
              <div
                key={i}
                className="rounded-lg px-4 py-3 text-sm text-white/80"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {h}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      className="rounded-xl p-3.5"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))',
        border: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      <div className="text-[11px] text-white/50 font-medium uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
      <div className="text-xs text-white/40">{sub}</div>
    </div>
  );
}
