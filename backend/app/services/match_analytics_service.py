from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from app.models.match import Match
from app.models.match_event import MatchEvent
from app.models.possession_event import PossessionEvent


_SCORE_TYPES = {'goal', 'point', 'two_point'}
_FREE_SCORE_TYPES = {'point_free', 'two_point_free', 'forty_five', 'penalty_goal'}
_FREE_ATTEMPT_TYPES = {'point_free', 'two_point_free', 'forty_five', 'penalty_goal', 'forty_five_missed', 'penalty_miss'}
_OWN_KICKOUT_WON_TYPES = {'own_kickout_won', 'own_kickout_won_break', 'kickout_won'}
_OPP_KICKOUT_WON_BY_US_TYPES = {'opp_kickout_opposition_won', 'opp_kickout_opposition_won_break'}
_TURNOVER_WON_TYPES = {'turnover_won', 'tackle_won', 'block', 'interception'}
_KICKOUT_POSSESSION_CHANGE_TYPES = (
    _OWN_KICKOUT_WON_TYPES
    | _OPP_KICKOUT_WON_BY_US_TYPES
    | {'own_kickout_opposition_won', 'own_kickout_opposition_won_break', 'opp_kickout_won', 'opp_kickout_won_break'}
)
_SHOT_TYPES = {
    'goal', 'point', 'two_point', 'wide', 'short', 'saved', 'hit_post',
    'point_free', 'two_point_free', 'wide_free', 'forty_five', 'forty_five_missed',
    'penalty_goal', 'penalty_miss',
}
_KICKOUT_WON_TYPES = {'own_kickout_won', 'own_kickout_won_break', 'kickout_won'}
_KICKOUT_ALL_TYPES = {
    'own_kickout_won', 'own_kickout_opposition_won',
    'own_kickout_won_break', 'own_kickout_opposition_won_break',
    'own_kickout_sideline', 'kickout_won', 'kickout_lost',
}


