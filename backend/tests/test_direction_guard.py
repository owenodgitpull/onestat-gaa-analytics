"""
Guard: analytics code must not read raw pitch coordinates without the direction helpers.

pitch_x / pitch_y are stored as drawn on screen; which goal a team attacks flips every half (and
for the opposition). Any file that ANALYSES coordinates must go through
app/utils/attack_direction.py or app/services/attack_frame.py (or the xP service, which has its own
tested normaliser). If you add a new analytic that reads pitch_x, this test fails until it does —
use `own_frame` / `side_frame` (see docs/pitch-coordinates.md).

Plumbing that only stores / returns coordinates is allow-listed below.
"""
import pathlib
import re

APP = pathlib.Path(__file__).resolve().parents[1] / "app"

# Files that only persist / pass coordinates through — no spatial interpretation.
PLUMBING = (
    "models/", "schemas/", "utils/",
    "routes/match_events.py", "routes/video_events.py", "routes/video_analysis.py",
    "routes/player_movement.py", "services/player_movement_service.py",
    "services/match_event_service.py", "services/possession_service.py",
    "services/video/", "services/attack_frame.py",
    # Carry distance = straight-line magnitude sqrt(dx² + dy²): direction can't change it.
    "services/leaderboard_service.py",
)

HELPER_MARKERS = (
    "attack_frame", "attack_direction", "own_frame", "side_frame",
    "_normalized_x", "own_attacks_right",
)

COORD_USE = re.compile(r"\bpitch_x\b|\bstart_x\b|\bend_x\b")


def _rel(p: pathlib.Path) -> str:
    return p.relative_to(APP).as_posix()


def test_every_analytic_that_reads_coordinates_uses_the_direction_helpers():
    offenders = []
    for path in APP.rglob("*.py"):
        rel = _rel(path)
        if rel.startswith(PLUMBING) or "__pycache__" in rel:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if not COORD_USE.search(text):
            continue
        if not any(marker in text for marker in HELPER_MARKERS):
            offenders.append(rel)
    assert not offenders, (
        "These files read raw pitch coordinates but never use the attack-direction helpers "
        f"(app/utils/attack_direction.py, app/services/attack_frame.py): {offenders}. "
        "Raw x/y are direction-blind — see docs/pitch-coordinates.md."
    )
