"""A created match takes its half length from the request if sent, else from the club's default (never the column's 30)."""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

from app.schemas.match import MatchCreate
from app.services.match_service import MatchService


class _Db:
    def __init__(self, club_default):
        self.club = SimpleNamespace(default_half_duration=club_default) if club_default else None
        self.added = []

    async def get(self, model, pk):
        return self.club

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        pass

    async def refresh(self, obj):
        pass


def _create(payload, club_default):
    db = _Db(club_default)
    asyncio.run(MatchService.create_match(db, MatchCreate(**payload), club_id=uuid4()))
    return db.added[0]


BASE = {"opponent": "Kerry", "match_date": "2026-05-23T15:00:00", "venue": "away"}


def test_unspecified_uses_club_default_inter_county():
    assert _create(BASE, 35).half_duration_mins == 35


def test_unspecified_uses_club_default_club_side():
    assert _create(BASE, 30).half_duration_mins == 30


def test_explicit_value_wins_over_club_default():
    assert _create({**BASE, "half_duration_mins": 30}, 35).half_duration_mins == 30


def test_simple_scoring_flag_is_kept():
    assert _create({**BASE, "precise_tracking_enabled": False}, 35).precise_tracking_enabled is False
