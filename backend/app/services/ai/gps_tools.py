"""AI tools over the GPS time-series analysis (services/gps_analysis). Numbers only, no raw position arrays."""
from __future__ import annotations

from app.services.gps_analysis import service as gps
from app.services.gps_analysis.loader import NotReady, match_row


def safe_json(data) -> str:
    from app.services.ai._shared import safe_json as _sj   # late: _shared imports this module's TOOL_DEFS
    return _sj(data)

FRAME_NOTE = (
    "Frame: positions are in OUR attack frame - our team (the club asking) always attacks towards x = pitch length, x = 0 is our own "
    "goal line, small y = our LEFT. Distances in metres, times in seconds. Only our outfielders are tracked (no goalkeeper, "
    "no opposition GPS); in/out of possession comes from the tagged carries. video_ms values can be passed to "
    "create_video_compilation / clip tools. Few matches have GPS: describe what happened, not statistics."
)

SECTIONS = ("summary", "situations", "positions", "pressure", "transitions", "kickouts", "intensity", "tag_health", "support", "marking", "moments")
SITUATIONS = ("their_scores", "their_missed_shots", "our_shots", "our_turnovers", "fouls_we_conceded")


def _band(d):
    if d is None:
        return None
    return "within 5 m" if d <= 5 else "5-10 m" if d <= 10 else "10-15 m" if d <= 15 else "over 15 m"


def _opp_summary(summ: dict) -> dict:
    """Opposition moments rest on a tagged spot a few metres out: give the median as a band, never a decimal."""
    out = dict(summ or {})
    if "median_nearest_of_ours_m" in out:
        out["median_nearest_of_ours"] = _band(out.pop("median_nearest_of_ours_m"))
    out.pop("no_of_ours_within_3m", None)
    return out


def _opp_moment(r: dict, full_positions: bool) -> dict:
    """One opposition moment without decimal distances to the (approximate) ball spot: bands only."""
    r = {k: v for k, v in r.items() if k not in ("within_3m",)}
    r["nearest"] = [{k: v for k, v in n.items() if k != "dist_m"} for n in r.get("nearest", [])]
    pos = r.get("positions", [])
    r["positions"] = [{**{k: v for k, v in p.items() if k != "dist_m"}, "band": _band(p.get("dist_m"))} for p in (pos if full_positions else pos[:6])]
    return r


def _trim_transitions(tr: dict, limit: int) -> dict:
    def t(x):
        x = dict(x)
        for k in ("sprinted", "did_not_sprint", "forward_runners"):
            if k in x:
                x[f"n_{k}"] = len(x[k])
                x[k] = [r["name"] for r in x[k]][:14]
        if "target" in x:
            x["goal_side_needed"] = x.pop("target")     # how many had to get goal-side to count as recovered - not a count of runners
        return x
    lost = sorted(tr["lost"], key=lambda x: (x["recovery_s"] is None, x["recovery_s"] or 0), reverse=True)
    return {"summary": tr["summary"], "lost_slowest_first": [t(x) for x in lost[:limit]],
            "won_most_runners_first": [t(x) for x in sorted(tr["won"], key=lambda x: -x["n_forward_runners"])[:limit]],
            "how_to_read": "recovery_s = a TEAM measure (not the player who lost it): seconds until `goal_side_needed` of our tracked outfielders were "
                           "at least 2 m goal-side of the ball AND stayed so for 5 s or until the move ended (null = not within 15 s); "
                           "players_on = our tracked outfielders on the pitch; n_sprinted + n_did_not_sprint = players_on (sprinted = went above 5.5 m/s in the 10 s after); "
                           "retreat_10s_m = how far the team's centre moved back towards our goal in 10 s. "
                           "outcome / lost_led_to_score = what THEIR possession from that turnover became before we next had the ball "
                           "(GPS-tracked turnovers only, a different count from the phase table's 'Turnovers we lost' row and from any "
                           "'score within 3 minutes' figure - name which one you quote)."}


