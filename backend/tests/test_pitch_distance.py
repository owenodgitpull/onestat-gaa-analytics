from app.utils.pitch_calibration import distance_m, position_m


def test_distance_uses_calibrated_scale_not_linear():
    # 10.06% from the goal is the 13m line, 34.99% the 45m line: 32m between them, not 24.9% * 1.45 = 36m
    assert abs(distance_m((10.06, 50), (34.99, 50)) - 32.0) < 0.3


def test_position_m_is_symmetric_about_the_centre_line():
    _, up = position_m(50, 70)
    _, down = position_m(50, 30)
    assert up > 0 > down and abs(up + down) < 1e-9
