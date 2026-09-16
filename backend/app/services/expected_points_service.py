"""
Expected Points (xP) model for shot quality.

Assigns every shot a probability-of-scoring value derived from its distance
and angle to goal. The model is calibrated fresh, at query time, from real
shot outcomes already logged across the platform — there is no fixed/hardcoded
conversion table anywhere in here. It will be rough while shot volume is low
and firm up as more matches get coded.

No defender-pressure data is captured yet, so this measures shot difficulty
from position alone. Weather (weather_condition/temperature_celsius) IS
captured per-match but isn't factored into this v1 model — worth revisiting
once there's enough matches played in varied conditions to calibrate against.
Position alone is enough to be directionally reliable for team- and season-
level trends (who's generating better chances, who's over- or under-
performing them) — treat any single shot's value as an estimate of
positional difficulty, not a verdict on the shot itself.
"""
import math
import time
from collections import defaultdict
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match_event import MatchEvent, EventType, Team
from app.models.match import Match
from app.models.player import Player


# Shots (make + miss) that count toward the model. Deliberately excludes
# free_short_pass/free_high_ball — those are tactical decisions to not shoot,
# never shots (see the "Key Interpretations" note in ai/_shared.py).
GOAL_ATTEMPT_TYPES = {
    EventType.GOAL, EventType.PENALTY_GOAL,
    EventType.SAVED, EventType.HIT_POST, EventType.PENALTY_MISS,
}
POINT_ATTEMPT_TYPES = {
    EventType.POINT, EventType.POINT_FREE, EventType.TWO_POINT, EventType.TWO_POINT_FREE,
    EventType.FORTY_FIVE, EventType.FORTY_FIVE_MISSED,
    EventType.WIDE, EventType.WIDE_FREE, EventType.SHORT,
}
ALL_SHOT_TYPES = GOAL_ATTEMPT_TYPES | POINT_ATTEMPT_TYPES

MADE_TYPES = {
    EventType.GOAL, EventType.PENALTY_GOAL,
    EventType.POINT, EventType.POINT_FREE,
    EventType.TWO_POINT, EventType.TWO_POINT_FREE,
    EventType.FORTY_FIVE,
}
FREE_TYPES = {
    EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.WIDE_FREE,
    EventType.FORTY_FIVE, EventType.FORTY_FIVE_MISSED,
    EventType.PENALTY_GOAL, EventType.PENALTY_MISS,
}

# Literature-informed prior for the pressure multiplier (pressured shots
# converting ~15% less often than an unpressured shot at the same
# distance/angle). Used two ways: (1) as the shrinkage target each shot
# group's real pressure_multiplier is blended toward in
# _build_shot_quality_model — early on, with few tagged shots, the model
# leans on this; as real under_pressure=True/False tagged shots accumulate,
# it's progressively replaced by the group's own measured ratio, same
# pattern free_multiplier already uses for real vs. angle-band rates.
# (2) as the cold-start fallback for a shot group with zero shots at all.
PRESSURE_MULTIPLIER_DEFAULT = 0.85
# "Pseudo-shots" of the literature prior blended into each group's real
# pressure/no-pressure ratio — mirrors SHRINKAGE_K's role for angle bands.
# 20 tagged shots (pressured + not) roughly halfway trusts the real signal;
# below that the prior dominates, well above it the real ratio does.
PRESSURE_SHRINKAGE_K = 20

# 40m arc radius as % of pitch length (145m pitch) — kept in sync with the
# same constant the frontend uses for the 2-point zone (ShootingEfficiencyHeatmap),
# so "two-point zone" means the same patch of grass everywhere in the app.
ARC_R_PCT = (40 / 145) * 100

GOAL_WIDTH_M = 6.5   # GAA posts are ~6.5m apart — shared target width for point and goal attempts
PITCH_LENGTH_M = 145.0
# Was 88.0 — inconsistent with the 90m used everywhere else in the app
# (GAA_ESSENTIALS in ai/_shared.py, leaderboard_service.py's Orchestrator
# fix). Reconciled 2026-09-09 per the user's request, now that pitch width
# is also the fallback for the optional per-match override (see
# shot_geometry) — the default and the override should agree on what "the
# default" even means.
PITCH_WIDTH_M = 90.0

