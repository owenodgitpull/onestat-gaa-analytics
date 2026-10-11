"""Lineup timeline: who played where and when, events credited to the position held at that minute."""
from app.services.lineup_timeline import (
    Move, Sub, Timeline, build_spells, describe_personnel, moved_players, personnel_log, position_at, stamp,
    stats_by_spell,
)

# The 2026-10-10 demo match: Connors started centre half forward and moved to midfield at 40' of the second half
# (the lineup rows hold where each player is NOW).
LINEUP = [
    ("connors", "mf-right", False),     # now midfield
    ("curran", "mf-left", False),
    ("ward", "mf-right", False),        # started midfield, went off at 40'
    ("mccready", "hf-center", True),    # came on at 40' into Ward's slot, then swapped
    ("diver", "sub-6", True),           # never came on
]
SUBS = [Sub("ward", "mccready", 2, 40)]
MOVES = [Move("connors", "hf-center", "mf-right", 2, 40), Move("mccready", "mf-right", "hf-center", 2, 40)]


def test_starter_who_moved_has_two_spells_with_the_original_start():
    sp = build_spells(LINEUP, SUBS, MOVES)
    c = sp["connors"]
    assert [s.position_id for s in c] == ["hf-center", "mf-right"]
    assert c[0].start == (1, 0) and c[0].end == (2, 2400) and c[1].start == (2, 2400) and c[1].end is None


def test_sub_who_swapped_on_entry_has_one_effective_spell():
    sp = build_spells(LINEUP, SUBS, MOVES)
    m = sp["mccready"]
    assert [s.position_id for s in m] == ["hf-center"]       # the zero-length mf-right spell is dropped
    assert m[0].via == "move" and m[0].start == (2, 2400)


def test_off_player_ends_and_bench_never_on_is_absent():
    sp = build_spells(LINEUP, SUBS, MOVES)
    assert sp["ward"][0].end == (2, 2400)
    assert "diver" not in sp
    assert set(moved_players(sp)) == {"connors"}


def test_no_moves_means_current_position_all_match():
    sp = build_spells([("a", "gk", False)], [], [])
    assert len(sp["a"]) == 1 and sp["a"][0].position_id == "gk" and sp["a"][0].end is None


def test_first_half_added_time_is_not_second_half():
    sp = build_spells(LINEUP, SUBS, MOVES)
    # minute 34 of the FIRST half (added time) is before the move; minute 34 of the second half is after it
    assert position_at(sp["connors"], stamp(1, 34, None)) == "hf-center"
    assert position_at(sp["connors"], stamp(2, 34, None)) == "hf-center"   # second half minute 34 < 40
    assert position_at(sp["connors"], stamp(2, 41, None)) == "mf-right"


def test_events_credited_to_the_position_held_then():
    sp = moved_players(build_spells(LINEUP, SUBS, MOVES))
    evs = [
        {"player_id": "connors", "event_type": "wide", "half": 1, "minute": 12},
        {"player_id": "connors", "event_type": "wide", "half": 2, "minute": 33},
        {"player_id": "connors", "event_type": "turnover_won", "half": 2, "minute": 44},
        {"player_id": "connors", "event_type": "point", "half": 2, "minute": 50},
    ]
    rows = stats_by_spell(sp, evs)["connors"]
    assert rows[0]["position_id"] == "hf-center" and rows[0]["counts"] == {"wides": 2}
    assert rows[1]["position_id"] == "mf-right" and rows[1]["counts"] == {"turnovers_won": 1, "scores": 1}


def test_personnel_log_before_after_and_caution():
    evs = [
        {"own": False, "event_type": "point", "half": 2, "minute": 33},
        {"own": False, "event_type": "point", "half": 2, "minute": 36},
        {"own": True, "event_type": "point", "half": 2, "minute": 38},
        {"own": True, "event_type": "point", "half": 2, "minute": 43},
        {"own": False, "event_type": "wide", "half": 2, "minute": 45},
    ]
    names = {"ward": "Ward", "mccready": "McCready", "connors": "Connors"}
    log = personnel_log(SUBS, MOVES, evs, names)
    kinds = [r["kind"] for r in log]
    assert kinds.count("substitution") == 1 and kinds.count("position_move") == 1   # the swap is reported once
    swap = next(r for r in log if r["kind"] == "position_move")
    assert swap["before"] == {"our_points": 1, "our_scores": 1, "their_points": 2, "their_scores": 2}
    assert swap["after"]["our_points"] == 1 and swap["after"]["their_points"] == 0
    assert swap["minutes_after_compared"] == 6 and "caution" not in swap


def test_describe_empty_when_nothing_changed():
    tl = Timeline(spells=build_spells([("a", "gk", False)], [], []), subs=[], moves=[], names={"a": "A"})
    assert describe_personnel(tl, []) == {}


def test_describe_names_the_players_and_positions():
    tl = Timeline(spells=build_spells(LINEUP, SUBS, MOVES), subs=SUBS, moves=MOVES,
                  names={"connors": "Ryan Connors", "ward": "Matthew Ward", "mccready": "Danny McCready"})
    out = describe_personnel(tl, [{"own": True, "player_id": "connors", "event_type": "wide", "half": 1, "minute": 9}])
    p = out["players_who_changed_position"][0]
    assert p["player"] == "Ryan Connors"
    assert [x["position"] for x in p["positions"]] == ["centre half forward", "right midfield"]
    assert p["positions"][0]["from_minute"] == 0 and p["positions"][0]["to_minute"] == 40
    assert p["positions"][0]["stats"] == {"wides": 1}


def test_personnel_lines_for_the_brief():
    from app.services.ai.live_brief import _personnel_lines
    tl = Timeline(spells=build_spells(LINEUP, SUBS, MOVES), subs=SUBS, moves=MOVES,
                  names={"connors": "Ryan Connors", "ward": "Matthew Ward", "mccready": "Danny McCready"})
    evs = [{"own": True, "player_id": "connors", "event_type": "point", "half": 2, "minute": 44}]
    lines = _personnel_lines(describe_personnel(tl, evs))
    text = "\n".join(lines)
    assert "Ryan Connors: centre half forward 0'-40' then right midfield 40'-now" in text
    assert "min before" in text and "min after" in text