def _section(res: dict, section: str, limit: int, situation=None, full_positions: bool = False):
    if section == "summary":
        return res["summary"]
    if section == "situations":
        si = res.get("situations") or {"groups": {}, "summary": {}}
        want = [x for x in (situation or SITUATIONS) if x in SITUATIONS] or list(SITUATIONS)
        out = {}
        for g in want:
            rows = si["groups"].get(g, [])
            summ = si["summary"].get(g)
            if g.startswith("their_"):
                summ = _opp_summary(summ)
            out[g] = {"summary": summ, "moments": [
                _opp_moment(r, full_positions) if g.startswith("their_") else
                (r if full_positions else {k: v for k, v in r.items() if k != "positions"} | {"positions": r["positions"][:6]})
                for r in rows[:limit * 3]]}
        out["tag_accuracy"] = si.get("tag_accuracy")
        out["how_to_read"] = (
            "One row per tagged moment; moment_from says how the instant and the ball spot were found. Our own moments (our_shots, "
            "our_turnovers, fouls_we_conceded) are anchored on the tagged player's own GPS, so their distances are good to a metre or two, "
            "and `nearest` there means the nearest TEAM-MATES (the player himself is left out). Opposition moments (their_scores, "
            "their_missed_shots) can only use the tagged spot, which is itself out by about tag_accuracy.median_m metres: for those, "
            "quote the band ('within 5 m', '5-10 m', '10-15 m', 'over 15 m') or counts across many moments, never a single decimal "
            "distance, and never claim one player was 2 m closer than another. "
            "nearest = our three closest tracked outfielders to the ball spot, with closed_in_last_2s_m (+ = he was closing the gap, "
            "- = backing off). goal_side_of_ball = our players nearer our goal line than the ball. in_line_between_ball_and_goal = our "
            "players within 3 m of the straight line from the ball to the middle of the goal. For our_shots the same fields count our "
            "players ahead of the ball and inside their 45. shape = our team shape at that instant; shape_5s_before = 5 s earlier. "
            "positions are sorted nearest first (6 unless full_positions). Opposition players other than the one on the ball are not tracked: "
            "never say an opposition runner was free or unmarked. "
            "our_turnovers are the tagged turnover EVENTS (with the player who lost it) - a different, smaller count than the "
            "transitions section's turnovers lost (every change of possession found in the carries). Name which one you quote. "
            "Distances in every section are from OUR goal line (x = 0) - write 'from our goal' every time.")
        return out
    if section == "positions":
        return res.get("positions")
    if section == "pressure":
        pr = res.get("pressure") or {}
        def clean(x):     # the tagged reception spot is a few metres out: no 3 m share, median as a band
            if not isinstance(x, dict) or "receptions" not in x:
                return x
            x = dict(x); x.pop("pct_within_3m", None)
            if "median_nearest_m" in x:
                x["median_nearest"] = _band(x.pop("median_nearest_m"))
            return x
        out = {}
        for k, v in pr.items():
            if isinstance(v, dict) and "receptions" not in v and k not in ("tag_accuracy",):
                out[k] = {kk: clean(vv) for kk, vv in v.items()}
            else:
                out[k] = clean(v)
        return out
    if section == "transitions":
        return _trim_transitions(res["transitions"], limit)
    if section == "kickouts":
        ko = res["kickouts"]
        rows = [{k: v for k, v in r.items() if k not in ("at_kick", "after_6s", "moved")} for r in ko["kickouts"]]
        return {"totals": ko.get("totals"), "groups": ko["groups"], "push_up_on_their_kickouts": ko["push_up_on_their_kickouts"], "kickouts": rows[:limit * 3],
                "how_to_read": "totals = kickouts with a GPS frame per side (own = ours, opp = theirs), won/lost from OUR side, over_the_sideline "
                               "included (our kick straight out = lost, theirs = won); quote these, never add groups up. team_mean_x = mean distance "
                               "of our outfielders from our own goal line at the kick (higher = pushed up). ours_within_10m_of_landing = our "
                               "outfielders within 10 m of the TAGGED landing spot at the tag (the spot is a few metres out, so a count, never a "
                               "distance); won_near_landing / lost_near_landing give its mean for kept v lost with how many landed. A group "
                               "under 5 kickouts is described, never compared."}
    if section == "intensity":
        it = res["intensity"]
        return {"thresholds": it["thresholds"], "by_half": it["by_half"],
                "players": [{k: v for k, v in p.items() if k != "blocks"} for p in it["players"]],
                "blocks": it["blocks"]}
    if section == "tag_health":
        th = res["tag_health"]
        return {**{k: th[k] for k in ("checked", "n_flagged", "untracked_player")},
                "flagged": [{k: v for k, v in f.items() if k not in ("severity", "id", "player_id")} for f in th["flagged"][:limit]],
                "how_to_read": "Probable mis-tags: the tagged spot disagrees with the named player's own GPS (wrong player or a late tap). "
                               "same_moment_events = his other tagged events within 3 s of it (the same tap: they share the doubt); "
                               "when = the match clock of the nearest tagged event."}
    if section == "support":
        sp = res["support"]
        return {**{k: v for k, v in sp.items() if k != "further_option_passes"}, "further_option_passes": sp["further_option_passes"][:limit],
                "how_to_read": "within_15m = team-mates within 15 m of the passer at the pass. players[].isolated = his passes with nobody "
                               "of ours within 15 m, isolated_pct = that as a share of his passes checked (compare with the team's "
                               "isolated_share_pct; under 15 passes checked, describe only). passes = passes the GPS could check, fewer than his "
                               "tagged passes. further_option = a team-mate within 25 m of the "
                               "passer was at least 15 m further forward than the receiver (we cannot see whether he was marked)."}
    if section == "marking":
        mk = res["marking"]
        return {**{k: v for k, v in mk.items() if k != "shots"}, "shots": mk["shots"][:limit * 3]}
    if section == "moments":
        return res["moments"]
    return None


