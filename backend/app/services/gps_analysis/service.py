"""Entry points for routes and AI tools. Computes every metric for a match in one pass (a few seconds of numpy, run in
a worker thread), caches it in-process until the sync, the tracks, the carries or the events change. Read-only."""
from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from typing import Dict, List, Optional, Tuple

import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession

from . import metrics as M
from . import situations as SI
from .frame import Grid, build_grid, on_pitch_intervals, period_bounds
from .loader import MatchInputs, NotReady, load_match, synced_matches

_CACHE: "OrderedDict[str, Tuple[dict, Grid]]" = OrderedDict()
_MAX = 8


def _remember(key, value):
    _CACHE[key] = value
    _CACHE.move_to_end(key)
    while len(_CACHE) > _MAX:
        _CACHE.popitem(last=False)


def _compute(inp: MatchInputs) -> Tuple[dict, Grid]:
    t0 = time.time()
    g1 = build_grid(inp, 1.0)
    g10 = build_grid(inp, 10.0)
    sh = M.shape_series(g1)
    tr = M.transitions(inp, g10)
    ko = M.kickouts(inp, g10)
    it = M.intensity(inp, g10)
    th = M.tag_health(inp, g10)
    sp = M.support(inp, g10)
    mk = M.marking(inp, g10)
    mo = M.moments(tr, ko, th, sh, g1)
    si = SI.situations(inp, g10)
    ap = SI.average_positions(inp, g1)
    pr = SI.carrier_pressure(inp, g10)
    shape_sum = M.shape_summary(g1, sh)
    fastest = sorted([t for t in tr["lost"] if t["recovery_s"] is not None and not t["already_back"]], key=lambda t: t["recovery_s"])[:3]
    drop = sorted([p for p in it["players"] if p.get("drop_off_pct") is not None], key=lambda p: p["drop_off_pct"])[:5]
    in_poss = float((g1.poss == 1).mean()) if len(g1.poss) else 0.0
    summary = {
        "by_half": {h: {**it["by_half"].get(h, {}), "compactness_in": (shape_sum.get(h) or {}).get("in", {}).get("compactness"),
                        "compactness_out": (shape_sum.get(h) or {}).get("out", {}).get("compactness"),
                        "length_out": (shape_sum.get(h) or {}).get("out", {}).get("length")}
                    for h in it["by_half"]},
        "shape": shape_sum["all"],
        "shape_by_half": {h: v for h, v in shape_sum.items() if h != "all"},
        "transitions": tr["summary"],
        # with how many were already goal-side and the target, so "back in 1 s" reads as "already nearly back", and a
        # one-off best is never used as a benchmark (the median is the benchmark)
        "fastest_recoveries": [{**{k: t[k] for k in ("video_ms", "half", "recovery_s", "lost_by", "outcome")},
                                "goal_side_when_lost": t["goal_side_at_0"], "needed": t["target"]} for t in fastest],
        # "tracked_minutes" is real time on the pitch by GPS (added time included), not the match clock - named so it is never
        # set beside the clock's "91 minutes" as if one of them were wrong
        "drop_off": [{"tracked_minutes" if k == "minutes" else k: p.get(k) for k in ("player_id", "name", "minutes", "hsr_per_min_first10", "hsr_per_min_last10", "drop_off_pct")} for p in drop],
        "team_distance_m": sum(p["distance_m"] for p in it["players"]),
        "team_hsr_m": sum(p["hsr_m"] for p in it["players"]),
        "players_tracked": len(it["players"]),
        "possession_tagged_share_pct": round(100 * float((g1.poss != 0).mean()), 1) if len(g1.poss) else None,
        "in_possession_share_pct": round(100 * in_poss, 1),
        "set_piece_share_pct": round(100 * float(g1.set_piece.mean()), 1) if g1.set_piece is not None and len(g1.t) else None,
        "kickout_push_up": ko["push_up_on_their_kickouts"],
        "tag_health": {"checked": th["checked"], "flagged": th["n_flagged"]},
        "support": {k: sp[k] for k in ("n_passes", "mean_within_15m", "isolated_share_pct", "further_option_share_pct")},
        "marking": {k: mk[k] for k in ("n_shots", "median_nearest_m", "median_nearest_m_scores", "unpressured_share_pct")},
        "situations": {**si["summary"], "tag_accuracy": si["tag_accuracy"]},
        "pressure_on_their_receiver": pr["all"],
    }
    out = {
        "match_id": inp.match_id, "opponent": inp.opponent, "match_date": inp.match_date, "result": inp.result,
        "frame": "ours: the logged-in club attacks towards x = pitch length (right) in every period; y small = our left",
        "pitch_length_m": inp.pitch_length_m, "pitch_width_m": inp.pitch_width_m,
        "sync_status": inp.sync["status"], "summary": summary,
        "transitions": tr, "kickouts": ko, "intensity": it, "tag_health": th, "support": sp, "marking": mk, "moments": mo,
        "situations": si, "positions": ap, "pressure": pr,
        "computed_in_s": round(time.time() - t0, 1),
    }
    # this match's own kickout patterns (the season list is /gps-analysis/season/kickout-patterns)
    try:
        from .ko_rules import match_kickout_patterns
        out["kickouts"]["match_patterns"] = match_kickout_patterns(out)
    except Exception as e:     # never lose the analysis over it
        out["kickouts"]["match_patterns"] = {"error": str(e)[:200]}
    # each carry's start lined up from GPS, for the replay's ball (10 Hz grid); the tag shift saved with the sync is in it
    al = g10.carry_align or {}
    cs = [c for c in inp.carries if c.team in ("own", "opponent")]
    from .lag import manual_shift_ms
    out["carry_times"] = {k: al.get(k) for k in ("median_delay_ms", "matched", "total")}
    out["carry_times"]["saved_shift_ms"] = manual_shift_ms(inp.sync.get("tag_lag"))
    out["carry_times"]["carries"] = [{"video_ms": c.video_ms, "start_ms": s_, "how": h}
                                     for c, s_, h in zip(cs, al.get("starts") or [], al.get("how") or [])]
    # replay display timing (frame.replay_times): the pitch drawn lead_ms ahead of the video per period, and carry
    # starts matched with that lead allowed for. The analysis above is unchanged.
    try:
        from .frame import replay_times
        rt = replay_times(inp, g10.t, g10.half, g10.pids, g10.X, g10.Y, g10.S, g10.on, period_bounds(inp))
        out["carry_times"]["replay"] = {"lead_ms": rt["lead_ms"], "lead_from": rt["lead_from"], "median_delay_ms": rt["median_delay_ms"],
                                        "matched": rt["matched"], "total": rt["total"]}
        for item, s_, h in zip(out["carry_times"]["carries"], rt["starts"], rt["how"]):
            item["replay_start_ms"] = s_; item["replay_how"] = h
    except Exception as e:     # the replay falls back to the analysis starts
        out["carry_times"]["replay"] = {"error": str(e)[:200]}
    return out, g1


