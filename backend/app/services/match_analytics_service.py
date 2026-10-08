from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent
from app.models.possession_event import PossessionEvent
from app.models.match_gps import MatchGPSData
from app.models.match_lineup import MatchLineup
from app.models.ball_carrier_segment import BallCarrierSegment


_SCORE_TYPES = {'goal', 'point', 'two_point'}
_FREE_SCORE_TYPES = {'point_free', 'two_point_free', 'forty_five', 'penalty_goal'}
_FREE_ATTEMPT_TYPES = {'point_free', 'two_point_free', 'forty_five', 'penalty_goal', 'forty_five_missed', 'penalty_miss'}
_OWN_KICKOUT_WON_TYPES = {'own_kickout_won', 'own_kickout_won_break', 'kickout_won'}
_OPP_KICKOUT_WON_BY_US_TYPES = {'opp_kickout_opposition_won', 'opp_kickout_opposition_won_break'}
_TURNOVER_WON_TYPES = {'turnover_won', 'tackle_won', 'block', 'interception'}
# The same real-world turnover can be recorded from either side — the
# winning team's turnover_won/tackle_won/block/interception, OR the losing
# team's turnover_lost/unforced_error. Both are equally valid signals that
# a score originated from a turnover; only checking the winner's side (as
# this used to) missed every score that followed the loser's own event
# instead — e.g. an unforced error credited to our player right before the
# opposition scored was falling through to "open play" instead of "turnover".
_TURNOVER_LOST_TYPES = {'turnover_lost', 'unforced_error'}
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
            if et in _TURNOVER_LOST_TYPES and team == 'opponent':
                return 'turnover'
        else:
            if et in {'opp_kickout_won', 'opp_kickout_won_break'} and team == 'opponent':
                return 'own_kickout'
            if et in {'own_kickout_opposition_won', 'own_kickout_opposition_won_break'}:
                return 'opp_kickout'
            if et in _TURNOVER_WON_TYPES and team == 'opponent':
                return 'turnover'
            if et in _TURNOVER_LOST_TYPES and team == 'own':
                return 'turnover'
        if et in _KICKOUT_POSSESSION_CHANGE_TYPES or et in _TURNOVER_WON_TYPES or et in _TURNOVER_LOST_TYPES:
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


async def _match_direction(db: AsyncSession, match_id: UUID):
    """(attacking_right_first_half, half_duration_mins) for this match."""
    row = (await db.execute(
        select(Match.attacking_right_first_half, Match.half_duration_mins).where(Match.id == match_id)
    )).first()
    return (row[0], row[1]) if row else (None, None)


