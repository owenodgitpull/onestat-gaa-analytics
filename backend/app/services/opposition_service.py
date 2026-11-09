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
from app.utils.names import clean_player_name

MAX_LINEUP = 40


def _key(text: str) -> str:
    """'Tyrone GAA' / 'tyrone' / 'Tyrone.' -> 'tyrone' so one team is not split across spellings."""
    k = re.sub(r"[^a-z0-9 ]+", "", (text or "").lower())
    k = re.sub(r"\b(gaa|gac|club|county|senior)\b", "", k)
    return re.sub(r"\s+", " ", k).strip() or (text or "").strip().lower()


def _serialise(rows: Iterable[OppositionLineup], start: dict | None = None) -> list[dict]:
    start = start or {}
    out = []
    for r in rows:
        sp = start.get(str(r.opposition_player_id), r.position_id)
        out.append({
            "opposition_player_id": str(r.opposition_player_id),
            "surname": r.player.surname,
            "jersey_number": r.jersey_number,
            # position_id / is_on_field are the lineup NOW (live tagging needs who is on the pitch); a substitution swaps
            # slots. start_position_id / started are the lineup at throw-in, rebuilt from the substitutions.
            "position_id": r.position_id,
            "is_substitute": r.is_substitute,
            "is_on_field": r.is_on_field,
            "start_position_id": sp,
            "started": not str(sp).startswith("sub"),
        })
    return out


async def starting_slots(db: AsyncSession, match_id, rows=None) -> dict:
    """{opposition_player_id: slot at throw-in}. The table holds the lineup as it is now (each tagged substitution swaps
    the two players' slots), so undo the substitutions newest first. The Dublin lineup was read as its finishing XV."""
    from app.models.match_event import MatchEvent, EventType, Team
    if rows is None:
        rows = (await db.execute(select(OppositionLineup).where(OppositionLineup.match_id == match_id))).scalars().all()
    slots = {str(r.opposition_player_id): r.position_id for r in rows}
    subs = (await db.execute(
        select(MatchEvent.opposition_player_id, MatchEvent.opposition_sub_in_player_id, MatchEvent.half,
               MatchEvent.match_clock_s, MatchEvent.minute, MatchEvent.created_at)
        .where(MatchEvent.match_id == match_id, MatchEvent.event_type == EventType.SUBSTITUTION,
               MatchEvent.team == Team.OPPONENT, MatchEvent.opposition_player_id.isnot(None),
               MatchEvent.opposition_sub_in_player_id.isnot(None)))).all()
    subs = sorted(subs, key=lambda r: (r[2] or 1, r[3] if r[3] is not None else (r[4] or 0) * 60, r[5]))
    for off_id, on_id, *_ in reversed(subs):
        a, b = str(off_id), str(on_id)
        if a in slots and b in slots:
            slots[a], slots[b] = slots[b], slots[a]
    return slots


async def lineup_for_match(db: AsyncSession, match_id) -> list[dict]:
    rows = (await db.execute(select(OppositionLineup).where(OppositionLineup.match_id == match_id))).scalars().all()
    return _serialise(rows, await starting_slots(db, match_id, rows) if rows else None)


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
        # the "surname" field now carries the full name as entered (the column keeps its old name)
        sn = clean_player_name(e.get("surname") or "")
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


# ── opposition substitutions ──────────────────────────────────────────────────

async def _swap(db: AsyncSession, match_id, off_id, on_id) -> bool:
    """Swap two lineup rows' slots: the player coming ON takes the slot (and so the pitch position) of the player
    coming OFF, who moves to the bench slot. Returns False (and changes nothing) unless both are in this match's lineup."""
    if not off_id or not on_id or off_id == on_id:
        return False
    rows = (await db.execute(
        select(OppositionLineup).where(
            OppositionLineup.match_id == match_id, OppositionLineup.opposition_player_id.in_([off_id, on_id])
        )
    )).scalars().all()
    by_player = {r.opposition_player_id: r for r in rows}
    off, on = by_player.get(off_id), by_player.get(on_id)
    if off is None or on is None:
        return False
    # jersey numbers stay with the players; only the slots (pitch positions) swap.
    # (match_id, position_id) is unique and checked per statement, so a straight swap collides with itself (this made
    # every opposition substitution a 500): park one row on a temporary slot, move the other, then land the first.
    off_slot, on_slot = off.position_id, on.position_id
    off.position_id = f"tmp-{str(off.id)[:8]}"
    await db.flush()
    on.position_id = off_slot
    await db.flush()
    off.position_id = on_slot
    await db.flush()
    for r in (off, on):
        bench = r.position_id.startswith("sub")
        r.is_substitute = bench
        r.is_on_field = not bench
    return True


def _is_opposition_sub(event) -> bool:
    et = getattr(event.event_type, "value", event.event_type)
    tm = getattr(event.team, "value", event.team)
    return str(et) == "substitution" and str(tm) == "opponent" and bool(
        getattr(event, "opposition_player_id", None) and getattr(event, "opposition_sub_in_player_id", None)
    )


async def apply_substitution_event(db: AsyncSession, event) -> None:
    """Called when a substitution event is written. Ids that are not in this match's lineup are dropped from the
    event so a client can never attach another club's player."""
    if not _is_opposition_sub(event):
        return
    if not await _swap(db, event.match_id, event.opposition_player_id, event.opposition_sub_in_player_id):
        event.opposition_player_id = None
        event.opposition_sub_in_player_id = None


async def undo_substitution_event(db: AsyncSession, event) -> None:
    """Called when a substitution event is removed: put the two players back where they were."""
    if _is_opposition_sub(event):
        await _swap(db, event.match_id, event.opposition_sub_in_player_id, event.opposition_player_id)