ANGLE_BAND_WIDTH = 15  # degrees per bucket
SHRINKAGE_K = 10        # pseudo-shots of the group's global rate blended into each angle band


def _is_first_half(half: Optional[int], minute: Optional[int], half_duration_mins: Optional[int]) -> bool:
    """`half` is frequently NULL on recorded events (a pre-existing data-quality
    gap — not something this service can fix), so it can't be trusted alone.
    Falls back to minute vs. half length, same heuristic PathsTakenChart.tsx's
    normalizeX already uses for this exact problem — without it, every null-half
    shot got silently treated as first-half, which meant second-half shots never
    got their attacking direction flipped and could land in the wrong half of the
    pitch entirely (a close-range shot mis-read as a long-range one, etc)."""
    if half is not None:
        return half == 1
    if minute is not None:
        return minute < (half_duration_mins or 30)
    return True


def _own_attacking_right(
    attacking_right_first_half: Optional[bool], half: Optional[int],
    minute: Optional[int] = None, half_duration_mins: Optional[int] = None,
) -> bool:
    is_first = _is_first_half(half, minute, half_duration_mins)
    base = attacking_right_first_half if attacking_right_first_half is not None else True
    return base if is_first else (not base)


def _normalized_x(
    raw_x: float, team: Team, attacking_right_first_half: Optional[bool], half: Optional[int],
    minute: Optional[int] = None, half_duration_mins: Optional[int] = None,
) -> float:
    """Re-express pitch_x so 100 always means 'the goal this shot is aimed at',
    regardless of which physical end the team defended that half. pitch_x is
    stored raw/unflipped at recording time — this mirrors the normalization
    already used on the frontend (PathsTakenChart.normalizeX, MatchResult's
    getPitchArea) so the two never disagree about where a shot came from."""
    own_right = _own_attacking_right(attacking_right_first_half, half, minute, half_duration_mins)
    attacking_right = own_right if team == Team.OWN else (not own_right)
    return raw_x if attacking_right else (100.0 - raw_x)


def shot_geometry(
    norm_x: float, norm_y: float,
    pitch_length_m: Optional[float] = None, pitch_width_m: Optional[float] = None,
) -> tuple[float, float]:
    """Distance (metres) and subtended goal-angle (degrees) from a normalized
    shot position (100=goal line, 50=pitch centre laterally) to the goal mouth.
    The angle a GOAL_WIDTH_M-wide goal subtends from the shot spot captures
    distance and lateral offset in a single number, which is why shot angle is
    the primary signal in most real shot-quality models.

    pitch_length_m/pitch_width_m default to the app-wide constants — pass a
    specific match's real dimensions (Match.pitch_length_m/pitch_width_m,
    when the club has recorded them for that ground) to sharpen distance for
    that match's own shots. The trained model's angle bands are calibrated
    against the default assumption (no per-match dims existed historically),
    so this only affects single-match display, not model training."""
    length_m = pitch_length_m or PITCH_LENGTH_M
    width_m = pitch_width_m or PITCH_WIDTH_M
    dx = max((100.0 - norm_x) / 100.0 * length_m, 0.5)  # metres from goal line
    dy = (norm_y - 50.0) / 100.0 * width_m               # metres off-centre
    distance_m = math.hypot(dx, dy)

    w = GOAL_WIDTH_M / 2
    denom = dx * dx + dy * dy - w * w
    angle_rad = math.atan2(2 * w * dx, denom) if denom != 0 else math.pi / 2
    if angle_rad < 0:
        angle_rad += math.pi
    angle_deg = math.degrees(angle_rad)
    return distance_m, angle_deg