async def analyse(db: AsyncSession, match) -> Tuple[dict, Grid, MatchInputs]:
    inp = await load_match(db, match, with_tracks=False)
    key = inp.cache_key
    hit = _CACHE.get(key)
    if hit:
        _CACHE.move_to_end(key)
        return hit[0], hit[1], inp
    inp = await load_match(db, match, with_tracks=True)
    res = await asyncio.to_thread(_compute, inp)
    _remember(key, res)
    return res[0], res[1], inp


def shape_series_payload(g1: Grid, step_s: int = 2) -> dict:
    sh = M.shape_series(g1)
    idx = np.arange(0, len(g1.t), max(1, int(step_s * g1.hz)))
    def arr(a):
        return [None if np.isnan(v) else round(float(v), 1) for v in a[idx]]
    return {"video_ms": [int(v) for v in g1.t[idx]], "half": [int(v) for v in g1.half[idx]], "poss": [int(v) for v in g1.poss[idx]],
            **{k: arr(sh[k]) for k in ("length", "width", "compactness", "area", "centroid_x", "deep6")}}


async def replay_context(db: AsyncSession, match) -> dict:
    from .loader import unit_in_match_q
    """Everything the replay needs besides positions: who is who, carries, events (framing flag per period), marks."""
    inp = await load_match(db, match, with_tracks=False)
    bounds = period_bounds(inp)
    from app.utils.attack_direction import own_attacks_right
    return {
        "match_id": inp.match_id, "opponent": inp.opponent, "session": inp.session,
        "attacking_right_first_half": inp.attacking_right_first_half,
        "own_attacks_right_by_half": {str(h): own_attacks_right(inp.attacking_right_first_half, h) for h, _, _ in bounds},
        "periods": [{"half": h, "video_start_ms": a, "video_end_ms": b} for h, a, b in bounds],
        "sync": {k: inp.sync[k] for k in ("status", "periods", "tag_lag", "computed_at", "confirmed_at")},
        "pitch_length_m": inp.pitch_length_m, "pitch_width_m": inp.pitch_width_m,
        "players": inp.players, "starters": inp.starters, "bench": inp.bench,
        "on_pitch": {pid: [[int(a), int(b)] for a, b in iv] for pid, iv in on_pitch_intervals(inp, bounds).items()},
        "tracked": [pid for pid, q in (inp.sync.get("quality") or {}).items() if unit_in_match_q(q)],
        "carries": [{"id": c.id, "team": c.team, "player_id": c.player_id, "half": c.half, "start_x": c.start_x, "start_y": c.start_y,
                     "end_x": c.end_x, "end_y": c.end_y, "video_ms": c.video_ms, "end_video_ms": c.end_video_ms, "ended_by": c.ended_by,
                     # their carrier's name (the replay labels the opposition ball with it)
                     "opposition_player": inp.opposition_names.get(c.opposition_player_id or "") if c.team == "opponent" else None}
                    for c in inp.carries],
        "events": [{"id": e.id, "team": e.team, "event_type": e.event_type, "sub_type": e.sub_type, "half": e.half, "video_ms": e.video_ms,
                    "pitch_x": e.pitch_x, "pitch_y": e.pitch_y, "player_id": e.player_id, "sub_in_player_id": e.sub_in_player_id,
                    "opposition_player": inp.opposition_names.get(e.opposition_player_id or ""),
                    "match_minute": e.match_minute, "match_second": e.match_second}
                   for e in inp.events if e.event_type not in ("PASS_HAND",)],
    }


