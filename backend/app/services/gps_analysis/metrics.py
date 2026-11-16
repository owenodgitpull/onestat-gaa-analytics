"""GPS match metrics (pure numpy on a framed Grid; see frame.py for the frame).

All X/Y are metres in OUR attack frame: X = 0 our goal line, X = L their goal line; Y small = our left.
Only our outfielders are tracked (no goalkeeper unit, no opposition positions). Possession comes from the tagged
carries, so every "in / out of possession" figure is as good as the carry tagging.
"""
from __future__ import annotations

import warnings
from typing import Dict, List, Optional

import numpy as np

# Every tagged point is framed with frame_point (app.utils.attack_direction.own_attacks_right); grid positions are
# framed when the grid is built (frame.build_grid).
from .frame import Grid, frame_point, period_bounds
from .lag import lag_ms
from .loader import MatchInputs

HSR = 5.5          # m/s, high-speed running
GOAL_SIDE_MARGIN_M = 2.0    # "goal-side" = at least this much nearer our goal than the ball (level is not back)
RECOVERY_HOLD_S = 5         # "back in" counts only once the target number stays goal-side this long (or the move ends)
SPRINT = 7.0       # m/s
ACCEL = 3.0        # m/s^2
BLOCK_MS = 5 * 60 * 1000
SHOT_TYPES = ("POINT_SCORED", "GOAL_SCORED", "WIDE", "SHORT", "SAVED", "HIT_POST")
DEAD_BALL_TYPES = ("POINT_SCORED", "GOAL_SCORED", "WIDE", "SAVED", "FOUL_COMMITTED", "SIDELINE_KICK", "SIDELINE_BALL",
                   "FORTY_FIVE", "THROW_IN", "FREE_KICK", "YELLOW_CARD", "BLACK_CARD", "RED_CARD")
TURNOVER_EVENT_TYPES = ("TURNOVER_LOST", "TURNOVER_WON", "INTERCEPTION", "TACKLE_WON", "OUR_UNFORCED_ERROR", "OPP_UNFORCED_ERROR", "SHORT")
PERIOD_NAME = {1: "1st half", 2: "2nd half", 3: "Extra time 1", 4: "Extra time 2"}


def r1(v):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), 1)


