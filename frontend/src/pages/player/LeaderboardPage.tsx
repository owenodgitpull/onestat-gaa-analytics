import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { playerPortalAPI } from '../../services/playerPortalApi';
import { useAuth } from '../../contexts/AuthContext';
import { Trophy, Target, Shield, TrendingUp, Zap, Footprints, Clock, Star, Info, Crown, Share2, ChevronRight } from 'lucide-react';
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

  // Competition + recent-matches filter — applies to every category, not
  // just the active tab, so switching tabs keeps whatever scope is chosen.
  const [competition, setCompetition] = useState<string | null>(null);
  const [lastN, setLastN] = useState<number | null>(null);
  const filter = { competition, lastN };
  const hasFilter = !!(competition || lastN);

  const { data: competitions } = useQuery({
    queryKey: ['player-portal-competitions'],
    queryFn: playerPortalAPI.getCompetitions,
    staleTime: 1000 * 60 * 30,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['player-leaderboards', competition, lastN],
    queryFn: () => playerPortalAPI.getAllLeaderboards(filter),
    staleTime: 1000 * 60 * 5, // Standings only change after a match/GPS/training upload
  });

  const { data: fullData, isLoading: fullLoading } = useQuery({
    queryKey: ['player-leaderboard-full', activeCategory, competition, lastN],
    queryFn: () => playerPortalAPI.getSingleLeaderboard(activeCategory, filter),
    staleTime: 1000 * 60 * 5,
  });

  // Cache previous ranks in localStorage for rank change indicators — only
  // meaningful for the unfiltered, all-matches view, since a filtered
  // ranking isn't comparable to the baseline it'd otherwise be diffed against.
  useEffect(() => {
    if (data?.leaderboards && !hasFilter) {
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
  }, [data, hasFilter]);

  // Category tabs scroll affordance — the row genuinely can't fit without
  // scrolling (10 categories), unlike the filter row above (fixed to a
  // 2-row layout instead, see below, so nothing there is ever hidden).
  // Two signals, not one: a persistent edge-fade that tracks real scroll
  // position (so it's never showing "more" when there isn't any), plus a
  // one-time swipe nudge for first-time visitors only — shown once, then
  // never again, tracked in localStorage.
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [showRightFade, setShowRightFade] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);

  const updateFadeState = useCallback(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth + 2;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setShowRightFade(hasOverflow && !atEnd);
  }, []);

  useEffect(() => {
    updateFadeState();
    window.addEventListener('resize', updateFadeState);
    return () => window.removeEventListener('resize', updateFadeState);
  }, [updateFadeState]);

  useEffect(() => {
    const seen = localStorage.getItem('leaderboard_swipe_hint_seen');
    const el = tabsScrollRef.current;
    if (!seen && el && el.scrollWidth > el.clientWidth + 2) {
      setShowSwipeHint(true);
      const timer = setTimeout(() => dismissSwipeHint(), 3200);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissSwipeHint = () => {
    setShowSwipeHint(false);
    localStorage.setItem('leaderboard_swipe_hint_seen', '1');
  };

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

      {/* Scope filter — competition + recent-matches window, applies to every
          category. Two full-width rows, never scrolled — a competition name
          can be arbitrarily long, so rather than compete for horizontal
          space with the match-count control (which was getting pushed
          off-screen, invisible unless the user knew to scroll), each
          control gets its own row and is always fully visible. */}
      <div className="space-y-2 px-1">
        <select
          value={competition ?? ''}
          onChange={(e) => setCompetition(e.target.value || null)}
          className="w-full bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-white/30"
        >
          <option value="">All competitions</option>
          {(competitions || []).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { label: 'All matches', value: null },
            { label: 'Last 5', value: 5 },
            { label: 'Last 3', value: 3 },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => setLastN(opt.value)}
              className={`rounded-lg px-2 py-2 text-xs font-medium text-center transition-colors ${
                lastN === opt.value
                  ? 'bg-white/15 text-white border border-white/20'
                  : 'bg-white/[0.04] text-white/50 border border-transparent hover:bg-white/[0.08]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category Tabs — horizontal scroll (10 categories genuinely don't
          fit on screen at once). Two affordances signal there's more:
          a persistent right-edge fade that tracks real scroll position
          (never shows "more" once actually scrolled to the end), and a
          one-time animated swipe nudge for first-time visitors, shown once
          ever (localStorage), dismissed the moment the row is scrolled. */}
      <div className="relative">
        <div
          ref={tabsScrollRef}
          onScroll={() => { updateFadeState(); if (showSwipeHint) dismissSwipeHint(); }}
          className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x scrollbar-hide"
        >
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

        {/* Persistent edge fade — only rendered while there's genuinely more
            to scroll to, fades the last visible tab into the background
            rather than cropping it hard. */}
        {showRightFade && (
          <div
            className="pointer-events-none absolute top-0 right-0 bottom-1 w-10"
            style={{ background: 'linear-gradient(to right, transparent, rgba(10,14,20,0.85))' }}
          />
        )}

        {/* One-time swipe hint — a small pill that nudges right twice then
            fades, overlaid at the trailing edge. Never shown again after
            the first time (or the instant the user actually scrolls). */}
        {showSwipeHint && (
          <div
            className="pointer-events-none absolute -bottom-6 right-1 flex items-center gap-1 text-[10px] text-white/50"
            style={{ animation: 'leaderboard-swipe-fade 3.2s ease forwards' }}
          >
            <span>Swipe for more</span>
            <ChevronRight size={12} style={{ animation: 'leaderboard-swipe-nudge 1s ease-in-out infinite' }} />
          </div>
        )}
      </div>
      <style>{`
        @keyframes leaderboard-swipe-nudge {
          0%, 100% { transform: translateX(0); opacity: 0.5; }
          50% { transform: translateX(4px); opacity: 1; }
        }
        @keyframes leaderboard-swipe-fade {
          0% { opacity: 0; transform: translateY(-2px); }
          15% { opacity: 1; transform: translateY(0); }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>

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
