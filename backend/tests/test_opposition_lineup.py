"""Opposition lineup: team-name matching, surname-only names, and the level -> feature mapping."""
from types import SimpleNamespace

from app.services.opposition_service import _key
from app.utils.features import has_feature, features_for_level
from app.utils.names import surname_only


def test_team_names_match_across_spellings():
    assert _key("Tyrone GAA") == _key("tyrone") == _key("Tyrone.") == "tyrone"
    assert _key("Down") != _key("Derry")


def test_surname_only_keeps_generational_suffix():
    assert surname_only("Conor Cox") == "Cox"
    assert surname_only("C O'Donnell Jr") == "O'Donnell Jr"
    assert surname_only("McBrearty") == "McBrearty"


def test_opposition_lineup_is_inter_county_only():
    assert has_feature(SimpleNamespace(team_level="inter_county"), "opposition_lineup")
    assert not has_feature(SimpleNamespace(team_level="club"), "opposition_lineup")
    assert not has_feature(SimpleNamespace(team_level=None), "opposition_lineup")
    assert features_for_level("club") == {}
