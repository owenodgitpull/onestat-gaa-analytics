"""Opposition substitution events: only a substitution by the opponent with both ids counts."""
from types import SimpleNamespace as E
from uuid import uuid4

from app.services.opposition_service import _is_opposition_sub


def ev(et="substitution", team="opponent", off=True, on=True):
    return E(event_type=et, team=team, opposition_player_id=uuid4() if off else None,
             opposition_sub_in_player_id=uuid4() if on else None)


def test_opposition_sub_needs_both_players():
    assert _is_opposition_sub(ev())
    assert not _is_opposition_sub(ev(on=False))
    assert not _is_opposition_sub(ev(off=False))


def test_only_substitutions_by_the_opponent():
    assert not _is_opposition_sub(ev(team="own"))
    assert not _is_opposition_sub(ev(et="point"))
