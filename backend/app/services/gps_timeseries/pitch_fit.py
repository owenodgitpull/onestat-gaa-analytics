"""Fit the two goal lines from the 40 m arc at THEIR kickouts.

The first calibration pass takes the pitch size as given (145 x 90 unless the match says otherwise) and its centre from
how far the players ran, which can leave the picture a few metres short or long at one end. The kickout rule fixes it:
at their kickouts our outfielders line up on (or just outside) the 40 m arc, so at each kick the nearest of ours to the
kicking goal is about 40 m from it. Comparing the two ends shows whether the picture sits a few metres towards one goal, and the centre is moved by half
the difference. The LENGTH is not fitted: players often stand a metre or two off the arc, so the absolute distance says
little (fitting it made Down worse). The length comes from the match (venue size) or the 145 m default.
Our own kickouts are not used: our players come in before our own kick (3-5 m nearer, measured on 5 matches).
Only the calibration changes; tagged data and the video offsets are untouched.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from . import codec, geo

MIN_PER_END = 5


def fit_ends(tracks: Dict[str, codec.Track], cal: dict, periods: List[dict], kickouts: List[dict],
             length_fixed: bool = False, log=print, weight: float = 1.0) -> Optional[dict]:
    """kickouts: [{video_ms, half, end}] of THEIR kickouts; end = 'L' / 'R', the raw-screen goal they kicked from (from the
    attacking direction - a kickout's tagged spot is where it LANDED, so it cannot say which end).
    Returns the new calibration (a copy) with `ends_fit` describing what was measured, or None if too few kickouts."""
    L = float(cal.get("pitch_length_m") or 145.0)
    W = float(cal.get("pitch_width_m") or 90.0)
    per = {int(p["half"]): p for p in periods}
    ends = {"L": [], "R": []}
    for k in kickouts:
        p = per.get(int(k.get("half") or 1))
        if p is None or k.get("end") not in ("L", "R"):
            continue
        gps_ms = k["video_ms"] * (p.get("rate") or 1.0) + p["offset_ms"] - 2500      # just before the kick
        us, vs = [], []
        for t in tracks.values():
            i = int(t.index_for_ms(np.array([gps_ms]))[0])
            if i < 0 or (t.flags[i] & codec.FLAG_BAD_FIX):
                continue
            u, v = geo.latlon_to_uv(t.lat[i:i + 1], t.lon[i:i + 1], cal)
            us.append(float(u[0])); vs.append(float(v[0]))
        u = np.array(us); v = np.array(vs)
        on = (np.abs(u) < L / 2) & (np.abs(v) < W / 2 + 2)          # on the pitch (not warming up behind a goal)
        if on.sum() < 8:
            continue
        end = k["end"]
        gx = -L / 2 if end == "L" else L / 2
        ends[end].append(float(np.min(np.hypot(u[on] - gx, v[on]))))
    nL, nR = len(ends["L"]), len(ends["R"])
    if nL < MIN_PER_END or nR < MIN_PER_END:
        log(f"pitch ends: too few of their kickouts to fit ({nL} at the left end, {nR} at the right)")
        return None
    dL, dR = float(np.median(ends["L"])), float(np.median(ends["R"]))
    # with the same stand-off a at both ends the true goal lines are at u = -L/2 + dL - a and u = L/2 - dR + a, so the true
    # centre is at u = (dL - dR) / 2 whatever a is
    # weight < 1: the centre already comes from the whole-match fit (geo.fit_rect), an independent estimate about as good
    # as this one (they agreed to 1-2 m on five matches): move part of the way, i.e. average the two
    measured = (dL - dR) / 2                       # where the true centre sits, in the current u (metres, + = raw right)
    applied = abs(measured) >= 1.0
    shift = measured * weight
    out = dict(cal)
    out["ends_fit"] = {"their_kickouts_left": nL, "their_kickouts_right": nR, "nearest_left_m": round(dL, 1), "nearest_right_m": round(dR, 1),
                       "pitch_length_m": L, "measured_shift_m": round(measured, 1), "centre_shift_m": round(shift if applied else 0.0, 1),
                       "applied": applied}
    if not applied:
        log(f"pitch ends: already right (nearest {dL:.1f} m / {dR:.1f} m at their kickouts)")
        return out
    # move the centre `shift` metres along +u, in local metres: +u is the axis, negated when flip_u
    sgn = -1.0 if cal.get("flip_u") else 1.0
    out["centre_x_m"] = cal["centre_x_m"] + sgn * cal["axis_x"] * shift
    out["centre_y_m"] = cal["centre_y_m"] + sgn * cal["axis_y"] * shift
    log(f"pitch ends: nearest at their kickouts {dL:.1f} m (left) / {dR:.1f} m (right): centre moved {shift:+.1f} m")
    return out