def classify_shot(event_type: EventType, norm_x: float) -> tuple[str, int, bool, bool]:
    """Returns (shot_group, point_value_if_scored, is_free, made)."""
    is_free = event_type in FREE_TYPES
    made = event_type in MADE_TYPES

    if event_type in GOAL_ATTEMPT_TYPES:
        return "goal", 3, is_free, made

    # 45s/65s are always worth 1 point regardless of range — never reclassify by location.
    if event_type in (EventType.FORTY_FIVE, EventType.FORTY_FIVE_MISSED):
        return "point", 1, is_free, made

    # Made shots already carry an unambiguous point value in their event type —
    # trust it. Reclassifying these by location was the bug: a made two-pointer
    # recorded fractionally inside our computed 40m-arc line (the boundary is
    # an approximation; real taps land on either side of it) got silently
    # downgraded to 1 point, undercounting the real score.
    if event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE):
        return "two_point", 2, is_free, made
    if event_type in (EventType.POINT, EventType.POINT_FREE):
        return "point", 1, is_free, made

    # Only the genuinely ambiguous miss types fall back to location — wide/
    # wide_free/short don't have a separate "attempted from 2-point range"
    # event type, so location is the only signal available for these.
    in_two_point_zone = norm_x < (100 - ARC_R_PCT)
    if in_two_point_zone:
        return "two_point", 2, is_free, made
    return "point", 1, is_free, made


