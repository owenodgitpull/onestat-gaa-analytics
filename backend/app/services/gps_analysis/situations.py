"""Off-the-ball read-outs for the AI agents (and anyone else): where our players were at tagged moments, the shape we
actually played (average positions), and how close we got to their ball carrier.

Same frame as metrics.py: metres in OUR attack frame, X = 0 our goal line, X = L their goal line, Y small = our left.
Only our outfielders are tracked: the opposition is known only where a tag puts the ball (their carrier at a tap).

Tap delay: a tag is pressed after the action. Every moment here is read at the tag time minus the measured median
delay for that event type (sync.tag_lag, used when it rests on 4+ examples, else the defaults below), clamped to
0-6 s: the same correction the replay draws with (GpsReplay makeLag). Tagged data is never changed.
"""
from __future__ import annotations

import warnings
from typing import Dict, List, Optional

import numpy as np

from .frame import Grid, frame_point
from .loader import MatchInputs
from .metrics import HSR, SHOT_TYPES, PERIOD_NAME, name_of, r1

from .lag import DEFAULT_LAG_MS, SHOT_LAG_FALLBACK, lag_ms  # noqa: F401  (moved; re-exported)
FORTY_FIVE_M = 45.0                  # the 45 m line, measured from the goal line

# what a moment is, for the agent: (team, event types)
SITUATION_GROUPS = {
    # 45s are counted (as set pieces, left out of the measured moments) so the tagged totals match the score: Dublin's 45 made
    # the tool say 24 of 25 scores were tagged, which read as a missing tag
    "their_scores": ("team_b", ("POINT_SCORED", "GOAL_SCORED", "FORTY_FIVE")),
    "their_missed_shots": ("team_b", ("WIDE", "SHORT", "SAVED", "HIT_POST", "FORTY_FIVE_MISSED")),
    "our_shots": ("team_a", SHOT_TYPES + ("FORTY_FIVE", "FORTY_FIVE_MISSED")),
    "our_turnovers": ("team_a", ("TURNOVER_LOST", "OUR_UNFORCED_ERROR")),
    "fouls_we_conceded": ("team_a", ("FOUL_COMMITTED",)),
}


def _when(e, hdm=None) -> str:
    half = PERIOD_NAME.get(e.half or 1, f"period {e.half}")
    if e.match_minute is None:
        return half
    if hdm:
        # added time as end+N, the way the rest of the report writes it: "Extra time 1 80+1:43", never "81:43" (which reads as
        # later than the start of extra time 2)
        from app.services.ai.phase_facts import period_bounds
        end = period_bounds(e.half, hdm)[1]
        if e.match_minute >= end and (e.match_minute > end or (e.match_second or 0) > 0):
            return f"{half} {end}+{e.match_minute - end}:{(e.match_second or 0):02d}"
    return f"{half} {e.match_minute}:{(e.match_second or 0):02d}"


def _shape_at(g: Grid, V: np.ndarray, j: int, L: float = None, W: float = None) -> Optional[dict]:
    m = V[:, j].copy()
    off = 0
    if L and W:
        # a unit off the field (a sin-binned or substituted player still wearing it, or a fix that wandered) is not part of
        # the shape: one at y = -5 m made the team "97.5 m wide" on a 90 m pitch
        on = (g.X[:, j] >= -3) & (g.X[:, j] <= L + 3) & (g.Y[:, j] >= -3) & (g.Y[:, j] <= W + 3)
        off = int((m & ~on).sum())
        m &= on
    if m.sum() < 8:
        return None
    x, y = g.X[m, j], g.Y[m, j]
    cx, cy = float(x.mean()), float(y.mean())
    return {"players_tracked": int(m.sum()), **({"off_the_field_left_out": off} if off else {}), "compactness_m": r1(np.hypot(x - cx, y - cy).mean()), "length_m": r1(x.max() - x.min()),
            "width_m": r1(y.max() - y.min()), "team_height_m": r1(cx), "deepest_six_m": r1(np.sort(x)[:6].mean())}


def band(d) -> Optional[str]:
    if d is None or not np.isfinite(d):
        return None
    return "within 5 m" if d <= 5 else "5-10 m" if d <= 10 else "10-15 m" if d <= 15 else "over 15 m"