async def get_gps_match_analysis(db, match_id: str, sections=None, limit: int = 8, club_id=None, situation=None, full_positions: bool = False) -> str:
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
        out[s] = _section(res, s, max(1, min(int(limit or 8), 30)), situation, bool(full_positions))
    return safe_json(out)


BASELINE_FIELDS = ("compactness_out_m", "compactness_in_m", "length_out_m", "median_recovery_s", "median_forward_runners",
                   "hsr_per_player_min", "m_per_player_min", "push_up_mean_x_m", "support_within_15m", "their_receptions_within_5m_pct")


def _baseline(rows: list, exclude_match_id) -> dict:
    """The mean of each figure over the OTHER GPS matches, with its N, so the agent copies a baseline instead of working one out."""
    others = [r for r in rows if str(r.get("match_id")) != str(exclude_match_id)]
    out = {"n_matches": len(others), "matches": [f"{r['opponent']} ({r['match_date']})" for r in others]}
    for f in BASELINE_FIELDS:
        v = [r[f] for r in others if r.get(f) is not None]
        out[f] = {"mean": round(sum(v) / len(v), 1), "n": len(v)} if v else None
    return out


async def get_gps_season_trends(db, club_id=None, exclude_match_id=None) -> str:
    se = await gps.season(db, club_id)
    extra = {"baseline_other_matches": _baseline(se["matches"], exclude_match_id)} if exclude_match_id else {}
    return safe_json({"frame_note": FRAME_NOTE, "matches": se["matches"], **extra, "load_alerts": se["load_alerts"][:30], "note": se["note"],
                      "how_to_read": "compactness_out_m = mean distance of our outfielders from their centre while the opposition had the ball "
                                     "(lower = tighter). hsr = running above 5.5 m/s. load_alerts compare a player's high-speed metres per "
                                     "minute in one match with his own average in the other GPS matches (+-25% or more). "
                                     "baseline_other_matches (only with exclude_match_id) = the mean over our OTHER GPS matches, n = how many "
                                     "had that figure: write 'over our other N GPS matches' with that n. Running figures are already per "
                                     "player-minute, so matches of different length compare fairly."})


TOOL_DEFS = [
    {
        "name": "get_match_gps_positional_analysis",
        "description": (
            "Raw-GPS OFF-THE-BALL analysis of one match (only matches with a synced GPS time series): where our players were, not just "
            "what the ball did. Sections: summary (team running by half, shape in/out of possession, transition summary, drop-off, support, "
            "marking, situation and pressure headlines), situations (for each tagged moment of a kind - their_scores, their_missed_shots, "
            "our_shots, our_turnovers, fouls_we_conceded - our nearest three players to the ball and whether they were closing, how many "
            "within 3/5/10 m, goal-side, in line between ball and goal, inside our 45, sprinting, team shape then and 5 s before, every "
            "player's position; pick kinds with `situation`), positions (each player's average spot with and without the ball per half: "
            "the shape actually played), pressure (distance from our nearest player to each opposition player as he received the ball, "
            "by half and zone, who was closest most often), transitions (every turnover "
            "lost: seconds to get players goal-side, retreat, who sprinted; every turnover won: who broke forward), kickouts (team "
            "shape at each kick, push-up, outcome groups), intensity (per player distance, high-speed metres, sprints, accels, "
            "5-minute blocks, drop-off), tag_health (probable mis-tags where the tagged spot disagrees with the player's GPS), "
            "support (team-mates within 15 m at each pass), marking (nearest of our players to each opposition shot, assigned "
            "marker), moments (key clips with video_ms). Use for 'how compact were we', 'how fast did we get back after turnovers', "
            "'who covered the most ground', 'did we push up on their kickouts'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {"type": "string", "description": "Match UUID"},
                "sections": {"type": "array", "items": {"type": "string", "enum": list(SECTIONS)},
                             "description": "Which sections to return (default ['summary'])"},
                "limit": {"type": "integer", "description": "Max rows per list section (default 8, max 30; situations returns up to 3x this per kind)"},
                "situation": {"type": "array", "items": {"type": "string", "enum": list(SITUATIONS)},
                              "description": "For the situations section: which kinds of moment (default all)"},
                "full_positions": {"type": "boolean", "description": "situations: every tracked player's position instead of the nearest 6 (default false)"},
            },
            "required": ["match_id"],
        },
    },
    {
        "name": "get_gps_shape_trends_by_match",
        "description": (
            "One row per match with a synced GPS time series: result, compactness and length out of possession, median seconds to "
            "get back behind the ball after a turnover, forward runners after winning it, running per player-minute, kickout push-up, "
            "support at passes, distance of the nearest defender to their shots; plus running-load alerts per player (high-speed "
            "metres per minute vs his own average). Use for cross-match questions and wins-vs-losses comparisons."
        ),
        "input_schema": {"type": "object", "properties": {
            "exclude_match_id": {"type": "string", "description": "The match being analysed: adds baseline_other_matches, the mean of each figure over our other GPS matches"}},
            "required": []},
    },
]
