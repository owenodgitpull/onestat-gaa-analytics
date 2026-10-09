"""The pitch calibration must put every marked line at its real distance (see app/utils/pitch_calibration.py)."""
import math

from app.utils.pitch_calibration import (
    along_m, lateral_m, distance_to_goal_m, arc_phrase, zone_phrase, DEFAULT_LENGTH_M,
)


def test_marked_lines_read_their_real_distance():
    for pct, real in [(0.0, 0.0), (10.06, 13.0), (13.58, 20.0), (30.48, 40.0), (34.99, 45.0), (44.83, 65.0), (50.0, 72.5)]:
        assert abs(along_m(pct) - real) < 0.05, (pct, along_m(pct), real)


def test_symmetric_for_both_ends():
    # 10.06% from the left goal and 10.06% from the right goal are the same real distance from their own goal lines
    assert abs(along_m(100 - 89.94) - along_m(10.06)) < 1e-9
    assert abs(along_m(89.94 + 0.0) - (DEFAULT_LENGTH_M - along_m(100 - 89.94))) < 1e-9


def test_apex_of_the_drawn_arc_is_40m():
    assert abs(distance_to_goal_m(100 - 30.48, 50.0, True) - 40.0) < 0.1
    assert abs(distance_to_goal_m(30.48, 50.0, False) - 40.0) < 0.1


def test_drawn_arc_is_a_40m_circle_where_it_meets_the_20m_line():
    # the drawn arc meets the 20m line ~21.5 app-m from the goal line, 40.0 app-m off the centre
    x = 100 - 21.5 / 145 * 100
    y = 50 + 40.0 / 0.9
    assert abs(distance_to_goal_m(x, y, True) - 40.0) < 1.0


def test_shot_just_outside_the_drawn_arc_reads_about_41_to_43m():
    # Barry Curran's wide: 25.5% along from the goal, 29.2 app-m from the centre line (it sat just outside the drawn arc)
    d = distance_to_goal_m(100 - 25.5, 50 + 29.2 / 0.9, True)
    assert 41.0 <= d <= 43.5, d
    assert "outside the 40m arc" in arc_phrase(d)


def test_arc_phrase_on_the_line():
    assert arc_phrase(40.4) == "on the 40m arc"
    assert "inside" in arc_phrase(35.0)


def test_monotonic():
    last = -1.0
    for i in range(0, 1001):
        v = along_m(i / 10.0)
        assert v >= last - 1e-9
        last = v


def test_short_ground_drops_the_65m_anchor():
    # on a 130m ground halfway is 65m, so the drawn 65m line (44.83%) can't also read 65m
    assert along_m(44.83, 130.0) < 65.0
    assert abs(along_m(50.0, 130.0) - 65.0) < 0.05


def test_lateral_landmarks():
    assert abs(lateral_m(50.0)) < 1e-9
    assert abs(lateral_m(50.0 + 7.55 / 0.9) - 7.0) < 0.05          # goal area edge
    assert abs(lateral_m(100.0, 80.0) - 40.0) < 0.05               # sideline = half the width


def test_zone_phrases_follow_the_drawn_lines():
    # on the drawn 45m line (34.99% from their goal) -> 45m; just inside it is "inside the 45m line"
    assert zone_phrase(100 - 34.0, 50.0) == "inside the 40m arc" or zone_phrase(100 - 34.0, 50.0) == "inside the 45m line"
    assert zone_phrase(100 - 36.0, 50.0) == "past midfield"
    assert zone_phrase(100 - 12.0, 50.0) == "inside the 20m line"
    assert zone_phrase(100 - 9.0, 50.0) == "inside the 13m line"
    assert zone_phrase(100 - 25.0, 50.0) == "inside the 40m arc"
    assert zone_phrase(20.0, 50.0) == "inside own 40m arc"
