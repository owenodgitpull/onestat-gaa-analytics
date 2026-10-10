"""Phase tools: shape, reconciliation and the tool registry."""
import asyncio
import json
from types import SimpleNamespace as E

from app.services.ai import phase_report
from app.services.ai._shared import TOOLS
from app.services.ai.phase_facts import normalise


def row(t, team="own", minute=1, half=1, clock=None):
    return E(event_type=t, team=team, minute=minute, half=half, match_clock_s=clock, player_id=None,
             opponent_player_name="Smith" if team != "own" else None)


def _patch(monkeypatch, rows):
    async def fake(db, match_id, club_id):
        return E(half_duration_mins=30), rows, normalise(rows, 30)
    monkeypatch.setattr(phase_report, "_load", fake)


ROWS = [row("own_kickout_won", minute=1), row("point", minute=1),
        row("own_kickout_opposition_won", minute=5), row("point", "opponent", minute=6),
        row("own_kickout_won", minute=9), row("wide", minute=9),
        row("turnover_lost", minute=40, half=2), row("goal", "opponent", minute=41, half=2)]


def test_summary_reconciles(monkeypatch):
    _patch(monkeypatch, ROWS)
    out = json.loads(asyncio.run(phase_report.get_phase_summary(None, "m", None)))
    ko = out["phases"]["own_ko_kept"]["match"]
    assert ko["possessions"] == 2 and ko["became_a_shot"] == 2 and ko["scored"] == 1
    assert "note" in ko                                      # under 3 finished -> flagged
    halves = out["phases"]["own_ko_kept"]
    assert halves["first_half"]["possessions"] + halves["second_half"]["possessions"] == ko["possessions"]
    assert out["final_score"]["them"].startswith("1-01")


def test_sequences_only_shots_and_filter(monkeypatch):
    _patch(monkeypatch, ROWS)
    out = json.loads(asyncio.run(phase_report.get_phase_sequences(None, "m", None, phase="own_ko_lost")))
    assert out["count"] == 1 and out["sequences"][0]["possession"] == "theirs"
    assert out["sequences"][0]["began"] == "our kickout, lost" and out["sequences"][0]["by"] == "Smith"


def test_tools_registered():
    names = {t["name"] for t in TOOLS}
    assert {"get_phase_summary", "get_phase_sequences", "get_season_phase_profile"} <= names
