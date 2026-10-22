from app.services.pass_flight import infer_flight, MIN_FLIGHT_M
from app.utils.pitch_calibration import distance_m, along_m, position_m


def test_distance_uses_calibrated_scale_not_linear():
    # 10.06% from the goal is the 13m line, 34.99% the 45m line: 32m between them, not 24.9% * 1.45 = 36m
    d = distance_m((10.06, 50), (34.99, 50))
    assert abs(d - 32.0) < 0.3


def test_position_m_is_symmetric_about_the_centre_line():
    _, up = position_m(50, 70)
    _, down = position_m(50, 30)
    assert up > 0 > down and abs(up + down) < 1e-9


def test_dragged_carry_that_ends_where_it_stopped_has_no_flight():
    trail = [{"x": 40, "y": 50}, {"x": 42, "y": 50}, {"x": 44, "y": 51}]
    assert infer_flight(trail, (40, 50), (44, 51)) is None


def test_tap_after_a_drag_is_the_pass_not_the_carry():
    trail = [{"x": 40, "y": 50}, {"x": 42, "y": 50}, {"x": 44, "y": 51}]
    f = infer_flight(trail, (40, 50), (60, 30))
    assert f and f["origin"] == (44.0, 51.0) and f["destination"] == (60.0, 30.0) and f["metres"] > MIN_FLIGHT_M


def test_no_drag_at_all_then_a_tap_is_all_pass():
    f = infer_flight([{"x": 28.5, "y": 77.1}], (28.5, 77.1), (10.1, 76.6))
    assert f and f["origin"] == (28.5, 77.1) and f["metres"] > 20


def test_a_short_move_is_not_a_pass():
    assert infer_flight([{"x": 50, "y": 50}], (50, 50), (53, 50)) is None   # ~4 m, a normal drag step