def tag_accuracy(inp: MatchInputs, g: Grid) -> dict:
    """How far a tagged spot is from where the tagged player really was, measured on OUR receptions (we have their GPS):
    the closest the receiver came to his tagged spot within 6 s before to 1 s after the tap. This is the error floor for
    every distance measured from a tag where nobody of ours is on the ball (all opposition moments)."""
    L, W = inp.pitch_length_m, inp.pitch_width_m
    out = []
    for c in inp.carries:
        if c.team != "own" or c.player_id not in g.pids:
            continue
        sx, sy = frame_point(c.start_x, c.start_y, c.half, inp.attacking_right_first_half, L, W)
        if sx is None:
            continue
        i = g.pids.index(c.player_id)
        a, b = g.idx(c.video_ms - 6000), g.idx(c.video_ms + 1000)
        dd = np.hypot(g.X[i, a:b] - sx, g.Y[i, a:b] - sy)
        if b > a and not np.all(np.isnan(dd)):
            out.append(float(np.nanmin(dd)))
    if not out:
        return {"checked": 0}
    return {"checked": len(out), "median_m": r1(np.median(out)), "p75_m": r1(np.percentile(out, 75))}


def _anchor_on_player(g: Grid, i: int, sx: float, sy: float, tap_ms: int):
    """The instant our tagged player was closest to his tagged spot (6 s before to 1 s after the tap) and his GPS spot then."""
    a, b = g.idx(tap_ms - 6000), g.idx(tap_ms + 1000)
    if b <= a:
        return None
    dd = np.hypot(g.X[i, a:b] - sx, g.Y[i, a:b] - sy)
    if np.all(np.isnan(dd)):
        return None
    k = a + int(np.nanargmin(dd))
    return k, float(g.X[i, k]), float(g.Y[i, k]), float(dd[k - a])


def _dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1) if L2 > 0 else np.zeros_like(px)
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy))