def _angle_band(angle_deg: float) -> str:
    band = int(angle_deg // ANGLE_BAND_WIDTH) * ANGLE_BAND_WIDTH
    return f"{band}-{band + ANGLE_BAND_WIDTH}"


# In-process cache for the platform-wide shot-quality model. Rebuilding it
# means scanning every shot ever logged, so it must NEVER be recomputed per
# request — this is a post-match reporting feature (Match Result page), not a
# live-tracking one. Nothing here is polled: MatchRecording.tsx must not import
# this, and the frontend query has no refetchInterval. The model itself only
# drifts as new matches get coded, so a coarse TTL cache is exactly right —
# still fully dynamic (never hardcoded), just not re-derived from scratch on
# every single page load.
_MODEL_CACHE_TTL_SECONDS = 900
_model_cache: dict = {"model": None, "built_at": 0.0}


async def build_shot_quality_model(db: AsyncSession) -> dict:
    """Cached wrapper — see _build_shot_quality_model for the real work."""
    now = time.monotonic()
    if _model_cache["model"] is not None and (now - _model_cache["built_at"]) < _MODEL_CACHE_TTL_SECONDS:
        return _model_cache["model"]

    model = await _build_shot_quality_model(db)
    _model_cache["model"] = model
    _model_cache["built_at"] = now
    return model


async def _build_shot_quality_model(db: AsyncSession) -> dict:
    """
    Empirically calibrated shot-quality model, rebuilt from every shot logged
    across the platform (aggregate conversion rates only — no shot-level data
    crosses club boundaries). Bayesian-shrunk toward each shot group's overall
    rate so sparse angle bands don't produce wild probabilities while the
    dataset is still small.
    """
    result = await db.execute(
        select(
            MatchEvent.event_type, MatchEvent.pitch_x, MatchEvent.pitch_y,
            MatchEvent.team, MatchEvent.half, MatchEvent.minute, MatchEvent.under_pressure,
            Match.attacking_right_first_half, Match.half_duration_mins,
        )
        .join(Match, Match.id == MatchEvent.match_id)
        .where(
            MatchEvent.event_type.in_(list(ALL_SHOT_TYPES)),
            MatchEvent.pitch_x.isnot(None),
            MatchEvent.pitch_y.isnot(None),
        )
    )
    rows = result.all()

    groups: dict = defaultdict(lambda: {
        "makes": 0, "shots": 0,
        "free_makes": 0, "free_shots": 0,
        "play_makes": 0, "play_shots": 0,
        # under_pressure is a tri-state (True/False/None — see the model
        # docstring on this column). Only explicit True/False rows count
        # here; None ("not recorded") is excluded from both buckets rather
        # than folded into "not pressured", since it's a different
        # population (untagged), not a confirmed non-pressure shot.
        "pressure_makes": 0, "pressure_shots": 0,
        "nopressure_makes": 0, "nopressure_shots": 0,
        "bands": defaultdict(lambda: {"makes": 0, "shots": 0}),
    })

    for event_type, px, py, team, half, minute, under_pressure, arfh, half_dur in rows:
        if px is None or py is None:
            continue
        norm_x = _normalized_x(px, team, arfh, half, minute, half_dur)
        group, _, is_free, made = classify_shot(event_type, norm_x)
        _, angle_deg = shot_geometry(norm_x, py)
        band = _angle_band(angle_deg)

        g = groups[group]
        g["shots"] += 1
        g["makes"] += 1 if made else 0
        if is_free:
            g["free_shots"] += 1
            g["free_makes"] += 1 if made else 0
        else:
            g["play_shots"] += 1
            g["play_makes"] += 1 if made else 0
        if under_pressure is True:
            g["pressure_shots"] += 1
            g["pressure_makes"] += 1 if made else 0
        elif under_pressure is False:
            g["nopressure_shots"] += 1
            g["nopressure_makes"] += 1 if made else 0
        b = g["bands"][band]
        b["shots"] += 1
        b["makes"] += 1 if made else 0

    model = {}
    for group, g in groups.items():
        global_rate = (g["makes"] / g["shots"]) if g["shots"] else 0.35
        free_rate = (g["free_makes"] / g["free_shots"]) if g["free_shots"] else global_rate
        play_rate = (g["play_makes"] / g["play_shots"]) if g["play_shots"] else global_rate
        # Multiplicative correction on top of the angle-band rate, clipped so
        # it can't push a probability wildly out of a sane range on its own.
        free_multiplier = min(max(free_rate / play_rate, 0.5), 2.0) if play_rate > 0 else 1.0

        # Same idea for pressure: real tagged pressured-vs-not conversion
        # rates, shrunk toward the literature prior until there's enough
        # tagged volume to trust the group's own numbers.
        pressure_tagged_n = g["pressure_shots"] + g["nopressure_shots"]
        if g["pressure_shots"] > 0 and g["nopressure_shots"] > 0:
            pressure_rate = g["pressure_makes"] / g["pressure_shots"]
            nopressure_rate = g["nopressure_makes"] / g["nopressure_shots"]
            raw_pressure_ratio = min(max(pressure_rate / nopressure_rate, 0.3), 1.5) if nopressure_rate > 0 else PRESSURE_MULTIPLIER_DEFAULT
        else:
            raw_pressure_ratio = PRESSURE_MULTIPLIER_DEFAULT
        shrink_weight = pressure_tagged_n / (pressure_tagged_n + PRESSURE_SHRINKAGE_K)
        pressure_multiplier = shrink_weight * raw_pressure_ratio + (1 - shrink_weight) * PRESSURE_MULTIPLIER_DEFAULT

        bands = {
            band: (b["makes"] + SHRINKAGE_K * global_rate) / (b["shots"] + SHRINKAGE_K)
            for band, b in g["bands"].items()
        }

        model[group] = {
            "global_rate": global_rate,
            "free_multiplier": free_multiplier,
            "pressure_multiplier": pressure_multiplier,
            "pressure_sample_size": pressure_tagged_n,
            "bands": bands,
            "sample_size": g["shots"],
        }

    # Sensible fallback for a shot_group with literally zero historical shots yet
    for group, default_rate in (("goal", 0.35), ("two_point", 0.30), ("point", 0.55)):
        if group not in model:
            model[group] = {
                "global_rate": default_rate, "free_multiplier": 1.0,
                "pressure_multiplier": PRESSURE_MULTIPLIER_DEFAULT, "pressure_sample_size": 0,
                "bands": {}, "sample_size": 0,
            }

    return model


def expected_points_for_shot(
    pitch_x: float, pitch_y: float, event_type: EventType, team: Team,
    attacking_right_first_half: Optional[bool], half: Optional[int], model: dict,
    minute: Optional[int] = None, half_duration_mins: Optional[int] = None,
    pitch_length_m: Optional[float] = None, pitch_width_m: Optional[float] = None,
    under_pressure: Optional[bool] = None,
) -> dict:
    """Returns shot-level detail: group, point value, probability, and xP.

    under_pressure defaults to None ("not recorded") — every shot logged
    before MatchEvent.under_pressure existed, and every shot where the
    optional tagging prompt is skipped, computes byte-identical xP to
    before this parameter was added. Only an explicit True applies the
    group's pressure_multiplier (see _build_shot_quality_model — real
    tagged-shot ratio once enough exist, shrunk toward
    PRESSURE_MULTIPLIER_DEFAULT while data is thin); False and None both
    leave probability untouched."""
    norm_x = _normalized_x(pitch_x, team, attacking_right_first_half, half, minute, half_duration_mins)
    norm_y = pitch_y
    group, point_value, is_free, made = classify_shot(event_type, norm_x)
    distance_m, angle_deg = shot_geometry(norm_x, norm_y, pitch_length_m, pitch_width_m)
    band = _angle_band(angle_deg)

    m = model.get(group) or {"global_rate": 0.4, "free_multiplier": 1.0, "pressure_multiplier": PRESSURE_MULTIPLIER_DEFAULT, "bands": {}}
    p = m["bands"].get(band, m["global_rate"])
    if is_free:
        p *= m["free_multiplier"]
    if under_pressure:
        p *= m.get("pressure_multiplier", PRESSURE_MULTIPLIER_DEFAULT)
    p = min(max(p, 0.02), 0.98)

    return {
        "group": group, "point_value": point_value, "made": made,
        "is_free": is_free, "distance_m": round(distance_m, 1),
        "angle_deg": round(angle_deg, 1), "probability": round(p, 3), "xp": p * point_value,
    }


async def compute_match_expected_points(db: AsyncSession, match: Match) -> dict:
    """Team- and player-level Expected Points for one match, computed fresh
    against the current shot-quality model — never cached or hardcoded, so it
    always reflects the real events logged for this match and the latest model."""
    model = await build_shot_quality_model(db)

    result = await db.execute(
        select(MatchEvent)
        .where(
            MatchEvent.match_id == match.id,
            MatchEvent.event_type.in_(list(ALL_SHOT_TYPES)),
            MatchEvent.pitch_x.isnot(None),
            MatchEvent.pitch_y.isnot(None),
        )
    )
    events = result.scalars().all()

    player_ids = list({e.player_id for e in events if e.player_id})
    players = {}
    if player_ids:
        pr = await db.execute(select(Player).where(Player.id.in_(player_ids)))
        players = {p.id: p.name for p in pr.scalars().all()}

    team_xp = 0.0
    opp_xp = 0.0
    team_actual_pts = 0
    opp_actual_pts = 0
    per_player: dict = defaultdict(lambda: {
        "player_id": None, "player_name": "Unassigned",
        "shots": 0, "goals": 0, "two_pts": 0, "pts": 0,
        "total_pts": 0, "expected_points": 0.0,
    })

    for e in events:
        shot = expected_points_for_shot(
            e.pitch_x, e.pitch_y, e.event_type, e.team,
            match.attacking_right_first_half, e.half, model,
            e.minute, match.half_duration_mins,
            match.pitch_length_m, match.pitch_width_m,
            under_pressure=e.under_pressure,
        )
        actual_pts = shot["point_value"] if shot["made"] else 0

        if e.team == Team.OWN:
            team_xp += shot["xp"]
            team_actual_pts += actual_pts

            key = e.player_id or "unassigned"
            row = per_player[key]
            row["player_id"] = str(e.player_id) if e.player_id else None
            row["player_name"] = players.get(e.player_id, "Unassigned") if e.player_id else "Unassigned"
            row["shots"] += 1
            row["expected_points"] += shot["xp"]
            if shot["made"]:
                row["total_pts"] += shot["point_value"]
                if shot["group"] == "goal":
                    row["goals"] += 1
                elif shot["point_value"] == 2:
                    row["two_pts"] += 1
                else:
                    row["pts"] += 1
        else:
            opp_xp += shot["xp"]
            opp_actual_pts += actual_pts

    player_rows = []
    for row in per_player.values():
        row["expected_points"] = round(row["expected_points"], 2)
        row["under_over"] = round(row["total_pts"] - row["expected_points"], 2)
        row["avg_shot_quality"] = round(row["expected_points"] / row["shots"], 2) if row["shots"] else 0.0
        player_rows.append(row)
    player_rows.sort(key=lambda r: -r["shots"])

    return {
        "team_expected_points": round(team_xp, 2),
        "opponent_expected_points": round(opp_xp, 2),
        "team_actual_points": team_actual_pts,
        "opponent_actual_points": opp_actual_pts,
        "team_under_over": round(team_actual_pts - team_xp, 2),
        "opponent_under_over": round(opp_actual_pts - opp_xp, 2),
        "expected_result_margin": round(team_xp - opp_xp, 2),
        "actual_result_margin": team_actual_pts - opp_actual_pts,
        "players": player_rows,
        "model_sample_size": {g: m.get("sample_size", 0) for g, m in model.items()},
        "pressure_model_sample_size": {g: m.get("pressure_sample_size", 0) for g, m in model.items()},
    }
