"""Findings engine: arithmetic is exact, small samples are never concluded from, and ranking rotates themes."""
from app.services.ai.insight_findings import (
    Ev, build_findings, top_findings, tally, margin, margin_phrase, early_read_note,
)


def e(t, own=True, minute=1, half=1, clock=None):
    return Ev(t, own, minute, half, clock)


def test_scoreboard_arithmetic_goal_is_three_points():
    evs = [e("goal"), e("point"), e("two_point"), e("wide"), e("point", own=False), e("goal", own=False)]
    us, them = tally(evs, True), tally(evs, False)
    assert (us.goals, us.points, us.total, us.scores, us.shots, us.misses) == (1, 3, 6, 3, 4, 1)
    assert (them.goals, them.points, them.total) == (1, 1, 4)
    assert us.line() == "1-03 (6 pts)"
    assert margin(evs) == 2 and margin_phrase(2) == "2 points up" and margin_phrase(-3) == "3 points down"
    assert margin_phrase(1) == "1 point up" and margin_phrase(0) == "level"


def test_shots_reconcile_with_scores_plus_misses():
    evs = [e("point"), e("wide"), e("saved"), e("goal"), e("short"), e("hit_post")]
    s = tally(evs, True)
    assert s.shots == s.scores + s.misses == 6


def test_scoring_window_reports_margin_move():
    evs = [e("point", True, 2), e("point", False, 7), e("goal", False, 8), e("point", False, 9)]
    f = {x.key: x for x in build_findings(evs, now=10, window=5)}
    assert "scoring_window" in f
    assert "last 5 minutes" in f["scoring_window"].text
    assert "from 1 point up to 4 points down" in f["scoring_window"].text
    assert f["scoring_window"].direction == "against" and f["scoring_window"].score > 0.3


def test_small_samples_are_not_concluded_from():
    # 2 kickouts in the window, 2 before: below MIN_N on both sides -> no kickout finding
    evs = [e("own_kickout_won", minute=1), e("own_kickout_opposition_won", minute=2),
           e("own_kickout_opposition_won", minute=8), e("own_kickout_opposition_won", minute=9)]
    keys = {x.key for x in build_findings(evs, now=10, window=5)}
    assert "own_ko_retention" not in keys


def test_poor_kickout_retention_to_date_is_flagged():
    evs = [e("own_kickout_won", minute=1)] + [e("own_kickout_opposition_won", minute=m) for m in (2, 3, 4, 5)]
    f = {x.key: x for x in build_findings(evs, now=6, window=5)}
    assert "own_ko_retention" in f and f["own_ko_retention"].direction == "against"


def test_turnovers_lost_conversion_needs_three_finished_possessions():
    evs = []
    for m in (1, 2, 3):
        evs += [e("turnover_lost", minute=m), e("point", own=False, minute=m)]
    keys = {x.key for x in build_findings(evs, now=5, window=5)}
    assert "turnover_lost_conceded" in keys
    keys2 = {x.key for x in build_findings(evs[:4], now=5, window=5)}
    assert "turnover_lost_conceded" not in keys2


def test_recent_theme_is_down_weighted_and_one_per_theme():
    evs = [e("own_kickout_won", minute=1)] + [e("own_kickout_opposition_won", minute=m) for m in (2, 3, 4, 5)]
    plain = {x.key: x for x in build_findings(evs, now=6, window=5)}
    rotated = {x.key: x for x in build_findings(evs, now=6, window=5, recent_keys={"own_ko_retention"})}
    assert rotated["own_ko_retention"].score < plain["own_ko_retention"].score
    top = top_findings(build_findings(evs, now=6, window=5), limit=3)
    assert len({f.theme for f in top}) == len(top)


def test_early_read_note():
    assert early_read_note(8, 4) is not None
    assert early_read_note(60, 30) is None


def test_one_point_is_singular_and_scoreboard_phase_is_not_a_game_phase():
    s = tally([e("point")], True)
    assert s.line() == "0-01 (1 pt)"
    f = build_findings([e("point", minute=3)], now=5, window=5)
    sw = [x for x in f if x.key == "scoring_window"][0]
    assert sw.phase == "scoreboard"


def test_kept_kickouts_that_never_score_are_a_finding():
    evs = []
    for m in range(1, 6):   # five kept kickouts, each possession then lost with no shot
        evs += [e("own_kickout_won", minute=m), e("turnover_lost", minute=m)]
    keys = {x.key for x in build_findings(evs, now=8, window=5)}
    assert "kept_ko_unproductive" in keys


def test_update_on_previous_quotes_then_and_now():
    from app.services.ai.insight_findings import update_on_previous
    evs = [e("own_kickout_won", minute=1)] + [e("own_kickout_opposition_won", minute=m) for m in (2, 3, 4, 5)]
    prev = top_findings(build_findings(evs, now=6, window=5))
    evs2 = evs + [e("own_kickout_opposition_won", minute=7)]
    now_f = build_findings(evs2, now=8, window=5)
    lines = update_on_previous(prev, now_f, 6)
    assert lines and all("Raised at 6'" in ln for ln in lines)
    assert any("now:" in ln for ln in lines)


def test_conversion_sentences_state_logged_and_finished_counts():
    evs = []
    for m in (1, 2, 3):
        evs += [e("turnover_lost", minute=m), e("point", own=False, minute=m)]
    f = {x.key: x for x in build_findings(evs, now=5, window=5)}
    assert "3 logged; 3 of them have a finished possession" in f["turnover_lost_conceded"].text
