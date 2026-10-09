"""
Pitch calibration: stored position (0-100 on the pitch drawing) -> real-world metres.

WHY THIS EXISTS. Every event is stored as a position on the pitch DRAWING (pitch_x / pitch_y, 0-100). People place
the ball against the lines they can SEE on that drawing — "on the 40m arc", "on the 45". The drawing's lines are not at
their regulation distances on a plain 145m x 90m scale (measured from `frontend/public/pitch-svg.svg`, 2026-10-09):

    line        drawn at (% of pitch length from the goal line)    real distance
    13m         10.06 %                                            13 m
    20m         13.58 %                                            20 m
    40m arc     30.48 % (apex on the centre line)                  40 m
    45m         34.99 %                                            45 m
    65m         44.83 %                                            65 m
    halfway     50.00 %                                            length / 2

So a shot placed ON the drawn arc used to read ~44m. This module maps a position to metres by interpolating between
those landmarks, so a position on a drawn line reads that line's real distance and everything in between is smooth.

It is used wherever the numbers must be right — the agents' location wording, the live brief, post-match tools — and NOT
for drawing anything: the pictures and charts are untouched.

Frames: everything here takes a position in OUR ATTACKING FRAME or any frame where you say which goal you measure
from (see `distance_to_goal_m`). The drawing is symmetric, so one set of landmarks serves both ends.
Accuracy is ~1-3 m (tapping on a screen), so treat sub-2m margins as "on the line".
"""
from math import hypot

# --- Along the pitch: drawn position (% of length from a goal line, 0..50) -> real metres from that goal line ---
LENGTH_PCT = [0.0, 10.06, 13.58, 30.48, 34.99, 44.83, 50.0]
LENGTH_M = [0.0, 13.0, 20.0, 40.0, 45.0, 65.0, None]   # last = half the pitch length (set per call)

# --- Across the pitch: |distance from the centre line| on the app's 90m-wide drawing scale -> real metres ---
# (goal area half-width, large rectangle half-width, where the 40m arc meets the 20m line, the sideline)
LATERAL_APP_M = [0.0, 7.55, 11.17, 40.0, 44.5]
LATERAL_M = [0.0, 7.0, 9.5, 34.6, None]                 # last = half the pitch width (set per call)

DEFAULT_LENGTH_M = 145.0
DEFAULT_WIDTH_M = 80.0     # the drawing's arc spans its full width, i.e. an 80m-wide drawing
APP_WIDTH_M = 90.0         # the scale the 0-100 y axis was historically converted with

ARC_RADIUS_M = 40.0
ON_THE_LINE_M = 1.5        # within this of a marked line is reported as "on" it


def _interp(x: float, xs, ys) -> float:
    if x <= xs[0]:
        return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + t * (ys[i] - ys[i - 1])
    return ys[-1]


def along_m(pct_from_goal: float, length_m: float = DEFAULT_LENGTH_M) -> float:
    """Real metres from a goal line, for a position `pct_from_goal` (0-100) of the way along the drawing from that goal."""
    p = max(0.0, min(100.0, float(pct_from_goal)))
    half = length_m / 2.0
    xs = list(LENGTH_PCT)
    ys = list(LENGTH_M)
    ys[-1] = half
    if half <= 65.0:          # a short ground: the 65m line is at/after halfway, so it can't be an anchor
        del xs[5]
        del ys[5]
    if p <= 50.0:
        return _interp(p, xs, ys)
    return length_m - _interp(100.0 - p, xs, ys)


def lateral_m(y_pct: float, width_m: float = DEFAULT_WIDTH_M) -> float:
    """Real metres from the centre line (always >= 0) for a position y_pct (0-100) across the drawing."""
    d_app = abs(float(y_pct) - 50.0) * APP_WIDTH_M / 100.0
    ys = list(LATERAL_M)
    ys[-1] = width_m / 2.0
    return _interp(d_app, LATERAL_APP_M, ys)


def distance_to_goal_m(x_pct: float, y_pct: float, toward_x_100: bool, length_m: float = DEFAULT_LENGTH_M,
                       width_m: float = DEFAULT_WIDTH_M) -> float:
    """Straight-line real metres from the centre of the goal at x=100 (toward_x_100=True) or x=0 (False)."""
    p = (100.0 - float(x_pct)) if toward_x_100 else float(x_pct)
    return hypot(along_m(p, length_m), lateral_m(y_pct, width_m))


def arc_phrase(distance_m: float) -> str:
    """Where a shot position sits relative to the 40m arc (the two-point line), in words."""
    margin = distance_m - ARC_RADIUS_M
    if abs(margin) <= ON_THE_LINE_M:
        return "on the 40m arc"
    if margin > 0:
        return f"{round(margin)}m outside the 40m arc (two-point range)"
    return f"{round(-margin)}m inside the 40m arc"


def zone_phrase(x_pct: float, y_pct: float, length_m: float = DEFAULT_LENGTH_M, width_m: float = DEFAULT_WIDTH_M) -> str:
    """Zone name for a position in OUR attacking frame (we attack towards x=100), by real distance."""
    if x_pct >= 50.0:                                   # opposition half: measured from THEIR goal
        r = along_m(100.0 - x_pct, length_m)
        dist = distance_to_goal_m(x_pct, y_pct, True, length_m, width_m)
        if r <= 13.0:
            return "inside the 13m line"
        if r <= 20.0:
            return "inside the 20m line"
        if dist < ARC_RADIUS_M:
            return "inside the 40m arc"
        if r <= 45.0:
            return "inside the 45m line"
        return "past midfield"
    r = along_m(x_pct, length_m)                         # our half: measured from OUR goal
    dist = distance_to_goal_m(x_pct, y_pct, False, length_m, width_m)
    if r <= 13.0:
        return "inside own 13m line"
    if r <= 20.0:
        return "inside own 20m line"
    if dist < ARC_RADIUS_M:
        return "inside own 40m arc"
    if r <= 45.0:
        return "inside own 45m line"
    return "own half"
