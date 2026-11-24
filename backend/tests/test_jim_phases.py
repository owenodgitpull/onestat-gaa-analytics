from types import SimpleNamespace as NS
from app.services.ai import jim_phases as J
from app.services.ai.phase_facts import normalise, possessions


def row(t, team, minute, clock, x=50, y=50, half=1):
    return NS(event_type=t, team=team, minute=minute, half=half, match_clock_s=clock, pitch_x=x, pitch_y=y)


def test_buildup_needs_own_third_win_and_crossing_their_45():
    rows = [row("turnover_won", "own", 1, 60, x=20), row("point", "own", 1, 90, x=85),
            row("turnover_won", "own", 5, 300, x=55), row("wide", "own", 5, 330, x=85)]
    evs = normalise(rows, 30)
    ps = possessions(evs)
    c = J.classify(rows, evs, ps, True, 30)
    assert len(c["buildup"]) == 1 and len(c["buildup_crossed"]) == 1
    # the 20 -> 85 turnover goes direct to their 45: quick. The 55 -> 85 one does too (no backward ball). Established = the rest (none)
    assert len(c["quick"]) == 2 and len(c["established"]) == 0


def test_quick_attack_goes_direct_to_their_45_without_going_backwards():
    rows = [row("turnover_won", "own", 2, 100, x=50), row("point", "own", 2, 160, x=80)]   # 60 s, but direct: quick
    evs = normalise(rows, 30)
    c = J.classify(rows, evs, possessions(evs), True, 30)
    assert len(c["quick"]) == 1 and len(c["established"]) == 0


def test_a_recycled_turnover_possession_is_established():
    rows = [row("turnover_won", "own", 2, 100, x=50), row("kick_pass", "own", 2, 105, x=30), row("point", "own", 2, 110, x=80)]
    evs = normalise(rows, 30)
    c = J.classify(rows, evs, possessions(evs), True, 30)
    assert len(c["quick"]) == 0 and len(c["established"]) == 1
