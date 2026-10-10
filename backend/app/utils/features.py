"""
Feature flags derived from a club's team level — the ONE place that knows which level unlocks what.

Code asks `has_feature(club, "opposition_lineup")`; it never compares `team_level` itself. When a new tier or a
per-club pilot arrives, only this table changes.
"""
TEAM_LEVELS = ("club", "inter_county")

_FEATURES_BY_LEVEL = {
    "club": frozenset(),
    "inter_county": frozenset({"opposition_lineup"}),
}


def features_for_level(level: str | None) -> dict[str, bool]:
    on = _FEATURES_BY_LEVEL.get(level or "club", frozenset())
    return {name: True for name in on}


def has_feature(club, name: str) -> bool:
    return name in _FEATURES_BY_LEVEL.get(getattr(club, "team_level", None) or "club", frozenset())
