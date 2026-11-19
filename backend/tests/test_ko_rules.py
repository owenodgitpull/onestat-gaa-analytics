"""ko_rules: a real placement effect spread over matches 'stands out'; pure noise rarely does."""
import numpy as np

from app.services.gps_analysis.ko_rules import kickout_patterns

L, W = 145.0, 85.0


def _rows(seed, effect):
    rng = np.random.default_rng(seed)
    rows = []
    for m in range(5):
        for k in range(24):
            at = []
            a_left = rng.random() < 0.5
            for i in range(12):
                y = (10 if a_left else 60) if i == 0 else float(rng.uniform(5, 80))
                at.append({"player_id": f"p{i}", "name": f"P{i}", "x": float(rng.uniform(40, 110)), "y": y})
            p = (0.9 if a_left else 0.3) if effect else 0.6
            rows.append({"match_id": f"m{m}", "opponent": f"O{m}", "match_date": f"2026-0{m + 1}-01", "L": L, "W": W,
                         "video_ms": k * 1000, "half": 1, "kind": "own", "outcome": "won clean" if rng.random() < p else "lost clean",
                         "won": None, "landing_x": float(rng.uniform(50, 100)), "landing_y": float(rng.uniform(5, 80)), "at_kick": at})
            rows[-1]["won"] = rows[-1]["outcome"].startswith("won")
    return rows


def test_real_effect_stands_out():
    out = kickout_patterns(_rows(1, True))["sides"]["own"]["patterns"]["win"]
    top = [p for p in out if p["strength"] == "stands out"]
    assert top and any(pt["label"].startswith("P0 was within") and "left touchline" in pt["label"] for p in top for pt in p["parts"])


def test_noise_rarely_stands_out():
    """the bar is set so pure noise passes about 1 run in 20: allow 2 of 10 for the small sample"""
    hits = 0
    for seed in range(2, 12):
        side = kickout_patterns(_rows(seed, False))["sides"]["own"]["patterns"]
        hits += any(p["strength"] == "stands out" for p in side["win"] + side["lose"])
    assert hits <= 2