def nanmax_rows(a: np.ndarray) -> np.ndarray:
    """Row-wise nanmax that returns nan (not a warning) for all-nan rows."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmax(a, 1)


def name_of(inp: MatchInputs, pid: Optional[str]) -> Optional[str]:
    return (inp.players.get(pid) or {}).get("name") if pid else None


def positions_at(g: Grid, j: int, inp: MatchInputs) -> List[dict]:
    V = g.valid()[:, j]
    return [{"player_id": pid, "name": name_of(inp, pid), "x": r1(g.X[i, j]), "y": r1(g.Y[i, j])}
            for i, pid in enumerate(g.pids) if V[i]]


def _hull_area(x: np.ndarray, y: np.ndarray) -> float:
    pts = sorted(zip(x.tolist(), y.tolist()))
    if len(pts) < 3:
        return 0.0
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    h = lower[:-1] + upper[:-1]
    return abs(sum(h[i][0] * h[(i + 1) % len(h)][1] - h[(i + 1) % len(h)][0] * h[i][1] for i in range(len(h)))) / 2.0


# ------------------------------------------------------------------ 2. shape

def shape_series(g: Grid, min_players: int = 10) -> Dict[str, np.ndarray]:
    V = g.valid()
    Xm = np.where(V, g.X, np.nan); Ym = np.where(V, g.Y, np.nan)
    n = V.sum(0)
    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore", RuntimeWarning)
        length = np.nanmax(Xm, 0) - np.nanmin(Xm, 0)
        width = np.nanmax(Ym, 0) - np.nanmin(Ym, 0)
        cx = np.nanmean(Xm, 0); cy = np.nanmean(Ym, 0)
        comp = np.nanmean(np.hypot(Xm - cx, Ym - cy), 0)
        srt = np.sort(np.where(V, g.X, np.inf), 0)[:6]
        deep6 = np.where(np.isfinite(srt).all(0), srt.mean(0), np.nan)
    ok = n >= min_players
    area = np.full(len(g.t), np.nan)
    for j in np.where(ok)[0]:
        area[j] = _hull_area(g.X[V[:, j], j], g.Y[V[:, j], j])
    nan = lambda a: np.where(ok, a, np.nan)
    return {"n": n, "length": nan(length), "width": nan(width), "compactness": nan(comp), "area": area,
            "centroid_x": nan(cx), "deep6": nan(deep6)}


def shape_summary(g: Grid, sh) -> dict:
    out = {}
    for h in sorted(set(g.half.tolist())) + [0]:
        hm = (g.half == h) if h else np.ones(len(g.t), bool)
        row = {}
        sp = g.set_piece if g.set_piece is not None else np.zeros(len(g.t), bool)
        for state, sm in (("in", g.poss == 1), ("out", g.poss == -1), ("set_piece", sp)):
            m = hm & sm & ~np.isnan(sh["length"])
            row[state] = {k: r1(np.nanmean(sh[k][m])) if m.any() else None for k in ("length", "width", "compactness", "area", "centroid_x", "deep6")}
            row[state]["seconds"] = int(m.sum() / g.hz)
        out["all" if not h else str(h)] = row
    return out


# ------------------------------------------------------------------ 3. transitions

def _ball_at(g: Grid, j: int, fallback):
    bx = g.ballX[j]
    return (float(bx), float(g.ballY[j])) if not np.isnan(bx) else fallback


def transitions(inp: MatchInputs, g: Grid) -> dict:
    """Turnovers from the carry sequence, where one team's carry is followed by the other team's carry and either
    - the turnover is tagged (carry ended by 'turnover', or a turnover / interception / tackle / unforced error /
      dropped-short event in between, within 60 s): measured from that tagged moment and spot; or
    - it is a plain change of carrier within 25 s with no dead-ball event (score, wide, foul, sideline, 45, kickout)
      in between: measured from the new team's first carry."""
    L, W = inp.pitch_length_m, inp.pitch_width_m
    arfh = inp.attacking_right_first_half
    cs = [c for c in inp.carries if c.team in ("own", "opponent")]
    dead = sorted(e.video_ms for e in inp.events if e.event_type in DEAD_BALL_TYPES or "KICKOUT" in e.event_type)
    V = g.valid()
    lost, won = [], []
    for k in range(len(cs) - 1):
        a, b = cs[k], cs[k + 1]
        if a.team == b.team or a.ended_by in ("score", "wide", "free"):
            continue
        tev = next((e for e in inp.events if a.video_ms - 500 <= e.video_ms <= b.video_ms and e.event_type in TURNOVER_EVENT_TYPES), None)
        if tev is not None or a.ended_by == "turnover":
            if b.video_ms - a.video_ms > 60000:
                continue
        elif b.video_ms - a.video_ms > 25000:
            continue
        # A foul, a sideline, a 45, a card or a kickout in between means play stopped: a restart, not a transition -
        # nobody is "getting back" against a live ball. This was only checked for untagged changes of possession, so
        # McHugh's foul (2nd half 56', a free to Dublin) was timed as a 1-second recovery from the free being taken.
        i0 = np.searchsorted(dead, a.video_ms - 500)
        if i0 < len(dead) and dead[i0] <= b.video_ms:
            continue
        # the moment of the loss, less the measured tap delay (taps land a second or more after the moment)
        from .lag import lag_ms as _lag
        t0 = (tev.video_ms - _lag(inp, tev.event_type)) if tev is not None else (b.video_ms - _lag(inp, "TURNOVER_LOST"))
        j0 = g.idx(t0)
        spot = frame_point(tev.pitch_x, tev.pitch_y, tev.half, arfh, L, W) if tev is not None and tev.pitch_x is not None else (None, None)
        if spot[0] is None:
            spot = frame_point(b.start_x, b.start_y, b.half, arfh, L, W)
        if spot[0] is None:
            continue
        n_on = int(V[:, j0].sum())
        if n_on < 8:
            continue
        step = int(round(g.hz))
        js = [min(j0 + s * step, len(g.t) - 1) for s in range(16)]
        cxs = [float(np.nanmean(np.where(V[:, j], g.X[:, j], np.nan))) for j in js]
        j10 = js[10]
        sl = slice(j0, j10 + 1)
        vmax = nanmax_rows(np.where(V[:, sl], g.S[:, sl], np.nan))
        runners = [{"player_id": pid, "name": name_of(inp, pid), "max_speed": r1(vmax[i])} for i, pid in enumerate(g.pids) if V[i, j0] and not np.isnan(vmax[i])]
        runners.sort(key=lambda r: -(r["max_speed"] or 0))
        nxt_own = next((c.video_ms for c in cs[k + 2:] if c.team == a.team), t0 + 60000)
        if a.team == "own":
            target = min(11, n_on - 3)
            goal_side = []
            for s, j in enumerate(js):
                bx, _ = _ball_at(g, j, spot)
                # level with the ball is not back: at least GOAL_SIDE_MARGIN_M nearer our goal than the ball
                goal_side.append(int((V[:, j] & (g.X[:, j] < bx - GOAL_SIDE_MARGIN_M)).sum()))
            shot = next((e for e in inp.events if e.team == "team_b" and e.event_type in SHOT_TYPES and t0 <= e.video_ms <= nxt_own), None)
            # back = the target reached AND held for RECOVERY_HOLD_S seconds (or until the move ends: we win it back or
            # they shoot). Taking the first second it touched the target timed Langan (Dublin 2H 11:31) "back in 1 s"
            # when three players level with the ball shuffled a metre, then Dublin ran it 23 m and only 7 were back.
            stop_ms = min(nxt_own, shot.video_ms - lag_ms(inp, shot.event_type) if shot else nxt_own)
            live = [s for s in range(len(js)) if t0 + s * 1000 <= stop_ms] or [0]
            last = live[-1]
            rec = next((s for s in live if all(goal_side[q] >= target for q in range(s, min(s + RECOVERY_HOLD_S, last + 1)))
                        and (s + RECOVERY_HOLD_S <= last + 1 or last < len(js) - 1)), None)
            # who was on, and who was goal-side 10 s after (the player KPI page: "goal-side 10 s after we lost it")
            bx10, _ = _ball_at(g, j10, spot)
            on_ids = [pid for i, pid in enumerate(g.pids) if V[i, j0]]
            back_ids = [pid for i, pid in enumerate(g.pids) if V[i, j0] and V[i, j10] and g.X[i, j10] < bx10 - GOAL_SIDE_MARGIN_M]
            lost.append({
                "on_ids": on_ids, "back_10s_ids": back_ids,
                "video_ms": t0, "half": b.half, "lost_by": name_of(inp, a.player_id), "spot_x": r1(spot[0]), "spot_y": r1(spot[1]),
                "how": (tev.event_type.replace("_", " ").lower() if tev is not None else "pass intercepted / lost" if a.ended_by == "pass" else "turnover"),
                "players_on": n_on, "target": target, "goal_side_at_0": goal_side[0], "goal_side": goal_side, "recovery_s": rec,
                "already_back": goal_side[0] >= target,
                "retreat_5s_m": r1(cxs[0] - cxs[5]), "retreat_10s_m": r1(cxs[0] - cxs[10]),
                "sprinted": [r for r in runners if (r["max_speed"] or 0) > HSR], "did_not_sprint": [r for r in runners if (r["max_speed"] or 0) <= HSR],
                "outcome": ("score" if shot and shot.event_type in ("POINT_SCORED", "GOAL_SCORED") else "shot") if shot else "no shot",
            })
        else:
            fwd = []
            for i, pid in enumerate(g.pids):
                if V[i, j0] and V[i, j10] and g.X[i, j10] - g.X[i, j0] >= 10 and (vmax[i] or 0) > HSR:
                    fwd.append({"player_id": pid, "name": name_of(inp, pid), "gain_m": r1(g.X[i, j10] - g.X[i, j0]), "max_speed": r1(vmax[i])})
            fwd.sort(key=lambda r: -r["gain_m"])
            shot = next((e for e in inp.events if e.team == "team_a" and e.event_type in SHOT_TYPES and t0 <= e.video_ms <= nxt_own), None)
            won.append({
                "video_ms": t0, "half": b.half, "won_by": name_of(inp, b.player_id), "spot_x": r1(spot[0]), "spot_y": r1(spot[1]),
                "players_on": n_on, "advance_10s_m": r1(cxs[10] - cxs[0]), "forward_runners": fwd, "n_forward_runners": len(fwd),
                "outcome": ("score" if shot and shot.event_type in ("POINT_SCORED", "GOAL_SCORED") else "shot") if shot else "no shot",
            })
    # recovery time only means something when we were caught short: leave out turnovers where enough were already back
    recs = [t["recovery_s"] for t in lost if t["recovery_s"] is not None and not t["already_back"]]
    return {
        "lost": lost, "won": won,
        "summary": {
            "n_lost": len(lost), "n_won": len(won),
            "already_back": sum(1 for t in lost if t["already_back"]),
            "caught_short": sum(1 for t in lost if not t["already_back"]),
            "median_recovery_s": r1(np.median(recs)) if recs else None,
            "not_recovered_in_15s": sum(1 for t in lost if t["recovery_s"] is None),
            "median_retreat_10s_m": r1(np.median([t["retreat_10s_m"] for t in lost if t["retreat_10s_m"] is not None])) if lost else None,
            "median_forward_runners": r1(np.median([t["n_forward_runners"] for t in won])) if won else None,
            "lost_led_to_score": sum(1 for t in lost if t["outcome"] == "score"),
            "won_led_to_score": sum(1 for t in won if t["outcome"] == "score"),
        },
    }


