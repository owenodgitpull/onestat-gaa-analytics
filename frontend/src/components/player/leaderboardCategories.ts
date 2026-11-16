/** The leaderboard categories (icon, short label, colour, what it measures): player portal and coach page share them. */
import { Trophy, Target, Shield, TrendingUp, Zap, Footprints, Clock, Star, Crown, Share2 } from 'lucide-react';

export const CATEGORIES = [
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

export const GPS_CATEGORIES = ['workhorse', 'speed_demon', 'sprint_king'];

export function emptyMessageFor(key: string, who: 'player' | 'coach' = 'player'): string {
  return GPS_CATEGORIES.includes(key)
    ? (who === 'coach' ? 'No GPS uploaded yet for this leaderboard.' : 'GPS data needs to be uploaded for this leaderboard. Ask your manager to upload match GPS files.')
    : key === 'clinical_rating' ? 'Players need at least 10 shots to qualify for the Clinical rating.'
    : key === 'iron_man' ? 'Training attendance needs to be recorded for this leaderboard.'
    : 'Match data will populate this leaderboard once results are recorded.';
}