# ------------------------------------------------------------------ play on (kickouts tab, "send to board")

PLAY_MAX_MS = 60000


async def play_window(db: AsyncSession, match, from_ms: int, to_ms: int) -> dict:
    """Our players' positions from `from_ms` to `to_ms` (video ms, at most a minute) in OUR attack frame, true metres, from
    the same 1 Hz analysis grid as every other GPS tab (the frontend eases between seconds); the ball where the tagged
    carries put it; the tagged events in the window; and their lineup (no opposition GPS: the board lets the coach place
    them). Read-only."""
    from sqlalchemy import select as _select
    from app.models.opposition import OppositionLineup, OppositionPlayer
    from .frame import frame_point
    from .metrics import name_of
    res, g, inp = await analyse(db, match)
    to_ms = min(to_ms, from_ms + PLAY_MAX_MS)
    j0 = max(0, int(np.searchsorted(g.t, from_ms)) - 1)
    j1 = min(len(g.t), int(np.searchsorted(g.t, to_ms)) + 1)
    V = g.valid()
    r = lambda v: None if v is None or not np.isfinite(v) else round(float(v), 1)
    players = []
    for i, pid in enumerate(g.pids):
        if not V[i, j0:j1].any():
            continue
        players.append({"player_id": pid, "name": name_of(inp, pid), "number": (inp.players.get(pid) or {}).get("jersey"),
                        "x": [r(g.X[i, j]) if V[i, j] else None for j in range(j0, j1)],
                        "y": [r(g.Y[i, j]) if V[i, j] else None for j in range(j0, j1)]})
    L, W = inp.pitch_length_m, inp.pitch_width_m
    evs = []
    for e in inp.events:
        if not (from_ms - 1000 <= e.video_ms <= to_ms) or e.event_type in ("PASS_HAND",):
            continue
        x, y = frame_point(e.pitch_x, e.pitch_y, e.half, inp.attacking_right_first_half, L, W) if e.pitch_x is not None else (None, None)
        evs.append({"video_ms": e.video_ms, "event_type": e.event_type, "team": "own" if e.team == "team_a" else "opp",
                    "player": name_of(inp, e.player_id) if e.team == "team_a" else inp.opposition_names.get(e.opposition_player_id or ""),
                    "x": r(x) if x is not None else None, "y": r(y) if y is not None else None})
    opp = []
    try:
        rows = (await db.execute(_select(OppositionLineup.jersey_number, OppositionLineup.position_id, OppositionLineup.is_substitute,
                                         OppositionPlayer.surname, OppositionPlayer.id)
                                 .join(OppositionPlayer, OppositionPlayer.id == OppositionLineup.opposition_player_id)
                                 .where(OppositionLineup.match_id == match.id))).all()
        opp = sorted([{"id": str(pid), "name": sn, "number": num, "position_id": pos, "substitute": bool(sub)} for num, pos, sub, sn, pid in rows],
                     key=lambda o: (o["substitute"], o["number"] if o["number"] is not None else 99))
    except Exception:
        opp = []
    return {"match_id": inp.match_id, "opponent": inp.opponent, "pitch_length_m": L, "pitch_width_m": W,
            "t": [int(v) for v in g.t[j0:j1]], "players": players,
            "ball": {"x": [r(v) for v in g.ballX[j0:j1]], "y": [r(v) for v in g.ballY[j0:j1]]},
            "poss": [int(v) for v in g.poss[j0:j1]], "events": evs, "opposition": opp,
            "how_to_read": "Positions once a second from the synced GPS, in our attack frame (x = metres from our goal line). "
                           "Ball = where the tagged carries put it (approximate). No goalkeeper or opposition GPS."}