# ------------------------------------------------------------------ 4. kickouts

KO_OUTCOME = {
    "OWN_KICKOUT_WON": ("own", "won clean"), "OWN_KICKOUT_WON_BREAK": ("own", "won break"),
    "OWN_KICKOUT_OPPOSITION_WON": ("own", "lost clean"), "OWN_KICKOUT_OPPOSITION_WON_BREAK": ("own", "lost break"),
    "OPP_KICKOUT_WON": ("opp", "won clean"), "OPP_KICKOUT_WON_BREAK": ("opp", "won break"),
    "OPP_KICKOUT_OPPOSITION_WON": ("opp", "lost clean"), "OPP_KICKOUT_OPPOSITION_WON_BREAK": ("opp", "lost break"),
}
KO_OUTCOMES = ("won clean", "won break", "lost clean", "lost break", "over the sideline")
NEAR_LANDING_M = 10.0
# The kickout tag is tapped when the ball is WON (the catch / the break), ~2-3 s after the kick, by which time players are
# already running in. Shape "at the kick" is read this long before the tag (checked 2026-11-15 on Down: defenders 39-41 m
# from goal 3 s before the tag, 35-36 m at it).
KICK_BEFORE_TAG_MS = 2500     # "near where it landed": the tagged spot is itself a few metres out, so a wide band


def _ko_kind(e):
    """(kind, outcome) for a kickout event, or None. Video SIDELINE_KICK is a kickout that went straight over the sideline
    (event_mapper: team_a = our kickout): a lost own kickout / a won opposition one, kept as its own outcome."""
    if e.event_type in KO_OUTCOME:
        return KO_OUTCOME[e.event_type]
    if e.event_type == "SIDELINE_KICK":
        return ("own", "over the sideline") if e.team == "team_a" else ("opp", "over the sideline")
    if e.event_type in ("OWN_KICKOUT_SIDELINE", "OPP_KICKOUT_SIDELINE"):
        return ("own" if e.event_type.startswith("OWN") else "opp", "over the sideline")
    return None