async def get_scoreable_frees(db: AsyncSession, match_id: UUID, club_id: UUID) -> dict:
    result = await db.execute(
        select(MatchEvent.event_type, MatchEvent.team, MatchEvent.minute, MatchEvent.pitch_x, MatchEvent.pitch_y, MatchEvent.half)
        .where(MatchEvent.match_id == match_id)
        .order_by(func.coalesce(MatchEvent.minute, 0).asc(), MatchEvent.created_at.asc())
    )
    events = result.all()

    # Fouls are placed in OUR attacking frame (our goal at x=0) — raw x only means that for one end/half
    from app.utils.attack_direction import own_attacks_right, to_attack_frame
    _atk_first, _hdm = await _match_direction(db, match_id)

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
        if pitch_x is not None and pitch_y is not None:
            pitch_x, pitch_y = to_attack_frame(
                float(pitch_x), float(pitch_y), own_attacks_right(_atk_first, row[5], minute, _hdm),
            )

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
    # Possession points are placed in OUR attacking frame (we attack towards x=100) before checking
    # who reached which 45 — raw x is only that for one end of one half.
    from app.utils.attack_direction import own_attacks_right, to_attack_frame
    _atk_first, _hdm = await _match_direction(db, match_id)
    _framed = []
    for _r in poss_result.all():
        _px = _r[2]
        if _px is not None:
            _px = to_attack_frame(float(_px), 50.0, own_attacks_right(_atk_first, None, _r[1], _hdm))[0]
        _framed.append((_r[0], _r[1], _px))
    poss_events = _framed

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

    # Simple Scoring's "Possession Changed" button records possession events
    # with no coordinates (pitch_x IS NULL) — that's "no usable location data"
    # for attack-detection purposes, same as having zero possession events at
    # all, so it should fall into the same estimated-from-shots branch below
    # rather than feeding _count_attacks a list of unusable rows.
    has_usable_possession_coords = any(row[2] is not None for row in poss_events)

    if not poss_events or not has_usable_possession_coords:
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
        else:
            conceded += _score_points(et)

        # Kickout retention must be decoded from the event_type NAME
        # ("own_kickout_*" = our own restart), never from the `team` column —
        # a kickout the opposition wins back is tagged team='opponent' (they
        # gained possession), even though it's still OUR restart. Gating this
        # on `team == 'own'` above meant every lost kickout was silently
        # dropped from kickouts_total (only the wins are ever tagged 'own'),
        # so retention always came out at 100%. match_service.py's sidebar
        # stats already decode kickouts this same way, correctly.
        if et in _KICKOUT_WON_TYPES:
            kickouts_won += 1
        if et in _KICKOUT_ALL_TYPES:
            kickouts_total += 1

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
        .where(and_(Match.club_id == club_id, Match.counts_in_stats))
        .order_by(Match.match_date.asc())
    )
    completed_matches = matches_result.all()

    empty_stats = {
        'scores': 0.0, 'conceded': 0.0, 'shots': 0.0, 'wides': 0.0,
        'turnovers_won': 0.0, 'turnovers_lost': 0.0, 'kickout_retention_pct': 0.0,
    }
    stat_keys = ['scores', 'conceded', 'shots', 'wides', 'turnovers_won', 'turnovers_lost', 'kickout_retention_pct']

    # Compute "current" directly from match_id's own events, independent of
    # completed_matches below. The old version only ever set `current` from
    # a row found inside completed_matches — so a match still IN_PROGRESS
    # (checked at half-time, say) was always excluded by the COMPLETED
    # filter and silently showed as all-zero here, even with real events
    # already logged. Confirmed live 2026-09-07.
    current_stats = await _compute_match_stats(db, match_id)
    current = {k: current_stats[k] for k in stat_keys}

    if not completed_matches:
        return {
            'current': current,
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

    season_avg = {
        k: round(sum(s[k] for s in all_stats) / match_count, 1)
        for k in stat_keys
    }

    trend = [dict(s) for s in all_stats[-3:]]

    return {
        'current': current,
        'season_avg': season_avg,
        'match_count': match_count,
        'trend': trend,
    }


# Pitch is standardized at 145m app-wide (see docs/pitch-svg-geometry.md).
# BallCarrierSegment coordinates are stored 0-100 (percent of pitch length),
# so a segment's absolute carried distance = |end_x - start_x| / 100 * this.
_TEAM_VOLUME_PITCH_LENGTH_M = 145.0


async def get_team_volume_intervals(db: AsyncSession, match_id: UUID, club_id: UUID) -> dict:
    """Estimate team running distance per 5-minute interval.

    We only ever get ONE real number from GPS: total distance for the whole
    match, per player, uploaded after full time. There is no time-series GPS
    feed. Previously this chart just spread that total proportionally by raw
    match_events COUNT per interval — a card or a sub counted the same as a
    burst of fast broken play, which is a poor proxy for actual running.

    Ball-carrier segments give us something much closer to the truth: for
    every interval we know how far the ball actually moved (own team) via
    tracked carries, which correlates far better with real running load than
    an event count does. So: derive a per-interval WEIGHT from own-team
    carried distance, and redistribute the match's real GPS total against
    that weight instead. Falls back to the old event-count method for a
    match (or a match with zero carrier data) where no segments exist, so
    the chart never goes blank.
    """
    match_result = await db.execute(
        select(Match.half_duration_mins, Match.pitch_length_m).where(and_(Match.id == match_id, Match.club_id == club_id))
    )
    match_row = match_result.first()
    half_duration = match_row[0] if match_row else 30
    pitch_length_m = (match_row[1] if match_row else None) or _TEAM_VOLUME_PITCH_LENGTH_M
    total_minutes = max(half_duration * 2, 60)
    num_intervals = (total_minutes // 5) + (1 if total_minutes % 5 else 0)
    num_intervals = max(num_intervals, 12)

    # GPS total: only players who actually featured (on the pitch at some
    # point), matching the convention established elsewhere (leaderboard
    # Workhorse calc, _shared.py get_match_gps) — an unused substitute's
    # stray GPS row must not inflate the team total.
    featured_result = await db.execute(
        select(MatchLineup.player_id).where(
            and_(MatchLineup.match_id == match_id, MatchLineup.is_on_field == True)  # noqa: E712
        )
    )
    featured_player_ids = {row[0] for row in featured_result.all()}

    gps_result = await db.execute(
        select(MatchGPSData.player_id, MatchGPSData.total_distance_m).where(MatchGPSData.match_id == match_id)
    )
    gps_rows = gps_result.all()
    if featured_player_ids:
        total_distance_m = sum(
            (row[1] or 0) for row in gps_rows if row[0] in featured_player_ids
        )
    else:
        total_distance_m = sum((row[1] or 0) for row in gps_rows)

    def _interval_label(idx: int) -> str:
        start = idx * 5
        if idx == num_intervals - 1:
            return f"{start}+"
        return f"{start}-{start + 5}"

    labels = [_interval_label(i) for i in range(num_intervals)]

    def _bucket_for_minute(minute) -> int:
        m = minute or 0
        return min(int(m) // 5, num_intervals - 1)

    carry_weight = [0.0] * num_intervals
    carry_count = [0] * num_intervals

    segments_result = await db.execute(
        select(BallCarrierSegment.minute, BallCarrierSegment.start_x, BallCarrierSegment.end_x)
        .where(and_(BallCarrierSegment.match_id == match_id, BallCarrierSegment.team == 'own'))
    )
    segments = segments_result.all()
    for minute, start_x, end_x in segments:
        if start_x is None or end_x is None:
            continue
        idx = _bucket_for_minute(minute)
        carried_m = abs(end_x - start_x) / 100.0 * pitch_length_m
        carry_weight[idx] += carried_m
        carry_count[idx] += 1

    total_carry_weight = sum(carry_weight)
    source = 'carrier_backed' if total_carry_weight > 0 else 'event_estimate'

    if total_carry_weight > 0:
        weights = carry_weight
        total_weight = total_carry_weight
    else:
        # Fall back to the old event-count proxy (no carrier data for this
        # match — an older match, or one recorded before tracking existed).
        events_result = await db.execute(
            select(MatchEvent.minute).where(MatchEvent.match_id == match_id)
        )
        event_weight = [0.0] * num_intervals
        for (minute,) in events_result.all():
            event_weight[_bucket_for_minute(minute)] += 1.0
        weights = event_weight
        total_weight = sum(event_weight)

    intervals = []
    for i in range(num_intervals):
        if total_weight > 0:
            distance_m = (weights[i] / total_weight) * total_distance_m
        else:
            distance_m = total_distance_m / num_intervals
        intervals.append({
            'interval': labels[i],
            'distance_km': round(distance_m / 1000, 2),
            'carries': carry_count[i],
        })

    return {
        'intervals': intervals,
        'total_distance_km': round(total_distance_m / 1000, 2),
        'source': source,
    }
