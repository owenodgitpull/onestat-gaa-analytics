"""AI tools over the GPS time-series analysis (services/gps_analysis). Numbers only, no raw position arrays."""
from __future__ import annotations

from app.services.gps_analysis import service as gps
from app.services.gps_analysis.loader import NotReady, match_row


def safe_json(data) -> str:
    from app.services.ai._shared import safe_json as _sj   # late: _shared imports this module's TOOL_DEFS
    return _sj(data)

FRAME_NOTE = (
    "Frame: positions are in OUR attack frame - Donegal (our team) always attack towards x = pitch length, x = 0 is our own "
    "goal line, small y = our LEFT. Distances in metres, times in seconds. Only our outfielders are tracked (no goalkeeper, "
    "no opposition GPS); in/out of possession comes from the tagged carries. video_ms values can be passed to "
    "create_video_compilation / clip tools. Few matches have GPS: describe what happened, not statistics."
)

SECTIONS = ("summary", "transitions", "kickouts", "intensity", "tag_health", "support", "marking", "moments")


def _trim_transitions(tr: dict, limit: int) -> dict:
    def t(x):
        x = dict(x)
        for k in ("sprinted", "did_not_sprint", "forward_runners"):
            if k in x:
                x[k] = [r["name"] for r in x[k]][:14]
        return x
    lost = sorted(tr["lost"], key=lambda x: (x["recovery_s"] is None, x["recovery_s"] or 0), reverse=True)
    return {"summary": tr["summary"], "lost_slowest_first": [t(x) for x in lost[:limit]],
            "won_most_runners_first": [t(x) for x in sorted(tr["won"], key=lambda x: -x["n_forward_runners"])[:limit]],
            "how_to_read": "recovery_s = seconds until `target` of our tracked outfielders were goal-side of the ball (null = not within 15 s); "
                           "retreat_10s_m = how far the team's centre moved back towards our goal in 10 s."}


def _section(res: dict, section: str, limit: int):
    if section == "summary":
        return res["summary"]
    if section == "transitions":
        return _trim_transitions(res["transitions"], limit)
    if section == "kickouts":
        ko = res["kickouts"]
        rows = [{k: v for k, v in r.items() if k not in ("at_kick", "after_6s", "moved")} for r in ko["kickouts"]]
        return {"groups": ko["groups"], "push_up_on_their_kickouts": ko["push_up_on_their_kickouts"], "kickouts": rows[:limit * 3],
                "how_to_read": "team_mean_x = mean distance of our outfielders from our own goal line at the kick (higher = pushed up)."}
    if section == "intensity":
        it = res["intensity"]
        return {"thresholds": it["thresholds"], "by_half": it["by_half"],
                "players": [{k: v for k, v in p.items() if k != "blocks"} for p in it["players"]],
                "blocks": it["blocks"]}
    if section == "tag_health":
        th = res["tag_health"]
        return {**{k: th[k] for k in ("checked", "n_flagged", "untracked_player")}, "flagged": th["flagged"][:limit]}
    if section == "support":
        sp = res["support"]
        return {**{k: v for k, v in sp.items() if k != "further_option_passes"}, "further_option_passes": sp["further_option_passes"][:limit],
                "how_to_read": "within_15m = team-mates within 15 m of the passer at the pass. further_option = a team-mate within 25 m of the "
                               "passer was at least 15 m further forward than the receiver (we cannot see whether he was marked)."}
    if section == "marking":
        mk = res["marking"]
        return {**{k: v for k, v in mk.items() if k != "shots"}, "shots": mk["shots"][:limit * 3]}
    if section == "moments":
        return res["moments"]
    return None


async def get_gps_match_analysis(db, match_id: str, sections=None, limit: int = 8, club_id=None) -> str:
    if not match_id:
        return safe_json({"error": "match_id is required"})
    m = await match_row(db, match_id, club_id)
    if m is None:
        return safe_json({"error": "Match not found for this club"})
    try:
        res, _, _ = await gps.analyse(db, m)
    except NotReady as e:
        return safe_json({"error": f"No synced GPS time series for this match: {e}"})
    wanted = [s for s in (sections or ["summary"]) if s in SECTIONS] or ["summary"]
    out = {"match": {"opponent": res["opponent"], "date": res["match_date"], "result": res["result"]}, "frame_note": FRAME_NOTE,
           "pitch_length_m": res["pitch_length_m"], "pitch_width_m": res["pitch_width_m"]}
    for s in wanted:
        out[s] = _section(res, s, max(1, min(int(limit or 8), 30)))
    return safe_json(out)


async def get_gps_season_trends(db, club_id=None) -> str:
    se = await gps.season(db, club_id)
    return safe_json({"frame_note": FRAME_NOTE, "matches": se["matches"], "load_alerts": se["load_alerts"][:30], "note": se["note"],
                      "how_to_read": "compactness_out_m = mean distance of our outfielders from their centre while the opposition had the ball "
                                     "(lower = tighter). hsr = running above 5.5 m/s. load_alerts compare a player's high-speed metres per "
                                     "minute in one match with his own average in the other GPS matches (+-25% or more)."})


TOOL_DEFS = [
    {
        "name": "get_gps_match_analysis",
        "description": (
            "Raw-GPS analysis of one match (only matches with a synced GPS time series). Sections: summary (team running by half, "
            "shape in/out of possession, transition summary, drop-off, support and marking headlines), transitions (every turnover "
            "lost: seconds to get players goal-side, retreat, who sprinted; every turnover won: who broke forward), kickouts (team "
            "shape at each kick, push-up, outcome groups), intensity (per player distance, high-speed metres, sprints, accels, "
            "5-minute blocks, drop-off), tag_health (probable mis-tags where the tagged spot disagrees with the player's GPS), "
            "support (team-mates within 15 m at each pass), marking (nearest Donegal player to each opposition shot, assigned "
            "marker), moments (key clips with video_ms). Use for 'how compact were we', 'how fast did we get back after turnovers', "
            "'who covered the most ground', 'did we push up on their kickouts'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {"type": "string", "description": "Match UUID"},
                "sections": {"type": "array", "items": {"type": "string", "enum": list(SECTIONS)},
                             "description": "Which sections to return (default ['summary'])"},
                "limit": {"type": "integer", "description": "Max rows per list section (default 8, max 30)"},
            },
            "required": ["match_id"],
        },
    },
    {
        "name": "get_gps_season_trends",
        "description": (
            "One row per match with a synced GPS time series: result, compactness and length out of possession, median seconds to "
            "get back behind the ball after a turnover, forward runners after winning it, running per player-minute, kickout push-up, "
            "support at passes, distance of the nearest defender to their shots; plus running-load alerts per player (high-speed "
            "metres per minute vs his own average). Use for cross-match questions and wins-vs-losses comparisons."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
]