def kickouts(inp: MatchInputs, g: Grid) -> dict:
    L, W = inp.pitch_length_m, inp.pitch_width_m
    V = g.valid()
    rows = []
    for e in inp.events:
        ko = _ko_kind(e)
        if ko is None:
            continue
        kind, outcome = ko
        over = outcome == "over the sideline"
        # won = we had the ball after it: our kickout over the sideline is lost, theirs is won
        won = outcome.startswith("won") or (over and kind == "opp")
        jt = g.idx(e.video_ms)                                   # the tag: ball won / landed
        j0 = g.idx(e.video_ms - KICK_BEFORE_TAG_MS); j6 = g.idx(e.video_ms - KICK_BEFORE_TAG_MS + 6000)   # the kick, and 6 s after it
        n = int(V[:, j0].sum())
        if n < 8:
            continue
        land = frame_point(e.pitch_x, e.pitch_y, e.half, inp.attacking_right_first_half, L, W)
        sl = slice(j0, j6 + 1)
        vmax = nanmax_rows(np.where(V[:, sl], g.S[:, sl], np.nan))
        xs = g.X[V[:, j0], j0]
        moved = []
        for i, pid in enumerate(g.pids):
            if V[i, j0] and V[i, j6]:
                moved.append({"player_id": pid, "name": name_of(inp, pid), "dx": r1(g.X[i, j6] - g.X[i, j0]), "dy": r1(g.Y[i, j6] - g.Y[i, j0]),
                              "dist": r1(np.hypot(g.X[i, j6] - g.X[i, j0], g.Y[i, j6] - g.Y[i, j0])), "max_speed": r1(vmax[i])})
        # our outfielders within 10 m of the tagged landing spot at the tag (none for a kick over the sideline: it never landed)
        near = None
        if not over and land[0] is not None:
            dl = np.hypot(g.X[V[:, jt], jt] - land[0], g.Y[V[:, jt], jt] - land[1])
            near = int((dl <= NEAR_LANDING_M).sum())
        rows.append({
            "video_ms": e.video_ms, "half": e.half, "kind": kind, "outcome": outcome, "won": won,
            "event_type": e.event_type, "player": name_of(inp, e.player_id),
            "landing_x": r1(land[0]), "landing_y": r1(land[1]), "ours_within_10m_of_landing": near,
            "team_mean_x": r1(xs.mean()), "players_in_their_half": int((xs > L / 2).sum()), "players_tracked": n,
            "sprinting_after": int(np.nansum(vmax > HSR)),
            "at_kick": positions_at(g, j0, inp), "after_6s": positions_at(g, j6, inp), "moved": moved,
        })
    groups = {}
    for kind in ("own", "opp"):
        for outcome in KO_OUTCOMES:
            rs = [r for r in rows if r["kind"] == kind and r["outcome"] == outcome]
            if rs:
                nl = [r["ours_within_10m_of_landing"] for r in rs if r["ours_within_10m_of_landing"] is not None]
                groups[f"{kind}|{outcome}"] = {"n": len(rs), "team_mean_x": r1(np.mean([r["team_mean_x"] for r in rs])),
                                               "players_in_their_half": r1(np.mean([r["players_in_their_half"] for r in rs])),
                                               "mean_ours_within_10m_of_landing": r1(np.mean(nl)) if nl else None}
    # kept v lost per side, so nobody adds groups up by hand
    totals = {}
    for kind in ("own", "opp"):
        rs = [r for r in rows if r["kind"] == kind]
        if rs:
            def nl_mean(sub):
                v = [r["ours_within_10m_of_landing"] for r in sub if r["ours_within_10m_of_landing"] is not None]
                return {"n_landed": len(v), "mean_ours_within_10m_of_landing": r1(np.mean(v)) if v else None}
            won_rs = [r for r in rs if r["won"]]; lost_rs = [r for r in rs if not r["won"]]
            totals[kind] = {"n": len(rs), "won": len(won_rs), "lost": len(lost_rs),
                            "over_the_sideline": sum(r["outcome"] == "over the sideline" for r in rs),
                            "won_near_landing": nl_mean(won_rs), "lost_near_landing": nl_mean(lost_rs)}
    push = {}
    for h in sorted({r["half"] for r in rows if r["half"]}):
        rs = [r for r in rows if r["kind"] == "opp" and r["half"] == h]
        if rs:
            push[str(h)] = {"n": len(rs), "team_mean_x": r1(np.mean([r["team_mean_x"] for r in rs])),
                            "players_in_their_half": r1(np.mean([r["players_in_their_half"] for r in rs]))}
    return {"kickouts": rows, "groups": groups, "totals": totals, "push_up_on_their_kickouts": push,
            "player_spots": _ko_player_spots(rows), "zones": _ko_zones(rows, L, W)}


KO_SPOT_MIN = 3          # a player's average spot needs at least this many kickouts in BOTH groups
KO_SHIFT_NOTE_M = 4.0    # smaller won-v-lost differences are within GPS/tagging noise: not a pattern


def _ko_player_spots(rows: list) -> dict:
    """Per side: each player's average spot at the kick on the kickouts we won v the ones we lost, biggest shift first.
    shift_m = straight-line distance between the two spots; dx_m = lost minus won along the pitch (+ = further from our goal
    when we lost), dy_m across it (+ = towards the right touchline as we attack)."""
    out = {}
    for kind in ("own", "opp"):
        acc = {}
        for r in rows:
            if r["kind"] != kind:
                continue
            for p in r["at_kick"]:
                if p["x"] is None or p["y"] is None:
                    continue
                a = acc.setdefault(p["player_id"], {"name": p["name"], "won": [], "lost": []})
                a["won" if r["won"] else "lost"].append((p["x"], p["y"]))
        players = []
        for pid, a in acc.items():
            if len(a["won"]) < KO_SPOT_MIN or len(a["lost"]) < KO_SPOT_MIN:
                continue
            w = np.mean(a["won"], 0); l_ = np.mean(a["lost"], 0)
            players.append({"player_id": pid, "name": a["name"],
                            "won": {"x": r1(w[0]), "y": r1(w[1]), "n": len(a["won"])},
                            "lost": {"x": r1(l_[0]), "y": r1(l_[1]), "n": len(a["lost"])},
                            "dx_m": r1(l_[0] - w[0]), "dy_m": r1(l_[1] - w[1]), "shift_m": r1(float(np.hypot(*(l_ - w))))})
        players.sort(key=lambda p: -p["shift_m"])
        if players:
            out[kind] = {"players": players, "min_each": KO_SPOT_MIN, "noise_m": KO_SHIFT_NOTE_M,
                         "n_won": sum(1 for r in rows if r["kind"] == kind and r["won"]),
                         "n_lost": sum(1 for r in rows if r["kind"] == kind and not r["won"])}
    return out


