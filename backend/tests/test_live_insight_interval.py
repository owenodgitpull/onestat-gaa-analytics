"""The interval trigger must work across half time, including first-half added time and a 35-minute half."""
from app.services.live_insights_service import minutes_since_last_insight as since


def test_within_a_half_is_a_plain_difference():
    assert since(15, 1, 10, 1, 30) == 5
    assert since(50, 2, 45, 2, 35) == 5


def test_across_half_time_club():
    # last insight at 28', second half now at 33' of a 30-minute half: 2 (rest of 1st half) + 3 = 5
    assert since(33, 2, 28, 1, 30) == 5


def test_added_time_does_not_delay_the_first_second_half_insight():
    # last insight at 34' (added time), second half at 35' of a 30-minute half -> 5, not 1
    assert since(35, 2, 34, 1, 30) == 5
    assert since(30, 2, 34, 1, 30) == 0


def test_inter_county_half_length_is_used():
    # 35-minute half: last at 33', second half at 38' -> 2 + 3
    assert since(38, 2, 33, 1, 35) == 5
    # missing half length falls back to 30
    assert since(33, 2, 28, 1, None) == 5
