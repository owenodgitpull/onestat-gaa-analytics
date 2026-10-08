"""Direction helper tests — mirrors a whole match and requires identical answers."""
import itertools
from app.utils.attack_direction import (
    is_first_half, own_attacks_right, side_attacks_right, to_attack_frame, point_in_side_frame,
)


def test_own_direction_by_half():
    assert own_attacks_right(True, 1) is True
    assert own_attacks_right(True, 2) is False      # teams swap ends
    assert own_attacks_right(False, 1) is False
    assert own_attacks_right(False, 2) is True
    assert own_attacks_right(None, 1) is True        # unrecorded -> long-standing default
    assert own_attacks_right(None, 2) is False


def test_half_falls_back_to_minute_and_half_length():
    assert is_first_half(None, 29, 30) is True
    assert is_first_half(None, 30, 30) is False
    assert is_first_half(None, 35, 35) is False
    assert is_first_half(None, 34, 35) is True
    assert is_first_half(1, 99, 30) is True          # explicit half wins


def test_opposition_attacks_the_other_way():
    for own in (True, False):
        assert side_attacks_right(True, own) is own
        assert side_attacks_right(False, own) is (not own)


def test_flip_is_a_180_rotation():
    assert to_attack_frame(20, 10, True) == (20, 10)
    assert to_attack_frame(20, 10, False) == (80, 90)


def test_kickout_example_from_the_bug_report():
    # Dungloe attack right-to-left in the 1st half (own goal on the RIGHT, x=100).
    # A kickout landing at x=72, y=97.6 is SHORT (28 from own goal) and on the team's LEFT.
    x, y = point_in_side_frame(72.16, 97.62, True, attacking_right_first_half=False, half=1)
    assert round(x) == 28          # distance from own goal -> Short (< 31)
    assert y < 33                  # team's LEFT


def test_mirroring_the_whole_match_changes_nothing():
    """A match and its mirror image (every x,y rotated 180° and the 1st-half direction flipped)
    must give identical attack-frame points for every event, in both halves, for both teams."""
    pts = [(5.0, 20.0), (50.0, 50.0), (72.16, 97.62), (95.0, 3.0)]
    for first, half, is_own in itertools.product((True, False), (1, 2), (True, False)):
        for (x, y) in pts:
            a = point_in_side_frame(x, y, is_own, first, half)
            b = point_in_side_frame(100 - x, 100 - y, is_own, not first, half)
            assert (round(a[0], 6), round(a[1], 6)) == (round(b[0], 6), round(b[1], 6))


# ---- attack_frame (the loader used by the AI tools and season analytics) -----------------------
from types import SimpleNamespace
from app.services.attack_frame import own_frame, side_frame


def _ev(x, y, half=None, minute=None, match="m1"):
    return SimpleNamespace(pitch_x=x, pitch_y=y, half=half, minute=minute, match_id=match)


def test_own_frame_uses_recorded_direction_and_half():
    d_right = {"m1": (True, 30)}   # we attack right in the 1st half
    d_left = {"m1": (False, 30)}   # we attack LEFT in the 1st half
    # 1st half, attacking right: untouched
    assert own_frame(_ev(80, 20, half=1), d_right) == (80, 20)
    # 2nd half, attacking right in the 1st -> we now attack left: rotated
    assert own_frame(_ev(80, 20, half=2), d_right) == (20, 80)
    # attacking left in the 1st half: rotated
    assert own_frame(_ev(80, 20, half=1), d_left) == (20, 80)
    # legacy rows with no half: minute vs half length decides (28' = 1st, 40' = 2nd)
    assert own_frame(_ev(80, 20, minute=28), d_right) == (80, 20)
    assert own_frame(_ev(80, 20, minute=40), d_right) == (20, 80)


def test_missing_coordinates_return_none():
    assert own_frame(_ev(None, 20, half=1), {"m1": (True, 30)}) == (None, None)


def test_opposition_is_framed_from_its_own_side():
    d = {"m1": (True, 30)}
    # 1st half: we attack right, they attack LEFT, so their frame is a rotation of ours
    assert side_frame(_ev(10, 30, half=1), d, is_own=False) == (90, 70)
    assert side_frame(_ev(10, 30, half=1), d, is_own=True) == (10, 30)


def test_whole_match_mirror_gives_identical_framed_events():
    """Mirror every coordinate (180° rotation) and flip the recorded direction: every event must land
    on exactly the same framed point, for both teams, both halves, with and without a stored half."""
    pts = [(5.0, 20.0), (50.0, 50.0), (72.16, 97.62), (95.0, 3.0)]
    for first in (True, False):
        for half in (1, 2, None):
            for is_own in (True, False):
                for (x, y) in pts:
                    minute = 10 if half in (1, None) else 40
                    a = side_frame(_ev(x, y, half=half, minute=minute), {"m1": (first, 30)}, is_own)
                    b = side_frame(_ev(100 - x, 100 - y, half=half, minute=minute), {"m1": (not first, 30)}, is_own)
                    assert (round(a[0], 6), round(a[1], 6)) == (round(b[0], 6), round(b[1], 6))


def test_the_reported_kickout_lands_short_and_left_in_the_kickers_frame():
    # Dungloe attack right-to-left (own goal on the right). Kickout landed at (72.2, 97.6) in the 1st half.
    fx, fy = side_frame(_ev(72.16, 97.62, half=1), {"m1": (False, 30)}, is_own=True)
    assert fx < 31        # SHORT (within 31 of its own goal)
    assert fy < 33        # on the kicking team's LEFT