def _ko_zones(rows: list, L: float, W: float) -> dict:
    """Per side: where the kickouts landed, by length from the KICKING goal (short under 45 m, mid 45-65 m, long over 65 m,
    the usual GAA bands) and channel (thirds of the width as WE attack), with won/lost and our numbers near the landing.
    Kicks over the sideline never landed: left out here (counted in totals)."""
    out = {}
    for kind in ("own", "opp"):
        z = {}
        for r in rows:
            if r["kind"] != kind or r["outcome"] == "over the sideline" or r["landing_x"] is None:
                continue
            d = r["landing_x"] if kind == "own" else L - r["landing_x"]
            length = "short (under 45 m)" if d < 45 else "mid (45-65 m)" if d <= 65 else "long (over 65 m)"
            ch = "our left" if r["landing_y"] < W / 3 else "centre" if r["landing_y"] <= 2 * W / 3 else "our right"
            c = z.setdefault(f"{length}|{ch}", {"length": length, "channel": ch, "n": 0, "won": 0, "near": []})
            c["n"] += 1; c["won"] += bool(r["won"])
            if r["ours_within_10m_of_landing"] is not None:
                c["near"].append(r["ours_within_10m_of_landing"])
        rows_out = []
        for c in z.values():
            near = c.pop("near")
            rows_out.append({**c, "lost": c["n"] - c["won"], "mean_ours_within_10m_of_landing": r1(np.mean(near)) if near else None})
        order = {"short (under 45 m)": 0, "mid (45-65 m)": 1, "long (over 65 m)": 2}
        rows_out.sort(key=lambda c: (order[c["length"]], c["channel"]))
        if rows_out:
            out[kind] = rows_out
    return out


# ------------------------------------------------------------------ 5. intensity

def _runs(mask: np.ndarray, min_len: int) -> int:
    if not mask.any():
        return 0
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
    return int(((ends - starts) >= min_len).sum())


