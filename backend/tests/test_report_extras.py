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


def test_phase_groups_do_not_overlap():
    from app.services.ai.phase_facts import GROUPS, Possession
    names = ["own_ko_kept", "own_ko_lost", "opp_ko_won", "opp_ko_kept", "turnovers_won", "turnovers_lost",
             "contests_won", "contests_lost"]
    origins = ["own_ko_kept", "own_ko_lost", "opp_ko_won", "opp_ko_kept", "turnover_won", "turnover_won_forced",
               "turnover_lost", "turnover_lost_unforced", "contest_won", "contest_lost", "free_won"]
    for origin in origins:
        for own in (True, False):
            for contested in (True, False):
                p = Possession(origin, own, 5, 1, "open", contested=contested)
                hit = [g for g in names if GROUPS[g](p)]
                assert len(hit) <= 1, (origin, own, contested, hit)


def test_long_possession_has_no_trusted_seconds():
    from app.services.ai.phase_facts import normalise, possessions
    rows = [
        NS(event_type="turnover_lost", team="own", minute=5, half=1, match_clock_s=300, pitch_x=None, pitch_y=None),
        NS(event_type="point", team="opponent", minute=9, half=1, match_clock_s=300 + 208, pitch_x=None, pitch_y=None),
    ]
    from app.services.ai.phase_facts import group_stats
    p = possessions(normalise(rows, 30))[0]
    assert p.outcome == "score" and p.seconds == 208         # kept, not hidden...
    g = group_stats([p])
    assert g["median_seconds_to_shot"] is None and g["shots_over_two_minutes"] == 1   # ...but not in the median


def test_scorecard_is_put_back_exactly():
    from app.services.ai.match_agent import _apply_scorecard
    tool = "| Phase | Possessions | Finished |\n|---|---|---|\n| A | 1 | 1 |"
    typed = "intro\n\n| Phase | Possessions | Finished |\n|---|---|---|\n| A | 1 | 1 finished, 3 shots |\n\nafter"
    out = _apply_scorecard(typed, tool)
    assert "| A | 1 | 1 |" in out and "3 shots" not in out and out.startswith("intro") and out.endswith("after")
    assert _apply_scorecard("no table here", tool) == "no table here"


def test_saves_from_inside_the_13m_are_chances_and_distance_saves_are_not():
    rows, evs = _build([
        _row("saved", "own", 10, x=94, y=50),        # ours, right on the goal: a chance
        _row("saved", "own", 12, x=70, y=50),        # ours, from distance: routine
        _row("saved", "opponent", 20, x=4, y=48),    # theirs, close in, saved by our keeper
        _row("saved", "opponent", 25, x=30, y=50),   # theirs, from distance
        _row("saved", "own", 28),                     # no position
    ])
    out = build_extras(rows, evs, True, 30, name_of=lambda r: "Shot Taker")["saved_chances"]
    assert out["ours"]["saved_in_total"] == 3
    assert out["ours"]["from_inside_the_13m_count"] == 1
    assert out["ours"]["from_inside_the_13m"][0]["saved_by"] == "their goalkeeper"
    assert out["theirs"]["saved_in_total"] == 2
    assert out["theirs"]["from_inside_the_13m_count"] == 1
    assert out["theirs"]["from_inside_the_13m"][0]["saved_by"] == "our goalkeeper"
    assert out["theirs"]["from_inside_the_13m"][0]["when"] == "1st half 20'"
