import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { playerPortalAPI } from '../../services/playerPortalApi';
import { useAuth } from '../../contexts/AuthContext';
import { Trophy, Target, Shield, TrendingUp, Zap, Footprints, Clock, Star, Info, Crown, Share2 } from 'lucide-react';
import PlayerHeader from '../../components/PlayerHeader';
import LeaderboardCategoryView from '../../components/player/LeaderboardCategoryView';

const CATEGORIES = [
  { key: 'top_scorer', icon: Trophy, label: 'Top Scorer', color: '#f59e0b', description: 'Total points scored across all matches (goals=3, points=1, 2-ptrs=2)' },
  { key: 'clinical_rating', icon: Target, label: 'Clinical', color: '#10b981', description: 'Shooting accuracy % — minimum 10 shots to qualify' },
  { key: 'the_wall', icon: Shield, label: 'The Wall', color: '#ef4444', description: 'Defensive actions: blocks, interceptions, and turnovers won' },
  { key: 'workhorse', icon: TrendingUp, label: 'Workhorse', color: '#3b82f6', description: 'Average distance covered per match from GPS data' },
  { key: 'speed_demon', icon: Zap, label: 'Speed', color: '#06b6d4', description: 'Highest top speed recorded across matches and training (GPS)' },
  { key: 'sprint_king', icon: Footprints, label: 'Sprints', color: '#10b981', description: 'Average sprint count per match from GPS data' },
  { key: 'iron_man', icon: Clock, label: 'Iron Man', color: '#14b8a6', description: 'Training attendance rate — shows who consistently turns up' },
  { key: 'motm_points', icon: Star, label: 'MOTM', color: '#eab308', description: 'Man of the Match weighted points: goals (+10), 2-ptrs (+5), points (+3), blocks (+2), interceptions (+2), turnovers won (+2), kickouts won (+2), turnovers lost (−1)' },
  { key: 'kickout_king', icon: Crown, label: 'Kickouts', color: '#22d3ee', description: 'Total kickouts won — clean or off a break, our restart or theirs' },
  { key: 'orchestrator', icon: Share2, label: 'Orchestrator', color: '#8b5cf6', description: 'Possessions + passes made, combined and averaged per match — only counts matches recorded with ball-carrier tracking on' },
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
    staleTime: 1000 * 60 * 5, // Standings only change after a match/GPS/training upload
  });

  const { data: fullData, isLoading: fullLoading } = useQuery({
    queryKey: ['player-leaderboard-full', activeCategory],
    queryFn: () => playerPortalAPI.getSingleLeaderboard(activeCategory),
    staleTime: 1000 * 60 * 5,
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

  const activeMeta = CATEGORIES.find((c) => c.key === activeCategory)!;
  const activeBoard = data?.leaderboards?.find((b) => b.category === activeCategory);
  const fullRanking = fullData?.ranking || [];

  const emptyMessage = GPS_CATEGORIES.includes(activeCategory)
    ? 'GPS data needs to be uploaded for this leaderboard. Ask your manager to upload match GPS files.'
    : activeCategory === 'clinical_rating'
    ? 'Players need at least 10 shots to qualify for the Clinical rating.'
    : activeCategory === 'iron_man'
    ? 'Training attendance needs to be recorded for this leaderboard.'
    : 'Match data will populate this leaderboard once results are recorded.';

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

      {/* "The Wall" is the only leaderboard whose per-player detail line uses
          bare single-letter abbreviations (1B 1I 1TO) — every other
          category spells things out in full, so this one gets a legend
          shown up front rather than tucked behind the (i) toggle, since
          "I" is easy to misread as "L" at small sizes. */}
      {activeCategory === 'the_wall' && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 -mt-2 text-[10px] text-white/35">
          <span><b className="text-white/60">B</b> = Blocks</span>
          <span><b className="text-white/60">I</b> = Interceptions</span>
          <span><b className="text-white/60">TO</b> = Turnovers Won</span>
        </div>
      )}

      <LeaderboardCategoryView
        board={activeBoard}
        ranking={fullRanking}
        isLoading={isLoading || fullLoading}
        myPlayerId={user?.player_id}
        categoryKey={activeCategory}
        icon={activeMeta.icon}
        color={activeMeta.color}
        emptyMessage={emptyMessage}
        qualificationNote={activeCategory === 'clinical_rating' ? 'Minimum 10 shots required to qualify' : undefined}
      />
    </div>
  );
}