def situations(inp: MatchInputs, g: Grid) -> dict:
    """Every tagged moment in SITUATION_GROUPS: our players around the ball at the (delay-corrected) moment."""
    L, W = inp.pitch_length_m, inp.pitch_width_m
    arfh = inp.attacking_right_first_half
    V = g.valid()
    step = int(round(g.hz))
    assigned = {}
    for mm in inp.man_marking:
        assigned.setdefault((mm["opponent_name"] or "").strip().lower(), []).append(mm["player_id"])
    out: Dict[str, List[dict]] = {k: [] for k in SITUATION_GROUPS}
    acc = tag_accuracy(inp, g)
    set_pieces: Dict[str, int] = {}
    tagged: Dict[str, int] = {}
    for e in inp.events:
        group = next((k for k, (team, types) in SITUATION_GROUPS.items() if e.team == team and e.event_type in types), None)
        if group is None:
            continue
        tagged[group] = tagged.get(group, 0) + 1
        if group in ("their_scores", "their_missed_shots", "our_shots") and (
                e.score_source not in (None, "FROM_PLAY") or e.event_type.startswith("FORTY_FIVE")):
            set_pieces[group] = set_pieces.get(group, 0) + 1     # a free / 45 / mark: players stand off by rule, not a read
            continue
        sx, sy = frame_point(e.pitch_x, e.pitch_y, e.half, arfh, L, W)
        if sx is None:
            continue
        lag = lag_ms(inp, e.event_type)
        j = g.idx(e.video_ms - lag)
        own_i = g.pids.index(e.player_id) if e.team == "team_a" and e.player_id in g.pids else None
        anchored = None
        if own_i is not None:
            anchored = _anchor_on_player(g, own_i, sx, sy, e.video_ms)
            if anchored is not None and anchored[3] <= 20:
                j, sx, sy = anchored[0], anchored[1], anchored[2]
            else:
                anchored = None
        if V[:, j].sum() < 8:
            continue
        jb = max(0, j - 2 * step); j5 = max(0, j - 5 * step)
        m = V[:, j].copy()
        if own_i is not None:
            m[own_i] = False                 # the player on the ball is not his own support / cover
        d = np.where(m, np.hypot(g.X[:, j] - sx, g.Y[:, j] - sy), np.inf)
        d_before = np.where(V[:, jb], np.hypot(g.X[:, jb] - sx, g.Y[:, jb] - sy), np.nan)
        order = [i for i in np.argsort(d) if np.isfinite(d[i])]
        attacking = group == "our_shots"     # our own shot: the ball is going towards THEIR goal; everything else threatens ours
        if attacking:
            goal_x = L
            between = int((m & (g.X[:, j] > sx)).sum())       # our players further forward than the ball
        else:
            goal_x = 0.0
            between = int((m & (g.X[:, j] < sx)).sum())       # goal-side: between the ball and our goal
        lane = _dist_to_segment(g.X[:, j], g.Y[:, j], sx, sy, goal_x, W / 2)
        in_lane = int((m & (lane <= 3.0) & (d > 1.5)).sum())
        sl = slice(j5, j + 1)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            vmax = np.nanmax(np.where(V[:, sl], g.S[:, sl], np.nan), 1)
        nearest = []
        for i in order[:3]:
            closing = None
            if np.isfinite(d_before[i]):
                closing = r1(d_before[i] - d[i])     # + = got closer in the last 2 s
            nearest.append({"name": name_of(inp, g.pids[i]), "dist_m": r1(d[i]), "band": band(d[i]), "speed_ms": r1(g.S[i, j]),
                            "closed_in_last_2s_m": closing})
        shape_now, shape_5 = _shape_at(g, V, j, L, W), _shape_at(g, V, j5, L, W)
        opp = inp.opposition_names.get(e.opposition_player_id or "")
        marker = None
        if opp and e.team == "team_b":
            key = opp.strip().lower()
            mids = next((v for k, v in assigned.items() if key and (key in k or k.endswith(key))), [])
            if mids and mids[0] in g.pids:
                mi = g.pids.index(mids[0])
                marker = {"name": name_of(inp, mids[0]), "dist_m": r1(d[mi]) if np.isfinite(d[mi]) else None}
        row = {
            "when": _when(e, inp.half_duration_mins), "video_ms": int(g.t[j]), "event": e.event_type.replace("_", " ").lower(),
            "player": name_of(inp, e.player_id) if e.team == "team_a" else opp,
            **({"opposition_player": opp} if e.team == "team_a" and opp else {}),
            "moment_from": ("the player's own GPS: the instant he was closest to the tagged spot (accurate to a metre or two)" if anchored
                            else f"the tagged spot at the tap minus the measured tap delay ({lag / 1000:.1f} s): spot accurate to about "
                                 f"{acc.get('median_m', '?')} m, so read distances as the band, not the decimal"),
            "spot_x_m": r1(sx), "spot_y_m": r1(sy), "distance_to_goal_m": r1(np.hypot(sx - goal_x, sy - W / 2)),
            "nearest": nearest,
            "within_3m": int((d <= 3).sum()), "within_5m": int((d <= 5).sum()), "within_10m": int((d <= 10).sum()),
            ("ahead_of_ball" if attacking else "goal_side_of_ball"): between,
            "in_line_between_ball_and_goal": in_lane,
            ("inside_our_45" if not attacking else "inside_their_45"): int((m & ((g.X[:, j] < FORTY_FIVE_M) if not attacking else (g.X[:, j] > L - FORTY_FIVE_M))).sum()),
            "sprinting_in_last_5s": int(np.nansum(vmax > HSR)),
            "shape": shape_now,
            "shape_5s_before": shape_5,
            "positions": [{"name": name_of(inp, g.pids[i]), "x_m": r1(g.X[i, j]), "y_m": r1(g.Y[i, j]), "dist_m": r1(d[i])} for i in order],
        }
        if marker:
            row["assigned_marker"] = marker
        out[group].append(row)

    def summ(rows, own: bool):
        if not rows:
            return {"n": 0}
        nd = [r["nearest"][0]["dist_m"] for r in rows if r["nearest"]]
        key = "ahead_of_ball" if "ahead_of_ball" in rows[0] else "goal_side_of_ball"
        who = "teammate" if own else "of_ours"
        return {"n": len(rows), f"median_nearest_{who}_m": r1(np.median(nd)) if nd else None,
                f"no_{who}_within_3m": sum(1 for r in rows if r["within_3m"] == 0),
                f"no_{who}_within_5m": sum(1 for r in rows if r["within_5m"] == 0),
                f"median_{key}": r1(np.median([r[key] for r in rows])),
                "median_in_line_between_ball_and_goal": r1(np.median([r["in_line_between_ball_and_goal"] for r in rows]))}

    summary = {k: summ(v, SITUATION_GROUPS[k][0] == "team_a") for k, v in out.items()}
    for k, n in set_pieces.items():
        summary[k]["left_out_frees_45s_marks"] = n
    for k, n in tagged.items():
        # the counts must add up in the report: tagged = measured (n) + set pieces left out + moments with no usable GPS frame
        miss = n - summary[k]["n"] - set_pieces.get(k, 0)
        summary[k]["tagged_in_match"] = n
        if miss:
            summary[k]["no_gps_frame_left_out"] = miss
    return {"groups": out, "summary": summary, "tag_accuracy": acc}


