"""Agents find a match by opponent / date / 'latest' instead of a pasted UUID (Owen 2026-11-21)."""
import asyncio
import uuid
from datetime import date
from types import SimpleNamespace

from app.services.ai import match_lookup


def _m(opp, d, done=True, comp="NFL"):
    return SimpleNamespace(id=uuid.uuid4(), opponent=opp, match_date=d, competition=comp, counts_in_stats=done)


MS = [  # newest first, as _club_matches returns them
    _m("Dublin", date(2026, 6, 21)),
    _m("Cork", date(2026, 6, 13)),
    _m("Kerry", date(2026, 5, 23), comp="Championship"),
    _m("Down", date(2026, 4, 26)),
    _m("Kerry", date(2026, 3, 29)),
    _m("Armagh", date(2026, 7, 5), done=False),
]


def run(ref, monkeypatch):
    async def fake(db, club_id, include_unfinished=False):
        return MS if include_unfinished else [m for m in MS if m.counts_in_stats]
    monkeypatch.setattr(match_lookup, "_club_matches", fake)
    return asyncio.run(match_lookup.resolve_match_ref(None, "club", ref))


def test_uuid_passes_through(monkeypatch):
    u = str(uuid.uuid4())
    assert run(u, monkeypatch) == (u, None)


def test_latest_is_newest_finished(monkeypatch):
    assert run("latest", monkeypatch)[0] == str(MS[0].id)


def test_unique_opponent(monkeypatch):
    assert run("Dublin", monkeypatch)[0] == str(MS[0].id)
    assert run("v Cork", monkeypatch)[0] == str(MS[1].id)


def test_ambiguous_opponent_lists_candidates(monkeypatch):
    mid, err = run("Kerry", monkeypatch)
    assert mid is None and len(err["candidates"]) == 2


def test_opponent_and_date(monkeypatch):
    assert run("Kerry 23 May", monkeypatch)[0] == str(MS[2].id)
    assert run("Kerry 2026-03-29", monkeypatch)[0] == str(MS[4].id)
    assert run("29/3", monkeypatch)[0] == str(MS[4].id)
    assert run("June 21", monkeypatch)[0] == str(MS[0].id)


def test_unknown_lists_all(monkeypatch):
    mid, err = run("Mayo", monkeypatch)
    assert mid is None and len(err["candidates"]) == 5
