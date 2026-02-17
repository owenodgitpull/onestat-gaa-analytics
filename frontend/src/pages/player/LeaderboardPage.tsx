import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { playerPortalAPI, type LeaderboardEntry } from '../../services/playerPortalApi';
import { useAuth } from '../../contexts/AuthContext';
import { Trophy, Target, Shield, TrendingUp, Zap, Footprints, Clock, Star } from 'lucide-react';

const CATEGORIES = [
  { key: 'top_scorer', icon: Trophy, label: 'Top Scorer', color: '#f59e0b' },
  { key: 'clinical_rating', icon: Target, label: 'Clinical', color: '#10b981' },
  { key: 'the_wall', icon: Shield, label: 'The Wall', color: '#ef4444' },
  { key: 'workhorse', icon: TrendingUp, label: 'Workhorse', color: '#3b82f6' },
  { key: 'speed_demon', icon: Zap, label: 'Speed', color: '#a855f7' },
  { key: 'sprint_king', icon: Footprints, label: 'Sprints', color: '#6366f1' },
  { key: 'iron_man', icon: Clock, label: 'Iron Man', color: '#14b8a6' },
  { key: 'motm_points', icon: Star, label: 'MOTM', color: '#eab308' },
];

const MEDAL_GRADIENTS = [
  'linear-gradient(135deg, #fbbf24, #f59e0b)', // Gold
  'linear-gradient(135deg, #d1d5db, #9ca3af)', // Silver
  'linear-gradient(135deg, #d97706, #b45309)', // Bronze
];

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [activeCategory, setActiveCategory] = useState('top_scorer');

  const { data, isLoading } = useQuery({
    queryKey: ['player-leaderboards'],
    queryFn: playerPortalAPI.getAllLeaderboards,
  });

  const { data: fullData, isLoading: fullLoading } = useQuery({
    queryKey: ['player-leaderboard-full', activeCategory],
    queryFn: () => playerPortalAPI.getSingleLeaderboard(activeCategory),
  });

  // Cache previous ranks in localStorage for rank change indicators
  useEffect(() => {
    if (data?.leaderboards) {
      const prev = localStorage.getItem('leaderboard_ranks');
      if (prev) {
        // Already stored — don't overwrite until next session
        return;
      }
      const ranks: Record<string, number | null> = {};
      data.leaderboards.forEach((b) => {
        ranks[b.category] = b.my_rank;
      });
      localStorage.setItem('leaderboard_ranks', JSON.stringify(ranks));
    }
  }, [data]);

  const prevRanks: Record<string, number | null> = (() => {
    try {
      return JSON.parse(localStorage.getItem('leaderboard_ranks') || '{}');
    } catch {
      return {};
    }
  })();

  const activeMeta = CATEGORIES.find((c) => c.key === activeCategory)!;
  const activeBoard = data?.leaderboards?.find((b) => b.category === activeCategory);
  const fullRanking = fullData?.ranking || [];

  return (
    <div className="space-y-5 pb-4">
      <h1 className="text-lg font-bold text-white">Leaderboards</h1>

      {/* Category Tabs — horizontal scroll */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x scrollbar-hide">
        {CATEGORIES.map((cat) => {
          const active = cat.key === activeCategory;
          const board = data?.leaderboards?.find((b) => b.category === cat.key);
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`flex-shrink-0 snap-start rounded-xl px-3 py-2 flex items-center gap-2 transition-all ${
                active
                  ? 'bg-white/10 border border-white/20 shadow-lg'
                  : 'bg-white/[0.04] border border-transparent hover:bg-white/[0.08]'
              }`}
            >
              <cat.icon size={16} style={{ color: active ? cat.color : 'rgba(255,255,255,0.4)' }} />
              <span className={`text-xs font-medium whitespace-nowrap ${active ? 'text-white' : 'text-white/50'}`}>
                {cat.label}
              </span>
              {board?.my_rank && (
                <span className="text-[10px] font-bold text-white/40 bg-white/10 px-1.5 py-0.5 rounded">
                  #{board.my_rank}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading || fullLoading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-40 rounded-2xl bg-white/5" />
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 rounded-xl bg-white/5" />)}
        </div>
      ) : (
        <>
          {/* Podium — Top 3 */}
          {activeBoard && activeBoard.top_3.length >= 3 && (
            <div className="flex items-end justify-center gap-3 pt-4 pb-2">
              {/* 2nd Place */}
              <PodiumCard entry={activeBoard.top_3[1]} medal={1} unit={activeBoard.unit} color={activeMeta.color} />
              {/* 1st Place */}
              <PodiumCard entry={activeBoard.top_3[0]} medal={0} unit={activeBoard.unit} color={activeMeta.color} featured />
              {/* 3rd Place */}
              <PodiumCard entry={activeBoard.top_3[2]} medal={2} unit={activeBoard.unit} color={activeMeta.color} />
            </div>
          )}

          {/* Full Ranking */}
          <div className="space-y-1.5">
            {fullRanking.map((entry) => {
              const isMe = entry.player_id === user?.player_id;
              const prevRank = prevRanks[activeCategory];
              const rankChange = isMe && prevRank && activeBoard?.my_rank
                ? prevRank - activeBoard.my_rank
                : 0;

              return (
                <div
                  key={entry.player_id}
                  className={`flex items-center gap-3 rounded-xl px-3.5 py-3 transition-all ${
                    isMe
                      ? 'ring-1 ring-indigo-500/40 shadow-lg shadow-indigo-500/10'
                      : ''
                  }`}
                  style={{
                    background: isMe
                      ? 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.08))'
                      : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                    border: isMe ? undefined : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {/* Rank */}
                  <div className={`w-8 text-center font-bold ${entry.rank <= 3 ? 'text-amber-400' : isMe ? 'text-indigo-400' : 'text-white/40'}`}>
                    {entry.rank <= 3 ? (
                      <span className="text-lg">{['🥇', '🥈', '🥉'][entry.rank - 1]}</span>
                    ) : (
                      entry.rank
                    )}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${isMe ? 'text-white' : 'text-white/80'}`}>
                      {entry.player_name}
                      {isMe && <span className="text-indigo-400 ml-1 text-xs">(You)</span>}
                    </div>
                    {entry.detail && (
                      <div className="text-[11px] text-white/40 truncate">{entry.detail}</div>
                    )}
                  </div>

                  {/* Value */}
                  <div className="text-right">
                    <div className={`text-sm font-bold ${isMe ? 'text-indigo-400' : 'text-white'}`}>
                      {typeof entry.value === 'number' ? (
                        Number.isInteger(entry.value) ? entry.value : entry.value.toFixed(1)
                      ) : entry.value}
                    </div>
                    <div className="text-[10px] text-white/30">{activeBoard?.unit}</div>
                  </div>

                  {/* Rank change */}
                  {isMe && rankChange !== 0 && (
                    <div className={`text-xs font-bold ${rankChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {rankChange > 0 ? `+${rankChange}` : rankChange}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PodiumCard({
  entry,
  medal,
  unit,
  color,
  featured,
}: {
  entry: LeaderboardEntry;
  medal: number;
  unit: string;
  color: string;
  featured?: boolean;
}) {
  const heights = ['h-28', 'h-24', 'h-20'];
  return (
    <div className={`flex flex-col items-center ${featured ? 'w-28' : 'w-24'}`}>
      {/* Avatar */}
      <div
        className={`${featured ? 'w-14 h-14' : 'w-11 h-11'} rounded-full flex items-center justify-center mb-2 shadow-lg`}
        style={{ background: MEDAL_GRADIENTS[medal] }}
      >
        <span className={`font-bold text-white ${featured ? 'text-lg' : 'text-sm'}`}>
          {entry.player_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
        </span>
      </div>
      <div className={`text-xs font-medium text-white/80 text-center truncate w-full ${featured ? 'mb-1' : ''}`}>
        {entry.player_name.split(' ')[0]}
      </div>
      <div className="text-sm font-bold text-white">
        {typeof entry.value === 'number' && !Number.isInteger(entry.value) ? entry.value.toFixed(1) : entry.value}
      </div>
      <div className="text-[10px] text-white/40">{unit}</div>
      {/* Podium bar */}
      <div
        className={`w-full ${heights[medal]} rounded-t-lg mt-2`}
        style={{
          background: `linear-gradient(180deg, ${color}30, ${color}10)`,
          borderTop: `2px solid ${color}60`,
        }}
      />
    </div>
  );
}