def intensity(inp: MatchInputs, g: Grid) -> dict:
    """g is the 10 Hz grid. Blocks are 5 minutes of video from each period's throw-in (clock stoppages not removed)."""
    hz = g.hz
    bounds = period_bounds(inp)
    starts = {h: s for h, s, _ in bounds}
    start_of = np.array([starts.get(h, 0) for h in range(5)])[g.half]
    block = ((g.t - start_of) // BLOCK_MS).astype(np.int64)
    V = g.valid() & ~np.isnan(g.S)
    S = np.where(V, g.S, 0.0)
    acc = np.zeros_like(S)
    acc[:, 1:] = np.diff(S, axis=1) * hz
    k = np.ones(5) / 5
    acc = np.apply_along_axis(lambda a: np.convolve(a, k, mode="same"), 1, acc)
    players, blocks = [], {}
    keys = sorted(set(zip(g.half.tolist(), block.tolist())))
    for i, pid in enumerate(g.pids):
        on = V[i]
        mins = on.sum() / hz / 60.0
        if mins < 1:
            continue
        s = S[i]
        row = {"player_id": pid, "name": name_of(inp, pid), "minutes": r1(mins),
               "distance_m": int(s.sum() / hz), "m_per_min": r1(s.sum() / hz / mins),
               "hsr_m": int(s[s > HSR].sum() / hz), "sprints": _runs(on & (g.S[i] > SPRINT), int(hz)),
               "accels": _runs(on & (acc[i] > ACCEL), int(hz // 2)), "max_speed": r1(nanmax_rows(np.where(on, g.S[i], np.nan)[None, :])[0])}
        for state, sm in (("in", g.poss == 1), ("out", g.poss == -1)):
            m = on & sm
            row[f"distance_{state}_m"] = int(s[m].sum() / hz)
            row[f"hsr_{state}_m"] = int(s[m & (s > HSR)].sum() / hz)
        # drop-off: high-speed metres per minute, first 10 minutes on vs last 10 minutes on
        on_idx = np.where(on)[0]
        n10 = int(10 * 60 * hz)
        if len(on_idx) >= 2 * n10:
            first, last = on_idx[:n10], on_idx[-n10:]
            hf = s[first][s[first] > HSR].sum() / hz / 10.0
            hl = s[last][s[last] > HSR].sum() / hz / 10.0
            row["hsr_per_min_first10"] = r1(hf); row["hsr_per_min_last10"] = r1(hl)
            row["drop_off_pct"] = r1((hl - hf) / hf * 100) if hf > 0 else None
        row["blocks"] = []
        for h, b in keys:
            m = on & (g.half == h) & (block == b)
            if m.any():
                row["blocks"].append({"half": h, "block": b, "distance_m": int(s[m].sum() / hz), "hsr_m": int(s[m & (s > HSR)].sum() / hz),
                                      "minutes": r1(m.sum() / hz / 60)})
        players.append(row)
    for h, b in keys:
        m = (g.half == h) & (block == b)
        mm = V & m
        tot = S[:, m].sum() / hz
        hs = np.where(S[:, m] > HSR, S[:, m], 0).sum() / hz
        pm = mm.sum() / hz / 60.0
        blocks[f"{h}|{b}"] = {"half": h, "block": b, "label": f"{PERIOD_NAME.get(h, h)} {b * 5}-{b * 5 + 5}'",
                              "team_distance_m": int(tot), "team_hsr_m": int(hs),
                              "m_per_player_min": r1(tot / pm) if pm else None, "hsr_per_player_min": r1(hs / pm) if pm else None,
                              "in_poss_share": r1(100 * (g.poss[m] == 1).mean()) if m.any() else None}
    players.sort(key=lambda r: -r["distance_m"])
    by_half = {}
    for h in sorted(set(g.half.tolist())):
        m = g.half == h
        mins = m.sum() / hz / 60.0
        tot, hs = S[:, m].sum() / hz, np.where(S[:, m] > HSR, S[:, m], 0).sum() / hz
        # per minute too: periods differ in length (35 v 10 minutes), so totals alone made extra time look like the legs held up
        by_half[str(h)] = {"team_distance_m": int(tot), "team_hsr_m": int(hs), "minutes": r1(mins),
                           "team_distance_per_min_m": int(tot / mins) if mins else None,
                           "team_hsr_per_min_m": int(hs / mins) if mins else None}
    return {"players": players, "blocks": list(blocks.values()), "by_half": by_half,
            "thresholds": {"hsr_ms": HSR, "sprint_ms": SPRINT, "accel_ms2": ACCEL}}


# ------------------------------------------------------------------ 6. heat maps

CELL_M = 5.0


def heatmap(inp: MatchInputs, g: Grid, player_id: Optional[str] = None, half: Optional[int] = None, state: str = "all") -> dict:
    """Seconds spent per 5 m cell in our frame (we attack right). Team = all tracked outfielders summed."""
    L, W = inp.pitch_length_m, inp.pitch_width_m
    nx, ny = int(np.ceil(L / CELL_M)), int(np.ceil(W / CELL_M))
    V = g.valid()
    m = np.ones(len(g.t), bool)
    if half:
        m &= g.half == half
    if state == "in":
        m &= g.poss == 1
    elif state == "out":
        m &= g.poss == -1
    rows = [g.pids.index(player_id)] if player_id and player_id in g.pids else range(len(g.pids))
    xs, ys = [], []
    for i in rows:
        mm = V[i] & m
        xs.append(g.X[i, mm]); ys.append(g.Y[i, mm])
    x = np.concatenate(xs) if xs else np.zeros(0); y = np.concatenate(ys) if ys else np.zeros(0)
    H, _, _ = np.histogram2d(np.clip(x, 0, L - 1e-6), np.clip(y, 0, W - 1e-6), bins=[nx, ny], range=[[0, L], [0, W]])
    H = H / g.hz
    thirds = [float(H[: nx // 3].sum()), float(H[nx // 3: 2 * nx // 3].sum()), float(H[2 * nx // 3:].sum())]
    tot = sum(thirds) or 1.0
    return {"cell_m": CELL_M, "nx": nx, "ny": ny, "pitch_length_m": L, "pitch_width_m": W,
            "seconds": [[round(float(v), 1) for v in col] for col in H],   # [x cell][y cell]
            "total_seconds": round(float(H.sum()), 1), "thirds_pct": [round(100 * v / tot, 1) for v in thirds],
            "mean_x": r1(np.mean(x)) if len(x) else None, "mean_y": r1(np.mean(y)) if len(y) else None}


# ------------------------------------------------------------------ 7. tag health

CHECK_EVENT_TYPES = ("POINT_SCORED", "GOAL_SCORED", "WIDE", "OWN_KICKOUT_WON", "OPP_KICKOUT_WON", "INTERCEPTION", "TACKLE_WON", "TURNOVER_WON")


def tag_health(inp: MatchInputs, g: Grid) -> dict:
    """Tagged spot vs the tagged player's own GPS: distance at the tap, and the nearest moment within +-8 s."""
    L, W = inp.pitch_length_m, inp.pitch_width_m
    arfh = inp.attacking_right_first_half
    row = {pid: i for i, pid in enumerate(g.pids)}
    w = int(8 * g.hz)
    items = []
    for c in inp.carries:
        if c.team == "own" and c.player_id:
            items.append(("carry", c.id, c.player_id, c.start_x, c.start_y, c.half, c.video_ms, None))
    for e in inp.events:
        if e.team == "team_a" and e.player_id and e.event_type in CHECK_EVENT_TYPES:
            items.append(("event", e.id, e.player_id, e.pitch_x, e.pitch_y, e.half, e.video_ms, e.event_type))
    checked, flagged, untracked = 0, [], 0
    for kind, iid, pid, x, y, half, vms, etype in items:
        if pid not in row:
            untracked += 1
            continue
        sx, sy = frame_point(x, y, half, arfh, L, W)
        if sx is None:
            continue
        i = row[pid]; j = g.idx(vms)
        a, b = max(0, j - w), min(len(g.t), j + w + 1)
        d = np.hypot(g.X[i, a:b] - sx, g.Y[i, a:b] - sy)
        if np.all(np.isnan(d)):
            continue
        checked += 1
        d_tap = float(d[j - a]) if not np.isnan(d[j - a]) else None
        k = int(np.nanargmin(d)); d_min = float(d[k]); lag = (g.t[a + k] - vms) / 1000.0
        reason = None
        if d_min > 20:
            reason = "never near the tagged spot: wrong player or wrong spot"
        elif d_tap is not None and d_tap > 20 and abs(lag) > 6:
            reason = f"tap {'after' if lag < 0 else 'before'} the action by {abs(lag):.0f} s"
        if reason:
            flagged.append({"kind": kind, "id": iid, "event_type": etype or "CARRY", "player_id": pid, "player": name_of(inp, pid),
                            "video_ms": vms, "half": half, "dist_at_tap_m": r1(d_tap), "nearest_m": r1(d_min), "nearest_lag_s": r1(lag),
                            "reason": reason, "severity": d_min if d_min > 20 else abs(lag)})
    flagged.sort(key=lambda f: -f["severity"])
    # the clock label and the tagged events at the same moment for that player (a flagged carry is often the same tap as a
    # turnover or a pass named elsewhere in a report: that event carries the same doubt)
    from .situations import _when
    ours = [e for e in inp.events if e.team == "team_a" and e.video_ms is not None]
    for f in flagged:
        near = sorted(ours, key=lambda e: abs(e.video_ms - f["video_ms"]))
        clock = next((e for e in near[:1] if abs(e.video_ms - f["video_ms"]) <= 15000 and e.match_minute is not None), None)
        f["when"] = _when(clock, inp.half_duration_mins) if clock else None
        f["same_moment_events"] = [{"event_type": e.event_type, "sub_type": e.sub_type, "when": _when(e, inp.half_duration_mins)}
                                   for e in near if abs(e.video_ms - f["video_ms"]) <= 3000 and e.player_id == f["player_id"]
                                   and e.id != f["id"]][:4]
    return {"checked": checked, "flagged": flagged, "n_flagged": len(flagged), "untracked_player": untracked}


# ------------------------------------------------------------------ 8. support at passes

def support(inp: MatchInputs, g: Grid) -> dict:
    """At each own pass (a carry ended by a pass, received by a team-mate's next carry within 8 s): team-mates within
    15 m, the nearest option ahead, and whether a team-mate within 25 m was at least 15 m further forward than the receiver.
    No opposition positions exist, so "further forward" is not "unmarked"."""
    L, W = inp.pitch_length_m, inp.pitch_width_m
    arfh = inp.attacking_right_first_half
    row = {pid: i for i, pid in enumerate(g.pids)}
    V = g.valid()
    cs = [c for c in inp.carries if c.team in ("own", "opponent")]
    passes, per_player = [], {}
    for k in range(len(cs) - 1):
        a, b = cs[k], cs[k + 1]
        if a.team != "own" or b.team != "own" or a.ended_by != "pass" or not a.player_id or not b.player_id or a.player_id == b.player_id:
            continue
        if b.video_ms - a.video_ms > 20000 or a.player_id not in row:
            continue
        t = a.end_video_ms if a.end_video_ms and a.end_video_ms <= b.video_ms else b.video_ms - 700
        j = g.idx(t); i = row[a.player_id]
        if not V[i, j]:
            continue
        cx, cy = g.X[i, j], g.Y[i, j]
        mates = [(pid, g.X[q, j], g.Y[q, j]) for pid, q in row.items() if q != i and V[q, j]]
        if len(mates) < 6:
            continue
        dist = {pid: float(np.hypot(x - cx, y - cy)) for pid, x, y in mates}
        within15 = sum(1 for v in dist.values() if v <= 15)
        ahead = [(pid, x, y) for pid, x, y in mates if x > cx + 2]
        nearest_ahead = min((dist[p] for p, _, _ in ahead), default=None)
        if b.player_id in row and V[row[b.player_id], j]:
            rx = float(g.X[row[b.player_id], j])
        else:
            rx = frame_point(b.start_x, b.start_y, b.half, arfh, L, W)[0]
        # a team-mate within 25 m of the passer AND at least 15 m further forward than the man who got it
        reach = [(pid, x) for pid, x, _ in mates if dist[pid] <= 25]
        far_pid, far_x = max(reach, key=lambda r: r[1]) if reach else (None, None)
        skipped = far_x is not None and rx is not None and far_pid != b.player_id and far_x >= rx + 15
        p = {"video_ms": t, "half": a.half, "passer": name_of(inp, a.player_id), "receiver": name_of(inp, b.player_id),
             "within_15m": within15, "nearest_ahead_m": r1(nearest_ahead), "gain_m": r1(rx - cx) if rx is not None else None,
             "further_option": name_of(inp, far_pid) if skipped else None, "further_option_ahead_m": r1(far_x - rx) if skipped else None}
        passes.append(p)
        pp = per_player.setdefault(a.player_id, {"player_id": a.player_id, "name": name_of(inp, a.player_id), "passes": 0, "within_15m": 0, "isolated": 0, "further_option": 0})
        pp["passes"] += 1; pp["within_15m"] += within15; pp["isolated"] += within15 == 0; pp["further_option"] += bool(skipped)
    for pp in per_player.values():
        pp["mean_within_15m"] = r1(pp.pop("within_15m") / pp["passes"])
        pp["isolated_pct"] = r1(100 * pp["isolated"] / pp["passes"])
    n = len(passes)
    return {"n_passes": n, "mean_within_15m": r1(np.mean([p["within_15m"] for p in passes])) if n else None,
            "isolated_share_pct": r1(100 * sum(p["within_15m"] == 0 for p in passes) / n) if n else None,
            "further_option_share_pct": r1(100 * sum(bool(p["further_option"]) for p in passes) / n) if n else None,
            "players": sorted(per_player.values(), key=lambda r: -r["passes"]),
            "further_option_passes": [p for p in passes if p["further_option"]][:60]}


# ------------------------------------------------------------------ 12. marking at their shots

SHOT_WINDOW_MS = 4000


def marking(inp: MatchInputs, g: Grid) -> dict:
    L, W = inp.pitch_length_m, inp.pitch_width_m
    V = g.valid()
    from .lag import lag_ms
    assigned = {}
    for mm in inp.man_marking:
        assigned.setdefault((mm["opponent_name"] or "").strip().lower(), []).append(mm["player_id"])
    rows = []
    for e in inp.events:
        if e.team != "team_b" or e.event_type not in SHOT_TYPES:
            continue
        sx, sy = frame_point(e.pitch_x, e.pitch_y, e.half, inp.attacking_right_first_half, L, W)
        if sx is None:
            continue
        t = e.video_ms - lag_ms(inp, e.event_type)   # same tap-delay rule as everywhere else (incl. the user's sync shift)
        # The tap delay on a shot varies (1-6 s: a point is often tapped once it is over the bar), so one moment can land
        # after the shot, with our players already running back out (Down 1H 8:28: 10.2 m "nearest" at the estimated
        # moment, 1.7 m four seconds earlier, as the video shows). Take the closest any of ours got to the shot spot in
        # the SHOT_WINDOW_MS up to that moment: the pressure on him as he shot.
        best_j, best_d = None, None
        for jj in range(g.idx(t - SHOT_WINDOW_MS), g.idx(t) + 1):
            if V[:, jj].sum() < 8:
                continue
            dd = np.where(V[:, jj], np.hypot(g.X[:, jj] - sx, g.Y[:, jj] - sy), np.inf)
            if best_d is None or dd.min() < best_d.min():
                best_j, best_d = jj, dd
        if best_j is None:
            continue
        j, d = best_j, best_d
        i = int(np.argmin(d))
        shooter = inp.opposition_names.get(e.opposition_player_id or "")
        marker_ids = []
        if shooter:
            key = shooter.strip().lower()
            marker_ids = next((v for k, v in assigned.items() if key and (key in k or k.endswith(key))), [])
        marker = None
        if marker_ids:
            mid = marker_ids[0]
            mi = g.pids.index(mid) if mid in g.pids else None
            marker = {"name": name_of(inp, mid), "dist_m": r1(d[mi]) if mi is not None and np.isfinite(d[mi]) else None,
                      "was_nearest": mid == g.pids[i]}
        rows.append({"video_ms": e.video_ms, "half": e.half, "event_type": e.event_type, "shooter": shooter,
                     "shot_x": r1(sx), "shot_y": r1(sy), "nearest": name_of(inp, g.pids[i]), "nearest_m": r1(d[i]),
                     "within_5m": int((d <= 5).sum()), "within_10m": int((d <= 10).sum()), "assigned_marker": marker,
                     "measured_s_before": r1((t - g.t[j]) / 1000),
                     # a free / 45 / penalty: our players must stand off, so it says nothing about pressure (Owen 2026-11-16)
                     "source": e.score_source, "set_piece": bool(e.score_source and e.score_source != "FROM_PLAY"),
                     # where every one of ours was at that moment (the Shots against pitch draws them when a shot is picked)
                     "ours": [{"name": name_of(inp, pid), "x": r1(g.X[k, j]), "y": r1(g.Y[k, j]), "dist_m": r1(d[k])}
                              for k, pid in enumerate(g.pids) if V[k, j]]})
    # pressure figures from open play only: on a free or a 45 our players stand back by rule
    play = [r for r in rows if not r["set_piece"]]
    scores = [r for r in play if r["event_type"] in ("POINT_SCORED", "GOAL_SCORED")]
    return {"shots": rows, "n_shots": len(rows), "n_from_play": len(play), "n_set_piece": len(rows) - len(play),
            "median_nearest_m": r1(np.median([r["nearest_m"] for r in play])) if play else None,
            "median_nearest_m_scores": r1(np.median([r["nearest_m"] for r in scores])) if scores else None,
            "unpressured_share_pct": r1(100 * sum(r["nearest_m"] > 5 for r in play) / len(play)) if play else None,
            "has_assignments": bool(inp.man_marking)}


# ------------------------------------------------------------------ 13. key moments

def moments(tr: dict, ko: dict, th: dict, sh_series, g1: Grid) -> List[dict]:
    out = []
    lost = [t for t in tr["lost"] if t["recovery_s"] is not None and not t["already_back"]]
    for t in sorted(lost, key=lambda t: t["recovery_s"])[:2]:
        out.append({"kind": "fast_recovery", "video_ms": t["video_ms"], "title": f"Back behind the ball in {t['recovery_s']} s",
                    "detail": f"{t['target']} players goal-side after the ball was lost{' by ' + t['lost_by'] if t['lost_by'] else ''}"})
    slow = sorted([t for t in tr["lost"] if not t["already_back"]], key=lambda t: -(t["recovery_s"] if t["recovery_s"] is not None else 99))[:3]
    for t in slow:
        out.append({"kind": "slow_recovery", "video_ms": t["video_ms"],
                    "title": "Not back within 15 s" if t["recovery_s"] is None else f"Slow to get back: {t['recovery_s']} s",
                    "detail": f"{t['goal_side_at_0']} of {t['players_on']} goal-side at the turnover; outcome: {t['outcome']}"})
    for t in sorted(tr["won"], key=lambda t: -t["n_forward_runners"])[:2]:
        if t["n_forward_runners"]:
            out.append({"kind": "counter", "video_ms": t["video_ms"], "title": f"{t['n_forward_runners']} players broke forward",
                        "detail": f"Ball won{' by ' + t['won_by'] if t['won_by'] else ''}; outcome: {t['outcome']}"})
    for k in sorted(ko["kickouts"], key=lambda r: -r["sprinting_after"])[:2]:
        out.append({"kind": "kickout_response", "video_ms": k["video_ms"], "title": f"{k['sprinting_after']} sprinting at a kickout",
                    "detail": f"{'Our' if k['kind'] == 'own' else 'Their'} kickout, {k['outcome']}"})
    length = np.where(g1.poss == -1, sh_series["length"], np.nan)
    if np.isfinite(length).any():
        j = int(np.nanargmax(length))
        out.append({"kind": "stretched", "video_ms": int(g1.t[j]), "title": f"Team stretched to {length[j]:.0f} m out of possession",
                    "detail": "Longest distance between deepest and highest outfielder while they had the ball"})
    for f in th["flagged"][:2]:
        out.append({"kind": "mis_tag", "video_ms": f["video_ms"], "title": f"Probable mis-tag: {f['event_type'].replace('_', ' ').lower()}",
                    "detail": f"{f['player']}: {f['reason']}"})
    out.sort(key=lambda m: m["video_ms"])
    return out
