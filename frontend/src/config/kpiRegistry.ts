/**
 * KPI Registry — master list of all KPI cards with metadata.
 *
 * Each entry defines the front/flip pair, theme, and tooltip content.
 * The `id` is a pairing ID (not individual card key) used by the KPI library
 * to show/hide pairs. The `frontKey`/`flipKey` map to backend KPICardItem.key.
 */

export interface KPIRegistryEntry {
  /** Unique pairing ID */
  id: string
  /** Front card backend key */
  frontKey: string
  /** Front card display label */
  frontLabel: string
  /** Flip card backend key (null if standalone) */
  flipKey: string | null
  /** Flip card display label */
  flipLabel: string | null
  /** Theme grouping */
  theme: string
  /** Explanations for the info modal */
  explanations: Record<string, { what: string; formula: string }>
}

export const KPI_REGISTRY: KPIRegistryEntry[] = [
  // --- Existing cards ---
  {
    id: 'productivity-shot',
    frontKey: 'productivity',
    frontLabel: 'Productivity Score',
    flipKey: 'shot_efficiency',
    flipLabel: 'Shot Efficiency',
    theme: 'Scoring Output',
    explanations: {
      productivity: {
        what: 'How efficiently we turn possessions into scores — higher means we make the most of every attack',
        formula: '(Total points scored ÷ Total possessions) × 10. Above 3.0 is strong, below 2.0 needs work.',
      },
      shot_efficiency: {
        what: 'Percentage of shots that result in scores — shows how clinical we are in front of the posts',
        formula: '(Scores ÷ Total shots) × 100. Includes points, goals, and 2-pointers.',
      },
    },
  },
  {
    id: 'turnover-fouls',
    frontKey: 'turnover_diff',
    frontLabel: 'Turnover Differential',
    flipKey: 'fouls_per_game',
    flipLabel: 'Fouls Per Game',
    theme: 'Defence',
    explanations: {
      turnover_diff: {
        what: 'Turnovers won minus lost — positive means we\'re winning more ball than giving it away',
        formula: 'Turnovers won − Turnovers lost. A positive number means we\'re coming out on top in the battle for possession.',
      },
      fouls_per_game: {
        what: 'Average fouls committed per match — fewer means less frees conceded to opposition',
        formula: 'Total fouls ÷ Matches played. Below 12 is disciplined, above 15 is a concern.',
      },
    },
  },
  {
    id: 'kickout-conceded',
    frontKey: 'kickout_retention',
    frontLabel: 'Kickout Retention %',
    flipKey: 'avg_conceded',
    flipLabel: 'Avg Conceded',
    theme: 'Restarts',
    explanations: {
      kickout_retention: {
        what: 'How often we retain our own goalkeeper\'s kickouts — crucial for building attacks from restarts',
        formula: '(Own kickouts retained ÷ Total own kickouts) × 100. Target: above 60%.',
      },
      avg_conceded: {
        what: 'Average total points conceded per match — lower means a tighter defence',
        formula: 'Total opponent points (goals×3 + points) ÷ Matches played.',
      },
    },
  },
  {
    id: 'avg-scored',
    frontKey: 'avg_scored',
    frontLabel: 'Avg Scored',
    flipKey: null,
    flipLabel: null,
    theme: 'Scoring Output',
    explanations: {
      avg_scored: {
        what: 'Average total points scored per match (goals×3 + points)',
        formula: 'Total points scored ÷ Matches played.',
      },
    },
  },

  // --- New cards (8–17) ---
  {
    id: 'score-per-possession',
    frontKey: 'score_per_possession',
    frontLabel: 'Score Per Possession %',
    flipKey: 'opp_score_per_possession',
    flipLabel: 'Opp Score Per Poss %',
    theme: 'Transition & Efficiency',
    explanations: {
      score_per_possession: {
        what: 'The percentage of your total possessions that end in a score. The north-star efficiency metric — it strips away possession volume and asks how often you actually hurt the opposition when you have the ball.',
        formula: '(Total scoring possessions ÷ Total possessions) × 100. Above 30% is elite, 22–30% is solid, below 22% needs attention.',
      },
      opp_score_per_possession: {
        what: 'How efficiently opponents convert their possessions into scores against you. A low number means your defensive system is forcing opponents into unproductive possessions.',
        formula: '(Opponent scoring possessions ÷ Opponent total possessions) × 100. Below 20% is excellent, 20–27% is solid, above 27% means opponents are finding it too easy.',
      },
    },
  },
  {
    id: 'turnover-to-score',
    frontKey: 'turnover_to_score',
    frontLabel: 'Turnover-to-Score Rate',
    flipKey: 'turnovers_conceded',
    flipLabel: 'Turnovers Conceded',
    theme: 'Transition & Efficiency',
    explanations: {
      turnover_to_score: {
        what: 'Of all turnovers your team wins, what percentage result in a score. Winning the ball back means nothing if you don\'t capitalise.',
        formula: '(Scores from turnovers won ÷ Total turnovers won) × 100. Above 35% is excellent, 25–35% is good, below 25% needs work.',
      },
      turnovers_conceded: {
        what: 'Average times per game your team loses possession through errors — misplaced passes, overcarrying, fumbles.',
        formula: 'Total turnovers conceded ÷ Matches played. Below 10 is disciplined, 10–16 is average, above 16 is careless.',
      },
    },
  },
  {
    id: 'pts-conceded-play',
    frontKey: 'pts_conceded_from_play',
    frontLabel: 'Pts Conceded From Play',
    flipKey: 'frees_in_scoring_range',
    flipLabel: 'Frees in Scoring Range',
    theme: 'Defensive System',
    explanations: {
      pts_conceded_from_play: {
        what: 'Average points conceded per game specifically from open play — excluding frees, 45s, penalties. Isolates your defensive structure from your discipline.',
        formula: 'Total opponent scores from play ÷ Matches played. Below 5 is excellent, 5–8 is solid, above 8 means the shape is being breached.',
      },
      frees_in_scoring_range: {
        what: 'Average frees given away per game within realistic scoring range (inside 45m line). These fouls hand the opposition easy scores.',
        formula: 'Fouls in opponent\'s 45m zone ÷ Matches played. Below 5 is disciplined, 5–8 is average, above 8 is a problem.',
      },
    },
  },
  {
    id: 'clean-sheet',
    frontKey: 'clean_sheet_rate',
    frontLabel: 'Clean Sheet Rate',
    flipKey: 'goals_conceded_pg',
    flipLabel: 'Goals Conceded / Game',
    theme: 'Defensive Solidity',
    explanations: {
      clean_sheet_rate: {
        what: 'Percentage of matches where your team conceded zero goals. Goals are game-changers in GAA — keeping them out is a massive competitive advantage.',
        formula: '(Matches with zero goals conceded ÷ Total matches) × 100. Above 50% is exceptional, 30–50% is strong, below 30% is a concern.',
      },
      goals_conceded_pg: {
        what: 'Average goals conceded per match. Even when goals are conceded, is it 1 or 3? A critical defensive metric.',
        formula: 'Total goals conceded ÷ Matches played. Below 0.7 is excellent, 0.7–1.2 is manageable, above 1.2 needs attention.',
      },
    },
  },
  {
    id: 'inside-45',
    frontKey: 'opp_inside_45',
    frontLabel: 'Opp Inside 45 Entries',
    flipKey: 'own_inside_45',
    flipLabel: 'Your Inside 45 Entries',
    theme: 'Territory',
    explanations: {
      opp_inside_45: {
        what: 'Average times per game the opposition gets the ball into your defensive 45. A leading indicator of defensive pressure — measures threat before it becomes a score.',
        formula: 'Opponent events in your 45m zone ÷ Matches played. Below 16 is excellent pressing, 16–22 is average, above 22 means the press is bypassed regularly.',
      },
      own_inside_45: {
        what: 'How often your team gets the ball into the opposition\'s 45 per game. Measures attacking penetration — are you getting into scoring range?',
        formula: 'Team events in opponent 45m zone ÷ Matches played. Above 24 is strong, 18–24 is average, below 18 means struggling to penetrate.',
      },
    },
  },
  {
    id: 'from-play-free',
    frontKey: 'from_play_score_pct',
    frontLabel: 'From Play Score %',
    flipKey: 'free_conversion',
    flipLabel: 'Free Conversion %',
    theme: 'Scoring Quality',
    explanations: {
      from_play_score_pct: {
        what: 'Percentage of your total score from open play. Elite teams generate the majority from play — over-reliance on dead balls suggests the attack isn\'t functioning.',
        formula: '(Score value from play ÷ Total score value) × 100. Above 60% is strong, 45–60% is balanced, below 45% is dead-ball dependent.',
      },
      free_conversion: {
        what: 'Accuracy of your free-taker(s) across the season. Frees are expected scores — converting below 70% is leaving points on the table.',
        formula: '(Frees scored ÷ Frees attempted) × 100. Above 80% is elite, 70–80% is solid, below 70% is a concern.',
      },
    },
  },
  {
    id: 'goal-threat',
    frontKey: 'goal_scoring_rate',
    frontLabel: 'Goal Scoring Rate',
    flipKey: 'goal_chances_created',
    flipLabel: 'Goal Chances Created',
    theme: 'Goal Threat',
    explanations: {
      goal_scoring_rate: {
        what: 'Average goals scored per match. A team that consistently scores goals puts opponents under psychological pressure.',
        formula: 'Total goals scored ÷ Matches played. Above 1.5 is a strong goal threat, 1.0–1.5 is average, below 1.0 is struggling.',
      },
      goal_chances_created: {
        what: 'Total goal-scoring opportunities per game — including goals, saves, and misses. Measures goal threat even when finishing isn\'t clinical.',
        formula: '(Goals + saves + goal misses) ÷ Matches played. Above 3.0 is strong, 2.0–3.0 is average, below 2.0 needs work.',
      },
    },
  },
  {
    id: 'opp-kickout',
    frontKey: 'opp_kickout_win',
    frontLabel: 'Opp Kickout Win %',
    flipKey: null,
    flipLabel: null,
    theme: 'Restart Attack',
    explanations: {
      opp_kickout_win: {
        what: 'Percentage of opposition kickouts your team wins. Winning opp kickouts is high-value — you\'re taking the ball in an advanced position with their defence disorganised.',
        formula: '(Opposition kickouts won by your team ÷ Total opp kickouts) × 100. Above 40% is dominant, 30–40% is competitive, below 30% lets them restart easily.',
      },
    },
  },
  {
    id: 'discipline-cards',
    frontKey: 'card_rate',
    frontLabel: 'Card Rate Per Game',
    flipKey: 'mins_14_men',
    flipLabel: 'Minutes With 14 Men',
    theme: 'Discipline',
    explanations: {
      card_rate: {
        what: 'Average yellow, black, and red cards per match. Measures severity of indiscipline — black cards are devastating (10 minutes with 14 men).',
        formula: 'Total cards ÷ Matches played. Below 1.0 is disciplined, 1.0–2.0 is average, above 2.0 is a systemic problem.',
      },
      mins_14_men: {
        what: 'Average minutes per game played with a numerical disadvantage due to cards. Quantifies the actual cost of indiscipline in game time.',
        formula: 'Total minutes at 14 men ÷ Matches played. Under 5 is disciplined, 5–15 is manageable, above 15 is critical.',
      },
    },
  },
]

/** Default visible KPI pairing IDs (first 4 shown by default) */
export const DEFAULT_VISIBLE_KPIS = [
  'productivity-shot',
  'turnover-fouls',
  'kickout-conceded',
  'avg-scored',
]
