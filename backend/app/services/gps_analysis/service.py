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
        "fastest_recoveries": [{k: t[k] for k in ("video_ms", "half", "recovery_s", "lost_by", "outcome")} for t in fastest],
        "drop_off": [{k: p.get(k) for k in ("player_id", "name", "minutes", "hsr_per_min_first10", "hsr_per_min_last10", "drop_off_pct")} for p in drop],
        "team_distance_m": sum(p["distance_m"] for p in it["players"]),
        "team_hsr_m": sum(p["hsr_m"] for p in it["players"]),
        "players_tracked": len(it["players"]),
        "possession_tagged_share_pct": round(100 * float((g1.poss != 0).mean()), 1) if len(g1.poss) else None,
        "in_possession_share_pct": round(100 * in_poss, 1),
        "kickout_push_up": ko["push_up_on_their_kickouts"],
        "tag_health": {"checked": th["checked"], "flagged": th["n_flagged"]},
        "support": {k: sp[k] for k in ("n_passes", "mean_within_15m", "isolated_share_pct", "further_option_share_pct")},
        "marking": {k: mk[k] for k in ("n_shots", "median_nearest_m", "median_nearest_m_scores", "unpressured_share_pct")},
    }
    out = {
        "match_id": inp.match_id, "opponent": inp.opponent, "match_date": inp.match_date, "result": inp.result,
        "frame": "ours: Donegal attack towards x = pitch length (right) in every period; y small = our left",
        "pitch_length_m": inp.pitch_length_m, "pitch_width_m": inp.pitch_width_m,
        "sync_status": inp.sync["status"], "summary": summary,
        "transitions": tr, "kickouts": ko, "intensity": it, "tag_health": th, "support": sp, "marking": mk, "moments": mo,
        "computed_in_s": round(time.time() - t0, 1),
    }
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
        "tracked": [pid for pid, q in (inp.sync.get("quality") or {}).items() if q.get("in_match") is not False],
        "carries": [{"team": c.team, "player_id": c.player_id, "half": c.half, "start_x": c.start_x, "start_y": c.start_y,
                     "end_x": c.end_x, "end_y": c.end_y, "video_ms": c.video_ms, "end_video_ms": c.end_video_ms, "ended_by": c.ended_by}
                    for c in inp.carries],
        "events": [{"id": e.id, "team": e.team, "event_type": e.event_type, "sub_type": e.sub_type, "half": e.half, "video_ms": e.video_ms,
                    "pitch_x": e.pitch_x, "pitch_y": e.pitch_y, "player_id": e.player_id, "sub_in_player_id": e.sub_in_player_id,
                    "opposition_player": inp.opposition_names.get(e.opposition_player_id or ""),
                    "match_minute": e.match_minute, "match_second": e.match_second}
                   for e in inp.events if e.event_type not in ("PASS_HAND",)],
    }


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
            "tag_flags": s["tag_health"]["flagged"],
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
