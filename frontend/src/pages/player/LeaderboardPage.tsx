import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { playerPortalAPI, type LeaderboardEntry } from '../../services/playerPortalApi';
import { useAuth } from '../../contexts/AuthContext';
import { Trophy, Target, Shield, TrendingUp, Zap, Footprints, Clock, Star, Info } from 'lucide-react';
import PlayerHeader from '../../components/PlayerHeader';

const CATEGORIES = [
  { key: 'top_scorer', icon: Trophy, label: 'Top Scorer', color: '#f59e0b', description: 'Total points scored across all matches (goals=3, points=1, 2-ptrs=2)' },
  { key: 'clinical_rating', icon: Target, label: 'Clinical', color: '#10b981', description: 'Shooting accuracy % — minimum 10 shots to qualify' },
  { key: 'the_wall', icon: Shield, label: 'The Wall', color: '#ef4444', description: 'Defensive actions: blocks, interceptions, and turnovers won' },
  { key: 'workhorse', icon: TrendingUp, label: 'Workhorse', color: '#3b82f6', description: 'Average distance covered per match from GPS data' },
  { key: 'speed_demon', icon: Zap, label: 'Speed', color: '#06b6d4', description: 'Highest top speed recorded across matches and training (GPS)' },
  { key: 'sprint_king', icon: Footprints, label: 'Sprints', color: '#10b981', description: 'Average sprint count per match from GPS data' },
  { key: 'iron_man', icon: Clock, label: 'Iron Man', color: '#14b8a6', description: 'Training attendance rate — shows who consistently turns up' },
  { key: 'motm_points', icon: Star, label: 'MOTM', color: '#eab308', description: 'Man of the Match weighted points: goals (+10), 2-ptrs (+5), points (+3), blocks (+2), interceptions (+2), turnovers won (+2), kickouts won (+2), turnovers lost (−1)' },
];

const MEDAL_GRADIENTS = [
  'linear-gradient(135deg, #fbbf24, #f59e0b)', // Gold
  'linear-gradient(135deg, #d1d5db, #9ca3af)', // Silver
  'linear-gradient(135deg, #d97706, #b45309)', // Bronze
];

const GPS_CATEGORIES = ['workhorse', 'speed_demon', 'sprint_king'];

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialCategory = searchParams.get('category') || 'top_scorer';
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [showInfo, setShowInfo] = useState(false);

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
      <PlayerHeader title="Leaderboards" />

      {/* Category Tabs — horizontal scroll */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x scrollbar-hide">
        {CATEGORIES.map((cat) => {
          const active = cat.key === activeCategory;
          const board = data?.leaderboards?.find((b) => b.category === cat.key);
          return (
            <button
              key={cat.key}
              onClick={() => { setActiveCategory(cat.key); setShowInfo(false); }}
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

      {/* Category Description */}
      <div className="flex items-center gap-2 px-1">
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="p-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          <Info size={14} className="text-white/30" />
        </button>
        <span className="text-xs text-white/40 font-medium">{activeMeta.label}</span>
        {activeBoard && (
          <span className="text-[10px] text-white/25 ml-auto">{activeBoard.total_players} players ranked</span>
        )}
      </div>
      {showInfo && (
        <div
          className="rounded-lg px-3 py-2 text-xs text-white/60 -mt-3"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {activeMeta.description}
        </div>
      )}

      {isLoading || fullLoading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-40 rounded-2xl bg-white/5" />
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 rounded-xl bg-white/5" />)}
        </div>
      ) : fullRanking.length === 0 ? (
        /* Empty state */
        <div className="text-center py-12">
          <activeMeta.icon size={40} className="mx-auto mb-3" style={{ color: `${activeMeta.color}40` }} />
          <p className="text-white/50 text-sm font-medium mb-1">No data yet</p>
          <p className="text-white/30 text-xs max-w-[260px] mx-auto">
            {GPS_CATEGORIES.includes(activeCategory)
              ? 'GPS data needs to be uploaded for this leaderboard. Ask your manager to upload match GPS files.'
              : activeCategory === 'clinical_rating'
              ? 'Players need at least 10 shots to qualify for the Clinical rating.'
              : activeCategory === 'iron_man'
              ? 'Training attendance needs to be recorded for this leaderboard.'
              : 'Match data will populate this leaderboard once results are recorded.'}
          </p>
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
                      ? 'ring-1 ring-emerald-500/40 shadow-lg shadow-emerald-500/10'
                      : ''
                  }`}
                  style={{
                    background: isMe
                      ? 'linear-gradient(135deg, rgba(0,230,118,0.15), rgba(0,176,255,0.08))'
                      : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                    border: isMe ? undefined : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {/* Rank */}
                  <div className={`w-8 text-center font-bold ${entry.rank <= 3 ? 'text-amber-400' : isMe ? 'text-emerald-400' : 'text-white/40'}`}>
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
                      {isMe && <span className="text-emerald-400 ml-1 text-xs">(You)</span>}
                    </div>
                    {entry.detail && (
                      <div className="text-[11px] text-white/40 truncate">{entry.detail}</div>
                    )}
                  </div>

                  {/* Value */}
                  <div className="text-right">
                    <div className={`text-sm font-bold ${isMe ? 'text-emerald-400' : 'text-white'}`}>
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

          {/* Qualification note for clinical */}
          {activeCategory === 'clinical_rating' && fullRanking.length > 0 && fullRanking.length < 5 && (
            <p className="text-[11px] text-white/25 text-center mt-2">
              Minimum 10 shots required to qualify
            </p>
          )}
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