# ------------------------------------------------------------------ 9 + 15. season

async def season(db: AsyncSession, club_id) -> dict:
    rows, per_player = [], {}
    for m in await synced_matches(db, club_id):
        try:
            res, _, _ = await analyse(db, m)
        except NotReady:
            continue
        s = res["summary"]; r = res["result"]
        us, them = r["team_goals"] * 3 + r["team_points"], r["opponent_goals"] * 3 + r["opponent_points"]
        minutes = sum(p["minutes"] or 0 for p in res["intensity"]["players"])
        rows.append({
            "match_id": res["match_id"], "opponent": res["opponent"], "match_date": res["match_date"],
            "result": "W" if us > them else "L" if us < them else "D", "score": f"{r['team_goals']}-{r['team_points']:02d} v {r['opponent_goals']}-{r['opponent_points']:02d}",
            "compactness_out_m": s["shape"]["out"].get("compactness"), "length_out_m": s["shape"]["out"].get("length"),
            "compactness_in_m": s["shape"]["in"].get("compactness"),
            "median_recovery_s": s["transitions"]["median_recovery_s"], "not_recovered_in_15s": s["transitions"]["not_recovered_in_15s"],
            "turnovers_lost": s["transitions"]["n_lost"], "median_forward_runners": s["transitions"]["median_forward_runners"],
            "hsr_per_player_min": round(s["team_hsr_m"] / minutes, 1) if minutes else None,
            "m_per_player_min": round(s["team_distance_m"] / minutes, 1) if minutes else None,
            "push_up_mean_x_m": _mean([v["team_mean_x"] for v in s["kickout_push_up"].values()]),
            "support_within_15m": s["support"]["mean_within_15m"],
            "shots_against_nearest_m": s["marking"]["median_nearest_m"],
            "their_receiver_nearest_m": (s.get("pressure_on_their_receiver") or {}).get("median_nearest_m"),
            "their_receptions_within_5m_pct": (s.get("pressure_on_their_receiver") or {}).get("pct_within_5m"),
            "tag_flags": s["tag_health"]["flagged"],
            # every figure the match tabs' tiles show, so each tile can be set against the last 3 and the season
            "team_distance_km": round(s["team_distance_m"] / 1000, 1), "team_hsr_km": round(s["team_hsr_m"] / 1000, 2),
            "players_tracked": s["players_tracked"],
            "width_out_m": s["shape"]["out"].get("width"), "deep6_out_m": s["shape"]["out"].get("deep6"),
            "length_in_m": s["shape"]["in"].get("length"), "width_in_m": s["shape"]["in"].get("width"),
            "caught_short": s["transitions"]["caught_short"], "already_back": s["transitions"]["already_back"],
            "back_in_15s_pct": (round(100 * max(0, s["transitions"]["caught_short"] - s["transitions"]["not_recovered_in_15s"]) / s["transitions"]["caught_short"])
                                if s["transitions"]["caught_short"] else None),
            "median_retreat_10s_m": s["transitions"]["median_retreat_10s_m"], "turnovers_won": s["transitions"]["n_won"],
            "lost_led_to_score": s["transitions"]["lost_led_to_score"], "won_led_to_score": s["transitions"]["won_led_to_score"],
            "passes_checked": s["support"]["n_passes"], "isolated_share_pct": s["support"]["isolated_share_pct"],
            "further_option_share_pct": s["support"]["further_option_share_pct"],
            "shots_against": s["marking"]["n_shots"], "nearest_on_scores_m": s["marking"]["median_nearest_m_scores"],
            "unpressured_share_pct": s["marking"]["unpressured_share_pct"],
        })
        for p in res["intensity"]["players"]:
            per_player.setdefault(p["player_id"], {"name": p["name"], "matches": []})["matches"].append(
                {"match_id": res["match_id"], "opponent": res["opponent"], "match_date": res["match_date"], "minutes": p["minutes"],
                 "hsr_m": p["hsr_m"], "hsr_per_min": round(p["hsr_m"] / p["minutes"], 1) if p["minutes"] else None,
                 "sprints": p["sprints"], "distance_m": p["distance_m"]})
    alerts = []
    for pid, v in per_player.items():
        ms = [x for x in v["matches"] if (x["minutes"] or 0) >= 20]
        for x in ms:
            others = [o["hsr_per_min"] for o in ms if o is not x and o["hsr_per_min"] is not None]
            if len(others) < 2 or not x["hsr_per_min"]:
                continue
            avg = float(np.mean(others))
            pct = (x["hsr_per_min"] - avg) / avg * 100 if avg else 0
            if abs(pct) >= 25:
                alerts.append({"player_id": pid, "name": v["name"], **x, "own_avg_hsr_per_min": round(avg, 1), "vs_own_avg_pct": round(pct, 1),
                               "direction": "above" if pct > 0 else "below"})
    alerts.sort(key=lambda a: -abs(a["vs_own_avg_pct"]))
    return {"matches": rows, "players": per_player, "load_alerts": alerts,
            "note": f"{len(rows)} matches with synced GPS: read these as what happened, not as statistics"}


def _mean(v):
    v = [x for x in v if x is not None]
    return round(float(np.mean(v)), 1) if v else None


# ------------------------------------------------------------------ kickout patterns across every GPS match (2026-11-17)

_KO_PAT: Dict[str, dict] = {}


async def season_kickout_patterns(db: AsyncSession, club_id) -> dict:
    """ko_rules over every synced match's kickouts. Cached until any match's analysis key changes (a few seconds of numpy
    for the luck check, run in a worker thread)."""
    from . import ko_rules
    rows, keys = [], []
    for m in await synced_matches(db, club_id):
        try:
            res, _, inp = await analyse(db, m)
        except NotReady:
            continue
        keys.append(str(inp.cache_key))
        rows += ko_rules.collect(res)
    key = f"{club_id}|" + "|".join(sorted(keys))
    hit = _KO_PAT.get(str(club_id))
    if hit and hit["key"] == key:
        return hit["value"]
    value = await asyncio.to_thread(ko_rules.kickout_patterns, rows)
    _KO_PAT[str(club_id)] = {"key": key, "value": value}
    return value