def average_positions(inp: MatchInputs, g: Grid) -> dict:
    """Each player's average spot with and without the ball, per half: the shape actually played."""
    V = g.valid()
    rows = []
    for i, pid in enumerate(g.pids):
        # the position's name ("left corner back"), not its code: "fb-left" was written as "full back"
        from app.services.lineup_timeline import label as _pos_label
        _pid_pos = (inp.players.get(pid) or {}).get("position")
        p = {"player_id": pid, "name": name_of(inp, pid), "listed_position": _pos_label(_pid_pos) if _pid_pos else None, "halves": {}}
        for h in sorted(set(g.half.tolist())):
            hm = g.half == h
            cell = {}
            for state, sm in (("with_ball", g.poss == 1), ("without_ball", g.poss == -1)):
                mm = V[i] & hm & sm
                if mm.sum() >= 60 * g.hz:            # at least a minute of it
                    cell[state] = {"x_m": r1(g.X[i, mm].mean()), "y_m": r1(g.Y[i, mm].mean()),
                                   "spread_m": r1(np.hypot(g.X[i, mm] - g.X[i, mm].mean(), g.Y[i, mm] - g.Y[i, mm].mean()).mean()),
                                   "minutes": r1(mm.sum() / g.hz / 60)}
            if cell:
                p["halves"][PERIOD_NAME.get(h, str(h))] = cell
        if p["halves"]:
            rows.append(p)
    return {"players": rows, "how_to_read": "x_m = average metres from our own goal line (higher = further up the pitch), y_m = from our "
                                            "left touchline (pitch width / 2 = middle). spread_m = how far from that average spot he usually was: "
                                            "large = roamed, small = held a position. with_ball / without_ball come from the tagged carries."}


def carrier_pressure(inp: MatchInputs, g: Grid) -> dict:
    """How close our nearest player was when one of THEIR players received the ball (a tagged carry start, delay-
    corrected). That moment is exact to the tag; the ball between taps is not known, so there is no continuous figure."""
    L, W = inp.pitch_length_m, inp.pitch_width_m
    arfh = inp.attacking_right_first_half
    V = g.valid()
    lag = lag_ms(inp, "PASS_HAND")
    rows = []
    for c in inp.carries:
        if c.team != "opponent":
            continue
        sx, sy = frame_point(c.start_x, c.start_y, c.half, arfh, L, W)
        if sx is None:
            continue
        j = g.idx(c.video_ms - lag)
        if V[:, j].sum() < 8:
            continue
        d = np.where(V[:, j], np.hypot(g.X[:, j] - sx, g.Y[:, j] - sy), np.inf)
        i = int(np.argmin(d))
        zone = "our third" if sx < L / 3 else "middle third" if sx < 2 * L / 3 else "their third"
        rows.append({"half": c.half, "zone": zone, "carrier": inp.opposition_names.get(c.opposition_player_id or ""),
                     "nearest": name_of(inp, g.pids[i]), "nearest_m": float(d[i]), "ended_by": c.ended_by})

    def summ(rs):
        if not rs:
            return None
        n = np.array([r["nearest_m"] for r in rs])
        return {"receptions": len(rs), "median_nearest_m": r1(np.median(n)),
                "pct_within_3m": r1(100 * (n <= 3).mean()), "pct_within_5m": r1(100 * (n <= 5).mean()), "pct_over_10m": r1(100 * (n > 10).mean())}

    by_half = {PERIOD_NAME.get(h, str(h)): summ([r for r in rows if r["half"] == h]) for h in sorted({r["half"] for r in rows if r["half"]})}
    by_zone = {z: summ([r for r in rows if r["zone"] == z]) for z in ("their third", "middle third", "our third")}
    first = {}
    for r in rows:
        if r["nearest_m"] <= 5 and r["nearest"]:
            first[r["nearest"]] = first.get(r["nearest"], 0) + 1
    free = {}
    for r in rows:
        if r["carrier"] and r["nearest_m"] > 10:
            free[r["carrier"]] = free.get(r["carrier"], 0) + 1
    by_end = {}
    for end in ("turnover", "pass", "score", "wide"):
        s = summ([r for r in rows if r["ended_by"] == end])
        if s:
            by_end[f"possession_touch_that_ended_in_{end}"] = s
    return {
        "all": summ(rows), "tag_accuracy": tag_accuracy(inp, g), "by_half": by_half, "by_zone_of_the_ball": by_zone, "by_how_the_touch_ended": by_end,
        "closest_to_their_receiver_most_often": sorted(({"name": k, "times_within_5m": v} for k, v in first.items()), key=lambda x: -x["times_within_5m"])[:8],
        "their_players_most_often_received_with_nobody_within_10m": sorted(({"name": k, "times": v} for k, v in free.items()), key=lambda x: -x["times"])[:6],
        "how_to_read": "Each row is one tagged moment an opposition player got the ball (read at the tap minus the measured tap delay, "
                       f"{lag / 1000:.1f} s). nearest_m = distance from that spot to our closest tracked outfielder. Zones are along the pitch "
                       "in our frame (our third = near our goal). We do not know where the ball was between taps, so this is pressure at "
                       "reception only, not over the whole possession; opposition players without the ball are not tracked. ACCURACY: the tagged "
                       "spot is itself a few metres out (tag_accuracy.median_m, measured on our own receptions), so a single reception's "
                       "distance is not reliable: use the shares and compare halves, zones and endings with each other.",
    }