def _safe_pct(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return round(numerator / denominator * 100, 1)


def _score_points(et_val: str) -> int:
    if et_val in ('goal', 'penalty_goal'):
        return 3
    if et_val == 'two_point':
        return 2
    if et_val in ('point', 'point_free', 'two_point_free', 'forty_five'):
        return 1
    return 0


def _et_val(et) -> str:
    return et.value if hasattr(et, 'value') else str(et)


def _team_val(team) -> str:
    return team.value if hasattr(team, 'value') else str(team)


def _classify_score_origin(preceding_events: list, scoring_team: str) -> str:
    for ev in reversed(preceding_events):
        et = ev[0]
        team = ev[1]
        if et in _FREE_ATTEMPT_TYPES:
            continue
        if scoring_team == 'own':
            if et in _OWN_KICKOUT_WON_TYPES and team == 'own':
                return 'own_kickout'
            if et in _OPP_KICKOUT_WON_BY_US_TYPES:
                return 'opp_kickout'
            if et in _TURNOVER_WON_TYPES and team == 'own':
                return 'turnover'
        else:
            if et in {'opp_kickout_won', 'opp_kickout_won_break'} and team == 'opponent':
                return 'own_kickout'
            if et in {'own_kickout_opposition_won', 'own_kickout_opposition_won_break'}:
                return 'opp_kickout'
            if et in _TURNOVER_WON_TYPES and team == 'opponent':
                return 'turnover'
        if et in _KICKOUT_POSSESSION_CHANGE_TYPES or et in _TURNOVER_WON_TYPES:
            break
    return 'open_play'


async def get_score_origins(db: AsyncSession, match_id: UUID, club_id: UUID) -> dict:
    result = await db.execute(
        select(MatchEvent.event_type, MatchEvent.team, MatchEvent.minute)
        .where(MatchEvent.match_id == match_id)
        .order_by(func.coalesce(MatchEvent.minute, 0).asc(), MatchEvent.created_at.asc())
    )
    events = result.all()

    own = {'own_kickout': 0, 'opp_kickout': 0, 'turnover': 0, 'free': 0, 'open_play': 0, 'total': 0}
    opp = {'own_kickout': 0, 'opp_kickout': 0, 'turnover': 0, 'free': 0, 'open_play': 0, 'total': 0}

    for i, row in enumerate(events):
        et = _et_val(row[0])
        team = _team_val(row[1])
        bucket = own if team == 'own' else opp

        if et in _FREE_SCORE_TYPES:
            bucket['free'] += 1
            bucket['total'] += 1
        elif et in _SCORE_TYPES:
            preceding = [(_et_val(e[0]), _team_val(e[1])) for e in events[:i]]
            origin = _classify_score_origin(preceding, team)
            bucket[origin] += 1
            bucket['total'] += 1

    return {'own': own, 'opp': opp}


async def get_scoreable_frees(db: AsyncSession, match_id: UUID, club_id: UUID) -> dict:
    result = await db.execute(
        select(MatchEvent.event_type, MatchEvent.team, MatchEvent.minute, MatchEvent.pitch_x, MatchEvent.pitch_y)
        .where(MatchEvent.match_id == match_id)
        .order_by(func.coalesce(MatchEvent.minute, 0).asc(), MatchEvent.created_at.asc())
    )
    events = result.all()

    fouls_total = 0
    fouls_in_range = 0
    fouls_out_of_range = 0
    conversions = 0
    foul_locations = []

    for i, row in enumerate(events):
        et = _et_val(row[0])
        team = _team_val(row[1])
        minute = row[2]
        pitch_x = row[3]
        pitch_y = row[4]

        if et == 'foul_committed' and team == 'own':
            fouls_total += 1
            # Opponent kicks free toward our goal (pitch_x=0); scoreable within ~50m of our goal
            in_range = pitch_x is not None and pitch_x < 35
            if in_range:
                fouls_in_range += 1
            else:
                fouls_out_of_range += 1

            converted = False
            if in_range:
                foul_minute = minute if minute is not None else 0
                for ev2 in events[i + 1:]:
                    et2 = _et_val(ev2[0])
                    min2 = ev2[2] if ev2[2] is not None else 0
                    if min2 - foul_minute > 3:
                        break
                    if et2 in _FREE_SCORE_TYPES:
                        converted = True
                        break
                if converted:
                    conversions += 1

            foul_locations.append({
                'pitch_x': pitch_x,
                'pitch_y': pitch_y,
                'in_range': in_range,
                'converted': converted,
            })

    return {
        'fouls_total': fouls_total,
        'fouls_in_scoring_range': fouls_in_range,
        'fouls_out_of_range': fouls_out_of_range,
        'opponent_conversions': conversions,
        'conversion_rate_pct': _safe_pct(conversions, fouls_in_range),
        'foul_locations': foul_locations,
    }


async def get_attack_efficiency(db: AsyncSession, match_id: UUID, club_id: UUID) -> dict:
    poss_result = await db.execute(
        select(PossessionEvent.team, PossessionEvent.minute, PossessionEvent.pitch_x)
        .where(PossessionEvent.match_id == match_id)
        .order_by(func.coalesce(PossessionEvent.minute, 0).asc(), PossessionEvent.created_at.asc())
    )
    poss_events = poss_result.all()

    shots_result = await db.execute(
        select(MatchEvent.event_type, MatchEvent.team)
        .where(
            and_(
                MatchEvent.match_id == match_id,
                MatchEvent.event_type.in_(list(_SHOT_TYPES)),
            )
        )
    )
    shot_events = shots_result.all()

    own_shots = sum(1 for row in shot_events if _team_val(row[1]) == 'own')
    opp_shots = sum(1 for row in shot_events if _team_val(row[1]) == 'opponent')

    if not poss_events:
        own_attacks = max(1, round(own_shots * 1.5))
        opp_attacks = max(1, round(opp_shots * 1.5))
        return {
            'own': {
                'attacks': own_attacks,
                'shots': own_shots,
                'attack_to_shot_pct': _safe_pct(own_shots, own_attacks),
                'estimated': True,
            },
            'opp': {
                'attacks': opp_attacks,
                'shots': opp_shots,
                'attack_to_shot_pct': _safe_pct(opp_shots, opp_attacks),
                'estimated': True,
            },
        }

    def _count_attacks(team_filter: str, threshold_x: float, compare_gt: bool) -> int:
        count = 0
        in_attack = False
        last_team = None
        last_minute = None

        for row in poss_events:
            t = _team_val(row[0])
            m = row[1] if row[1] is not None else 0
            px = row[2]

            if t != team_filter:
                in_attack = False
                last_team = t
                last_minute = m
                continue

            gap = (last_minute is not None) and (m - last_minute > 5)
            if last_team != team_filter or gap:
                in_attack = False

            if px is not None:
                reached = (px > threshold_x) if compare_gt else (px < threshold_x)
            else:
                reached = False

            if reached and not in_attack:
                count += 1
                in_attack = True

            last_team = t
            last_minute = m

        return count

    own_attacks = _count_attacks('own', 55.0, True)
    opp_attacks = _count_attacks('opponent', 45.0, False)

    return {
        'own': {
            'attacks': own_attacks,
            'shots': own_shots,
            'attack_to_shot_pct': _safe_pct(own_shots, own_attacks),
        },
        'opp': {
            'attacks': opp_attacks,
            'shots': opp_shots,
            'attack_to_shot_pct': _safe_pct(opp_shots, opp_attacks),
        },
    }


async def _compute_match_stats(db: AsyncSession, m_id: UUID) -> dict:
    result = await db.execute(
        select(MatchEvent.event_type, MatchEvent.team)
        .where(MatchEvent.match_id == m_id)
    )
    events = result.all()

    scores = 0
    conceded = 0
    shots = 0
    wides = 0
    turnovers_won = 0
    turnovers_lost = 0
    kickouts_won = 0
    kickouts_total = 0

    for row in events:
        et = _et_val(row[0])
        team = _team_val(row[1])

        if team == 'own':
            scores += _score_points(et)
            if et in _SHOT_TYPES:
                shots += 1
            if et in ('wide', 'wide_free', 'forty_five_missed'):
                wides += 1
            if et in ('turnover_won', 'tackle_won'):
                turnovers_won += 1
            if et == 'turnover_lost':
                turnovers_lost += 1
            if et in _KICKOUT_WON_TYPES:
                kickouts_won += 1
            if et in _KICKOUT_ALL_TYPES:
                kickouts_total += 1
        else:
            conceded += _score_points(et)

    return {
        'scores': float(scores),
        'conceded': float(conceded),
        'shots': float(shots),
        'wides': float(wides),
        'turnovers_won': float(turnovers_won),
        'turnovers_lost': float(turnovers_lost),
        'kickout_retention_pct': _safe_pct(kickouts_won, kickouts_total),
    }


async def get_season_benchmark(db: AsyncSession, match_id: UUID, club_id: UUID) -> dict:
    matches_result = await db.execute(
        select(Match.id, Match.opponent, Match.match_date)
        .where(and_(Match.club_id == club_id, Match.status == 'completed'))
        .order_by(Match.match_date.asc())
    )
    completed_matches = matches_result.all()

    empty_stats = {
        'scores': 0.0, 'conceded': 0.0, 'shots': 0.0, 'wides': 0.0,
        'turnovers_won': 0.0, 'turnovers_lost': 0.0, 'kickout_retention_pct': 0.0,
    }

    if not completed_matches:
        return {
            'current': empty_stats,
            'season_avg': empty_stats,
            'match_count': 0,
            'trend': [],
        }

    all_stats = []
    for m_id, opponent, match_date in completed_matches:
        stats = await _compute_match_stats(db, m_id)
        all_stats.append({
            'match_id': str(m_id),
            'opponent': opponent or '',
            'date': match_date.strftime('%Y-%m-%d') if match_date else '',
            **stats,
        })

    match_count = len(all_stats)
    stat_keys = ['scores', 'conceded', 'shots', 'wides', 'turnovers_won', 'turnovers_lost', 'kickout_retention_pct']

    season_avg = {
        k: round(sum(s[k] for s in all_stats) / match_count, 1)
        for k in stat_keys
    }

    current_row = next((s for s in all_stats if s['match_id'] == str(match_id)), None)
    current = {k: current_row[k] for k in stat_keys} if current_row else empty_stats

    trend = [dict(s) for s in all_stats[-3:]]

    return {
        'current': current,
        'season_avg': season_avg,
        'match_count': match_count,
        'trend': trend,
    }
