"""Phase facts: possessions are walked in event ORDER and every origin is in the denominator."""
from types import SimpleNamespace as E

from app.services.ai.phase_facts import (
    possessions, summarise, group_stats, normalise, order_key, points_for,
)


def ev(t, team="own", minute=1, half=1, clock=None):
    return E(event_type=t, team=team, minute=minute, half=half, match_clock_s=clock)


def test_kept_kickout_then_score():
    ps = possessions([ev("own_kickout_won"), ev("point")])
    assert len(ps) == 1
    p = ps[0]
    assert (p.origin, p.owner_is_own, p.outcome, p.points) == ("own_ko_kept", True, "score", 1)


def test_lost_kickout_then_they_score_is_their_possession():
    ps = possessions([ev("own_kickout_opposition_won"), ev("point", "opponent")])
    assert ps[0].origin == "own_ko_lost" and ps[0].owner_is_own is False and ps[0].outcome == "score"


def test_goal_is_three_points():
    ps = possessions([ev("turnover_won"), ev("goal")])
    assert ps[0].points == 3 and points_for("two_point_free") == 2 and points_for("wide") == 0


def test_turnover_won_ends_in_wide_and_turnover_lost_hands_ball_over():
    ps = possessions([ev("tackle_won"), ev("wide"), ev("own_kickout_won", minute=2),
                      ev("turnover_lost", minute=3), ev("point", "opponent", minute=3)])
    assert [p.outcome for p in ps] == ["miss", "lost", "score"]
    assert ps[2].origin == "turnover_lost" and ps[2].owner_is_own is False


def test_open_possession_is_not_counted_as_a_failure():
    st = group_stats(possessions([ev("own_kickout_won")]))
    assert (st["n"], st["finished"], st["open"], st["shots"], st["shot_rate"]) == (1, 0, 1, 0, None)


def test_foul_conceded_ends_our_possession():
    assert possessions([ev("opp_kickout_won"), ev("foul_committed")])[0].outcome == "foul"


def test_half_change_closes_possession():
    ps = possessions([ev("own_kickout_won", half=1), ev("own_kickout_won", minute=31, half=2)])
    assert ps[0].outcome == "half_end"


def test_seconds_use_the_match_clock_only_when_both_ends_have_it():
    ps = possessions([ev("turnover_won", clock=600), ev("point", clock=618)])
    assert ps[0].seconds == 18
    ps2 = possessions([ev("turnover_won"), ev("point", clock=618)])
    assert ps2[0].seconds is None


def test_median_seconds_needs_three_samples():
    evs = []
    for i, sec in enumerate((10, 20, 30)):
        base = 100 * (i + 1)
        evs += [ev("turnover_won", minute=i + 1, clock=base), ev("point", minute=i + 1, clock=base + sec)]
    st = group_stats(possessions(evs))
    assert st["median_seconds_to_shot"] == 20
    assert group_stats(possessions(evs[:2]))["median_seconds_to_shot"] is None


def test_totals_reconcile_across_groups():
    evs = [ev("own_kickout_won", minute=1), ev("point", minute=1),
           ev("own_kickout_opposition_won", minute=2), ev("wide", "opponent", minute=2),
           ev("turnover_lost", minute=3), ev("point", "opponent", minute=3),
           ev("interception", minute=4)]
    ps = possessions(evs)
    s = summarise(ps, now=5)
    for name in ("own_ko_kept", "all_ours", "all_theirs"):
        st = s[name]["to_date"]
        assert st["finished"] + st["open"] <= st["n"]
        assert st["shots"] + st["died"] == st["finished"]
        assert st["scores"] <= st["shots"]
    assert s["all_ours"]["to_date"]["n"] + s["all_theirs"]["to_date"]["n"] == len(ps)


def test_window_counts_possessions_that_started_in_the_window():
    ps = possessions([ev("own_kickout_won", minute=1), ev("point", minute=1),
                      ev("own_kickout_won", minute=9), ev("wide", minute=9)])
    s = summarise(ps, now=10, window=5)["own_ko_kept"]
    assert s["to_date"]["n"] == 2 and s["window"]["n"] == 1


def test_order_key_sorts_added_time_before_second_half():
    first_half_added = E(minute=34, half=1, match_clock_s=2040, created_at=1)
    second_half = E(minute=30, half=2, match_clock_s=1800, created_at=2)
    assert order_key(first_half_added) < order_key(second_half)


def test_empty():
    assert possessions([]) == []
    assert normalise([]) == []
