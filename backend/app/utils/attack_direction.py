"""
Attack-direction helpers — THE one place that knows how to turn raw pitch coordinates into a
direction-aware frame. Every analytic that cares about "short vs long", "defensive vs attacking
third", "left vs right" or "distance from goal" MUST go through these (and the AI tools must too).

pitch_x / pitch_y are stored exactly as drawn on screen (0-100 each, x = 0 at the LEFT goal). Which
goal a team attacks depends on the match's `attacking_right_first_half` AND the half (teams swap ends
at half-time); the opposition always attacks the other way.

"Attack frame" of a team = that team attacks towards x = 100, its own goal is at x = 0. Flipping
rotates 180° (x -> 100-x AND y -> 100-y) so a team's own left/right are preserved.

Keep in step with frontend/src/utils/attackDirection.ts (same rules, same tests).
"""
from typing import Optional, Tuple


def is_first_half(half: Optional[int], minute: Optional[int] = None, half_duration_mins: Optional[int] = None) -> bool:
    if half is not None:
        return half == 1
    if minute is not None:
        return minute < (half_duration_mins or 30)
    return True


def own_attacks_right(
    attacking_right_first_half: Optional[bool],
    half: Optional[int],
    minute: Optional[int] = None,
    half_duration_mins: Optional[int] = None,
) -> bool:
    """Does OUR team attack towards x = 100 in this half? Unrecorded direction defaults to True."""
    base = True if attacking_right_first_half is None else bool(attacking_right_first_half)
    return base if is_first_half(half, minute, half_duration_mins) else (not base)


def side_attacks_right(is_own: bool, own_right: bool) -> bool:
    return own_right if is_own else (not own_right)


def to_attack_frame(x: float, y: float, attacks_right: bool) -> Tuple[float, float]:
    return (x, y) if attacks_right else (100.0 - x, 100.0 - y)


def point_in_side_frame(
    x: float,
    y: float,
    is_own: bool,
    attacking_right_first_half: Optional[bool],
    half: Optional[int],
    minute: Optional[int] = None,
    half_duration_mins: Optional[int] = None,
) -> Tuple[float, float]:
    own_right = own_attacks_right(attacking_right_first_half, half, minute, half_duration_mins)
    return to_attack_frame(x, y, side_attacks_right(is_own, own_right))
