"""
API routes for fixtures — upcoming matches, fixture previews, scraping, and file import.
"""

import csv
import io
import logging
from datetime import datetime, time as dt_time
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import AuthenticatedUser, require_club
from app.database import get_db, async_session_maker
from app.models.match import Match, MatchStatus, MatchVenue
from app.schemas.match import MatchResponse
from app.services.fixture_scraper import FixtureScraperService, DUNGLOE_NAMES, _normalize_team, _is_dungloe

logger = logging.getLogger(__name__)

router = APIRouter()


def _format_gaa_score(goals: int, points: int) -> str:
    return f"{goals}-{points}"


@router.get("/")
async def list_fixtures(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """List upcoming fixtures (scheduled matches with future dates, ordered by date ASC)."""
    now = datetime.utcnow()
    result = await db.execute(
        select(Match)
        .where(
            and_(
                Match.club_id == user.club_id,
                Match.status == MatchStatus.SCHEDULED,
                Match.is_deleted == False,
                Match.match_date >= now,
            )
        )
        .order_by(Match.match_date.asc())
    )
    matches = result.scalars().all()
    return [MatchResponse.model_validate(m) for m in matches]


@router.get("/{match_id}/preview")
async def fixture_preview(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Fixture preview: match details + our recent form + opponent form + last meeting."""
    result = await db.execute(
        select(Match).where(
            and_(
                Match.id == match_id,
                Match.club_id == user.club_id,
                Match.is_deleted == False,
            )
        )
    )
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    our_result = await db.execute(
        select(Match)
        .where(
            and_(
                Match.club_id == user.club_id,
                Match.status == MatchStatus.COMPLETED,
                Match.is_deleted == False,
            )
        )
        .order_by(Match.match_date.desc())
        .limit(5)
    )
    our_matches = our_result.scalars().all()
    our_form = []
    for m in our_matches:
        our_form.append({
            "date": m.match_date.isoformat(),
            "opponent_faced": m.opponent,
            "score_for": _format_gaa_score(m.team_goals, m.team_points),
            "score_against": _format_gaa_score(m.opponent_goals, m.opponent_points),
            "result": "W" if m.result == "win" else ("L" if m.result == "loss" else "D"),
            "competition": m.competition,
        })

    opponent_form = await FixtureScraperService.get_opponent_form(
        db, match.opponent, user.club_id
    )
    last_meeting = await FixtureScraperService.get_last_meeting(
        db, match.opponent, user.club_id
    )

    return {
        "match": MatchResponse.model_validate(match),
        "our_form": our_form,
        "opponent_form": opponent_form,
        "last_meeting": last_meeting,
    }


async def _run_sync(club_id: UUID):
    """Background task to run the fixture sync."""
    async with async_session_maker() as db:
        try:
            stats = await FixtureScraperService.sync_all(db, club_id)
            logger.info(f"Fixture sync completed for club {club_id}: {stats}")
        except Exception as e:
            logger.error(f"Fixture sync failed for club {club_id}: {e}")


@router.post("/sync")
async def sync_fixtures(
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_club),
):
    """Trigger scrape from donegalgaa.ie. Runs in background, returns immediately."""
    background_tasks.add_task(_run_sync, user.club_id)
    return {"status": "syncing", "message": "Fixture sync started in background"}


# ---------------------------------------------------------------------------
# Shared helpers for import
# ---------------------------------------------------------------------------

VENUE_MAP = {
    "home": MatchVenue.HOME, "h": MatchVenue.HOME,
    "away": MatchVenue.AWAY, "a": MatchVenue.AWAY,
    "neutral": MatchVenue.NEUTRAL, "n": MatchVenue.NEUTRAL,
}

DATE_FORMATS = [
    "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d/%m/%Y %H:%M", "%d/%m/%Y",
    "%d-%m-%Y %H:%M", "%d-%m-%Y", "%d %b %Y %H:%M", "%d %b %Y",
    "%d %B %Y %H:%M", "%d %B %Y",
]


def _parse_date(raw: str) -> datetime | None:
    raw = raw.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


async def _check_duplicate(db: AsyncSession, club_id: UUID, opponent: str, match_date: datetime) -> bool:
    day_start = match_date.replace(hour=0, minute=0, second=0)
    day_end = match_date.replace(hour=23, minute=59, second=59)
    existing = await db.execute(
        select(Match).where(
            and_(
                Match.club_id == club_id,
                Match.opponent == opponent,
                Match.match_date >= day_start,
                Match.match_date <= day_end,
                Match.is_deleted == False,
            )
        )
    )
    return existing.scalar_one_or_none() is not None


# ---------------------------------------------------------------------------
# XLSX import (county board format)
# ---------------------------------------------------------------------------

def _parse_xlsx_fixtures(content: bytes) -> list[dict]:
    """
    Parse county board XLSX fixture files.

    Expects columns like:
      Division Name | Home Organization | Away Organization | Start Date | Start Time | Round
    or (U16 style):
      Age Level | Division Name | Home Organization | Away Organization | Start Date | Start Time | Round

    Only returns rows where Dungloe (An Clochán Liath) is home or away.
    Skips U16 / underage sheets.
    """
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    fixtures = []

    for sheet_name in wb.sheetnames:
        # TODO: When we support underage teams, let the user pick which sheet
        # to import rather than auto-skipping. For now, senior only.
        lower_name = sheet_name.lower()
        if any(tag in lower_name for tag in ["u16", "u14", "u12", "u18", "minor", "underage"]):
            continue

        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        # Find header row and map columns
        header = [str(c).strip().lower() if c else "" for c in rows[0]]

        col_map = {}
        for i, h in enumerate(header):
            if h in ("division name", "division", "comp", "competition"):
                col_map["competition"] = i
            elif h in ("home organization", "home organisation", "home team", "home"):
                col_map["home"] = i
            elif h in ("away organization", "away organisation", "away team", "away"):
                col_map["away"] = i
            elif h in ("start date", "date", "match date"):
                col_map["date"] = i
            elif h in ("start time", "time", "throw-in"):
                col_map["time"] = i
            elif h in ("round", "round no"):
                col_map["round"] = i

        if "home" not in col_map or "away" not in col_map or "date" not in col_map:
            continue  # skip sheets we can't parse

        for row in rows[1:]:
            if not row or len(row) <= max(col_map.values()):
                continue

            home_raw = str(row[col_map["home"]] or "").strip()
            away_raw = str(row[col_map["away"]] or "").strip()
            if not home_raw or not away_raw:
                continue

            # Only keep Dungloe fixtures
            is_home = _is_dungloe(home_raw)
            is_away = _is_dungloe(away_raw)
            if not is_home and not is_away:
                continue

            # Parse date
            date_val = row[col_map["date"]]
            if isinstance(date_val, datetime):
                match_date = date_val
            elif date_val:
                match_date = _parse_date(str(date_val))
                if not match_date:
                    continue
            else:
                continue

            # Parse time
            time_val = row[col_map.get("time", -1)] if "time" in col_map else None
            if time_val:
                if isinstance(time_val, dt_time):
                    match_date = match_date.replace(hour=time_val.hour, minute=time_val.minute)
                elif isinstance(time_val, datetime):
                    match_date = match_date.replace(hour=time_val.hour, minute=time_val.minute)
                else:
                    time_str = str(time_val).strip()
                    try:
                        t = datetime.strptime(time_str, "%H:%M:%S")
                        match_date = match_date.replace(hour=t.hour, minute=t.minute)
                    except ValueError:
                        try:
                            t = datetime.strptime(time_str, "%H:%M")
                            match_date = match_date.replace(hour=t.hour, minute=t.minute)
                        except ValueError:
                            pass

            opponent = _normalize_team(away_raw) if is_home else _normalize_team(home_raw)
            venue = MatchVenue.HOME if is_home else MatchVenue.AWAY
            competition = str(row[col_map["competition"]]).strip() if "competition" in col_map and row[col_map["competition"]] else None
            round_val = str(row[col_map["round"]]).strip() if "round" in col_map and row[col_map["round"]] else None

            fixtures.append({
                "opponent": opponent,
                "match_date": match_date,
                "venue": venue,
                "competition": competition,
                "round": round_val,
            })

    return fixtures


# ---------------------------------------------------------------------------
# Unified import endpoint (CSV + XLSX)
# ---------------------------------------------------------------------------

@router.post("/import")
async def import_fixtures(
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Import fixtures from a CSV or XLSX file.

    **XLSX** (county board format): auto-detects Dungloe fixtures from
    Home/Away Organization columns. Skips underage sheets.

    **CSV** (manual format): expects columns Opponent, Date, Time, Venue, Competition.
    """
    filename = (file.filename or "").lower()
    content = await file.read()

    if filename.endswith(".xlsx"):
        return await _import_xlsx(content, user.club_id, db)
    elif filename.endswith(".csv"):
        return await _import_csv(content, user.club_id, db)
    else:
        raise HTTPException(status_code=400, detail="Please upload a .csv or .xlsx file")


async def _import_xlsx(content: bytes, club_id: UUID, db: AsyncSession) -> dict:
    try:
        fixtures = _parse_xlsx_fixtures(content)
    except Exception as e:
        logger.error(f"XLSX parse error: {e}")
        raise HTTPException(status_code=400, detail=f"Could not parse XLSX file: {e}")

    if not fixtures:
        raise HTTPException(
            status_code=400,
            detail="No Dungloe (An Clochán Liath) fixtures found in the file. "
                   "Make sure the file has Home/Away Organization columns.",
        )

    created = 0
    skipped = 0

    for f in fixtures:
        if await _check_duplicate(db, club_id, f["opponent"], f["match_date"]):
            skipped += 1
            continue

        notes = f"Round {f['round']}" if f.get("round") else None
        new_match = Match(
            club_id=club_id,
            opponent=f["opponent"],
            match_date=f["match_date"],
            venue=f["venue"],
            competition=f["competition"],
            notes=notes,
            status=MatchStatus.SCHEDULED,
        )
        db.add(new_match)
        created += 1

    await db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "errors": [],
        "message": f"Imported {created} fixture(s)" + (f", {skipped} skipped (duplicates)" if skipped else ""),
    }


async def _import_csv(content: bytes, club_id: UUID, db: AsyncSession) -> dict:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file is empty or has no header row")

    header_map: dict[str, str] = {}
    for h in reader.fieldnames:
        lower = h.strip().lower()
        if lower in ("opponent", "opposition", "team"):
            header_map[h] = "opponent"
        elif lower in ("date", "match_date", "match date"):
            header_map[h] = "date"
        elif lower in ("time", "throw-in", "throw_in", "kickoff", "kick-off"):
            header_map[h] = "time"
        elif lower in ("venue", "home/away", "h/a"):
            header_map[h] = "venue"
        elif lower in ("competition", "comp", "tournament"):
            header_map[h] = "competition"

    if "opponent" not in header_map.values():
        raise HTTPException(
            status_code=400,
            detail="CSV must have an 'Opponent' column. Found: " + ", ".join(reader.fieldnames),
        )
    if "date" not in header_map.values():
        raise HTTPException(
            status_code=400,
            detail="CSV must have a 'Date' column. Found: " + ", ".join(reader.fieldnames),
        )

    created = 0
    skipped = 0
    errors = []

    for row_num, row in enumerate(reader, start=2):
        mapped = {}
        for orig_key, val in row.items():
            norm = header_map.get(orig_key)
            if norm:
                mapped[norm] = (val or "").strip()

        opponent = mapped.get("opponent", "").strip()
        date_raw = mapped.get("date", "").strip()
        if not opponent or not date_raw:
            skipped += 1
            continue

        match_date = _parse_date(date_raw)
        if not match_date:
            errors.append(f"Row {row_num}: could not parse date '{date_raw}'")
            continue

        time_raw = mapped.get("time", "").strip()
        if time_raw and match_date.hour == 0 and match_date.minute == 0:
            try:
                t = datetime.strptime(time_raw, "%H:%M")
                match_date = match_date.replace(hour=t.hour, minute=t.minute)
            except ValueError:
                pass
        elif match_date.hour == 0 and match_date.minute == 0:
            match_date = match_date.replace(hour=15, minute=0)

        venue_raw = mapped.get("venue", "home").strip().lower()
        venue = VENUE_MAP.get(venue_raw, MatchVenue.HOME)
        competition = mapped.get("competition") or None

        if await _check_duplicate(db, club_id, opponent, match_date):
            skipped += 1
            continue

        new_match = Match(
            club_id=club_id,
            opponent=opponent,
            match_date=match_date,
            venue=venue,
            competition=competition,
            status=MatchStatus.SCHEDULED,
        )
        db.add(new_match)
        created += 1

    await db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "message": f"Imported {created} fixture(s)" + (f", {skipped} skipped" if skipped else ""),
    }


@router.get("/opponent/{name}/form")
async def opponent_form(
    name: str,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Get an opponent's recent results from scraped data."""
    form = await FixtureScraperService.get_opponent_form(db, name, user.club_id)
    return form
