"""
Opposition lineup service (inter-county). The opposition is club-private reference data, not a tenant — see
app/models/opposition.py. Everything here is scoped by the caller's club_id.
"""
import re
from typing import Iterable

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.club import Club
from app.models.match import Match
from app.models.opposition import OppositionTeam, OppositionPlayer, OppositionLineup
from app.utils.features import has_feature
from app.utils.names import surname_only

MAX_LINEUP = 40


def _key(text: str) -> str:
    """'Tyrone GAA' / 'tyrone' / 'Tyrone.' -> 'tyrone' so one team is not split across spellings."""
    k = re.sub(r"[^a-z0-9 ]+", "", (text or "").lower())
    k = re.sub(r"\b(gaa|gac|club|county|senior)\b", "", k)
    return re.sub(r"\s+", " ", k).strip() or (text or "").strip().lower()


def _serialise(rows: Iterable[OppositionLineup]) -> list[dict]:
    return [
        {
            "opposition_player_id": str(r.opposition_player_id),
            "surname": r.player.surname,
            "jersey_number": r.jersey_number,
            "position_id": r.position_id,
            "is_substitute": r.is_substitute,
            "is_on_field": r.is_on_field,
        }
        for r in rows
    ]


async def lineup_for_match(db: AsyncSession, match_id) -> list[dict]:
    rows = (await db.execute(select(OppositionLineup).where(OppositionLineup.match_id == match_id))).scalars().all()
    return _serialise(rows)


async def resolve_team(db: AsyncSession, club_id, name: str) -> OppositionTeam:
    key = _key(name)
    team = (await db.execute(
        select(OppositionTeam).where(OppositionTeam.club_id == club_id, OppositionTeam.name_key == key)
    )).scalar_one_or_none()
    if team is None:
        team = OppositionTeam(club_id=club_id, name=name.strip(), name_key=key)
        db.add(team)
        await db.flush()
    return team


async def get_lineup(db: AsyncSession, match: Match) -> dict:
    """The saved lineup, or — when none is saved yet — the previous lineup against this team as an unsaved prefill."""
    rows = await lineup_for_match(db, match.id)
    team = await resolve_team(db, match.club_id, match.opponent)
    if rows:
        return {"team_id": str(team.id), "team_name": team.name, "lineup": rows, "prefill": False}

    previous = (await db.execute(
        select(Match.id)
        .join(OppositionLineup, OppositionLineup.match_id == Match.id)
        .where(Match.club_id == match.club_id, Match.opposition_team_id == team.id, Match.id != match.id)
        .order_by(Match.match_date.desc())
        .limit(1)
    )).scalar_one_or_none()
    prefill = await lineup_for_match(db, previous) if previous else []
    return {"team_id": str(team.id), "team_name": team.name, "lineup": prefill, "prefill": bool(prefill)}


async def save_lineup(db: AsyncSession, match: Match, entries: list[dict]) -> dict:
    """Replace the match's lineup. Entries: {position_id, jersey_number, surname}. Blank surnames are dropped."""
    team = await resolve_team(db, match.club_id, match.opponent)
    cleaned: dict[str, dict] = {}
    for e in entries[:MAX_LINEUP]:
        pos = str(e.get("position_id") or "").strip()[:20]
        sn = surname_only(str(e.get("surname") or ""))[:100]
        if not pos or not sn:
            continue
        j = e.get("jersey_number")
        ok = isinstance(j, (int, float)) and 0 < j < 100
        cleaned[pos] = {"position_id": pos, "surname": sn, "jersey_number": int(j) if ok else None}

    existing = (await db.execute(
        select(OppositionPlayer).where(OppositionPlayer.opposition_team_id == team.id)
    )).scalars().all()
    by_key = {p.surname_key: p for p in existing}

    await db.execute(delete(OppositionLineup).where(OppositionLineup.match_id == match.id))
    for c in cleaned.values():
        k = c["surname"].lower()
        player = by_key.get(k)
        if player is None:
            player = OppositionPlayer(club_id=match.club_id, opposition_team_id=team.id, surname=c["surname"], surname_key=k)
            db.add(player)
            await db.flush()
            by_key[k] = player
        bench = c["position_id"].startswith("sub")
        db.add(OppositionLineup(
            match_id=match.id, opposition_player_id=player.id, position_id=c["position_id"],
            jersey_number=c["jersey_number"], is_substitute=bench, is_on_field=not bench,
        ))

    match.opposition_team_id = team.id
    # keep the older surname roster (scorer strip, live brief man-marking) in step until those are lineup-driven
    match.opposition_roster = [c["surname"] for c in cleaned.values()]
    await db.commit()
    return {"team_id": str(team.id), "team_name": team.name, "lineup": await lineup_for_match(db, match.id), "prefill": False}


async def club_has_opposition_lineup(db: AsyncSession, club_id) -> bool:
    club = (await db.execute(select(Club).where(Club.id == club_id))).scalar_one_or_none()
    return bool(club and has_feature(club, "opposition_lineup"))
