from types import SimpleNamespace as NS

from app.services.ai.phase_facts import normalise
from app.services.ai.report_extras import build_extras, scores_by_game_state


def _row(t, team="own", minute=1, half=1, x=None, y=None, clock=None):
    return NS(event_type=t, team=team, minute=minute, half=half, match_clock_s=clock, pitch_x=x, pitch_y=y)


def _build(rows):
    evs = normalise(rows, 30)
    return rows, evs


def test_game_state_buckets_each_score_by_state_before_it():
    rows, evs = _build([
        _row("point", "opponent", 2),       # they score: level -> they scored while level
        _row("point", "own", 5),            # we score while behind by 1
        _row("point", "own", 8),            # level before this -> while level
        _row("goal", "own", 12),            # ahead by 1 before -> while ahead
    ])
    g = scores_by_game_state(evs)
    assert g["their_scores"]["while_level"] == {"scores": 1, "points": 1}
    assert g["our_scores"]["while_behind"] == {"scores": 1, "points": 1}
    assert g["our_scores"]["while_level"] == {"scores": 1, "points": 1}
    assert g["our_scores"]["while_ahead"] == {"scores": 1, "points": 3}


def test_frees_link_adjacent_free_shot_and_count_defensive_third():
    rows, evs = _build([
        _row("free_conceded", "own", 10, x=10, y=50),
        _row("point_free", "opponent", 10),
        _row("free_conceded", "own", 20, x=60, y=50),
        _row("wide", "own", 21),
    ])
    out = build_extras(rows, evs, True, 30)["frees"]
    assert out["frees_conceded"] == 2
    assert out["followed_by_a_free_shot_for_them"] == 1
    assert out["of_which_scored"] == 1
    assert out["conceded_in_our_defensive_third"] == 1


def test_kickouts_by_half_length_and_channel():
    rows, evs = _build([
        _row("own_kickout_won", "own", 3, 1, x=40, y=50),
        _row("own_kickout_opposition_won", "own", 5, 1, x=40, y=10),
        _row("own_kickout_won", "own", 8, 1, x=80, y=50),
        _row("opp_kickout_won", "own", 40, 2, x=50, y=50),
    ])
    k = build_extras(rows, evs, True, 30)["kickouts_by_half"]
    h1 = k["half_1"]
    assert h1["our_kickouts"]["kept"] == 2 and h1["our_kickouts"]["of"] == 3
    assert any("long" in key for key in h1["by_length"])
    assert k["half_2"]["their_kickouts"] == {"won_by_us": 1, "of": 1}
